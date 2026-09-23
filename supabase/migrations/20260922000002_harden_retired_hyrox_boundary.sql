-- Forward-only correction after 20260922000001 (already applied once).
-- Production postgres/public defaults grant EXECUTE to service_role as well
-- as browser roles. CREATE OR REPLACE retains existing ACLs. Close only the
-- retirement helper exposure; do not rewrite shared default privileges or
-- unrelated legacy/job grants. The resolver needs only the session classifier.
revoke execute on function public.operational_is_retired_hyrox_activity(text)
  from service_role;
revoke execute on function public.operational_is_retired_hyrox_booking(uuid)
  from service_role;
grant execute on function public.operational_is_retired_hyrox_session(text)
  to service_role;
revoke execute on function public.operational_notification_is_retired_hyrox(text, text, timestamptz, text, text)
  from service_role;
-- Policy adapters are called only by browser RLS, never by the resolver.
revoke execute on function private.operational_booking_is_active(uuid)
  from service_role;
revoke execute on function private.operational_session_is_active(text)
  from service_role;
revoke execute on function private.operational_notification_is_active(text, text, timestamptz, text, text)
  from service_role;

-- Restore the historical read/read_at boundary despite broad table ACL drift.
-- RLS cannot constrain TRUNCATE. Independent column grants survive a table
-- REVOKE, so clear those too before restoring only the member read marker.
-- PUBLIC is included so an inherited grant cannot defeat browser revocation.
revoke all on table public.notifications from public, anon, authenticated;
revoke all (id, profile_id, kind, title, body, created_at, read_at, destination)
  on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

-- Exact latest intended implementation from
-- 20260910000002_operational_attendee_names_rsvp.sql; only the name changes.
-- Leave the public retirement guard and its approved-member grant untouched.
create or replace function public.get_operational_attendee_names_pre_pool_retirement_20260922(
  p_session_id text
)
returns table(display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_is_roster_event boolean;
  v_profile_expr text;
begin
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select coalesce(t.price_hkd, 0) > 0 or coalesce(t.requires_rsvp, false)
    into v_is_roster_event
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not coalesce(v_is_roster_event, false) then
    return;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_bookings'
       and column_name = 'replacement_profile_id'
  ) then
    v_profile_expr := 'coalesce(b.replacement_profile_id, b.profile_id)';
  else
    v_profile_expr := 'b.profile_id';
  end if;

  return query execute format($query$
    select coalesce(
             nullif(trim(a.preferred_name), '') || case
               when position(' ' in trim(coalesce(p.full_name, ''))) > 0
                 then ' ' || upper(right(trim(p.full_name), 1)) || '.'
               else ''
             end,
             nullif(trim(p.full_name), ''),
             'Member'
           )::text
      from public.operational_bookings b
      join public.profiles p on p.id = %s
      left join public.applications a on a.profile_id = p.id
     where b.session_id = $1
       and b.status = 'confirmed'
     order by b.created_at, b.id
  $query$, v_profile_expr)
  using p_session_id;
end;
$$;

alter function public.get_operational_attendee_names_pre_pool_retirement_20260922(text) owner to postgres;
revoke all on function public.get_operational_attendee_names_pre_pool_retirement_20260922(text)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
