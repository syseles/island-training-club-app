-- Island Training Club — pooled HYROX venue switching and cycle lifecycle

create or replace function public.select_hyrox_cycle_venue(
  p_booking_id uuid,
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
  v_cycle_id text;
  v_cycle public.operational_hyrox_cycles;
  v_booking public.operational_bookings;
  v_target public.operational_sessions;
  v_target_count integer;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings where id = p_booking_id;
  if v_cycle_id is null then
    raise exception 'Pooled HYROX booking not found.' using errcode = 'P0002';
  end if;

  select * into v_cycle
    from public.operational_hyrox_cycles where id = v_cycle_id for update;
  perform 1 from public.operational_sessions
   where id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
   order by id for update;
  select * into v_booking
    from public.operational_bookings where id = p_booking_id for update;

  if v_booking.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_cycle.venue_plan <> 'both' then
    raise exception 'Venue changes are available only when both gyms open.' using errcode = '23514';
  end if;
  if v_booking.status <> 'confirmed' or v_booking.allocation_state <> 'provisional' then
    raise exception 'Booking allocation is not changeable.' using errcode = '23514';
  end if;
  if now() >= v_cycle.venue_choice_deadline_at then
    raise exception 'Venue changes closed Friday at 9 PM HKT.' using errcode = '23514';
  end if;
  if p_target_session_id not in (v_cycle.bft_session_id, v_cycle.midtown_session_id) then
    raise exception 'Target venue is not part of this HYROX cycle.' using errcode = '22023';
  end if;
  if p_target_session_id = v_booking.session_id then
    return v_booking;
  end if;

  select * into v_target
    from public.operational_sessions where id = p_target_session_id;
  select count(*) into v_target_count
    from public.operational_bookings b
   where b.hyrox_cycle_id = v_cycle.id
     and b.status = 'confirmed'
     and b.session_id = p_target_session_id;
  if v_target_count >= v_target.capacity then
    raise exception 'Target venue is full.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set session_id = v_target.id,
         allocation_source = 'member',
         allocated_at = now(),
         allocation_snapshot = coalesce(allocation_snapshot, '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object(
             'session_id', v_target.id,
             'venue', v_target.venue,
             'start_time', v_target.start_time,
             'capacity', v_target.capacity,
             'source', 'member',
             'assigned_at', now()
           ))
   where id = v_booking.id
  returning * into v_booking;

  update public.operational_receipts
     set session_id = v_target.id
   where booking_id = v_booking.id
     and hyrox_cycle_id = v_cycle.id;
  update public.operational_hyrox_queue_entries
     set status = 'matched', resolved_at = now()
   where cycle_id = v_cycle.id
     and profile_id = v_booking.profile_id
     and kind = 'venue_switch'
     and status = 'active';

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  values (
    v_booking.profile_id, 'operational_hyrox_venue_changed',
    'HYROX venue updated',
    'Your HYROX venue is now ' || v_target.venue || '.',
    '#/booking/' || v_booking.id::text
  );
  return v_booking;
end;
$$;

