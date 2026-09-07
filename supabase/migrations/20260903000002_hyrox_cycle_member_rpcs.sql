-- Island Training Club — pooled HYROX member registration RPCs
--
-- Adds the shared BFT/Midtown reservation and weekly-waitlist entry points,
-- then wraps the legacy session RPCs so scheduled pooled cycles cannot be
-- bypassed. Quarry Bay remains separately bookable with same-date exclusion.

-- Preserve the venue-specific implementations behind private, ungranted names.
-- The guards make this forward migration safe to reapply after historical
-- migration-idempotency checks recreate the public legacy entry points.
do $$
begin
  if to_regprocedure('public.reserve_operational_session_legacy(text)') is null then
    alter function public.reserve_operational_session(text)
      rename to reserve_operational_session_legacy;
  end if;
  if to_regprocedure('public.join_operational_queue_legacy(text,text)') is null then
    alter function public.join_operational_queue(text, text)
      rename to join_operational_queue_legacy;
  end if;
  if to_regprocedure('public.mark_operational_payment_legacy(uuid,text,text)') is null then
    alter function public.mark_operational_payment(uuid, text, text)
      rename to mark_operational_payment_legacy;
  end if;
  if to_regprocedure('public.release_operational_reservation_legacy(uuid)') is null then
    alter function public.release_operational_reservation(uuid)
      rename to release_operational_reservation_legacy;
  end if;
end $$;

revoke all on function public.reserve_operational_session_legacy(text)
  from public, anon, authenticated;
revoke all on function public.join_operational_queue_legacy(text, text)
  from public, anon, authenticated;
revoke all on function public.mark_operational_payment_legacy(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_operational_reservation_legacy(uuid)
  from public, anon, authenticated;

-- =====================================================================
-- Shared-cycle reservation
-- =====================================================================

create or replace function public.reserve_hyrox_cycle(
  p_cycle_id text,
  p_preference text,
  p_fallback_acknowledged boolean
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_cycle public.operational_hyrox_cycles;
  v_bft public.operational_sessions;
  v_midtown public.operational_sessions;
  v_booking public.operational_bookings;
  v_active_count integer;
  v_opened boolean := false;
  v_capacity_notice boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_preference not in ('bft', 'midtown', 'either') then
    raise exception 'Choose BFT, Midtown, or Either.' using errcode = '22023';
  end if;
  if not coalesce(p_fallback_acknowledged, false) then
    raise exception 'Fallback acknowledgement is required.' using errcode = '22023';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = p_cycle_id
   for update;
  if not found then
    raise exception 'HYROX cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.registration_state = 'cancelled' then
    raise exception 'This HYROX cycle is cancelled.' using errcode = '23514';
  end if;
  if now() < v_cycle.registration_opens_at then
    raise exception 'HYROX registration opens Monday at 6 PM HKT.' using errcode = '23514';
  end if;
  if now() >= v_cycle.payment_deadline_at then
    raise exception 'HYROX registration is closed.' using errcode = '23514';
  end if;

  if v_cycle.registration_state = 'draft' then
    update public.operational_hyrox_cycles
       set registration_state = 'open',
           opened_at = coalesce(opened_at, now())
     where id = v_cycle.id
    returning * into v_cycle;
    v_opened := true;
  elsif v_cycle.registration_state <> 'open' then
    raise exception 'HYROX registration is closed.' using errcode = '23514';
  end if;

  select * into v_bft
    from public.operational_sessions
   where id = v_cycle.bft_session_id;
  select * into v_midtown
    from public.operational_sessions
   where id = v_cycle.midtown_session_id;
  if v_bft.id is null or v_midtown.id is null
      or v_bft.cancelled_at is not null or v_midtown.cancelled_at is not null then
    raise exception 'HYROX cycle sessions are unavailable.' using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.operational_bookings b
     where b.profile_id = v_uid
       and b.hyrox_cycle_id = v_cycle.id
       and b.status in ('reserved', 'confirmed')
  ) or exists (
    select 1
      from public.operational_hyrox_queue_entries q
     where q.profile_id = v_uid
       and q.cycle_id = v_cycle.id
       and q.status = 'active'
  ) then
    raise exception 'You already joined this HYROX registration.' using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
     where b.profile_id = v_uid
       and b.status in ('reserved', 'confirmed')
       and s.activity_id = 'hyrox-quarry-bay'
       and s.session_date = v_cycle.session_date
  ) then
    raise exception 'You already have a HYROX booking for this Saturday.' using errcode = '23505';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings b
   where b.hyrox_cycle_id = v_cycle.id
     and b.status in ('reserved', 'confirmed');
  if v_active_count >= v_cycle.registration_capacity then
    raise exception 'HYROX registration is full. Join the weekly waitlist.' using errcode = '23514';
  end if;

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at, snapshot
  ) values (
    v_uid, null, v_cycle.id, 'reserved', now(),
    v_cycle.holder_grace_deadline_at, p_preference, now(),
    jsonb_build_object(
      'name', 'ITC HYROX',
      'kind', 'paid',
      'booking_mode', 'weekly_pool',
      'session_date', v_cycle.session_date,
      'price_hkd', v_bft.price_hkd,
      'venues', jsonb_build_array(
        jsonb_build_object(
          'session_id', v_bft.id,
          'venue', v_bft.venue,
          'start_time', v_bft.start_time,
          'capacity', v_bft.capacity
        ),
        jsonb_build_object(
          'session_id', v_midtown.id,
          'venue', v_midtown.venue,
          'start_time', v_midtown.start_time,
          'capacity', v_midtown.capacity
        )
      )
    )
  ) returning * into v_booking;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_uid,
    'operational_hyrox_reserved',
    'HYROX place reserved',
    'Mark payment by Thursday at 6 PM HKT to keep your place.',
    '#/pay/' || v_booking.id::text
  );

  if v_opened then
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    select p.id,
           'operational_hyrox_registration_opened',
           'HYROX registration is open',
           'Registration is open for Saturday ' || v_cycle.session_date::text || '.',
           '#/schedule'
      from public.profiles p
     where p.role in ('member', 'admin', 'super_admin')
       and p.id <> v_uid;
  end if;

  if v_active_count + 1 = v_cycle.registration_capacity then
    update public.operational_hyrox_cycles
       set capacity_warning_sent_at = now()
     where id = v_cycle.id
       and capacity_warning_sent_at is null
    returning true into v_capacity_notice;

    if coalesce(v_capacity_notice, false) then
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select b.profile_id,
             'operational_hyrox_capacity_reached',
             'HYROX registration is full',
             'Mark payment by Thursday at 6 PM HKT or your place may move to the waitlist.',
             '#/pay/' || b.id::text
        from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'reserved'
         and b.payment_marked_at is null;
    end if;
  end if;

  return v_booking;
