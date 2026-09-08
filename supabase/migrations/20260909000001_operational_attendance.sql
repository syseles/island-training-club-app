-- Island Training Club — Admin attendance for paid operational sessions
--
-- Attendance remains part of the paid booking lifecycle: confirmed means
-- Expected and attended means an Admin manually recorded Arrived.

alter table public.operational_bookings
  add column if not exists attended_at timestamptz,
  add column if not exists attended_by uuid references public.profiles(id);

alter table public.operational_bookings
  drop constraint if exists operational_bookings_status_check;
alter table public.operational_bookings
  add constraint operational_bookings_status_check
  check (status in ('reserved', 'confirmed', 'attended', 'cancelled', 'expired', 'deferred'));

alter table public.operational_bookings
  drop constraint if exists operational_bookings_attendance_consistent;
alter table public.operational_bookings
  add constraint operational_bookings_attendance_consistent check (
    (status = 'attended' and attended_at is not null and attended_by is not null)
    or
    (status <> 'attended' and attended_at is null and attended_by is null)
  );

-- An attended booking remains active for uniqueness purposes. Rebuild these
-- two partial indexes under their existing names without changing their keys.
drop index if exists public.operational_bookings_one_active_per_session;
create unique index operational_bookings_one_active_per_session
  on public.operational_bookings(profile_id, session_id)
  where status in ('reserved', 'confirmed', 'attended');

drop index if exists public.operational_bookings_one_active_per_hyrox_cycle;
create unique index operational_bookings_one_active_per_hyrox_cycle
  on public.operational_bookings(profile_id, hyrox_cycle_id)
  where hyrox_cycle_id is not null
    and status in ('reserved', 'confirmed', 'attended');

create or replace function public.set_operational_attendance(
  p_booking_id uuid,
  p_arrived boolean
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_start timestamptz;
  v_close timestamptz;
begin
  perform public.operational_assert_admin('set_attendance');
  if p_arrived is null then
    raise exception 'Attendance state is required.' using errcode = '22004';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  if v_booking.session_id is null then
    raise exception 'Assigned session not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
   for share;
  if not found then
    raise exception 'Assigned session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_session.price_hkd <= 0 then
    raise exception 'Attendance check-in is for paid sessions only.' using errcode = '23514';
  end if;
  if v_booking.status not in ('confirmed', 'attended') then
    raise exception 'Only confirmed-paid bookings can be checked in.' using errcode = '23514';
  end if;

  v_start := (v_session.session_date + v_session.start_time)
    at time zone 'Asia/Hong_Kong';
  v_close := v_start
    + make_interval(mins => v_session.duration_minutes)
    + interval '24 hours';
  if now() < v_start - interval '15 minutes' or now() > v_close then
    raise exception 'Attendance is outside the check-in window.' using errcode = '23514';
  end if;

  if p_arrived and v_booking.status = 'confirmed' then
    update public.operational_bookings
       set status = 'attended',
           attended_at = now(),
           attended_by = v_uid
     where id = p_booking_id
     returning * into v_booking;
  elsif not p_arrived and v_booking.status = 'attended' then
    update public.operational_bookings
       set status = 'confirmed',
           attended_at = null,
           attended_by = null
     where id = p_booking_id
     returning * into v_booking;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.set_operational_attendance(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_operational_attendance(uuid, boolean) to authenticated;

-- Arrived remains an active paid-attendee state. Keep the existing narrow
-- display-name RPC useful after an Admin checks a member in without widening
-- its profile fields, caller roles, or paid-session boundary.
create or replace function public.get_operational_attendee_names(
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
  v_is_paid boolean;
begin
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select t.price_hkd > 0
    into v_is_paid
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not coalesce(v_is_paid, false) then
    return;
  end if;

  return query
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
    join public.profiles p on p.id = b.profile_id
    left join public.applications a on a.profile_id = p.id
   where b.session_id = p_session_id
     and b.status in ('confirmed', 'attended')
   order by b.created_at, b.id;
end;
$$;

revoke all on function public.get_operational_attendee_names(text)
  from public, anon, authenticated;
grant execute on function public.get_operational_attendee_names(text)
  to authenticated;