create or replace function public.join_hyrox_venue_switch_queue(
  p_booking_id uuid,
  p_target_session_id text
)
returns public.operational_hyrox_queue_entries
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
  v_target public.operational_sessions;
  v_target_count integer;
  v_opposite public.operational_hyrox_queue_entries;
  v_opposite_booking public.operational_bookings;
  v_entry public.operational_hyrox_queue_entries;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  select hyrox_cycle_id into v_cycle_id
    from public.operational_bookings where id = p_booking_id;
  if v_cycle_id is null then
    raise exception 'Pooled HYROX booking not found.' using errcode = 'P0002';
  end if;

  select * into v_cycle from public.operational_hyrox_cycles
   where id = v_cycle_id for update;
  perform 1 from public.operational_sessions
   where id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
   order by id for update;
  select * into v_booking from public.operational_bookings
   where id = p_booking_id for update;
  if v_booking.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this booking.' using errcode = '42501';
  end if;
  if v_cycle.venue_plan <> 'both' then
    raise exception 'Venue changes are available only when both gyms open.' using errcode = '23514';
  end if;
  if v_booking.status <> 'confirmed' or v_booking.allocation_state <> 'provisional' then
    raise exception 'Booking allocation is not changeable.' using errcode = '23514';
  end if;
  if now() >= v_cycle.venue_choice_deadline_at then
    raise exception 'Venue changes closed Friday at 9 PM HKT.' using errcode = '23514';
  end if;
  if p_target_session_id not in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
      or p_target_session_id = v_booking.session_id then
    raise exception 'Choose the other venue in this HYROX cycle.' using errcode = '22023';
  end if;
  if exists (select 1 from public.operational_hyrox_queue_entries
    where cycle_id = v_cycle.id and profile_id = v_uid
      and status = 'active') then
    raise exception 'You already have an active HYROX queue request.' using errcode = '23505';
  end if;

  select * into v_target from public.operational_sessions where id = p_target_session_id;
  select count(*) into v_target_count from public.operational_bookings
   where hyrox_cycle_id = v_cycle.id and status = 'confirmed'
     and session_id = p_target_session_id;
  if v_target_count < v_target.capacity then
    perform public.select_hyrox_cycle_venue(p_booking_id, p_target_session_id);
    insert into public.operational_hyrox_queue_entries
      (cycle_id, profile_id, kind, target_session_id, status, joined_at, resolved_at)
    values (v_cycle.id, v_uid, 'venue_switch', p_target_session_id,
            'matched', now(), now())
    returning * into v_entry;
    return v_entry;
  end if;

  select q.* into v_opposite
    from public.operational_hyrox_queue_entries q
    join public.operational_bookings b
      on b.hyrox_cycle_id = q.cycle_id and b.profile_id = q.profile_id
     and b.status = 'confirmed'
   where q.cycle_id = v_cycle.id and q.kind = 'venue_switch'
     and q.status = 'active'
     and q.target_session_id = v_booking.session_id
     and b.session_id = p_target_session_id
   order by q.joined_at, q.id
   limit 1 for update of q skip locked;

  if v_opposite.id is null then
    insert into public.operational_hyrox_queue_entries
      (cycle_id, profile_id, kind, target_session_id, status, joined_at)
    values (v_cycle.id, v_uid, 'venue_switch', p_target_session_id, 'active', now())
    returning * into v_entry;
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    values (v_uid, 'operational_hyrox_switch_waitlisted',
            'Venue switch requested',
            'Your current venue remains confirmed while you wait.',
            '#/booking/' || p_booking_id::text);
    return v_entry;
  end if;

  select * into v_opposite_booking from public.operational_bookings
   where hyrox_cycle_id = v_cycle.id and profile_id = v_opposite.profile_id
     and status = 'confirmed' for update;
  update public.operational_bookings
     set session_id = p_target_session_id, allocation_source = 'member',
         allocated_at = now(),
         allocation_snapshot = allocation_snapshot || jsonb_build_array(
           jsonb_build_object('session_id', p_target_session_id,
             'source', 'switch_match', 'assigned_at', now()))
   where id = v_booking.id;
  update public.operational_bookings
     set session_id = v_booking.session_id, allocation_source = 'member',
         allocated_at = now(),
         allocation_snapshot = allocation_snapshot || jsonb_build_array(
           jsonb_build_object('session_id', v_booking.session_id,
             'source', 'switch_match', 'assigned_at', now()))
   where id = v_opposite_booking.id;
  update public.operational_receipts set session_id = p_target_session_id
   where booking_id = v_booking.id;
  update public.operational_receipts set session_id = v_booking.session_id
   where booking_id = v_opposite_booking.id;
  update public.operational_hyrox_queue_entries
     set status = 'matched', resolved_at = now() where id = v_opposite.id;
  insert into public.operational_hyrox_queue_entries
    (cycle_id, profile_id, kind, target_session_id, status, joined_at, resolved_at)
  values (v_cycle.id, v_uid, 'venue_switch', p_target_session_id,
          'matched', now(), now()) returning * into v_entry;

  insert into public.notifications (profile_id, kind, title, body, destination)
  values
    (v_booking.profile_id, 'operational_hyrox_switch_matched',
     'Venue switch confirmed', 'Your requested HYROX venue switch is confirmed.',
     '#/booking/' || v_booking.id::text),
    (v_opposite_booking.profile_id, 'operational_hyrox_switch_matched',
     'Venue switch confirmed', 'Your requested HYROX venue switch is confirmed.',
     '#/booking/' || v_opposite_booking.id::text);
  return v_entry;