end;
$$;

-- =====================================================================
-- Shared weekly waitlist
-- =====================================================================

create or replace function public.join_hyrox_cycle_waitlist(
  p_cycle_id text,
  p_preference text,
  p_fallback_acknowledged boolean
)
returns public.operational_hyrox_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_cycle public.operational_hyrox_cycles;
  v_entry public.operational_hyrox_queue_entries;
  v_active_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_preference not in ('bft', 'midtown', 'either') then
    raise exception 'Choose BFT, Midtown, or Either.' using errcode = '22023';
  end if;
  if not coalesce(p_fallback_acknowledged, false) then
    raise exception 'Fallback acknowledgement is required.' using errcode = '22023';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = p_cycle_id
   for update;
  if not found then
    raise exception 'HYROX cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.registration_state = 'cancelled' then
    raise exception 'This HYROX cycle is cancelled.' using errcode = '23514';
  end if;
  if now() < v_cycle.registration_opens_at then
    raise exception 'HYROX registration opens Monday at 6 PM HKT.' using errcode = '23514';
  end if;
  if now() >= v_cycle.payment_deadline_at then
    raise exception 'HYROX registration is closed.' using errcode = '23514';
  end if;

  if v_cycle.registration_state = 'draft' then
    update public.operational_hyrox_cycles
       set registration_state = 'open',
           opened_at = coalesce(opened_at, now())
     where id = v_cycle.id
    returning * into v_cycle;
  elsif v_cycle.registration_state <> 'open' then
    raise exception 'HYROX registration is closed.' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.operational_bookings b
     where b.profile_id = v_uid
       and b.hyrox_cycle_id = v_cycle.id
       and b.status in ('reserved', 'confirmed')
  ) or exists (
    select 1 from public.operational_hyrox_queue_entries q
     where q.profile_id = v_uid
       and q.cycle_id = v_cycle.id
       and q.status = 'active'
  ) then
    raise exception 'You already joined this HYROX registration.' using errcode = '23505';
  end if;

  if exists (
    select 1
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
     where b.profile_id = v_uid
       and b.status in ('reserved', 'confirmed')
       and s.activity_id = 'hyrox-quarry-bay'
       and s.session_date = v_cycle.session_date
  ) then
    raise exception 'You already have a HYROX booking for this Saturday.' using errcode = '23505';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings b
   where b.hyrox_cycle_id = v_cycle.id
     and b.status in ('reserved', 'confirmed');
  if v_active_count < v_cycle.registration_capacity then
    raise exception 'HYROX places are still available.' using errcode = '23514';
  end if;

  insert into public.operational_hyrox_queue_entries (
    cycle_id, profile_id, kind, venue_preference,
    fallback_acknowledged_at, status, joined_at
  ) values (
    v_cycle.id, v_uid, 'weekly_waitlist', p_preference,
    now(), 'active', now()
  ) returning * into v_entry;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_uid,
    'operational_hyrox_waitlisted',
    'Joined the HYROX waitlist',
    'This waitlist place is not payable and does not guarantee a booking.',
    '#/schedule'
  );

  return v_entry;
