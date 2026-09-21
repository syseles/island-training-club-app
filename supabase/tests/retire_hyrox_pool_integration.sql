-- Island Training Club — retired BFT/Midtown HYROX boundary integration
-- Run only against a disposable local Supabase database. Every fixture and
-- mutation, including the complete Island ECC lifecycle, is rolled back.

\set ON_ERROR_STOP on

begin;

create function pg_temp.retire_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'retired HYROX integration failed: %', message;
  end if;
end;
$$;

create function pg_temp.retire_expect_denied(
  statement text,
  expected_message text
)
returns void language plpgsql as $$
declare
  actual_state text;
  actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics
      actual_state = returned_sqlstate,
      actual_message = message_text;
  end;
  perform pg_temp.retire_assert(
    actual_state = '42501' and actual_message = expected_message,
    format(
      'expected SQLSTATE 42501 / %L, got %s / %L for: %s',
      expected_message, coalesce(actual_state, '<success>'), actual_message, statement
    )
  );
end;
$$;

create function pg_temp.retire_expect_rejected(
  statement text,
  expected_state text,
  expected_message text
)
returns void language plpgsql as $$
declare
  actual_state text;
  actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics
      actual_state = returned_sqlstate,
      actual_message = message_text;
  end;
  perform pg_temp.retire_assert(
    actual_state = expected_state and actual_message = expected_message,
    format(
      'expected SQLSTATE %s / %L, got %s / %L for: %s',
      expected_state, expected_message, coalesce(actual_state, '<success>'),
      actual_message, statement
    )
  );
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a2200000-0000-0000-0000-000000000001', 'retire-admin@itc.invalid', '{}'::jsonb),
  ('a2200000-0000-0000-0000-000000000002', 'retire-member@itc.invalid', '{}'::jsonb);

update public.profiles
   set role = 'admin', full_name = 'Retirement Admin'
 where id = 'a2200000-0000-0000-0000-000000000001';
update public.profiles
   set role = 'member', full_name = 'Retirement Member'
 where id = 'a2200000-0000-0000-0000-000000000002';

do $$
declare
  v_admin constant uuid := 'a2200000-0000-0000-0000-000000000001';
  v_member constant uuid := 'a2200000-0000-0000-0000-000000000002';
  v_pool_date date;
  v_ecc_date date;
  v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
  v_pool_bft_session_id text;
  v_pool_midtown_session_id text;
  v_island_ecc_session_id text;
  v_attendance_session_id text;
  v_cycle_id text;
  v_pool_booking_id uuid;
  v_unallocated_pool_booking_id uuid;
  v_pool_queue_id uuid;
  v_pool_replacement_id uuid;
  v_pool_review_notification_id uuid;
  v_pool_review_created_at timestamptz;
  v_ecc_booking_id uuid;
  v_ecc_queue_id uuid;
  v_ecc_replacement_id uuid;
  v_ecc_review_notification_id uuid;
  v_attendance_booking_id uuid;
  v_temp_pool_booking_id uuid;
  v_notification_count integer;
  v_cycle_count integer;
  v_pool_booking_before jsonb;
  v_pool_queue_before jsonb;
  v_pool_replacement_before jsonb;
  v_receipt_count integer;
  v_result jsonb;
  v_signature text;
  v_rows integer;