end;
$$;

create or replace function public.cancel_hyrox_cycle(
  p_cycle_id text,
  p_reason text
)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_cycle public.operational_hyrox_cycles;
  v_target public.operational_hyrox_cycles;
  v_booking record;
  v_new_booking public.operational_bookings;
  v_target_id text;
  v_target_price integer;
begin
  perform public.operational_assert_admin('cancel_hyrox_cycle');
  if v_reason is null then
    raise exception 'Cancellation reason is required.' using errcode = '22023';
  end if;

  select * into v_cycle from public.operational_hyrox_cycles
   where id = p_cycle_id for update;
  if not found then
    raise exception 'HYROX cycle not found.' using errcode = 'P0002';
  end if;
  if v_cycle.registration_state = 'cancelled' then
    raise exception 'HYROX cycle is already cancelled.' using errcode = '23514';
  end if;
  perform 1 from public.operational_sessions
   where id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
   order by id for update;

  update public.operational_hyrox_cycles
     set registration_state = 'cancelled',
         cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = v_reason
   where id = v_cycle.id
  returning * into v_cycle;
  update public.operational_sessions
     set cancelled_at = now(), cancelled_by = v_uid,
         cancelled_source = 'admin', cancel_reason = v_reason
   where id in (v_cycle.bft_session_id, v_cycle.midtown_session_id);

  update public.operational_bookings
     set status = 'cancelled'
   where hyrox_cycle_id = v_cycle.id
     and status = 'reserved';
  update public.operational_hyrox_queue_entries
     set status = 'dissolved', resolved_at = now()
   where cycle_id = v_cycle.id and status = 'active';

  select * into v_target
    from public.operational_hyrox_cycles c
   where c.session_date > v_cycle.session_date
     and c.registration_state = 'open'
     and c.cancelled_at is null
     and now() < c.payment_deadline_at
     and (select count(*) from public.operational_bookings b
           where b.hyrox_cycle_id = c.id
             and b.status in ('reserved', 'confirmed')) < c.registration_capacity
   order by c.session_date, c.id
   limit 1
   for update;

  if found then
    select price_hkd into v_target_price
      from public.operational_sessions
     where id = v_target.bft_session_id;
    for v_booking in
      select * from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'confirmed'
       order by b.paid_at, b.id
       for update
    loop
      insert into public.operational_bookings (
        profile_id, session_id, hyrox_cycle_id, status, reserved_at,
        pay_deadline_at, payment_marked_at, payment_method, payment_reference,
        paid_at, confirmed_by, venue_preference, fallback_acknowledged_at,
        snapshot
      ) values (
        v_booking.profile_id, null, v_target.id, 'confirmed', now(),
        v_target.payment_deadline_at, v_booking.payment_marked_at,
        v_booking.payment_method, v_booking.payment_reference, v_booking.paid_at,
        v_booking.confirmed_by, v_booking.venue_preference,
        v_booking.fallback_acknowledged_at,
        coalesce(v_booking.snapshot, jsonb_build_object(
          'name', 'ITC HYROX', 'booking_mode', 'weekly_pool',
          'session_date', v_target.session_date, 'price_hkd', v_target_price))
      ) returning * into v_new_booking;
      update public.operational_bookings
         set status = 'deferred', deferred_to_booking_id = v_new_booking.id
       where id = v_booking.id;
      update public.operational_bookings
         set deferred_from_booking_id = v_booking.id
       where id = v_new_booking.id;
      update public.operational_receipts
         set hyrox_cycle_id = v_target.id, session_id = null,
             booking_id = v_new_booking.id
       where booking_id = v_booking.id
         and hyrox_cycle_id = v_cycle.id;
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      values
        (v_booking.profile_id, 'operational_hyrox_cycle_deferred',
         'HYROX booking moved',
         'Your paid HYROX place was moved to ' || v_target.session_date::text || '.',
         '#/booking/' || v_new_booking.id::text);
    end loop;
  else
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    select b.profile_id, 'operational_hyrox_cycle_credit_followup',
           'HYROX booking requires follow-up',
           'Your paid HYROX place was cancelled; ITC will follow up about your credit.',
           '#/schedule'
      from public.operational_bookings b
     where b.hyrox_cycle_id = v_cycle.id and b.status = 'confirmed';
  end if;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  select p.id, 'operational_hyrox_cycle_cancelled', 'HYROX cycle cancelled',
         'The HYROX cycle on ' || v_cycle.session_date::text ||
           ' was cancelled: ' || v_reason || '.', '#/schedule'
    from public.profiles p
   where p.role in ('member', 'admin', 'super_admin');
  return v_cycle;