end;
$$;

create or replace function public.leave_hyrox_cycle_queue(p_entry_id uuid)
returns public.operational_hyrox_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_cycle_id text;
  v_entry public.operational_hyrox_queue_entries;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select cycle_id into v_cycle_id
    from public.operational_hyrox_queue_entries
   where id = p_entry_id;
  if not found then
    raise exception 'HYROX queue entry not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.operational_hyrox_cycles
   where id = v_cycle_id
   for update;
  select * into v_entry
    from public.operational_hyrox_queue_entries
   where id = p_entry_id
   for update;

  if v_entry.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this queue entry.' using errcode = '42501';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'Queue entry is no longer active.' using errcode = '23514';
  end if;

  update public.operational_hyrox_queue_entries
     set status = 'left', resolved_at = now()
   where id = p_entry_id
  returning * into v_entry;
  return v_entry;
end;
$$;

-- =====================================================================
-- Guard legacy venue-specific entry points
-- =====================================================================

create or replace function public.reserve_operational_session(p_session_id text)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
  v_cycle public.operational_hyrox_cycles;
begin
  select * into v_session
    from public.operational_sessions
   where id = p_session_id;

  if exists (
    select 1
      from public.operational_hyrox_cycles c
     where c.cancelled_at is null
       and p_session_id in (c.bft_session_id, c.midtown_session_id)
  ) then
    perform 1
      from public.operational_hyrox_cycles c
     where c.cancelled_at is null
       and p_session_id in (c.bft_session_id, c.midtown_session_id)
     for update;
    raise exception 'Use the weekly HYROX registration.' using errcode = '23514';
  end if;

  if v_session.activity_id = 'hyrox-quarry-bay' then
    select * into v_cycle
      from public.operational_hyrox_cycles c
     where c.cancelled_at is null
       and c.session_date = v_session.session_date
     for update;
    if found and exists (
      select 1 from public.operational_bookings b
       where b.profile_id = v_uid
         and b.hyrox_cycle_id = v_cycle.id
         and b.status in ('reserved', 'confirmed')
    ) then
      raise exception 'You already have a HYROX booking for this Saturday.' using errcode = '23505';
    end if;
  end if;

  return public.reserve_operational_session_legacy(p_session_id);
end;
$$;

