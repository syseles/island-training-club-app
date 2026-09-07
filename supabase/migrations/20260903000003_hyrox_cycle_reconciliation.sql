-- Island Training Club — pooled HYROX reconciliation and venue planning
--
-- This migration starts with authoritative cycle scheduling. Lifecycle sweeps,
-- collector reconciliation and deterministic allocation are added below as
-- their integration contracts are introduced.

create or replace function public.schedule_hyrox_cycle(p_cycle_id text)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_bft_id text;
  v_midtown_id text;
  v_bft public.operational_sessions;
  v_midtown public.operational_sessions;
  v_cycle public.operational_hyrox_cycles;
  v_registration_opens timestamptz;
  v_payment_deadline timestamptz;
  v_holder_grace_deadline timestamptz;
  v_promoted_payment_deadline timestamptz;
  v_choice_deadline timestamptz;
begin
  perform public.operational_assert_admin('schedule_hyrox_cycle');

  if p_cycle_id !~ '^hyrox-pool-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Invalid HYROX cycle id.' using errcode = '22023';
  end if;
  begin
    v_date := substring(p_cycle_id from 12)::date;
  exception when others then
    raise exception 'Invalid HYROX cycle id.' using errcode = '22023';
  end;
  if p_cycle_id <> 'hyrox-pool-' || v_date::text
      or extract(dow from v_date) <> 6 then
    raise exception 'HYROX cycle date must be a Saturday.' using errcode = '22023';
  end if;
  if v_date <= (now() at time zone 'Asia/Hong_Kong')::date then
    raise exception 'HYROX cycle must be scheduled for a future Saturday.' using errcode = '23514';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = p_cycle_id
   for update;
  if found then
    return v_cycle;
  end if;

  v_bft_id := 'hyrox-bft-' || v_date::text;
  v_midtown_id := 'hyrox-midtown-' || v_date::text;

  select * into v_bft
    from public.operational_sessions
   where id = v_bft_id
   for update;
  if not found or v_bft.activity_id <> 'hyrox-bft'
      or v_bft.session_date <> v_date then
    raise exception 'Matching BFT session not found.' using errcode = 'P0002';
  end if;

  select * into v_midtown
    from public.operational_sessions
   where id = v_midtown_id
   for update;
  if not found or v_midtown.activity_id <> 'hyrox-midtown'
      or v_midtown.session_date <> v_date then
    raise exception 'Matching Midtown session not found.' using errcode = 'P0002';
  end if;

  if v_bft.cancelled_at is not null or v_midtown.cancelled_at is not null then
    raise exception 'HYROX child sessions must not be cancelled.' using errcode = '23514';
  end if;
  if v_bft.capacity <> 20 or v_midtown.capacity <> 12 then
    raise exception 'HYROX child capacities must be 20 and 12.' using errcode = '23514';
  end if;
  if v_bft.price_hkd is null or v_bft.price_hkd <= 0
      or v_midtown.price_hkd is distinct from v_bft.price_hkd then
    raise exception 'HYROX child sessions must have one matching paid price.' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.operational_bookings b
     where b.session_id in (v_bft_id, v_midtown_id)
       and b.status in ('reserved', 'confirmed')
  ) then
    raise exception 'Active venue-specific bookings must be resolved before scheduling.'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.operational_queue_entries q
     where q.session_id in (v_bft_id, v_midtown_id)
       and q.status = 'active'
  ) then
    raise exception 'Active venue-specific queues must be resolved before scheduling.'
      using errcode = '23514';
  end if;

  v_registration_opens := ((v_date - 5) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_payment_deadline := ((v_date - 2) + time '18:00') at time zone 'Asia/Hong_Kong';
  v_holder_grace_deadline := ((v_date - 2) + time '19:00') at time zone 'Asia/Hong_Kong';
  v_promoted_payment_deadline := ((v_date - 2) + time '20:00') at time zone 'Asia/Hong_Kong';
  v_choice_deadline := ((v_date - 1) + time '21:00') at time zone 'Asia/Hong_Kong';

  insert into public.operational_hyrox_cycles (
    id, session_date, bft_session_id, midtown_session_id,
    registration_state, venue_plan, registration_opens_at,
    payment_deadline_at, holder_grace_deadline_at,
    promoted_payment_deadline_at, venue_choice_deadline_at
  ) values (
    p_cycle_id, v_date, v_bft_id, v_midtown_id,
    'draft', 'pending', v_registration_opens,
    v_payment_deadline, v_holder_grace_deadline,
    v_promoted_payment_deadline, v_choice_deadline
  ) returning * into v_cycle;

  return v_cycle;
end;
$$;

create or replace function public.finalize_hyrox_venue_plan_locked(
  p_cycle_id text,
  p_now timestamptz,
  p_source text,
  p_actor uuid default null
)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.operational_hyrox_cycles;
  v_booking record;
  v_target public.operational_sessions;
  v_confirmed integer;
  v_bft_count integer := 0;
  v_midtown_count integer := 0;
  v_plan text;
  v_target_id text;
  v_allocation_state text;
begin
  if p_source not in ('automatic_sweep', 'payment_reconciliation', 'admin_retry') then
    raise exception 'Invalid venue-plan finalization source.' using errcode = '22023';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles
   where id = p_cycle_id
   for update;
  if not found then
    raise exception 'HYROX cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.venue_plan <> 'pending' then
    return v_cycle;
  end if;
  if v_cycle.reconciliation_started_at is null then
    raise exception 'Payment reconciliation has not started.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.operational_bookings b
     where b.hyrox_cycle_id = v_cycle.id
       and b.status = 'reserved'
       and b.payment_marked_at is not null
  ) then
    return v_cycle;
  end if;

  select count(*) into v_confirmed
    from public.operational_bookings b
   where b.hyrox_cycle_id = v_cycle.id
     and b.status = 'confirmed';
  if v_confirmed > v_cycle.registration_capacity then
    raise exception 'Confirmed HYROX payments exceed cycle capacity.' using errcode = '23514';
  end if;
  v_plan := case when v_confirmed <= 20 then 'bft_only' else 'both' end;
  v_allocation_state := case
    when v_plan = 'bft_only' or p_now >= v_cycle.venue_choice_deadline_at then 'final'
    else 'provisional'
  end;

  for v_booking in
    select * from public.operational_bookings b
     where b.hyrox_cycle_id = v_cycle.id
       and b.status = 'confirmed'
     order by b.paid_at, b.id
     for update
  loop
    if v_plan = 'bft_only' then
      v_target_id := v_cycle.bft_session_id;
      v_bft_count := v_bft_count + 1;
    elsif v_booking.venue_preference = 'midtown' and v_midtown_count < 12 then
      v_target_id := v_cycle.midtown_session_id;
      v_midtown_count := v_midtown_count + 1;
    elsif v_booking.venue_preference = 'bft' and v_bft_count < 20 then
      v_target_id := v_cycle.bft_session_id;
      v_bft_count := v_bft_count + 1;
    elsif v_booking.venue_preference = 'either' and v_bft_count < 20 then
      v_target_id := v_cycle.bft_session_id;
      v_bft_count := v_bft_count + 1;
    elsif v_midtown_count < 12 then
      v_target_id := v_cycle.midtown_session_id;
      v_midtown_count := v_midtown_count + 1;
    elsif v_bft_count < 20 then
      v_target_id := v_cycle.bft_session_id;
      v_bft_count := v_bft_count + 1;
    else
      raise exception 'Confirmed HYROX payments exceed venue capacity.' using errcode = '23514';
    end if;

    select * into v_target from public.operational_sessions where id = v_target_id;
    update public.operational_bookings
       set session_id = v_target.id,
           allocation_state = v_allocation_state,
           allocation_source = 'automatic',
           allocated_at = p_now,
           allocation_snapshot = coalesce(allocation_snapshot, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object(
               'session_id', v_target.id,
               'venue', v_target.venue,
               'start_time', v_target.start_time,
               'capacity', v_target.capacity,
               'source', p_source,
               'assigned_at', p_now
             ))
     where id = v_booking.id;
    update public.operational_receipts
       set session_id = v_target.id
     where booking_id = v_booking.id
       and hyrox_cycle_id = v_cycle.id;
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    values (
      v_booking.profile_id, 'operational_hyrox_venue_allocated',
      'HYROX venue allocated',
      'Your venue for ' || v_cycle.session_date::text || ' is ' || v_target.venue ||
        case when v_allocation_state = 'provisional'
          then '. Venue changes close Friday at 9 PM HKT.' else '.' end,
      '#/booking/' || v_booking.id::text
    );
  end loop;

  update public.operational_hyrox_cycles
     set registration_state = 'closed',
         venue_plan = v_plan,
         plan_confirmed_at = p_now,
         plan_confirmed_by = case when p_source = 'automatic_sweep' then null else p_actor end,
         plan_confirmed_source = p_source,
         allocation_closed_at = case
           when v_allocation_state = 'final' then p_now else null end
   where id = v_cycle.id
  returning * into v_cycle;
  return v_cycle;
