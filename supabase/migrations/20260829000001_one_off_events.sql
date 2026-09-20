-- Island Training Club — one-off events
--
-- Lets admins create single-date events (free or paid, any weekday) from the
-- app, and delete them while they have no bookings. Cancelling a one-off
-- reuses cancel_operational_session (it already voids confirmed bookings when
-- no same-activity follow-up session exists).
--
-- Design: a one-off event is an INACTIVE operational_activity_templates row
-- (id prefix 'event-') plus exactly one operational_sessions row. Inactive
-- templates are skipped by ensure_operational_sessions, so nothing recurs.
-- price_hkd = 0 renders as a free event (no booking/checkout); price > 0
-- flows through the existing reserve/pay/confirm pipeline unchanged.

-- =====================================================================
-- Constraint relaxations
-- =====================================================================

-- Allow one-off template ids alongside the two recurring HYROX templates.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (activity_id in ('hyrox', 'hyrox-midtown') or activity_id like 'event-%');

-- Free one-off events carry price_hkd = 0.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_price_hkd_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_price_hkd_check
  check (price_hkd >= 0);

alter table public.operational_sessions
  drop constraint operational_sessions_price_hkd_check;
alter table public.operational_sessions
  add constraint operational_sessions_price_hkd_check
  check (price_hkd >= 0);

-- Event metadata used by the app (schedule filter category, directions link).
alter table public.operational_activity_templates
  add column if not exists category text not null default 'HYROX',
  add column if not exists maps_query text;

-- =====================================================================
-- Create a one-off event (admin only)
-- =====================================================================

create or replace function public.create_operational_event(
  p_name             text,
  p_session_date     date,
  p_start_time       time,
  p_duration_minutes integer,
  p_venue            text,
  p_maps_query       text default null,
  p_category         text default 'Other',
  p_price_hkd        integer default 0,
  p_capacity         integer default 20
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id text;
  v_session public.operational_sessions;
begin
  perform public.operational_assert_admin('create_event');

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Event name is required.' using errcode = '22023';
  end if;
  if p_session_date is null or p_session_date < current_date then
    raise exception 'Event date must be today or in the future.' using errcode = '22023';
  end if;
  if p_start_time is null then
    raise exception 'Start time is required.' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'Duration must be positive.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_venue, '')), '') is null then
    raise exception 'Venue is required.' using errcode = '22023';
  end if;
  if p_price_hkd is null or p_price_hkd < 0 then
    raise exception 'Price must be zero (free) or positive.' using errcode = '22023';
  end if;
  if p_capacity is null or p_capacity <= 0 then
    raise exception 'Capacity must be positive.' using errcode = '22023';
  end if;

  -- Epoch-suffixed id keeps same-named events unique.
  v_activity_id := 'event-' || floor(extract(epoch from now()))::bigint::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query)
  values
    (v_activity_id, btrim(p_name), btrim(p_venue),
     extract(dow from p_session_date)::smallint, p_start_time, p_duration_minutes,
     p_capacity, p_price_hkd, true, false,
     coalesce(nullif(btrim(p_category), ''), 'Other'),
     nullif(btrim(coalesce(p_maps_query, '')), ''));

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_activity_id || '-' || p_session_date::text, v_activity_id, p_session_date,
     p_start_time, p_duration_minutes, btrim(p_venue), p_capacity, p_price_hkd, true)
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.create_operational_event(text, date, time, integer, text, text, text, integer, integer) to authenticated;

-- =====================================================================
-- Delete a one-off event (admin only, only while it has no bookings)
-- =====================================================================

create or replace function public.delete_operational_event(
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_booking_count integer;
begin
  perform public.operational_assert_admin('delete_event');

  select * into v_session
    from public.operational_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.activity_id not like 'event-%' then
    raise exception 'Only one-off events can be deleted; cancel recurring sessions instead.'
      using errcode = '22023';
  end if;

  select count(*) into v_booking_count
    from public.operational_bookings b
   where b.session_id = p_session_id
     and b.status in ('reserved', 'confirmed');
  if v_booking_count > 0 then
    raise exception 'Event has active bookings — cancel the session instead.'
      using errcode = '23514';
  end if;

  delete from public.operational_queue_entries where session_id = p_session_id;
  delete from public.operational_sessions where id = p_session_id;
  delete from public.operational_activity_templates
   where activity_id = v_session.activity_id and activity_id like 'event-%';
end;
$$;

grant execute on function public.delete_operational_event(text) to authenticated;

-- =====================================================================
-- Snapshot names for one-off bookings
-- =====================================================================

-- Bookings snapshot the template display name instead of the raw activity id
-- so receipts and history for one-off events read naturally.
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
  if v_session.session_date <= current_date then
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
  v_deadline := (v_session.session_date - interval '2 days')::date + time '15:59';

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot)
  values
    (v_uid, p_session_id, 'reserved', now(), v_deadline,
     jsonb_build_object(
       'name', coalesce(v_template_name, v_session.activity_id),
       'session_date', v_session.session_date,
       'start_time', v_session.start_time,
       'venue', v_session.venue,
       'price_hkd', v_session.price_hkd
     ))
  returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  values (v_uid, 'operational_booking_reserved',
          'Booking reserved',
          'You have a reserved spot for ' || coalesce(v_template_name, v_session.activity_id)
            || ' on ' || v_session.session_date::text
            || '. Pay by ' || v_deadline::text || '.');

  return v_booking;
end;
$$;

grant execute on function public.reserve_operational_session(text) to authenticated;
