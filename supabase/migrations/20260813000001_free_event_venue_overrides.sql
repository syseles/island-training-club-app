-- Island Training Club — shared free-event venue overrides
--
-- Adds the per-week venue override table for free activities (wnt, run,
-- water) and the `set_session_venue` Admin RPC. The RPC is the only
-- mutation path; clients and anon/authenticated roles hold only SELECT
-- privileges because free-event details are public. Notification fan-out
-- for member and admin audiences is performed atomically inside the RPC
-- so the override and its notifications commit together.
--
-- The new `notifications.destination` column lets each notification record
-- where it should land in the app; venue-confirmation notifications point
-- at the dated activity page.

-- =====================================================================
-- Schema additions
-- =====================================================================

alter table public.notifications
  add column if not exists destination text;

create table public.operational_session_venue_overrides (
  session_id          text primary key
    check (session_id ~ '^(wnt|run|water)-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  activity_id         text not null
    check (activity_id in ('wnt', 'run', 'water')),
  location            text,
  maps_query          text,
  set_by              uuid references public.profiles(id),
  set_at              timestamptz,
  member_notified_at  timestamptz,
  check (activity_id = regexp_replace(session_id, '-[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''))
);

create index operational_session_venue_overrides_activity_idx
  on public.operational_session_venue_overrides (activity_id, session_id desc);

-- =====================================================================
-- Row Level Security + grants
-- =====================================================================

alter table public.operational_session_venue_overrides enable row level security;

create policy "public read session venue overrides"
  on public.operational_session_venue_overrides for select
  using (true);

-- Direct client writes are denied; the RPC is the single mutation path.
revoke all on table public.operational_session_venue_overrides from anon;
revoke all on table public.operational_session_venue_overrides from authenticated;
grant select on table public.operational_session_venue_overrides to anon, authenticated;

-- =====================================================================
-- set_session_venue
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
begin
  perform public.operational_assert_admin('set_session_venue');

  v_session_id := trim(p_session_id);
  if v_session_id is null or v_session_id = '' then
    raise exception 'Session id is required.' using errcode = '22023';
  end if;

  v_activity_id := regexp_replace(v_session_id, '-[0-9]{4}-[0-9]{2}-[0-9]{2}$', '');
  if v_activity_id not in ('wnt', 'run', 'water') then
    raise exception 'Activity venue is fixed.' using errcode = '42501';
  end if;

  v_location := nullif(trim(p_location), '');
  v_maps_query := nullif(trim(p_maps_query), '');

  -- Lock an existing row, if any, so concurrent admins serialize.
  select * into v_existing
    from public.operational_session_venue_overrides
   where session_id = v_session_id
   for update;

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
  v_session_label := v_activity_id || ' on ' || split_part(v_session_id, '-', 2)
                     || '-' || split_part(v_session_id, '-', 3)
                     || '-' || split_part(v_session_id, '-', 4);

  -- Member fan-out fires once per session when the venue moves from
  -- TBC/empty to a real location, regardless of subsequent edits.
  v_should_notify_members := coalesce(p_was_tbc, false)
                             and v_existing.session_id is not null -- no first confirmation when brand new
                             and v_existing.member_notified_at is null
                             and v_location is not null
                             and v_maps_query is not null;

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
             format('Admin reset the venue for %s to the activity default.', v_session_id)
           else
             format('Admin set the venue for %s to %s.', v_session_id, v_location)
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