end;
$$;

create or replace function public.leave_hyrox_venue_switch_queue(p_entry_id uuid)
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
  select cycle_id into v_cycle_id from public.operational_hyrox_queue_entries
   where id = p_entry_id;
  if v_cycle_id is null then
    raise exception 'HYROX switch request not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.operational_hyrox_cycles where id = v_cycle_id for update;
  select * into v_entry from public.operational_hyrox_queue_entries
   where id = p_entry_id for update;
  if v_entry.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this switch request.' using errcode = '42501';
  end if;
  if v_entry.kind <> 'venue_switch' or v_entry.status <> 'active' then
    raise exception 'Venue-switch request is no longer active.' using errcode = '23514';
  end if;
  update public.operational_hyrox_queue_entries
     set status = 'left', resolved_at = now()
   where id = p_entry_id returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function public.close_hyrox_venue_allocation(p_cycle_id text)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.operational_hyrox_cycles;
begin
  perform public.operational_assert_admin('close_hyrox_venue_allocation');
  select * into v_cycle from public.operational_hyrox_cycles
   where id = p_cycle_id for update;
  if not found then
    raise exception 'HYROX cycle not found.' using errcode = 'P0002';
  end if;
  perform 1 from public.operational_sessions
   where id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
   order by id for update;
  if v_cycle.allocation_closed_at is not null then
    return v_cycle;
  end if;
  if v_cycle.venue_plan = 'pending' or v_cycle.registration_state <> 'closed' then
    raise exception 'HYROX venue plan is not ready.' using errcode = '23514';
  end if;
  if now() < v_cycle.venue_choice_deadline_at then
    raise exception 'Venue changes close Friday at 9 PM HKT.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set allocation_state = 'final', allocated_at = now()
   where hyrox_cycle_id = v_cycle.id
     and status = 'confirmed'
     and allocation_state = 'provisional';
  update public.operational_hyrox_queue_entries
     set status = 'dissolved', resolved_at = now()
   where cycle_id = v_cycle.id and kind = 'venue_switch' and status = 'active';
  update public.operational_hyrox_cycles
     set allocation_closed_at = now()
   where id = v_cycle.id
  returning * into v_cycle;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  select b.profile_id, 'operational_hyrox_allocation_final',
         'HYROX venue confirmed',
         'Your final HYROX venue for ' || v_cycle.session_date::text ||
           ' is ' || s.venue || '.',
         '#/booking/' || b.id::text
    from public.operational_bookings b
    join public.operational_sessions s on s.id = b.session_id
   where b.hyrox_cycle_id = v_cycle.id and b.status = 'confirmed';
  return v_cycle;
end;
$$;

