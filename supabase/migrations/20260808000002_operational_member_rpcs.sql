-- Island Training Club — shared HYROX operational member RPCs
--
-- Adds bounded session generation and member-facing RPCs:
--   ensure_operational_sessions
--   reserve_operational_session
--   join_operational_queue
--   leave_operational_queue
--   mark_operational_payment
--   defer_operational_booking
-- All functions are SECURITY DEFINER with a fixed search_path and assert
-- role/cancellation/start/availability under row locks. Member writes are
-- routed exclusively through these functions; no direct INSERT/UPDATE
-- privilege is granted to authenticated.

-- =====================================================================
-- Session generation
-- =====================================================================

create or replace function public.ensure_operational_sessions(
  p_start_date date,
  p_weeks      integer default 16
)
returns setof public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_saturday date;
  v_template record;
  v_series date;
  v_id text;
  v_session public.operational_sessions;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 16 then
    raise exception 'ensure_operational_sessions: weeks must be between 1 and 16.'
      using errcode = '22023';
  end if;

  -- Snap to the first Saturday on or after p_start_date.
  v_first_saturday := p_start_date + ((6 - extract(dow from p_start_date)::integer) % 7);

  for v_series in
    select v_first_saturday + (7 * (gs - 1))::integer
      from generate_series(1, p_weeks) gs
  loop
    for v_template in
      select * from public.operational_activity_templates where active
    loop
      v_id := v_template.activity_id || '-' || v_series::text;
      insert into public.operational_sessions
        (id, activity_id, session_date, start_time, duration_minutes,
         venue, capacity, price_hkd, is_open)
      values
        (v_id, v_template.activity_id, v_series, v_template.start_time,
         v_template.duration_minutes, v_template.venue, v_template.capacity,
         v_template.price_hkd, v_template.default_open)
      on conflict (id) do nothing;
    end loop;
  end loop;

  return query
    select * from public.operational_sessions
     where session_date between v_first_saturday
                            and v_first_saturday + (7 * (p_weeks - 1))::integer
     order by session_date, activity_id;
end;
$$;

grant execute on function public.ensure_operational_sessions(date, integer) to authenticated;

-- =====================================================================
-- Reservation
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

  -- Pay deadline: Thursday 23:59 HK time of the same week as session_date.
  -- session_date is Saturday; Thursday is two days before.
  v_deadline := (v_session.session_date - interval '2 days')::date + time '15:59';

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot)
  values
    (v_uid, p_session_id, 'reserved', now(), v_deadline,
     jsonb_build_object(
       'name', v_session.activity_id,
       'session_date', v_session.session_date,
       'start_time', v_session.start_time,
       'venue', v_session.venue,
       'price_hkd', v_session.price_hkd
     ))
  returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  values (v_uid, 'operational_booking_reserved',
          'Booking reserved',
          'You have a reserved spot for ' || v_session.activity_id
            || ' on ' || v_session.session_date::text
            || '. Pay by ' || v_deadline::text || '.');

  return v_booking;
end;
$$;

grant execute on function public.reserve_operational_session(text) to authenticated;

-- =====================================================================
-- Queue management
-- =====================================================================

