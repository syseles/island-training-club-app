-- Island Training Club — RSVP events (post-training lunch)
--
-- RSVP sessions are price_hkd = 0 operational sessions whose template sets
-- requires_rsvp: no in-app payment, but members commit so the organizer gets
-- a headcount. Joining confirms instantly; withdrawing is member self-service
-- (no money ever moved, so no admin involvement).
--
-- Depends on 20260829000001_one_off_events.sql (category/maps_query columns,
-- template-name booking snapshots).

-- =====================================================================
-- Template support
-- =====================================================================

-- Allow the recurring lunch template alongside the HYROX templates and
-- one-off event templates.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (activity_id in ('hyrox', 'hyrox-midtown', 'lunch') or activity_id like 'event-%');

alter table public.operational_activity_templates
  add column if not exists requires_rsvp boolean not null default false;

-- The recurring Saturday post-training lunch. Active, so
-- ensure_operational_sessions generates it weekly (Saturdays only — the
-- lunch follows the morning HYROX sessions by design).
insert into public.operational_activity_templates
  (activity_id, name, venue, weekday, start_time, duration_minutes,
   capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
values
  ('lunch', 'Post-Training Lunch', 'Announced weekly', 6, '12:45', 75,
   12, 0, true, true, 'Meals', null, true)
on conflict (activity_id) do nothing;

-- =====================================================================
-- Reservation: price-0 RSVP sessions confirm instantly
-- =====================================================================

create or replace function public.reserve_operational_session(
  p_session_id text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_session public.operational_sessions;
  v_template_name text;
  v_is_rsvp boolean;
  v_active_count integer;
  v_existing uuid;
  v_deadline timestamptz;
  v_booking public.operational_bookings;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  -- Lock the session row to serialize capacity decisions.
  select * into v_session
    from public.operational_sessions
   where id = p_session_id
     for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if not v_session.is_open then
    raise exception 'Session is not open.' using errcode = '23514';
  end if;

  v_is_rsvp := v_session.price_hkd = 0;
  if v_is_rsvp then
    -- RSVP: same-day sign-up is fine until the event starts.
    if (v_session.session_date + v_session.start_time) <= now() then
      raise exception 'Session has already started.' using errcode = '23514';
    end if;
  elsif v_session.session_date <= current_date then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  -- One active booking per member per session.
  select id into v_existing
    from public.operational_bookings
   where profile_id = v_uid
     and session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_existing is not null then
    raise exception 'Already booked.' using errcode = '23514';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings
   where session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_active_count >= v_session.capacity then
    raise exception 'Session is full.' using errcode = '23514';
  end if;

  select t.name into v_template_name
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  -- Pay deadline: session_date minus two days at 15:59 (weekday-agnostic).
  -- RSVP bookings skip payment entirely, so the deadline is just "now".
  v_deadline := case when v_is_rsvp
    then now()
    else (v_session.session_date - interval '2 days')::date + time '15:59'
  end;

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at, paid_at, snapshot)
  values
    (v_uid, p_session_id,
     case when v_is_rsvp then 'confirmed' else 'reserved' end,
     now(), v_deadline,
     case when v_is_rsvp then now() else null end,
     jsonb_build_object(
       'name', coalesce(v_template_name, v_session.activity_id),
       'session_date', v_session.session_date,
       'start_time', v_session.start_time,
       'venue', v_session.venue,
       'price_hkd', v_session.price_hkd
     ))
  returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  values (v_uid,
          case when v_is_rsvp then 'operational_rsvp_confirmed' else 'operational_booking_reserved' end,
          case when v_is_rsvp then 'You''re in' else 'Booking reserved' end,
          case when v_is_rsvp
            then 'You''re on the list for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. Everyone pays their own bill — see you there.'
            else 'You have a reserved spot for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. Pay by ' || v_deadline::text || '.'
          end);

  return v_booking;
end;
$$;

grant execute on function public.reserve_operational_session(text) to authenticated;

-- =====================================================================
-- Withdraw an RSVP (member self-service, price-0 sessions only)
-- =====================================================================

create or replace function public.withdraw_operational_rsvp(
  p_booking_id uuid
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
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found or v_booking.profile_id <> v_uid then
    raise exception 'RSVP not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id;
  if v_session.price_hkd > 0 or v_booking.status <> 'confirmed' then
    raise exception 'Only your own confirmed RSVP can be withdrawn.'
      using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'cancelled'
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;