end;
$$;

revoke all on function public.finalize_hyrox_venue_plan_locked(text, timestamptz, text, uuid)
  from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.approve_operational_payment_legacy(uuid)') is null then
    alter function public.approve_operational_payment(uuid)
      rename to approve_operational_payment_legacy;
  end if;
end $$;

revoke all on function public.approve_operational_payment_legacy(uuid)
  from public, anon, authenticated;

create or replace function public.approve_operational_payment(p_booking_id uuid)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_booking public.operational_bookings;
  v_amount integer;
  v_number text;
  v_year text;
  v_seq bigint;
begin
  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings where id = p_booking_id;
  if v_cycle_id is null then
    return public.approve_operational_payment_legacy(p_booking_id);
  end if;

  perform public.operational_assert_admin('approve_hyrox_cycle_payment');
  select * into v_cycle
    from public.operational_hyrox_cycles where id = v_cycle_id for update;
  select * into v_booking
    from public.operational_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'reserved' then
    raise exception 'Booking is not awaiting approval.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at is null then
    raise exception 'Payment has not been marked.' using errcode = '23514';
  end if;
  if v_booking.payment_marked_at >= v_booking.pay_deadline_at then
    raise exception 'Payment was marked after the booking deadline.' using errcode = '23514';
  end if;

  select price_hkd into v_amount
    from public.operational_sessions
   where id = v_cycle.bft_session_id
   for share;
  if v_amount is null then
    raise exception 'HYROX cycle price is unavailable.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'confirmed', paid_at = now(), confirmed_by = v_uid
   where id = p_booking_id
  returning * into v_booking;

  v_year := to_char(now(), 'YYYY');
  select coalesce(max(
    nullif(regexp_replace(receipt_number, '^[A-Z0-9]+-[0-9]+-', ''), '')::bigint
  ), 0) + 1 into v_seq
    from public.operational_receipts
   where receipt_number like 'ITC-' || v_year || '-%';
  v_number := 'ITC-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  insert into public.operational_receipts (
    receipt_number, booking_id, profile_id, session_id, hyrox_cycle_id,
    amount_hkd, currency, payment_method, issued_by
  ) values (
    v_number, v_booking.id, v_booking.profile_id, null, v_cycle.id,
    v_amount, 'HKD', v_booking.payment_method, v_uid
  );

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_booking.profile_id, 'operational_payment_approved',
    'HYROX payment approved',
    'Your payment for ' || v_cycle.session_date::text || ' is confirmed.',
    '#/booking/' || v_booking.id::text
  );

  if v_cycle.reconciliation_started_at is not null then
    perform public.finalize_hyrox_venue_plan_locked(
      v_cycle.id, now(), 'payment_reconciliation', v_uid
    );
  end if;
  return v_booking;