do $$
begin
  if to_regprocedure('public.cancel_operational_session(text,text)') is not null
      and to_regprocedure('public.cancel_operational_session_legacy(text,text)') is null then
    alter function public.cancel_operational_session(text, text)
      rename to cancel_operational_session_legacy;
  end if;
  if to_regprocedure('public.set_operational_midtown_open(text,boolean)') is not null
      and to_regprocedure('public.set_operational_midtown_open_legacy(text,boolean)') is null then
    alter function public.set_operational_midtown_open(text, boolean)
      rename to set_operational_midtown_open_legacy;
  end if;
  if to_regprocedure('public.finalize_operational_gym(text,text)') is not null
      and to_regprocedure('public.finalize_operational_gym_legacy(text,text)') is null then
    alter function public.finalize_operational_gym(text, text)
      rename to finalize_operational_gym_legacy;
  end if;
end;
$$;

create or replace function public.cancel_operational_session(
  p_session_id text,
  p_reason text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle_id text;
begin
  perform public.operational_assert_admin('cancel_session');
  select id into v_cycle_id from public.operational_hyrox_cycles
   where bft_session_id = p_session_id or midtown_session_id = p_session_id;
  if v_cycle_id is not null then
    raise exception 'Cancel the weekly HYROX cycle instead.' using errcode = '23514';
  end if;
  return public.cancel_operational_session_legacy(p_session_id, p_reason);
end;
$$;

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
  v_cycle public.operational_hyrox_cycles;
begin
  perform public.operational_assert_admin('set_midtown_open');
  select * into v_cycle from public.operational_hyrox_cycles
   where midtown_session_id = p_session_id
     and registration_state <> 'draft';
  if found then
    raise exception 'Midtown availability is derived from the weekly HYROX plan.'
      using errcode = '23514';
  end if;
  return public.set_operational_midtown_open_legacy(p_session_id, p_enabled);
end;
$$;

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
  v_cycle public.operational_hyrox_cycles;
begin
  perform public.operational_assert_admin('finalize_gym');
  select * into v_cycle from public.operational_hyrox_cycles
   where bft_session_id = p_session_id or midtown_session_id = p_session_id;
  if found then
    if v_cycle.allocation_closed_at is null then
      raise exception 'HYROX venue allocation must be closed first.' using errcode = '23514';
    end if;
    if v_cycle.venue_plan = 'bft_only' and p_session_id = v_cycle.midtown_session_id then
      raise exception 'HYROX child venue is not enabled by the weekly plan.' using errcode = '23514';
    end if;
  end if;
  return public.finalize_operational_gym_legacy(p_session_id, p_note);
end;
$$;

revoke all on function public.cancel_operational_session_legacy(text, text)
  from public, anon, authenticated;
revoke all on function public.set_operational_midtown_open_legacy(text, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_operational_gym_legacy(text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_operational_session(text, text)
  from public, anon, authenticated;
revoke all on function public.set_operational_midtown_open(text, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_operational_gym(text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_operational_session(text, text)
  to authenticated;
grant execute on function public.set_operational_midtown_open(text, boolean)
  to authenticated;
grant execute on function public.finalize_operational_gym(text, text)
  to authenticated;

revoke all on function public.select_hyrox_cycle_venue(uuid, text)
  from public, anon, authenticated;
revoke all on function public.join_hyrox_venue_switch_queue(uuid, text)
  from public, anon, authenticated;
revoke all on function public.close_hyrox_venue_allocation(text)
  from public, anon, authenticated;
revoke all on function public.cancel_hyrox_cycle(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_hyrox_venue_switch_queue(uuid)
  from public, anon, authenticated;
grant execute on function public.select_hyrox_cycle_venue(uuid, text)
  to authenticated;
grant execute on function public.join_hyrox_venue_switch_queue(uuid, text)
  to authenticated;
grant execute on function public.close_hyrox_venue_allocation(text)
  to authenticated;
grant execute on function public.cancel_hyrox_cycle(text, text)
  to authenticated;
grant execute on function public.leave_hyrox_venue_switch_queue(uuid)
  to authenticated;

-- Realtime publication is additive and idempotent for forward-only deploys.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_hyrox_cycles'
  ) then
    alter publication supabase_realtime add table public.operational_hyrox_cycles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_hyrox_queue_entries'
  ) then
    alter publication supabase_realtime add table public.operational_hyrox_queue_entries;
  end if;
end;
$$;

notify pgrst, 'reload schema';