create or replace function public.join_operational_queue(
  p_session_id text,
  p_kind       text
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_session public.operational_sessions;
  v_active_count integer;
  v_entry public.operational_queue_entries;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_kind not in ('waitlist', 'interest') then
    raise exception 'Invalid queue kind.' using errcode = '22023';
  end if;

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
  if v_session.session_date <= current_date then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  -- Reject if member already has an active booking.
  if exists (
    select 1 from public.operational_bookings
     where profile_id = v_uid
       and session_id = p_session_id
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'Already booked.' using errcode = '23514';
  end if;

  if p_kind = 'waitlist' then
    if not v_session.is_open then
      raise exception 'Session is not open.' using errcode = '23514';
    end if;
    select count(*) into v_active_count
      from public.operational_bookings
     where session_id = p_session_id
       and status in ('reserved', 'confirmed');
    if v_active_count < v_session.capacity then
      raise exception 'Session is not full.' using errcode = '23514';
    end if;
  else
    -- interest: only valid on closed Midtown sessions.
    if v_session.activity_id <> 'hyrox-midtown' or v_session.is_open then
      raise exception 'Interest list is only for closed Midtown sessions.' using errcode = '23514';
    end if;
  end if;

  -- Idempotency via partial unique index handles duplicate active entries.
  insert into public.operational_queue_entries
    (session_id, profile_id, kind, status)
  values (p_session_id, v_uid, p_kind, 'active')
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.join_operational_queue(text, text) to authenticated;

create or replace function public.leave_operational_queue(
  p_entry_id uuid
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_entry public.operational_queue_entries;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select * into v_entry
    from public.operational_queue_entries
   where id = p_entry_id
     for update;
  if not found then
    raise exception 'Queue entry not found.' using errcode = 'P0002';
  end if;
  if v_entry.profile_id <> v_uid and not public.operational_is_admin() then
    raise exception 'Not authorized for this queue entry.' using errcode = '42501';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'Queue entry is not active.' using errcode = '23514';
  end if;

  update public.operational_queue_entries
     set status = 'left',
         resolved_at = now()
   where id = p_entry_id
   returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function public.leave_operational_queue(uuid) to authenticated;

-- =====================================================================
-- Member payment marking
-- =====================================================================

create or replace function public.mark_operational_payment(
  p_booking_id uuid,
  p_method     text,
  p_reference  text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_method not in ('payme', 'fps') then
    raise exception 'Invalid payment method.' using errcode = '22023';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.profile_id <> v_uid and not public.operational_is_admin() then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Payment has already been processed.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is not null then
    raise exception 'Payment has already been marked.' using errcode = '23514';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
     for share;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set payment_marked_at = now(),
         payment_method = p_method,
         payment_reference = nullif(trim(p_reference), '')
   where id = p_booking_id
   returning * into v_booking;

  -- Notify assigned collector (if any) plus admins.
  insert into public.notifications (profile_id, kind, title, body)
  select coalesce(ca.collector_profile_id, a.id),
         'operational_payment_marked',
         'Payment marked for ' || v_session.activity_id,
         'A member marked payment on ' || v_session.session_date::text || '.'
    from public.operational_sessions s
    left join lateral (
      select collector_profile_id
        from public.collector_assignments
       where week_start <= s.session_date
       order by week_start desc
       limit 1
    ) ca on true
    cross join lateral (
      select id
        from public.profiles
       where role in ('admin', 'super_admin')
    ) a
   where s.id = v_session.id;

  return v_booking;
end;
$$;

grant execute on function public.mark_operational_payment(uuid, text, text) to authenticated;

-- =====================================================================
-- Member deferral
-- =====================================================================

create or replace function public.defer_operational_booking(
  p_booking_id       uuid,
  p_target_session_id text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_src public.operational_bookings;
  v_src_session public.operational_sessions;
  v_tgt public.operational_sessions;
  v_active_count integer;
  v_new_booking public.operational_bookings;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  -- Lock source booking then both sessions in deterministic order.
  select * into v_src
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_src.profile_id <> v_uid and not public.operational_is_admin() then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_src.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be deferred.' using errcode = '23514';
  end if;

  select * into v_src_session from public.operational_sessions where id = v_src.session_id;

  -- Lock source session row (after the booking) and target session row.
  select * into v_src_session
    from public.operational_sessions
   where id = v_src.session_id
     for update;

  select * into v_tgt
    from public.operational_sessions
   where id = p_target_session_id
     for update;
  if not found then
    raise exception 'Target session not found.' using errcode = 'P0002';
  end if;
  if v_tgt.activity_id <> v_src_session.activity_id then
    raise exception 'Target must be a session of the same activity.' using errcode = '23514';
  end if;
  if v_tgt.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_tgt.session_date <= current_date then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;
  if v_tgt.session_date <= v_src_session.session_date then
    raise exception 'Target must be later than the current session.' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.operational_bookings
     where profile_id = v_uid
       and session_id = p_target_session_id
       and status in ('reserved', 'confirmed')
  ) then
    raise exception 'Already booked for the target session.' using errcode = '23514';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings
   where session_id = p_target_session_id
     and status in ('reserved', 'confirmed');
  if v_active_count >= v_tgt.capacity then
    raise exception 'Target session is full.' using errcode = '23514';
  end if;

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at,
     payment_marked_at, payment_method, payment_reference, paid_at,
     confirmed_by, snapshot)
  values
    (v_uid, p_target_session_id, 'confirmed', now(), v_tgt.session_date::timestamptz,
     now(), v_src.payment_method, v_src.payment_reference, now(),
     v_src.confirmed_by, to_jsonb(v_tgt))
  returning * into v_new_booking;

  update public.operational_bookings
     set status = 'deferred',
         deferred_to_booking_id = v_new_booking.id,
         updated_at = now()
   where id = v_src.id
   returning * into v_src;

  update public.operational_bookings
     set deferred_from_booking_id = v_src.id,
         updated_at = now()
   where id = v_new_booking.id;

  return v_new_booking;
end;
$$;

grant execute on function public.defer_operational_booking(uuid, text) to authenticated;