end;
$$;

create or replace function public.reject_hyrox_cycle_payment(
  p_booking_id uuid,
  p_reason text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_cycle_id text;
  v_booking public.operational_bookings;
begin
  perform public.operational_assert_admin('reject_hyrox_cycle_payment');
  if v_reason is null then
    raise exception 'Payment rejection reason is required.' using errcode = '22023';
  end if;

  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings
   where id = p_booking_id;
  if v_cycle_id is null then
    raise exception 'Pooled HYROX booking not found.' using errcode = 'P0002';
  end if;

  perform 1 from public.operational_hyrox_cycles
   where id = v_cycle_id
   for update;
  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found or v_booking.hyrox_cycle_id is null then
    raise exception 'Pooled HYROX booking not found.' using errcode = 'P0002';
  end if;
  if v_booking.status <> 'reserved' or v_booking.payment_marked_at is null then
    raise exception 'Booking has no pending payment claim.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = case when now() < pay_deadline_at then 'reserved' else 'expired' end,
         payment_marked_at = case when now() < pay_deadline_at then null else payment_marked_at end,
         payment_method = case when now() < pay_deadline_at then null else payment_method end,
         payment_reference = case when now() < pay_deadline_at then null else payment_reference end,
         payment_rejected_at = now(),
         payment_rejected_by = v_uid,
         payment_rejection_reason = v_reason
   where id = p_booking_id
  returning * into v_booking;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_booking.profile_id,
    'operational_hyrox_payment_rejected',
    'HYROX payment claim rejected',
    v_reason,
    case when v_booking.status = 'reserved'
      then '#/pay/' || v_booking.id::text else '#/schedule' end
  );

  if exists (
    select 1 from public.operational_hyrox_cycles
     where id = v_cycle_id and reconciliation_started_at is not null
  ) then
    perform public.finalize_hyrox_venue_plan_locked(
      v_cycle_id, now(), 'payment_reconciliation', v_uid
    );
  end if;
  return v_booking;
