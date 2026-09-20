-- Island Training Club — weekly venue overrides for the RSVP lunch
--
-- The post-training lunch venue changes weekly, so lunch sessions join the
-- free-event venue override mechanism (one dated session at a time). The
-- lunch template and any already-generated lunch sessions move from the
-- 'Announced weekly' placeholder to 'TBC' so the app shows the venue as
-- unconfirmed until an admin sets it.
--
-- Depends on 20260829000002_rsvp_events.sql (lunch template).

-- =====================================================================
-- Allow lunch rows in the override table
-- =====================================================================

alter table public.operational_session_venue_overrides
  drop constraint operational_session_venue_overrides_session_id_check;
alter table public.operational_session_venue_overrides
  add constraint operational_session_venue_overrides_session_id_check
  check (session_id ~ '^(wnt|run|water|lunch)-[0-9]{4}-[0-9]{2}-[0-9]{2}$');

alter table public.operational_session_venue_overrides
  drop constraint operational_session_venue_overrides_activity_id_check;
alter table public.operational_session_venue_overrides
  add constraint operational_session_venue_overrides_activity_id_check
  check (activity_id in ('wnt', 'run', 'water', 'lunch'));

-- =====================================================================
-- Lunch venue becomes TBC until set per week
-- =====================================================================

update public.operational_activity_templates
   set venue = 'TBC'
 where activity_id = 'lunch' and venue = 'Announced weekly';

update public.operational_sessions
   set venue = 'TBC'
 where activity_id = 'lunch' and venue = 'Announced weekly';

-- =====================================================================
-- set_session_venue: admit lunch sessions
-- =====================================================================

create or replace function public.set_session_venue(
  p_session_id text,
  p_location   text,
  p_maps_query text,
  p_was_tbc    boolean
)
returns public.operational_session_venue_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id text;
  v_actor uuid := auth.uid();
  v_activity_id text;
  v_location text;
  v_maps_query text;
  v_existing public.operational_session_venue_overrides;
  v_saved public.operational_session_venue_overrides;
  v_changed boolean := false;
  v_should_notify_members boolean := false;
  v_destination text;
  v_session_label text;
  v_actor_label text;
begin
  perform public.operational_assert_admin('set_session_venue');

  v_session_id := trim(p_session_id);
  if v_session_id is null or v_session_id = '' then
    raise exception 'Session id is required.' using errcode = '22023';
  end if;

  v_activity_id := regexp_replace(v_session_id, '-[0-9]{4}-[0-9]{2}-[0-9]{2}$', '');
  if v_activity_id not in ('wnt', 'run', 'water', 'lunch') then
    raise exception 'Activity venue is fixed.' using errcode = '42501';
  end if;

  v_location := nullif(trim(p_location), '');
  v_maps_query := nullif(trim(p_maps_query), '');

  select coalesce(nullif(trim(full_name), ''), email, 'Admin')
    into v_actor_label
    from public.profiles
   where id = v_actor;
  v_actor_label := coalesce(v_actor_label, 'Admin');

  -- A row lock cannot serialize the first insert because no row exists yet.
  -- Lock the dated session key first so concurrent first saves cannot both
  -- fan out member notifications or overwrite the dedupe timestamp.
  perform pg_advisory_xact_lock(hashtext('set_session_venue'), hashtext(v_session_id));

  select * into v_existing
    from public.operational_session_venue_overrides
   where session_id = v_session_id
   for update;

  -- Resetting a session that has never had an override is a true no-op.
  if v_existing.session_id is null and v_location is null and v_maps_query is null then
    return v_existing;
  end if;

  v_changed := (v_existing.location is distinct from v_location)
               or (v_existing.maps_query is distinct from v_maps_query);

  if not v_changed and v_existing.session_id is not null then
    return v_existing;
  end if;

  insert into public.operational_session_venue_overrides
    (session_id, activity_id, location, maps_query, set_by, set_at, member_notified_at)
  values
    (v_session_id, v_activity_id, v_location, v_maps_query, v_actor, now(), v_existing.member_notified_at)
  on conflict (session_id) do update
    set location = excluded.location,
        maps_query = excluded.maps_query,
        set_by = excluded.set_by,
        set_at = excluded.set_at,
        member_notified_at = excluded.member_notified_at
  returning * into v_saved;

  v_destination := '#/activity/' || v_session_id;
  v_session_label := case v_activity_id
    when 'wnt' then 'Wednesday Night Training'
    when 'run' then 'ITC Run Club'
    when 'water' then 'ITC Swimming'
    when 'lunch' then 'Post-Training Lunch'
  end || ' on ' || substring(v_session_id from '([0-9]{4}-[0-9]{2}-[0-9]{2})$');

  -- Member fan-out fires once per session when both member-facing location
  -- and map query become usable. A first complete row and completion of a
  -- retained partial row are both real confirmations.
  v_should_notify_members := v_existing.member_notified_at is null
                             and v_location is not null
                             and upper(v_location) <> 'TBC'
                             and v_maps_query is not null
                             and upper(v_maps_query) <> 'TBC'
                             and (
                               v_existing.session_id is null
                               or v_existing.location is null
                               or v_existing.maps_query is null
                               or coalesce(p_was_tbc, false)
                             );

  if v_should_notify_members then
    update public.operational_session_venue_overrides
       set member_notified_at = now()
     where session_id = v_session_id
     returning * into v_saved;

    insert into public.notifications (profile_id, kind, title, body, destination)
    select p.id,
           'operational_session_venue_updated',
           'Venue confirmed',
           format('%s is at %s. Check the activity page for details.', v_session_label, v_location),
           v_destination
      from public.profiles p
     where p.role = 'member';
  end if;

  -- Admin audit fan-out fires on every actual save/reset, excluding
  -- the actor so the form's own feedback remains the actor's only signal.
  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'operational_session_venue_updated',
         'Session venue updated',
         case
           when v_location is null and v_maps_query is null then
             format('%s reset the venue for %s to the activity default.', v_actor_label, v_session_id)
           else
             format('%s set the venue for %s to %s.',
                    v_actor_label, v_session_id, coalesce(v_location, 'the activity default'))
         end,
         v_destination
    from public.profiles p
   where p.role in ('admin', 'super_admin')
     and p.id <> v_actor;

  return v_saved;
end;
$$;

revoke execute on function public.set_session_venue(text, text, text, boolean) from public, anon;
grant execute on function public.set_session_venue(text, text, text, boolean) to authenticated;
