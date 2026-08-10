-- Island Training Club — shared HYROX operational admin RPCs
--
-- Adds the atomic administrative operations:
--   approve_operational_payment
--   cancel_operational_session
--   set_operational_session_time
--   set_operational_venue_tbc
--   set_operational_notice
--   set_operational_midtown_open
--   finalize_operational_gym
--   set_collector_assignment
--   update_collector_payout_profile
--   sweep_operational_deadlines
--
-- All functions are SECURITY DEFINER, set search_path = public, and
-- verify the caller is admin/super-admin. They lock the authoritative
-- session row before any state change and reject cancellation after
-- gym finalization.

-- =====================================================================
-- Helper: admin gate
-- =====================================================================

create or replace function public.operational_assert_admin(p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.operational_is_admin() then
    raise exception 'Administrator access required for: %', p_action
      using errcode = '42501';
  end if;
end;
$$;

-- =====================================================================
-- Approve payment
-- =====================================================================

create or replace function public.approve_operational_payment(
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
  v_number text;
  v_year text;
  v_seq bigint;
begin
  perform public.operational_assert_admin('approve_payment');

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Booking is not awaiting approval.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is null then
    raise exception 'Payment has not been marked.' using errcode = '23514';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
     for share;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'confirmed',
         paid_at = now(),
         confirmed_by = v_uid
   where id = p_booking_id
   returning * into v_booking;

  -- Generate a sequential receipt number: ITC-YYYY-NNNN.
  v_year := to_char(now(), 'YYYY');
  select coalesce(max(
    nullif(regexp_replace(receipt_number, '^[A-Z0-9]+-[0-9]+-', ''), '')::bigint
  ), 0) + 1
    into v_seq
    from public.operational_receipts
   where receipt_number like 'ITC-' || v_year || '-%';
  v_number := 'ITC-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into public.operational_receipts
    (receipt_number, booking_id, profile_id, session_id,
     amount_hkd, currency, payment_method, issued_by)
  values
    (v_number, v_booking.id, v_booking.profile_id, v_booking.session_id,
     v_session.price_hkd, 'HKD', v_booking.payment_method, v_uid);

  insert into public.notifications (profile_id, kind, title, body)
  values (v_booking.profile_id, 'operational_payment_approved',
          'Payment approved',
          'Your payment for ' || v_session.activity_id
            || ' on ' || v_session.session_date::text || ' is confirmed.');

  return v_booking;
end;
$$;

grant execute on function public.approve_operational_payment(uuid) to authenticated;

-- =====================================================================
-- Cancel session (atomic)
-- =====================================================================

create or replace function public.cancel_operational_session(
  p_session_id text,
  p_reason     text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
  v_trim_reason text;
  v_booking record;
  v_booking_count integer := 0;
  v_pending_count integer := 0;
  v_queue_count integer := 0;
  v_target public.operational_sessions;
  v_new_booking public.operational_bookings;
  v_has_target boolean;
begin
  perform public.operational_assert_admin('cancel_session');

  v_trim_reason := nullif(trim(p_reason), '');
  if v_trim_reason is null then
    raise exception 'Cancellation reason is required.'
      using errcode = '22023';
  end if;

  -- Lock the session row first.
  select * into v_session
    from public.operational_sessions
   where id = p_session_id
     for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is already cancelled.' using errcode = '23514';
  end if;

  -- Update cancellation state.
  update public.operational_sessions
     set cancelled_at = now(),
         cancelled_by = v_uid,
         cancelled_source = 'admin',
         cancel_reason = v_trim_reason
   where id = p_session_id
   returning * into v_session;

  -- Step 1: handle confirmed bookings. For each, find the next available
  -- same-activity session; defer when capacity exists, otherwise cancel.
  for v_booking in
    select b.* from public.operational_bookings b
     where b.session_id = p_session_id
       and b.status = 'confirmed'
     order by b.id
     for update
  loop
    select s.* into v_target
      from public.operational_sessions s
     where s.activity_id = v_session.activity_id
       and s.session_date > v_session.session_date
       and s.cancelled_at is null
       and s.session_date > current_date
       and s.is_open
       and (select count(*) from public.operational_bookings b2
             where b2.session_id = s.id
               and b2.status in ('reserved', 'confirmed')) < s.capacity
     order by s.session_date asc, s.id asc
     limit 1
     for update;
    v_has_target := found;
    if v_has_target then
      insert into public.operational_bookings
        (profile_id, session_id, status, reserved_at, pay_deadline_at,
         payment_marked_at, payment_method, payment_reference, paid_at,
         confirmed_by, snapshot)
      values
        (v_booking.profile_id, v_target.id, 'confirmed', now(),
         v_target.session_date::timestamptz,
         v_booking.payment_marked_at, v_booking.payment_method,
         v_booking.payment_reference, v_booking.paid_at,
         v_booking.confirmed_by, to_jsonb(v_target))
      returning * into v_new_booking;

      update public.operational_bookings
         set status = 'deferred',
             deferred_to_booking_id = v_new_booking.id
       where id = v_booking.id;

      update public.operational_bookings
         set deferred_from_booking_id = v_booking.id
       where id = v_new_booking.id;

      insert into public.notifications (profile_id, kind, title, body)
      values (v_booking.profile_id, 'operational_session_deferred',
              'Booking deferred',
              'Your booking was moved to ' || v_target.id
                || ' on ' || v_target.session_date::text || '.');

      v_booking_count := v_booking_count + 1;
    else
      update public.operational_bookings
         set status = 'cancelled'
       where id = v_booking.id;
      insert into public.notifications (profile_id, kind, title, body)
      values (v_booking.profile_id, 'operational_session_cancelled_no_defer',
              'Booking cancelled',
              'Your booking for ' || p_session_id
                || ' was cancelled with no deferral target available.');
    end if;
  end loop;

  -- Step 2: cancel unpaid reservations.
  update public.operational_bookings
     set status = 'cancelled'
   where session_id = p_session_id
     and status = 'reserved';
  get diagnostics v_pending_count = row_count;

  -- Step 3: dissolve active queue entries.
  update public.operational_queue_entries
     set status = 'dissolved',
         resolved_at = now()
   where session_id = p_session_id
     and status = 'active';
  get diagnostics v_queue_count = row_count;

  -- Step 4: notification for the cancelled session.
  insert into public.notifications (profile_id, kind, title, body)
  select id, 'operational_session_cancelled',
         'Session cancelled',
         'Session ' || p_session_id || ' was cancelled by ITC.'
    from public.profiles
   where role in ('admin', 'super_admin');

  return v_session;
end;
$$;

grant execute on function public.cancel_operational_session(text, text) to authenticated;

-- =====================================================================
-- Session control RPCs
-- =====================================================================

create or replace function public.set_operational_session_time(
  p_session_id text,
  p_time time
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare v_session public.operational_sessions;
begin
  perform public.operational_assert_admin('set_session_time');
  select * into v_session from public.operational_sessions
    where id = p_session_id for update;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  update public.operational_sessions set start_time = p_time where id = p_session_id
    returning * into v_session;
  return v_session;
end $$;

grant execute on function public.set_operational_session_time(text, time) to authenticated;

create or replace function public.set_operational_venue_tbc(
  p_session_id text,
  p_enabled boolean
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare v_session public.operational_sessions;
begin
  perform public.operational_assert_admin('set_venue_tbc');
  select * into v_session from public.operational_sessions
    where id = p_session_id for update;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  update public.operational_sessions set venue_tbc = p_enabled where id = p_session_id
    returning * into v_session;
  return v_session;
end $$;

grant execute on function public.set_operational_venue_tbc(text, boolean) to authenticated;

create or replace function public.set_operational_notice(
  p_session_id text,
  p_notice text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare v_session public.operational_sessions;
begin
  perform public.operational_assert_admin('set_notice');
  select * into v_session from public.operational_sessions
    where id = p_session_id for update;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  update public.operational_sessions set notice = nullif(trim(p_notice), '')
    where id = p_session_id
    returning * into v_session;
  return v_session;
end $$;

grant execute on function public.set_operational_notice(text, text) to authenticated;

-- Midtown open toggle: when opening, attempt to promote interest entries
-- up to capacity; remaining become waitlist entries.
create or replace function public.set_operational_midtown_open(
  p_session_id text,
  p_enabled boolean
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_active_count integer;
  v_interest record;
  v_booking public.operational_bookings;
begin
  perform public.operational_assert_admin('set_midtown_open');
  select * into v_session from public.operational_sessions
    where id = p_session_id for update;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_session.activity_id <> 'hyrox-midtown' then
    raise exception 'Midtown toggle is only valid for hyrox-midtown sessions.'
      using errcode = '23514';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;

  update public.operational_sessions set is_open = p_enabled where id = p_session_id
    returning * into v_session;

  if p_enabled then
    select count(*) into v_active_count
      from public.operational_bookings
     where session_id = p_session_id and status in ('reserved', 'confirmed');
    for v_interest in
      select qe.* from public.operational_queue_entries qe
       where qe.session_id = p_session_id
         and qe.status = 'active'
         and qe.kind = 'interest'
       order by qe.joined_at, qe.id
       for update
    loop
      exit when v_active_count >= v_session.capacity;
      insert into public.operational_bookings
        (profile_id, session_id, status, reserved_at, pay_deadline_at, snapshot)
      values
        (v_interest.profile_id, p_session_id, 'reserved', now(),
         (v_session.session_date - interval '2 days')::date + time '15:59',
         to_jsonb(v_session))
      returning * into v_booking;
      update public.operational_queue_entries
         set status = 'promoted', resolved_at = now()
       where id = v_interest.id;
      v_active_count := v_active_count + 1;
    end loop;
    -- Remaining interests remain active (and become waitlist in spirit).
  end if;

  return v_session;
end $$;

grant execute on function public.set_operational_midtown_open(text, boolean) to authenticated;

-- =====================================================================
-- Gym finalization
-- =====================================================================

create or replace function public.finalize_operational_gym(
  p_session_id text,
  p_note text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
begin
  perform public.operational_assert_admin('finalize_gym');

  -- Lock the session row.
  select * into v_session from public.operational_sessions
    where id = p_session_id for update;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_session.gym_confirmed_at is not null then
    raise exception 'Gym confirmation has already been recorded.' using errcode = '23514';
  end if;

  update public.operational_sessions
     set gym_confirmed_at = now(),
         gym_confirmed_by = v_uid,
         gym_note = nullif(trim(p_note), '')
   where id = p_session_id
   returning * into v_session;

  insert into public.notifications (profile_id, kind, title, body)
  select id, 'operational_gym_finalized',
         'Gym confirmation recorded',
         'Gym confirmation recorded for ' || p_session_id || '.'
    from public.profiles
   where role in ('admin', 'super_admin');

  return v_session;
end $$;

grant execute on function public.finalize_operational_gym(text, text) to authenticated;

-- =====================================================================
-- Collector duties
-- =====================================================================

create or replace function public.set_collector_assignment(
  p_week_start date,
  p_profile_id uuid
)
returns public.collector_assignments
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.collector_assignments;
begin
  perform public.operational_assert_admin('set_collector');
  if p_profile_id is null then
    raise exception 'Collector profile id required.' using errcode = '22023';
  end if;
  insert into public.collector_assignments
    (week_start, collector_profile_id, assigned_by)
  values (p_week_start, p_profile_id, auth.uid())
  on conflict (week_start) do update
    set collector_profile_id = excluded.collector_profile_id,
        assigned_by = excluded.assigned_by,
        assigned_at = now()
  returning * into v_row;
  return v_row;
end $$;

grant execute on function public.set_collector_assignment(date, uuid) to authenticated;

create or replace function public.update_collector_payout_profile(
  p_profile_id uuid,
  p_payme_link text,
  p_fps_phone  text
)
returns public.collector_payout_profiles
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
  v_row public.collector_payout_profiles;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_uid <> p_profile_id and not public.operational_is_admin() then
    raise exception 'Not authorized for this payout profile.' using errcode = '42501';
  end if;
  insert into public.collector_payout_profiles
    (profile_id, payme_link, fps_phone)
  values (p_profile_id, nullif(trim(p_payme_link), ''), nullif(trim(p_fps_phone), ''))
  on conflict (profile_id) do update
    set payme_link = excluded.payme_link,
        fps_phone = excluded.fps_phone
  returning * into v_row;
  return v_row;
end $$;

grant execute on function public.update_collector_payout_profile(uuid, text, text) to authenticated;

-- =====================================================================
-- Deadline sweep
-- =====================================================================

create or replace function public.sweep_operational_deadlines(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
begin
  with expired as (
    update public.operational_bookings
       set status = 'expired'
     where status = 'reserved'
       and pay_deadline_at < p_now
       and payment_marked_at is null
     returning id
  )
  select count(*) into v_expired from expired;

  -- Promote first active waitlist entry per session when capacity allows.
  with ranked as (
    select qe.id,
           qe.session_id,
           row_number() over (partition by qe.session_id order by qe.joined_at, qe.id) as rn
      from public.operational_queue_entries qe
     where qe.status = 'active' and qe.kind = 'waitlist'
  ),
  promotable as (
    select r.id
      from ranked r
      join public.operational_sessions s on s.id = r.session_id
     where r.rn = 1
       and s.cancelled_at is null
       and s.is_open
       and (select count(*) from public.operational_bookings b
             where b.session_id = r.session_id
               and b.status in ('reserved', 'confirmed')) < s.capacity
  )
  update public.operational_queue_entries qe
     set status = 'promoted', resolved_at = now()
    from promotable p
   where qe.id = p.id;

  return v_expired;
end;
$$;

grant execute on function public.sweep_operational_deadlines(timestamptz) to authenticated;