end;
$$;

create or replace function public.sweep_hyrox_cycle_deadlines(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.operational_hyrox_cycles;
  v_booking record;
  v_queue record;
  v_promoted public.operational_bookings;
  v_collector uuid;
  v_freed_count integer;
  v_changed integer := 0;
  v_snapshot jsonb;
begin
  for v_cycle in
    select *
      from public.operational_hyrox_cycles c
     where c.registration_state <> 'cancelled'
       and c.registration_opens_at <= p_now
     order by c.session_date, c.id
     for update skip locked
  loop
    if v_cycle.registration_state = 'draft' then
      update public.operational_hyrox_cycles
         set registration_state = 'open', opened_at = p_now
       where id = v_cycle.id;
      v_cycle.registration_state := 'open';
      v_cycle.opened_at := p_now;
      v_changed := v_changed + 1;
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select p.id, 'operational_hyrox_registration_opened',
             'HYROX registration is open',
             'Registration is open for Saturday ' || v_cycle.session_date::text || '.',
             '#/schedule'
        from public.profiles p
       where p.role in ('member', 'admin', 'super_admin');
    end if;

    if p_now >= v_cycle.payment_deadline_at - interval '1 hour'
        and v_cycle.payment_reminder_sent_at is null then
      update public.operational_hyrox_cycles
         set payment_reminder_sent_at = p_now
       where id = v_cycle.id;
      v_cycle.payment_reminder_sent_at := p_now;
      v_changed := v_changed + 1;
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select b.profile_id, 'operational_hyrox_payment_reminder',
             'HYROX payment reminder',
             'Mark payment for ' || v_cycle.session_date::text ||
               ' by Thursday at 6 PM HKT.',
             '#/pay/' || b.id::text
        from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'reserved'
         and b.payment_marked_at is null
         and b.promoted_from_waitlist_at is null;
    end if;

    if p_now >= v_cycle.payment_deadline_at
        and v_cycle.holder_grace_started_at is null then
      update public.operational_hyrox_cycles
         set holder_grace_started_at = p_now
       where id = v_cycle.id;
      v_cycle.holder_grace_started_at := p_now;
      v_changed := v_changed + 1;
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select b.profile_id, 'operational_hyrox_holder_grace',
             'Final HYROX payment grace',
             'Your place for ' || v_cycle.session_date::text ||
               ' will move to the waitlist at 7 PM HKT unless payment is marked.',
             '#/pay/' || b.id::text
        from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'reserved'
         and b.payment_marked_at is null
         and b.promoted_from_waitlist_at is null;

      select ca.collector_profile_id into v_collector
        from public.collector_assignments ca
       where ca.week_start <= v_cycle.session_date
       order by ca.week_start desc limit 1;
      if v_collector is not null then
        insert into public.notifications
          (profile_id, kind, title, body, destination)
        values (
          v_collector,
          'operational_hyrox_grace_summary',
          'HYROX payment grace started',
          format(
            '%s payment claims, %s unmarked holders, %s weekly waitlist for %s.',
            (select count(*) from public.operational_bookings b
              where b.hyrox_cycle_id = v_cycle.id
                and b.status = 'reserved' and b.payment_marked_at is not null),
            (select count(*) from public.operational_bookings b
              where b.hyrox_cycle_id = v_cycle.id
                and b.status = 'reserved' and b.payment_marked_at is null),
            (select count(*) from public.operational_hyrox_queue_entries q
              where q.cycle_id = v_cycle.id and q.kind = 'weekly_waitlist'
                and q.status = 'active'),
            v_cycle.session_date
          ),
          '#/admin/payments'
        );
      end if;
    end if;

    if p_now >= v_cycle.holder_grace_deadline_at
        and v_cycle.waitlist_promoted_at is null then
      update public.operational_hyrox_cycles
         set waitlist_promoted_at = p_now
       where id = v_cycle.id;
      v_cycle.waitlist_promoted_at := p_now;
      v_changed := v_changed + 1;

      v_freed_count := 0;
      for v_booking in
        update public.operational_bookings
           set status = 'expired', updated_at = p_now
         where hyrox_cycle_id = v_cycle.id
           and status = 'reserved'
           and payment_marked_at is null
           and promoted_from_waitlist_at is null
        returning *
      loop
        v_freed_count := v_freed_count + 1;
        insert into public.operational_hyrox_queue_entries (
          cycle_id, profile_id, kind, venue_preference,
          fallback_acknowledged_at, status, joined_at
        ) values (
          v_cycle.id, v_booking.profile_id, 'weekly_waitlist',
          v_booking.venue_preference, v_booking.fallback_acknowledged_at,
          'active', p_now
        );
        insert into public.notifications
          (profile_id, kind, title, body, destination)
        values (v_booking.profile_id, 'operational_hyrox_holder_demoted',
                'HYROX place moved to the waitlist',
                'Payment was not marked by 7 PM HKT for ' || v_cycle.session_date::text || '.',
                '#/schedule');
      end loop;

      select jsonb_build_object(
        'name', 'ITC HYROX', 'kind', 'paid', 'booking_mode', 'weekly_pool',
        'session_date', v_cycle.session_date,
        'price_hkd', s.price_hkd
      ) into v_snapshot
        from public.operational_sessions s
       where s.id = v_cycle.bft_session_id;

      for v_queue in
        select * from public.operational_hyrox_queue_entries q
         where q.cycle_id = v_cycle.id
           and q.kind = 'weekly_waitlist'
           and q.status = 'active'
           and q.joined_at < p_now
         order by q.joined_at, q.id
         limit v_freed_count
         for update skip locked
      loop
        insert into public.operational_bookings (
          profile_id, session_id, hyrox_cycle_id, status, reserved_at,
          pay_deadline_at, venue_preference, fallback_acknowledged_at,
          promoted_from_waitlist_at, snapshot
        ) values (
          v_queue.profile_id, null, v_cycle.id, 'reserved', p_now,
          v_cycle.promoted_payment_deadline_at, v_queue.venue_preference,
          v_queue.fallback_acknowledged_at, p_now, v_snapshot
        ) returning * into v_promoted;
        update public.operational_hyrox_queue_entries
           set status = 'promoted', resolved_at = p_now
         where id = v_queue.id;
        insert into public.notifications
          (profile_id, kind, title, body, destination)
        values (v_queue.profile_id, 'operational_hyrox_waitlist_promoted',
                'A HYROX place is available',
                'Mark payment by Thursday at 8 PM HKT for ' || v_cycle.session_date::text || '.',
                '#/pay/' || v_promoted.id::text);
      end loop;
    end if;

    if p_now >= v_cycle.promoted_payment_deadline_at
        and v_cycle.reconciliation_started_at is null then
      update public.operational_bookings
         set status = 'expired', updated_at = p_now
       where hyrox_cycle_id = v_cycle.id
         and status = 'reserved'
         and payment_marked_at is null
         and promoted_from_waitlist_at is not null;
      update public.operational_hyrox_queue_entries
         set status = 'dissolved', resolved_at = p_now
       where cycle_id = v_cycle.id
         and kind = 'weekly_waitlist'
         and status = 'active';
      update public.operational_hyrox_cycles
         set registration_state = 'reconciling',
             reconciliation_started_at = p_now
       where id = v_cycle.id;
      v_cycle.registration_state := 'reconciling';
      v_cycle.reconciliation_started_at := p_now;
      v_changed := v_changed + 1;

      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select b.profile_id, 'operational_hyrox_payment_closed',
             'HYROX payment marking closed',
             'Payment marking has closed for ' || v_cycle.session_date::text || '.',
             '#/schedule'
        from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'expired'
         and b.updated_at = p_now;

      select ca.collector_profile_id into v_collector
        from public.collector_assignments ca
       where ca.week_start <= v_cycle.session_date
       order by ca.week_start desc limit 1;
      if v_collector is not null then
        insert into public.notifications
          (profile_id, kind, title, body, destination)
        values (
          v_collector,
          'operational_hyrox_reconciliation_started',
          'HYROX payment reconciliation',
          format(
            '%s pending claims, %s confirmed payments for %s. Review all pending claims.',
            (select count(*) from public.operational_bookings b
              where b.hyrox_cycle_id = v_cycle.id
                and b.status = 'reserved' and b.payment_marked_at is not null),
            (select count(*) from public.operational_bookings b
              where b.hyrox_cycle_id = v_cycle.id and b.status = 'confirmed'),
            v_cycle.session_date
          ),
          '#/admin/payments'
        );
      end if;
      perform public.finalize_hyrox_venue_plan_locked(
        v_cycle.id, p_now, 'automatic_sweep', null
      );
    end if;
  end loop;

  return v_changed;
end;
$$;

create or replace function public.finalize_hyrox_venue_plan(p_cycle_id text)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.operational_assert_admin('finalize_hyrox_venue_plan');
  return public.finalize_hyrox_venue_plan_locked(
    p_cycle_id, now(), 'admin_retry', auth.uid()
  );
end;
$$;

revoke all on function public.schedule_hyrox_cycle(text)
  from public, anon, authenticated;
revoke all on function public.approve_operational_payment(uuid)
  from public, anon, authenticated;
revoke all on function public.reject_hyrox_cycle_payment(uuid, text)
  from public, anon, authenticated;
revoke all on function public.sweep_hyrox_cycle_deadlines(timestamptz)
  from public, anon, authenticated;
revoke all on function public.finalize_hyrox_venue_plan(text)
  from public, anon, authenticated;
grant execute on function public.schedule_hyrox_cycle(text)
  to authenticated;
grant execute on function public.approve_operational_payment(uuid)
  to authenticated;
grant execute on function public.reject_hyrox_cycle_payment(uuid, text)
  to authenticated;
grant execute on function public.sweep_hyrox_cycle_deadlines(timestamptz)
  to authenticated;
grant execute on function public.finalize_hyrox_venue_plan(text)
  to authenticated;

notify pgrst, 'reload schema';