create or replace function public.join_operational_queue(
  p_session_id text,
  p_kind text
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.operational_hyrox_cycles;
begin
  if exists (
    select 1
      from public.operational_hyrox_cycles c
     where c.cancelled_at is null
       and p_session_id in (c.bft_session_id, c.midtown_session_id)
  ) then
    perform 1
      from public.operational_hyrox_cycles c
     where c.cancelled_at is null
       and p_session_id in (c.bft_session_id, c.midtown_session_id)
     for update;
    raise exception 'Use the weekly HYROX registration.' using errcode = '23514';
  end if;

  return public.join_operational_queue_legacy(p_session_id, p_kind);
end;
$$;

-- =====================================================================
-- Pooled payment marking and unpaid release
-- =====================================================================

create or replace function public.mark_operational_payment(
  p_booking_id uuid,
  p_method text,
  p_reference text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_booking public.operational_bookings;
  v_collector uuid;
begin
  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings
   where id = p_booking_id;
  if v_cycle_id is null then
    return public.mark_operational_payment_legacy(p_booking_id, p_method, p_reference);
  end if;

  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if p_method not in ('payme', 'fps') then
    raise exception 'Invalid payment method.' using errcode = '22023';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = v_cycle_id
   for update;
  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;

  if v_booking.profile_id <> v_uid then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Booking is not awaiting payment.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is not null then
    raise exception 'Payment already marked.' using errcode = '23505';
  end if;
  if now() >= v_booking.pay_deadline_at then
    raise exception 'Payment marking is closed for this booking.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set payment_marked_at = now(),
         payment_method = p_method,
         payment_reference = nullif(trim(p_reference), ''),
         payment_rejected_at = null,
         payment_rejected_by = null,
         payment_rejection_reason = null
   where id = p_booking_id
  returning * into v_booking;

  select ca.collector_profile_id into v_collector
    from public.collector_assignments ca
   where ca.week_start <= v_cycle.session_date
   order by ca.week_start desc
   limit 1;

  if v_collector is not null then
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    values (
      v_collector,
      'operational_payment_marked',
      'HYROX payment claim submitted',
      'Review the payment claim for ' || v_cycle.session_date::text || '.',
      '#/admin/payments'
    );
  else
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    select p.id,
           'operational_payment_marked',
           'HYROX payment claim submitted',
           'Review the payment claim for ' || v_cycle.session_date::text || '.',
           '#/admin/payments'
      from public.profiles p
     where p.role in ('admin', 'super_admin');
  end if;

  return v_booking;
end;
$$;

create or replace function public.release_operational_reservation(p_booking_id uuid)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_booking public.operational_bookings;
  v_queue public.operational_hyrox_queue_entries;
  v_promoted public.operational_bookings;
begin
  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings
   where id = p_booking_id;
  if v_cycle_id is null then
    return public.release_operational_reservation_legacy(p_booking_id);
  end if;

  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = v_cycle_id
   for update;
  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;

  if v_booking.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Reservation is no longer releasable.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is not null then
    raise exception 'Payment has already been marked.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'cancelled'
   where id = p_booking_id
  returning * into v_booking;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_booking.profile_id,
    'operational_hyrox_reservation_released',
    'HYROX reservation released',
    'Your place for ' || v_cycle.session_date::text || ' has been released.',
    '#/schedule'
  );

  if now() < v_cycle.payment_deadline_at then
    select * into v_queue
      from public.operational_hyrox_queue_entries q
     where q.cycle_id = v_cycle.id
       and q.kind = 'weekly_waitlist'
       and q.status = 'active'
     order by q.joined_at, q.id
     limit 1
     for update;

    if found then
      insert into public.operational_bookings (
        profile_id, session_id, hyrox_cycle_id, status, reserved_at,
        pay_deadline_at, venue_preference, fallback_acknowledged_at,
        promoted_from_waitlist_at, snapshot
      ) values (
        v_queue.profile_id, null, v_cycle.id, 'reserved', now(),
        v_cycle.holder_grace_deadline_at, v_queue.venue_preference,
        v_queue.fallback_acknowledged_at, now(), v_booking.snapshot
      ) returning * into v_promoted;

      update public.operational_hyrox_queue_entries
         set status = 'promoted', resolved_at = now()
       where id = v_queue.id;

      insert into public.notifications
        (profile_id, kind, title, body, destination)
      values (
        v_promoted.profile_id,
        'operational_hyrox_waitlist_promoted',
        'A HYROX place is available',
        'Mark payment by Thursday at 7 PM HKT to keep your promoted place.',
        '#/pay/' || v_promoted.id::text
      );
    end if;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.reserve_hyrox_cycle(text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.join_hyrox_cycle_waitlist(text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.leave_hyrox_cycle_queue(uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_operational_session(text)
  from public, anon, authenticated;
revoke all on function public.join_operational_queue(text, text)
  from public, anon, authenticated;
revoke all on function public.mark_operational_payment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_operational_reservation(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_hyrox_cycle(text, text, boolean)
  to authenticated;
grant execute on function public.join_hyrox_cycle_waitlist(text, text, boolean)
  to authenticated;
grant execute on function public.leave_hyrox_cycle_queue(uuid)
  to authenticated;
grant execute on function public.reserve_operational_session(text)
  to authenticated;
grant execute on function public.join_operational_queue(text, text)
  to authenticated;
grant execute on function public.mark_operational_payment(uuid, text, text)
  to authenticated;
grant execute on function public.release_operational_reservation(uuid)
  to authenticated;

notify pgrst, 'reload schema';