begin
  v_ecc_date := current_date + 200
    + ((6 - extract(dow from current_date + 200)::integer + 7) % 7);
  -- Retained pool fixtures deliberately share Island ECC's date. They must
  -- neither conflict with nor otherwise influence the active direct product.
  v_pool_date := v_ecc_date;
  v_pool_bft_session_id := 'hyrox-bft-' || v_pool_date::text;
  v_pool_midtown_session_id := 'hyrox-midtown-' || v_pool_date::text;
  v_island_ecc_session_id := 'hyrox-quarry-bay-' || v_ecc_date::text;
  v_attendance_session_id := 'hyrox-quarry-bay-' || v_today::text;
  v_cycle_id := 'hyrox-pool-' || v_pool_date::text;

  perform pg_temp.retire_assert(
    public.operational_is_retired_hyrox_activity('hyrox-bft')
      and public.operational_is_retired_hyrox_activity('hyrox-midtown')
      and not public.operational_is_retired_hyrox_activity('hyrox-quarry-bay')
      and not public.operational_is_retired_hyrox_activity('hyrox-bft-training'),
    'retirement identity must use exact canonical activity ids'
  );

  insert into public.operational_sessions (
    id, activity_id, session_date, start_time, duration_minutes,
    venue, capacity, price_hkd, is_open
  ) values
    (v_pool_bft_session_id, 'hyrox-bft', v_pool_date, '11:15', 60,
     'BFT Causeway Bay', 20, 180, true),
    (v_pool_midtown_session_id, 'hyrox-midtown', v_pool_date, '11:00', 60,
     'Midtown28 Fitness', 12, 180, false),
    (v_island_ecc_session_id, 'hyrox-quarry-bay', v_ecc_date, '11:00', 60,
     '10/F, Island ECC, Quarry Bay', 30, 180, true)
  on conflict (id) do update
    set start_time = excluded.start_time,
        capacity = excluded.capacity,
        is_open = excluded.is_open,
        cancelled_at = null,
        cancelled_by = null,
        cancelled_source = null,
        cancel_reason = null,
        gym_confirmed_at = null,
        gym_confirmed_by = null,
        gym_note = null;

  insert into public.operational_sessions (
    id, activity_id, session_date, start_time, duration_minutes,
    venue, capacity, price_hkd, is_open
  ) values (
    v_attendance_session_id, 'hyrox-quarry-bay', v_today,
    (now() at time zone 'Asia/Hong_Kong')::time, 60,
    '10/F, Island ECC, Quarry Bay', 30, 180, true
  ) on conflict (id) do update
    set start_time = excluded.start_time,
        duration_minutes = excluded.duration_minutes,
        cancelled_at = null,
        cancelled_by = null,
        cancelled_source = null,
        cancel_reason = null;

  insert into public.operational_hyrox_cycles (
    id, session_date, bft_session_id, midtown_session_id,
    registration_state, venue_plan, registration_opens_at,
    payment_deadline_at, holder_grace_deadline_at,
    promoted_payment_deadline_at, venue_choice_deadline_at
  ) values (
    v_cycle_id, v_pool_date, v_pool_bft_session_id, v_pool_midtown_session_id,
    'open', 'pending', now() - interval '1 day',
    now() + interval '1 day', now() + interval '1 day 1 hour',
    now() + interval '1 day 2 hours', now() + interval '2 days'
  );

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, payment_marked_at, payment_method, payment_reference,
    paid_at, confirmed_by, venue_preference, fallback_acknowledged_at,
    allocation_state, allocation_source, allocated_at, allocation_snapshot,
    snapshot
  ) values (
    v_member, v_pool_bft_session_id, v_cycle_id, 'confirmed', now(),
    now() + interval '1 day', now(), 'fps', 'POOL-RETAINED', now(), v_admin,
    'either', now(), 'final', 'automatic', now(),
    jsonb_build_array(jsonb_build_object('session_id', v_pool_bft_session_id)),
    jsonb_build_object('name', 'ITC HYROX', 'kind', 'paid',
      'booking_mode', 'weekly_pool', 'session_date', v_pool_date)
  ) returning id into v_pool_booking_id;

  insert into public.operational_bookings (
    profile_id, session_id, hyrox_cycle_id, status, reserved_at,
    pay_deadline_at, venue_preference, fallback_acknowledged_at, snapshot
  ) values (
    v_admin, null, v_cycle_id, 'expired', now(), now() + interval '1 day',
    'either', now(), jsonb_build_object(
      'name', 'ITC HYROX', 'kind', 'paid',
      'booking_mode', 'weekly_pool', 'session_date', v_pool_date
    )
  ) returning id into v_unallocated_pool_booking_id;

  insert into public.operational_receipts (
    receipt_number, booking_id, profile_id, session_id, hyrox_cycle_id,
    amount_hkd, payment_method, issued_by
  ) values (
    'ITC-RETIRE-POOL', v_pool_booking_id, v_member,
    v_pool_bft_session_id, v_cycle_id, 180, 'fps', v_admin
  );

  insert into public.operational_queue_entries (
    session_id, profile_id, kind, status
  ) values (v_pool_midtown_session_id, v_admin, 'interest', 'active')
  returning id into v_pool_queue_id;

  insert into public.operational_hyrox_queue_entries (
    cycle_id, profile_id, kind, venue_preference,
    fallback_acknowledged_at, status
  ) values (v_cycle_id, v_admin, 'weekly_waitlist', 'either', now(), 'active');

  insert into public.operational_booking_replacement_requests (
    booking_id, original_profile_id, token_hash, expires_at
  ) values (
    v_pool_booking_id, v_member,
    repeat('a', 64), now() + interval '12 hours'
  ) returning id into v_pool_replacement_id;
  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id, actor_profile_id
  ) values (
    v_pool_replacement_id, v_pool_booking_id, 'created', v_member, v_member
  );

  -- Match the real Admin-review producer: accepted_at and notification
  -- created_at share the transaction timestamp, while the generic Admin route
  -- contains no booking id.
  v_pool_review_created_at := clock_timestamp();
  update public.operational_booking_replacement_requests
     set status = 'accepted', replacement_profile_id = v_admin,
         accepted_at = v_pool_review_created_at, accepted_by = v_admin
   where id = v_pool_replacement_id;
  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id,
    replacement_profile_id, actor_profile_id, created_at
  ) values (
    v_pool_replacement_id, v_pool_booking_id, 'accepted', v_member,
    v_admin, v_admin, v_pool_review_created_at
  );

  insert into public.notifications (profile_id, kind, title, body, destination)
  values
    (v_member, 'operational_hyrox_reserved', 'Retained pool notice',
     'Retained fixture', '#/pay/' || v_pool_booking_id::text),
    (v_member, 'operational_payment_approved', 'Retained pool receipt',
     'Retained fixture', '#/booking/' || v_pool_booking_id::text);
  insert into public.notifications (
    profile_id, kind, title, body, destination, created_at
  ) values (
    v_admin, 'hyrox_replacement_review',
    'HYROX replacement needs confirmation',
    'An approved member accepted a paid HYROX replacement invite. Review it in Admin Payments.',
    '#/admin/ops', v_pool_review_created_at
  ) returning id into v_pool_review_notification_id;

  select to_jsonb(b) into v_pool_booking_before
    from public.operational_bookings b where b.id = v_pool_booking_id;
  select to_jsonb(q) into v_pool_queue_before
    from public.operational_queue_entries q where q.id = v_pool_queue_id;
  select to_jsonb(r) into v_pool_replacement_before
    from public.operational_booking_replacement_requests r
   where r.id = v_pool_replacement_id;
  select count(*) into v_notification_count from public.notifications;
  select count(*) into v_cycle_count from public.operational_hyrox_cycles;

  -- Trusted owner still sees every retained fixture.
  perform pg_temp.retire_assert(
    (select count(*) from public.operational_hyrox_cycles where id = v_cycle_id) = 1,
    'trusted pool cycle must remain stored'
  );
  perform pg_temp.retire_assert(
    (select count(*) from public.operational_bookings where hyrox_cycle_id = v_cycle_id) > 0,
    'trusted pool bookings must remain stored'
  );
  perform pg_temp.retire_assert(
    public.operational_is_retired_hyrox_session(v_pool_bft_session_id)
      and public.operational_is_retired_hyrox_booking(v_pool_booking_id)
      and public.operational_is_retired_hyrox_booking(v_unallocated_pool_booking_id),
    'retired session and booking helpers must follow allocated and unallocated pool relationships'
  );
  perform pg_temp.retire_assert(
    not has_table_privilege('anon', 'public.operational_hyrox_cycles', 'select')
      and not has_table_privilege('authenticated', 'public.operational_hyrox_cycles', 'select')
      and not has_table_privilege('anon', 'public.operational_hyrox_queue_entries', 'select')
      and not has_table_privilege('authenticated', 'public.operational_hyrox_queue_entries', 'select'),
    'browser roles must have no direct pool-table read privilege'
  );
  perform pg_temp.retire_assert(
    not has_function_privilege('anon', 'public.operational_is_retired_hyrox_activity(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.operational_is_retired_hyrox_activity(text)', 'execute')
      and not has_function_privilege('anon', 'public.operational_is_retired_hyrox_session(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.operational_is_retired_hyrox_session(text)', 'execute')
      and not has_function_privilege('anon', 'public.operational_is_retired_hyrox_booking(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.operational_is_retired_hyrox_booking(uuid)', 'execute'),
    'public retirement helpers must remain unavailable to browser roles'
  );
  perform pg_temp.retire_assert(
    has_function_privilege(
      'service_role', 'public.operational_is_retired_hyrox_session(text)', 'execute'
    )
      and not has_function_privilege(
        'service_role', 'public.operational_is_retired_hyrox_activity(text)', 'execute'
      )
      and not has_function_privilege(
        'service_role', 'public.operational_is_retired_hyrox_booking(uuid)', 'execute'
      ),
    'avatar service role must have only the authoritative session classifier'
  );
  set local role service_role;
  perform pg_temp.retire_assert(
    public.operational_is_retired_hyrox_session(v_pool_bft_session_id)
      and public.operational_is_retired_hyrox_session(v_pool_midtown_session_id)
      and not public.operational_is_retired_hyrox_session(v_island_ecc_session_id)
      and not public.operational_is_retired_hyrox_session(
        'hyrox-bft-training-' || v_pool_date::text
      ),
    'service-role classifier must reject exact retired sessions only'
  );
  reset role;
  foreach v_signature in array array[
    'public.ensure_hyrox_cycles(date,integer)',
    'public.reserve_hyrox_cycle(text,text,boolean)',
    'public.join_hyrox_cycle_waitlist(text,text,boolean)',
    'public.leave_hyrox_cycle_queue(uuid)',
    'public.schedule_hyrox_cycle(text)',
    'public.sweep_hyrox_cycle_deadlines(timestamp with time zone)',
    'public.reject_hyrox_cycle_payment(uuid,text)',
    'public.finalize_hyrox_venue_plan(text)',
    'public.select_hyrox_cycle_venue(uuid,text)',
    'public.join_hyrox_venue_switch_queue(uuid,text)',
    'public.leave_hyrox_venue_switch_queue(uuid)',
    'public.close_hyrox_venue_allocation(text)',
    'public.cancel_hyrox_cycle(text,text)',
    'public.send_hyrox_collector_payment_reminder(timestamp with time zone)',
    'public.send_hyrox_member_payment_reminders(timestamp with time zone)',
    'public.send_hyrox_venue_reminders(timestamp with time zone)'
  ] loop
    perform pg_temp.retire_assert(
      not has_function_privilege('anon', v_signature, 'execute')
        and not has_function_privilege('authenticated', v_signature, 'execute'),
      'pool-only function must be owner-only: ' || v_signature
    );
  end loop;
  perform pg_temp.retire_assert(
    not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname like '%pre_pool_retirement%'
         and (
           has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute')
         )
    ),
    'renamed pre-retirement implementations must remain browser-denied'
  );

  -- Templates and provisioning.
  perform pg_temp.retire_assert(
    not (select active from public.operational_activity_templates where activity_id = 'hyrox-bft'),
    'BFT template must be inactive'
  );
  perform pg_temp.retire_assert(
    not (select active from public.operational_activity_templates where activity_id = 'hyrox-midtown'),
    'Midtown template must be inactive'
  );
  perform pg_temp.retire_assert(
    (select active from public.operational_activity_templates where activity_id = 'hyrox-quarry-bay'),
    'Island ECC must remain active'
  );
  perform count(*) from public.ensure_hyrox_cycles(v_pool_date, 1);
  perform count(*) from public.ensure_operational_sessions(v_pool_date, 1);
  perform pg_temp.retire_assert(
    (select count(*) from public.operational_hyrox_cycles) = v_cycle_count,
    'provisioning must not create a new pool cycle'
  );

  -- Browser member cannot read pool tables or rows and cannot invoke either
  -- pool-only or shared mutation entry points for a retired target.
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  perform pg_temp.retire_expect_denied(
    'select * from public.operational_hyrox_cycles',
    'permission denied for table operational_hyrox_cycles'
  );
  perform pg_temp.retire_expect_denied(
    'select * from public.operational_hyrox_queue_entries',
    'permission denied for table operational_hyrox_queue_entries'
  );
  perform pg_temp.retire_expect_denied(
    'select public.reserve_hyrox_cycle(''' || v_cycle_id || ''',''either'',true)',
    'permission denied for function reserve_hyrox_cycle'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.reserve_operational_session(''' || v_pool_bft_session_id || ''')',
    'P0002', 'Session not found.'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.mark_operational_payment(''' || v_pool_booking_id || ''',''fps'',''blocked'')',
    'P0002', 'Booking not found.'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.create_operational_replacement_request(''' || v_pool_booking_id
      || ''',''' || repeat('b', 64) || ''',now()+interval ''1 hour'')',
    'P0002', 'Booking not found.'
  );
  perform pg_temp.retire_assert(
    not exists (select 1 from public.operational_activity_templates
      where activity_id in ('hyrox-bft', 'hyrox-midtown'))
      and exists (select 1 from public.operational_activity_templates
      where activity_id = 'hyrox-quarry-bay'),
    'member template reads must expose Island ECC but not retired templates'
  );
  perform pg_temp.retire_assert(
    not exists (select 1 from public.operational_sessions
      where id in (v_pool_bft_session_id, v_pool_midtown_session_id))
      and exists (select 1 from public.operational_sessions
      where id = v_island_ecc_session_id),
    'member session reads must expose Island ECC but not retired sessions'
  );
  perform pg_temp.retire_assert(
    not exists (select 1 from public.operational_bookings where id = v_pool_booking_id)
      and not exists (select 1 from public.operational_receipts
        where booking_id = v_pool_booking_id)
      and not exists (select 1 from public.operational_queue_entries
        where id = v_pool_queue_id),
    'member history, receipts, and queues must hide retired relationships'
  );
  perform pg_temp.retire_assert(
    not exists (select 1 from public.notifications
      where destination in ('#/pay/' || v_pool_booking_id::text,
                            '#/booking/' || v_pool_booking_id::text)
         or kind like 'operational_hyrox\_%' escape '\'),
    'member notifications must hide pool kinds and destinations'
  );
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Admin has the same read boundary and cannot use pool controls or generic
  -- child-session controls.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform pg_temp.retire_expect_denied(
    'select * from public.operational_hyrox_cycles',
    'permission denied for table operational_hyrox_cycles'
  );
  perform pg_temp.retire_expect_denied(
    'select public.finalize_hyrox_venue_plan(''' || v_cycle_id || ''')',
    'permission denied for function finalize_hyrox_venue_plan'
  );
  perform pg_temp.retire_expect_denied(
    'select public.cancel_hyrox_cycle(''' || v_cycle_id || ''',''blocked'')',
    'permission denied for function cancel_hyrox_cycle'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.set_operational_notice(''' || v_pool_bft_session_id || ''',''blocked'')',
    'P0002', 'Session not found.'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.set_operational_attendance(''' || v_pool_booking_id || ''',true)',
    'P0002', 'Booking not found.'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.mark_operational_payment(''' || v_unallocated_pool_booking_id
      || ''',''fps'',''blocked'')',
    'P0002', 'Booking not found.'
  );
  perform pg_temp.retire_expect_rejected(
    'select public.admin_decide_operational_replacement(''' || v_pool_replacement_id
      || ''',false,''blocked'')',
    'P0002', 'Replacement request not found.'
  );
  perform pg_temp.retire_assert(
    not exists (select 1 from public.operational_bookings where id = v_pool_booking_id)
      and not exists (select 1 from public.list_operational_replacement_requests()
        where booking_id = v_pool_booking_id),
    'Admin payment and replacement reads must exclude retained pool rows'
  );
  perform pg_temp.retire_assert(
    not exists (
      select 1 from public.notifications where id = v_pool_review_notification_id
    ),
    'realistic retired replacement-review notification must be hidden from Admin'
  );
  update public.notifications
     set read_at = now()
   where id = v_pool_review_notification_id;
  get diagnostics v_rows = row_count;
  perform pg_temp.retire_assert(
    v_rows = 0,
    'Admin must not mark a hidden retired replacement-review notification read'
  );
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform pg_temp.retire_assert(
    (select to_jsonb(b) = v_pool_booking_before
       from public.operational_bookings b where b.id = v_pool_booking_id)
      and (select to_jsonb(q) = v_pool_queue_before
       from public.operational_queue_entries q where q.id = v_pool_queue_id)
      and (select to_jsonb(r) = v_pool_replacement_before
       from public.operational_booking_replacement_requests r
      where r.id = v_pool_replacement_id)
      and (select count(*) from public.notifications) = v_notification_count,
    'denied pool operations must not mutate fixtures or emit notifications'
  );

  -- Island ECC direct reservation, payment, receipt, waitlist, gym and
  -- replacement behavior remains available through the same public RPCs.
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select id into v_ecc_booking_id
    from public.reserve_operational_session(v_island_ecc_session_id);
  perform public.mark_operational_payment(v_ecc_booking_id, 'fps', 'ECC-OK');
  reset role;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.approve_operational_payment(v_ecc_booking_id);
  perform public.finalize_operational_gym(v_island_ecc_session_id, 'Island ECC confirmed');
  reset role;

  perform pg_temp.retire_assert(
    (select status = 'confirmed' and payment_method = 'fps'
       from public.operational_bookings where id = v_ecc_booking_id)
      and (select count(*) = 1 from public.operational_receipts
       where booking_id = v_ecc_booking_id
         and session_id = v_island_ecc_session_id
         and hyrox_cycle_id is null),
    'Island ECC payment confirmation and receipt must remain unchanged'
  );

  update public.operational_sessions set capacity = 1
   where id = v_island_ecc_session_id;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select id into v_ecc_queue_id
    from public.join_operational_queue(v_island_ecc_session_id, 'waitlist');
  reset role;
  perform pg_temp.retire_assert(
    (select status = 'active' and kind = 'waitlist'
       from public.operational_queue_entries where id = v_ecc_queue_id),
    'Island ECC direct waitlist must remain available'
  );

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;
  select (public.create_operational_replacement_request(
    v_ecc_booking_id, repeat('c', 64), now() + interval '12 hours'
  )->>'requestId')::uuid into v_ecc_replacement_id;
  reset role;

  -- Both replacement conflict checks must ignore retained active pool
  -- bookings whether the booking is allocated or still unallocated. Each
  -- deliberate subtransaction is rolled back so the real lifecycle below can
  -- run once and retained fixture snapshots remain unchanged.
  begin
    insert into public.operational_bookings (
      profile_id, session_id, hyrox_cycle_id, status, reserved_at,
      pay_deadline_at, payment_marked_at, payment_method, paid_at, confirmed_by,
      venue_preference, fallback_acknowledged_at, allocation_state,
      allocation_source, allocated_at, allocation_snapshot, snapshot
    ) values (
      v_admin, v_pool_bft_session_id, v_cycle_id, 'confirmed', now(),
      now() + interval '1 day', now(), 'fps', now(), v_admin, 'either', now(),
      'final', 'automatic', now(),
      jsonb_build_array(jsonb_build_object('session_id', v_pool_bft_session_id)),
      jsonb_build_object('name', 'ITC HYROX', 'booking_mode', 'weekly_pool')
    ) returning id into v_temp_pool_booking_id;
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    perform public.accept_operational_replacement_request(repeat('c', 64));
    reset role;
    update public.operational_bookings set status = 'expired'
     where id = v_temp_pool_booking_id;
    update public.operational_bookings set status = 'confirmed'
     where id = v_unallocated_pool_booking_id;
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    perform public.admin_decide_operational_replacement(
      v_ecc_replacement_id, true, 'allocated acceptance / unallocated confirmation'
    );
    reset role;
    raise exception 'rollback replacement conflict scenario one';
  exception when raise_exception then
    if sqlerrm <> 'rollback replacement conflict scenario one' then raise; end if;
  end;

  begin
    update public.operational_bookings set status = 'confirmed'
     where id = v_unallocated_pool_booking_id;
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    perform public.accept_operational_replacement_request(repeat('c', 64));
    reset role;
    update public.operational_bookings set status = 'expired'
     where id = v_unallocated_pool_booking_id;
    insert into public.operational_bookings (
      profile_id, session_id, hyrox_cycle_id, status, reserved_at,
      pay_deadline_at, payment_marked_at, payment_method, paid_at, confirmed_by,
      venue_preference, fallback_acknowledged_at, allocation_state,
      allocation_source, allocated_at, allocation_snapshot, snapshot
    ) values (
      v_admin, v_pool_bft_session_id, v_cycle_id, 'confirmed', now(),
      now() + interval '1 day', now(), 'fps', now(), v_admin, 'either', now(),
      'final', 'automatic', now(),
      jsonb_build_array(jsonb_build_object('session_id', v_pool_bft_session_id)),
      jsonb_build_object('name', 'ITC HYROX', 'booking_mode', 'weekly_pool')
    );
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    set local role authenticated;
    perform public.admin_decide_operational_replacement(
      v_ecc_replacement_id, true, 'unallocated acceptance / allocated confirmation'
    );
    reset role;
    raise exception 'rollback replacement conflict scenario two';
  exception when raise_exception then
    if sqlerrm <> 'rollback replacement conflict scenario two' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.accept_operational_replacement_request(repeat('c', 64));
  select id into v_ecc_review_notification_id
    from public.notifications
   where profile_id = v_admin
     and kind = 'hyrox_replacement_review'
     and destination = '#/admin/ops'
     and id <> v_pool_review_notification_id
   order by created_at desc, id desc
   limit 1;
  perform pg_temp.retire_assert(
    v_ecc_review_notification_id is not null
      and exists (
        select 1 from public.notifications where id = v_ecc_review_notification_id
      )
      and not exists (
        select 1 from public.notifications where id = v_pool_review_notification_id
      ),
    'Admin must see Island ECC review notification but not retained pool review'
  );
  update public.notifications set read_at = now()
   where id = v_ecc_review_notification_id;
  get diagnostics v_rows = row_count;
  perform pg_temp.retire_assert(
    v_rows = 1,
    'Admin must retain read-marker access to Island ECC review notifications'
  );
  select public.admin_decide_operational_replacement(
    v_ecc_replacement_id, true, 'Island ECC replacement accepted'
  ) into v_result;
  perform pg_temp.retire_assert(
    exists (select 1 from public.list_operational_replacement_requests()
      where request_id = v_ecc_replacement_id)
      and not exists (select 1 from public.list_operational_replacement_requests()
      where request_id = v_pool_replacement_id),
    'replacement list must include Island ECC and exclude the retired pool'
  );
  reset role;
  perform pg_temp.retire_assert(
    (select replacement_profile_id = v_admin
       from public.operational_bookings where id = v_ecc_booking_id)
      and (v_result->>'status') = 'confirmed',
    'Island ECC replacement confirmation must remain available'
  );

  insert into public.operational_bookings (
    profile_id, session_id, status, reserved_at, pay_deadline_at,
    payment_marked_at, payment_method, payment_reference, paid_at,
    confirmed_by, snapshot
  ) values (
    v_member, v_attendance_session_id, 'confirmed', now() - interval '1 day',
    now(), now() - interval '1 day', 'payme', 'ECC-ATTEND',
    now() - interval '1 day', v_admin,
    jsonb_build_object('name', 'ITC HYROX', 'kind', 'paid',
      'venue', '10/F, Island ECC, Quarry Bay')
  ) returning id into v_attendance_booking_id;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.set_operational_attendance(v_attendance_booking_id, true);
  reset role;
  perform pg_temp.retire_assert(
    (select status = 'attended' and attended_by = v_admin
       from public.operational_bookings where id = v_attendance_booking_id),
    'Island ECC attendance must remain available'
  );

  select count(*) into v_receipt_count
    from public.operational_receipts where booking_id = v_pool_booking_id;
  perform pg_temp.retire_assert(
    v_receipt_count = 1
      and (select count(*) from public.operational_hyrox_cycles where id = v_cycle_id) = 1
      and (select count(*) from public.operational_bookings
        where id in (v_pool_booking_id, v_unallocated_pool_booking_id)) = 2
      and (select count(*) from public.operational_hyrox_queue_entries where cycle_id = v_cycle_id) = 1
      and (select count(*) from public.operational_booking_replacement_requests
        where id = v_pool_replacement_id) = 1,
    'all retained pool fixture row counts must remain unchanged'
  );
end;
$$;

rollback;

\echo 'OK: retired HYROX pool boundary'
