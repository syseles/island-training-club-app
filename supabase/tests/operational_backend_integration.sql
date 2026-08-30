-- Island Training Club — shared HYROX operational backend integration tests
--
-- Plain SQL covering schema, RLS, RPCs, atomicity, and seed. Each scenario
-- is scoped inside an explicit transaction. Tests use raise notice to
-- surface failures; the verifier observes non-zero exit from psql.
--
-- Run after every ordered migration through
-- supabase/tests/verify_operational_backend.sh against a disposable
-- Supabase-compatible database.

\set ON_ERROR_STOP on

create function pg_temp.op_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'verification failed: %', message;
  end if;
end;
$$;

-- Helper: claim the current role/sub as a SQL session and run a snippet.
-- Used so each scenario can switch callers without losing state.
create function pg_temp.op_as(p_sub uuid, p_role text, p_body text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  set local role authenticated;
  execute replace(p_body, '{{SUB}}', p_sub::text);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- =====================================================================
-- Schema foundations
-- =====================================================================

do $$
declare failures integer := 0;
begin
  if to_regclass('public.operational_activity_templates') is null then
    raise notice 'FAIL: operational_activity_templates missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_sessions') is null then
    raise notice 'FAIL: operational_sessions missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_bookings') is null then
    raise notice 'FAIL: operational_bookings missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_queue_entries') is null then
    raise notice 'FAIL: operational_queue_entries missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_receipts') is null then
    raise notice 'FAIL: operational_receipts missing'; failures := failures + 1;
  end if;
  if to_regclass('public.collector_assignments') is null then
    raise notice 'FAIL: collector_assignments missing'; failures := failures + 1;
  end if;
  if to_regclass('public.collector_payout_profiles') is null then
    raise notice 'FAIL: collector_payout_profiles missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_session_venue_overrides') is null then
    raise notice 'FAIL: operational_session_venue_overrides missing'; failures := failures + 1;
  end if;
  if to_regclass('public.operational_rsvp_counts') is null then
    raise notice 'FAIL: operational_rsvp_counts missing'; failures := failures + 1;
  elsif not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'operational_rsvp_counts'
       and c.relrowsecurity
  ) then
    raise notice 'FAIL: operational_rsvp_counts RLS not enabled'; failures := failures + 1;
  elsif (
    select array_agg(column_name order by ordinal_position)
      from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_rsvp_counts'
  ) <> array['session_id', 'going_count', 'updated_at']::text[] then
    raise notice 'FAIL: operational_rsvp_counts exposes unexpected columns'; failures := failures + 1;
  end if;
  if not has_table_privilege('anon', 'public.operational_rsvp_counts', 'select')
      or not has_table_privilege('authenticated', 'public.operational_rsvp_counts', 'select') then
    raise notice 'FAIL: public browser roles cannot read RSVP counts'; failures := failures + 1;
  end if;
  if has_table_privilege('anon', 'public.operational_rsvp_counts', 'insert,update,delete')
      or has_table_privilege('authenticated', 'public.operational_rsvp_counts', 'insert,update,delete') then
    raise notice 'FAIL: browser roles can write RSVP counts'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'operational_rsvp_counts'
       and cmd = 'SELECT'
       and roles = array['public']::name[]
       and qual = 'true'
  ) then
    raise notice 'FAIL: operational_rsvp_counts public SELECT policy missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_rsvp_counts'
  ) then
    raise notice 'FAIL: operational_rsvp_counts missing from Realtime publication'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.recalculate_operational_rsvp_count(text)', 'execute')
      or has_function_privilege('authenticated', 'public.recalculate_operational_rsvp_count(text)', 'execute')
      or has_function_privilege('anon', 'public.sync_operational_rsvp_count()', 'execute')
      or has_function_privilege('authenticated', 'public.sync_operational_rsvp_count()', 'execute') then
    raise notice 'FAIL: browser roles can execute RSVP count trigger helpers'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.reserve_operational_session(text)', 'execute')
      or not has_function_privilege('authenticated', 'public.reserve_operational_session(text)', 'execute')
      or has_function_privilege('anon', 'public.withdraw_operational_rsvp(uuid)', 'execute')
      or not has_function_privilege('authenticated', 'public.withdraw_operational_rsvp(uuid)', 'execute') then
    raise notice 'FAIL: RSVP mutation RPC ACLs violate least privilege'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notifications'
       and column_name = 'destination'
  ) then
    raise notice 'FAIL: notifications.destination missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox' and capacity = 20 and price_hkd = 180 and venue = 'BFT Causeway Bay'
  ) then
    raise notice 'FAIL: hyrox activity template seed missing'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-midtown'
      and capacity = 12
      and price_hkd = 180
      and venue = 'Midtown28 Fitness'
  ) then
    raise notice 'FAIL: corrected hyrox-midtown activity template seed missing';
    failures := failures + 1;
  end if;
  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_sessions' and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_sessions RLS not enabled'; failures := failures + 1;
  end if;
  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_session_venue_overrides' and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_session_venue_overrides RLS not enabled'; failures := failures + 1;
  end if;
  if not has_function_privilege('authenticated', 'public.set_session_venue(text, text, text, boolean)', 'execute') then
    raise notice 'FAIL: authenticated cannot execute set_session_venue'; failures := failures + 1;
  end if;
  if has_function_privilege('anon', 'public.set_session_venue(text, text, text, boolean)', 'execute') then
    raise notice 'FAIL: anon should not execute set_session_venue'; failures := failures + 1;
  end if;
  if to_regprocedure('public.set_session_venue(text,text,text,boolean,double precision,double precision)') is null then
    raise notice 'FAIL: six-argument meeting-point RPC missing'; failures := failures + 1;
  elsif not has_function_privilege(
    'authenticated',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ) then
    raise notice 'FAIL: authenticated cannot execute meeting-point RPC'; failures := failures + 1;
  elsif has_function_privilege(
    'anon',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ) then
    raise notice 'FAIL: anon should not execute meeting-point RPC'; failures := failures + 1;
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_session_venue_overrides'
       and column_name = 'meeting_lat'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'operational_session_venue_overrides'
       and column_name = 'meeting_lng'
  ) then
    raise notice 'FAIL: venue meeting-point columns missing'; failures := failures + 1;
  end if;
  if failures > 0 then raise exception 'schema failures: %', failures; end if;
  raise notice 'OK: operational schema foundations';
end $$;

-- =====================================================================
-- Member RPCs (Tasks 2-4)
-- =====================================================================

begin;

-- Auth fixtures and profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-0000-0000-00000000a001', 'admin-test@itc.invalid', '{}'::jsonb),
  ('bb000000-0000-0000-0000-00000000b001', 'member-test@itc.invalid', '{}'::jsonb),
  ('cc000000-0000-0000-0000-00000000c001', 'pending-test@itc.invalid', '{}'::jsonb),
  ('dd000000-0000-0000-0000-00000000d001', 'other-test@itc.invalid', '{}'::jsonb),
  ('ee000000-0000-0000-0000-00000000e001', 'extra-member@itc.invalid', '{}'::jsonb),
  ('ff000000-0000-0000-0000-00000000f001', 'super-test@itc.invalid', '{}'::jsonb);

update public.profiles set full_name = 'Admin Test', role = 'admin'
  where id = 'aa000000-0000-0000-0000-00000000a001';
update public.profiles set full_name = 'Member Test', role = 'member'
  where id = 'bb000000-0000-0000-0000-00000000b001';
update public.profiles set full_name = 'Pending Test', role = 'pending'
  where id = 'cc000000-0000-0000-0000-00000000c001';
update public.profiles set full_name = 'Other Test', role = 'member'
  where id = 'dd000000-0000-0000-0000-00000000d001';
update public.profiles set full_name = 'Extra Member', role = 'member'
  where id = 'ee000000-0000-0000-0000-00000000e001';
update public.profiles set full_name = 'Super Test', role = 'super_admin'
  where id = 'ff000000-0000-0000-0000-00000000f001';

-- generate sessions and pre-cancel 15 August.
select ensure_operational_sessions(date '2026-08-01', 5);
update public.operational_sessions
   set cancelled_at = now(),
       cancelled_by = null,
       cancelled_source = 'system',
       cancel_reason = 'HYROX race weekend'
 where id in ('hyrox-2026-08-15', 'hyrox-midtown-2026-08-15');

-- RSVP integrity: exact public counts, requires_rsvp enforcement, Hong Kong
-- start boundaries, and preservation of paid/uncapped reservation behavior.
do $$
declare
  v_member_a        constant uuid := 'bb000000-0000-0000-0000-00000000b001';
  v_member_b        constant uuid := 'dd000000-0000-0000-0000-00000000d001';
  v_member_c        constant uuid := 'ee000000-0000-0000-0000-00000000e001';
  v_admin           constant uuid := 'aa000000-0000-0000-0000-00000000a001';
  v_super           constant uuid := 'ff000000-0000-0000-0000-00000000f001';
  v_future_hk       timestamp := (now() + interval '1 hour') at time zone 'Asia/Hong_Kong';
  v_at_start_hk     timestamp := now() at time zone 'Asia/Hong_Kong';
  v_count_date      date := (now() at time zone 'Asia/Hong_Kong')::date + 400;
  v_paid_date       date := (now() at time zone 'Asia/Hong_Kong')::date + 401;
  v_free_date       date := (now() at time zone 'Asia/Hong_Kong')::date + 402;
  v_boundary_date   date := v_future_hk::date;
  v_count_session   text;
  v_paid_session    text;
  v_free_session    text;
  v_boundary_session text;
  v_free_booking    uuid;
  v_boundary_booking uuid;
  v_paid_booking    uuid;
  v_lunch_booking   uuid;
  v_going_count     bigint;
  v_visible_count   integer;
begin
  v_count_session := 'lunch-' || v_count_date::text;
  v_paid_session := 'hyrox-' || v_paid_date::text;
  v_free_session := 'event-free-integrity-' || v_free_date::text;
  v_boundary_session := 'lunch-' || v_boundary_date::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    ('event-free-integrity', 'Integrity Free Event', 'Tamar Park',
     extract(dow from v_free_date)::integer, time '19:00', 60,
     20, 0, true, false, 'Socials', 'Tamar Park', false)
  on conflict (activity_id) do update
    set price_hkd = excluded.price_hkd,
        requires_rsvp = excluded.requires_rsvp,
        active = excluded.active;

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_count_session, 'lunch', v_count_date, time '12:45', 75,
     'TBC', null, 0, true),
    (v_paid_session, 'hyrox', v_paid_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true),
    (v_free_session, 'event-free-integrity', v_free_date, time '19:00', 60,
     'Tamar Park', 20, 0, true)
  on conflict (id) do update
    set start_time = excluded.start_time,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = excluded.is_open;

  -- Two confirmed lunch bookings plus statuses that must not count.
  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_a, v_count_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_member_b, v_count_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_member_c, v_count_session, 'reserved', now(), null,
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_admin, v_count_session, 'cancelled', now(), null,
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0)),
    (v_super, v_count_session, 'deferred', now(), now(),
     jsonb_build_object('name', 'Post-Training Lunch', 'session_date', v_count_date,
       'start_time', '12:45', 'venue', 'TBC', 'price_hkd', 0));

  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  perform pg_temp.op_assert(v_going_count = 2,
    'RSVP aggregate counts only two confirmed lunch bookings');
  perform pg_temp.op_assert(
    (select p.proallargnames = array['session_id', 'going_count']::text[]
       from pg_proc p
      where p.oid = 'public.get_operational_rsvp_counts()'::regprocedure),
    'RSVP aggregate exposes no identity output columns'
  );
  perform pg_temp.op_assert(
    has_function_privilege('anon', 'public.get_operational_rsvp_counts()', 'execute')
    and has_function_privilege('authenticated', 'public.get_operational_rsvp_counts()', 'execute'),
    'anon and authenticated can execute only the identity-free count aggregate'
  );
  perform pg_temp.op_assert(
    (select relrowsecurity from pg_class
      where oid = 'public.operational_bookings'::regclass)
    and exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'operational_bookings'
         and policyname = 'member read own operational bookings'
    ),
    'direct operational booking RLS remains enabled and unchanged'
  );

  set local role anon;
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  select count(*) into v_visible_count
    from public.operational_bookings
   where session_id = v_count_session;
  reset role;
  perform pg_temp.op_assert(v_going_count = 2,
    'anon receives the exact RSVP total through the aggregate');
  perform pg_temp.op_assert(v_visible_count = 0,
    'anon receives no direct booking rows');

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  select count(*) into v_visible_count
    from public.operational_bookings
   where session_id = v_count_session;
  reset role;
  perform pg_temp.op_assert(v_going_count = 2,
    'ordinary member receives the exact all-member RSVP total');
  perform pg_temp.op_assert(v_visible_count = 1,
    'ordinary member direct booking query sees only their own row');

  -- Zero-price ordinary free events cannot enter the RSVP reserve path.
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_free_session);
    raise exception 'ordinary free event reserve should fail';
  exception when others then
    if sqlerrm not like '%Session does not require RSVP.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_bookings
      where profile_id = v_member_a and session_id = v_free_session),
    'rejected ordinary free reserve creates no booking row'
  );

  -- Even a forged confirmed free-event row cannot be withdrawn through RSVP.
  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_b, v_free_session, 'confirmed', now(), now(),
     jsonb_build_object('name', 'Integrity Free Event', 'session_date', v_free_date,
       'start_time', '19:00', 'venue', 'Tamar Park', 'price_hkd', 0))
  returning id into v_free_booking;
  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  begin
    perform public.withdraw_operational_rsvp(v_free_booking);
    raise exception 'ordinary free event withdraw should fail';
  exception when others then
    if sqlerrm not like '%Only your own confirmed RSVP can be withdrawn.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings where id = v_free_booking),
    'rejected ordinary free withdraw does not mutate its booking row'
  );

  -- now() is transaction-stable. Split that same instant into Hong Kong date
  -- and wall time so equality proves the at-start rejection exactly.
  delete from public.operational_bookings where session_id = v_boundary_session;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_boundary_session, 'lunch', v_future_hk::date,
     v_future_hk::time, 75, 'TBC', null, 0, true)
  on conflict (id) do update
    set start_time = excluded.start_time,
        cancelled_at = null,
        cancelled_by = null,
        cancelled_source = null,
        cancel_reason = null,
        capacity = null,
        price_hkd = 0,
        is_open = true;

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select id into v_boundary_booking
    from public.reserve_operational_session(v_boundary_session);
  reset role;
  perform pg_temp.op_assert(v_boundary_booking is not null,
    'lunch RSVP succeeds before its Hong Kong start time');

  update public.operational_sessions
     set session_date = v_at_start_hk::date,
         start_time = v_at_start_hk::time
   where id = v_boundary_session;

  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  begin
    perform public.reserve_operational_session(v_boundary_session);
    raise exception 'RSVP at Hong Kong start should fail';
  exception when others then
    if sqlerrm not like '%Session has already started.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    not exists (select 1 from public.operational_bookings
      where profile_id = v_member_b and session_id = v_boundary_session),
    'at-start Hong Kong reserve creates no booking row'
  );

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  begin
    perform public.withdraw_operational_rsvp(v_boundary_booking);
    raise exception 'RSVP withdraw at Hong Kong start should fail';
  exception when others then
    if sqlerrm not like '%Session has already started.%' then raise; end if;
  end;
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings
      where id = v_boundary_booking),
    'at-start Hong Kong withdraw leaves RSVP confirmed'
  );

  -- Paid HYROX remains reserved with capacity/payment semantics.
  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  select id into v_paid_booking
    from public.reserve_operational_session(v_paid_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'reserved' and payment_marked_at is null
       from public.operational_bookings where id = v_paid_booking),
    'paid HYROX reservation behavior is preserved'
  );

  -- The pre-seeded noise does not cap lunch; another member confirms instantly.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select id into v_lunch_booking
    from public.reserve_operational_session(v_count_session);
  reset role;
  perform pg_temp.op_assert(
    (select status = 'confirmed' from public.operational_bookings
      where id = v_lunch_booking)
    and (select capacity is null from public.operational_sessions
      where id = v_count_session),
    'uncapped lunch RSVP still confirms instantly'
  );

  -- Drive the aggregate to zero through a real withdrawal. The trigger must
  -- retain an identity-free row with an exact zero rather than deleting it.
  update public.operational_bookings
     set status = 'cancelled'
   where session_id = v_count_session
     and profile_id in (v_member_a, v_member_b)
     and status = 'confirmed';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.withdraw_operational_rsvp(v_lunch_booking);
  reset role;
  perform pg_temp.op_assert(
    (select going_count = 0 from public.operational_rsvp_counts
      where session_id = v_count_session),
    'booking trigger updates the public RSVP count row to exact zero after withdrawal'
  );
  select going_count into v_going_count
    from public.get_operational_rsvp_counts()
   where session_id = v_count_session;
  perform pg_temp.op_assert(v_going_count = 0,
    'identity-free aggregate returns the stored exact zero');

  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- run tests as a SQL function that can switch auth.uid() per case.
do $$
declare
  v_session_count integer;
  v_status text;
  v_dummy text;
  v_other_id uuid;
  v_other_id2 uuid;
  v_pending_book uuid;
  v_open_date date := (now() at time zone 'Asia/Hong_Kong')::date + 410;
  v_open_session text;
begin
  v_open_session := 'hyrox-' || v_open_date::text;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_open_session, 'hyrox', v_open_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = true;

  -- Pending cannot reserve.
  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  set local role authenticated;
  begin
    perform reserve_operational_session(v_open_session);
    raise exception 'pending should not reserve';
  exception when others then
    if sqlerrm not like '%Approved membership required%' then
      raise;
    end if;
  end;

  -- Member can reserve an open session.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  select id into v_pending_book
    from reserve_operational_session(v_open_session);
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'reserved', 'reserved booking created');

  -- Duplicate reservation is rejected.
  begin
    perform reserve_operational_session(v_open_session);
    raise exception 'duplicate should not reserve';
  exception when others then
    if sqlerrm not like '%Already booked%' then raise; end if;
  end;

  -- Cancelled session refuses reservation.
  begin
    perform reserve_operational_session('hyrox-2026-08-15');
    raise exception 'cancelled should not reserve';
  exception when others then
    if sqlerrm not like '%Session is cancelled%' then raise; end if;
  end;

  -- Closed session also refuses reservation.
  begin
    perform reserve_operational_session('hyrox-midtown-2026-08-22');
    raise exception 'closed session should not reserve';
  exception when others then
    if sqlerrm not like '%Session is not open%' then raise; end if;
  end;

  -- Interest can join on closed midtown.
  perform join_operational_queue('hyrox-midtown-2026-08-22', 'interest');

  -- Waitlist cannot join on closed session.
  begin
    perform join_operational_queue('hyrox-midtown-2026-08-22', 'waitlist');
    raise exception 'waitlist should not join on closed session';
  exception when others then
    if sqlerrm not like '%Session is not open%' then raise; end if;
  end;

  -- Member cannot mark another's payment.
  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  begin
    perform mark_operational_payment(v_pending_book, 'payme', 'WRONG-OWNER');
    raise exception 'non-owner should not mark payment';
  exception when others then
    if sqlerrm not like '%Not authorized for this booking%' then raise; end if;
  end;

  -- Member marks payment correctly.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  perform mark_operational_payment(v_pending_book, 'payme', 'REF-001');

  -- Member cannot mark again.
  begin
    perform mark_operational_payment(v_pending_book, 'payme', 'REF-002');
    raise exception 'already-marked should reject';
  exception when others then
    if sqlerrm not like '%Payment has already been marked%' then raise; end if;
  end;

  -- Member cannot defer because booking is still reserved (not confirmed).
  begin
    perform defer_operational_booking(v_pending_book, 'hyrox-2026-08-29');
    raise exception 'reserved should not defer';
  exception when others then
    if sqlerrm not like '%Only confirmed bookings can be deferred%' then raise; end if;
  end;

  reset role;
end $$;

-- Admin scenario: approve payment, finalize, defer, queue join promotion.
do $$
declare
  v_pending_book uuid;
  v_new_booking uuid;
  v_role text;
  v_status text;
  v_source_date date := (now() at time zone 'Asia/Hong_Kong')::date + 420;
  v_target_date date := (now() at time zone 'Asia/Hong_Kong')::date + 427;
  v_source_session text;
  v_target_session text;
begin
  v_source_session := 'hyrox-' || v_source_date::text;
  v_target_session := 'hyrox-' || v_target_date::text;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_source_session, 'hyrox', v_source_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true),
    (v_target_session, 'hyrox', v_target_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = true;

  -- Member reserves and marks payment.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending_book
    from reserve_operational_session(v_source_session);
  perform mark_operational_payment(v_pending_book, 'payme', 'REF-100');

  -- Admin approves payment.
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_pending_book);
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'confirmed', 'approved booking is confirmed');

  -- Member defers to a later session.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  begin
    select id into v_new_booking
      from defer_operational_booking(v_pending_book, v_target_session);
  exception when no_data_found then
    v_new_booking := null;
  end;
  perform pg_temp.op_assert(v_new_booking is not null, 'deferral created new booking');

  -- Source booking is marked deferred.
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'deferred', 'source booking is deferred');

  -- Receipt created for the original booking.
  perform pg_temp.op_assert(
    (select count(*) from public.operational_receipts where booking_id = v_pending_book) = 1,
    'one receipt issued for confirmed booking'
  );

  reset role;
end $$;

-- Admin cancellation atomicity.
do $$
declare
  v_pending uuid;
  v_confirmed uuid;
  v_waitlist_id uuid;
  v_interest_id uuid;
  v_session_date date := (now() at time zone 'Asia/Hong_Kong')::date + 430;
  v_midtown_date date := (now() at time zone 'Asia/Hong_Kong')::date + 431;
  v_target_date date := (now() at time zone 'Asia/Hong_Kong')::date + 437;
  v_session_id text;
  v_midtown_session text;
  v_target_session text;
  v_deferred_count integer;
  v_cancelled_count integer;
  v_dissolved_count integer;
begin
  v_session_id := 'hyrox-' || v_session_date::text;
  v_midtown_session := 'hyrox-midtown-' || v_midtown_date::text;
  v_target_session := 'hyrox-' || v_target_date::text;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_session_id, 'hyrox', v_session_date, time '11:15', 60,
     'BFT Causeway Bay', 2, 180, true),
    (v_midtown_session, 'hyrox-midtown', v_midtown_date, time '11:00', 60,
     'Midtown28 Fitness', 12, 180, false),
    (v_target_session, 'hyrox', v_target_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true)
  on conflict (id) do update
    set activity_id = excluded.activity_id,
        session_date = excluded.session_date,
        start_time = excluded.start_time,
        venue = excluded.venue,
        cancelled_at = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = excluded.is_open;

  perform pg_temp.op_assert(
    exists (
      select 1
        from public.operational_sessions
       where id = v_midtown_session
         and activity_id = 'hyrox-midtown'
         and session_date = v_midtown_date
         and session_date > (now() at time zone 'Asia/Hong_Kong')::date
         and not is_open
         and cancelled_at is null
    ),
    'closed Midtown interest fixture exists with required properties'
  );

  -- Tight capacity lets two reservations fill the session.

  -- Two members fill the single slot.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending from reserve_operational_session(v_session_id);

  perform set_config('request.jwt.claim.sub', 'dd000000-0000-0000-0000-00000000d001', true);
  select id into v_confirmed from reserve_operational_session(v_session_id);
  perform mark_operational_payment(v_confirmed, 'fps', 'REF-CON');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_confirmed);

  -- Waitlist and interest preconditions.
  perform set_config('request.jwt.claim.sub', 'ee000000-0000-0000-0000-00000000e001', true);
  select id into v_waitlist_id from join_operational_queue(v_session_id, 'waitlist');
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  select id into v_interest_id from join_operational_queue(v_midtown_session, 'interest');

  -- Admin cancels the session — the unpaid reservation will be cancelled
  -- by the RPC itself, so no direct update is needed here.
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform cancel_operational_session(v_session_id, 'Storm warning');

  -- Verify outcome.
  select count(*) into v_deferred_count
    from public.operational_bookings
   where session_id = v_session_id and status = 'deferred';
  perform pg_temp.op_assert(v_deferred_count = 1, 'confirmed booking was deferred');

  select count(*) into v_cancelled_count
    from public.operational_bookings
   where session_id = v_session_id and status = 'cancelled';
  perform pg_temp.op_assert(v_cancelled_count >= 1, 'unpaid/reservation was cancelled');

  select count(*) into v_dissolved_count
    from public.operational_queue_entries
   where session_id = v_session_id and status = 'dissolved';
  perform pg_temp.op_assert(v_dissolved_count = 1, 'waitlist is dissolved');

  declare
    v_cancel_reason text;
  begin
    select cancel_reason into v_cancel_reason from public.operational_sessions where id = v_session_id;
    perform pg_temp.op_assert(v_cancel_reason = 'Storm warning', 'cancel reason stored');
  end;

  reset role;
end $$;

-- Cancellation rollback test: a failed deferral leaves everything consistent.
do $$
declare
  v_pending uuid;
  v_target_id text;
  v_session_date date := (now() at time zone 'Asia/Hong_Kong')::date + 1000;
  v_session_id text;
begin
  v_session_id := 'hyrox-' || v_session_date::text;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_session_id, 'hyrox', v_session_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = true;

  -- Member reserves; Admin cancels; no later HYROX target exists.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending from reserve_operational_session(v_session_id);
  perform mark_operational_payment(v_pending, 'payme', 'REF-200');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_pending);
  -- Cancel without future targets: confirmed booking becomes cancelled.
  perform cancel_operational_session(v_session_id, 'Venue flooded');
  select status into v_target_id from public.operational_bookings where id = v_pending;
  perform pg_temp.op_assert(v_target_id = 'cancelled', 'confirmed booking cancelled when no deferral target');
  reset role;
end $$;

-- Stake: gym finalization must reject a cancelled session.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  begin
    perform finalize_operational_gym('hyrox-2026-08-15', 'Reader note');
    raise exception 'cancelled session must reject gym finalization';
  exception when others then
    if sqlerrm not like '%Session is cancelled%' then raise; end if;
  end;
  reset role;
end $$;

-- Stake: non-admin cannot finalize.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform finalize_operational_gym('hyrox-2026-08-29', 'unauthorized');
    raise exception 'members must not finalize';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then raise; end if;
  end;
  reset role;
end $$;

-- Stake: gym finalization succeeds on an active session.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  perform finalize_operational_gym('hyrox-2026-08-29', 'All clear');
  perform pg_temp.op_assert(
    (select gym_confirmed_at from public.operational_sessions where id = 'hyrox-2026-08-29') is not null,
    'gym confirmation timestamp recorded'
  );
  reset role;
end $$;

-- Stake: receipt approval is required for paid bookings.
do $$
declare
  v_booking uuid;
  v_session_date date := (now() at time zone 'Asia/Hong_Kong')::date + 440;
  v_session_id text;
begin
  v_session_id := 'hyrox-' || v_session_date::text;
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_session_id, 'hyrox', v_session_date, time '11:15', 60,
     'BFT Causeway Bay', 20, 180, true)
  on conflict (id) do update
    set session_date = excluded.session_date,
        start_time = excluded.start_time,
        cancelled_at = null,
        capacity = excluded.capacity,
        price_hkd = excluded.price_hkd,
        is_open = true;

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_booking from reserve_operational_session(v_session_id);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  begin
    perform approve_operational_payment(v_booking);
    raise exception 'approval must require marked payment';
  exception when others then
    if sqlerrm not like '%Payment has not been marked%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- =====================================================================
-- Free-event venue overrides (Task 1)
-- =====================================================================

do $$
declare
  v_admin     constant uuid := 'aa000000-0000-0000-0000-00000000a001';
  v_super     constant uuid := 'ff000000-0000-0000-0000-00000000f001';
  v_member_a  constant uuid := 'bb000000-0000-0000-0000-00000000b001';
  v_member_b  constant uuid := 'dd000000-0000-0000-0000-00000000d001';
  v_member_c  constant uuid := 'ee000000-0000-0000-0000-00000000e001';
  v_pending   constant uuid := 'cc000000-0000-0000-0000-00000000c001';
  v_session   constant text := 'wnt-2026-08-19';
  v_other_session constant text := 'wnt-2026-08-26';
  v_non_tamar_session constant text := 'wnt-2026-09-02';
  v_reset_only_session constant text := 'water-2026-08-18';
  v_partial_session constant text := 'water-2026-08-25';
  v_initial_count integer;
  v_after_edit_count integer;
  v_after_reset_count integer;
  v_after_reconfirm_count integer;
  v_member_notified_at timestamptz;
  v_partial_member_count integer;
  v_member_before_point integer;
  v_admin_before_point integer;
  v_retained_notified_at timestamptz;
begin
  perform ensure_operational_sessions(date '2026-08-01', 5);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

  -- Reset with no retained override is a true no-op: no blank row and no
  -- audit notification are created.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(v_reset_only_session, null, null, false);
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = v_reset_only_session
    ),
    'first blank reset does not create an override row'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated') = v_initial_count,
    'first blank reset does not create audit notifications'
  );

  -- First confirmation: TBC -> real venue. Members should be notified once,
  -- other Admins should be notified once, actor excluded.
  perform public.set_session_venue(
    v_session,
    'Central Harbourfront — 7pm sharp',
    'Central Harbourfront, Hong Kong',
    true
  );

  perform pg_temp.op_assert(
    (select location from public.operational_session_venue_overrides where session_id = v_session)
      = 'Central Harbourfront — 7pm sharp',
    'dated free-event venue stored'
  );
  perform pg_temp.op_assert(
    (select activity_id from public.operational_session_venue_overrides where session_id = v_session) = 'wnt',
    'venue override records the derived activity'
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides where session_id = v_session)
      is not null,
    'member notification timestamp recorded on first transition'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id in (v_member_a, v_member_b, v_member_c)) = 3,
    'first confirmation notifies approved members once'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_super) = 1,
    'other admins receive audit notification'
  );
  perform pg_temp.op_assert(
    not exists (select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id in (v_admin, v_pending)),
    'actor and pending profiles are excluded'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session) >= 4,
    'every notification carries the dated activity destination'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and body = 'Wednesday Night Training on 2026-08-19 is at Central Harbourfront — 7pm sharp. Check the activity page for details.'
    ),
    'member copy uses the activity display name and dated venue'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_super
         and body = 'Admin Test set the venue for wnt-2026-08-19 to Central Harbourfront — 7pm sharp.'
    ),
    'admin audit copy identifies the acting profile'
  );

  -- Subsequent edit (also TBC flag): only Admins receive a new audit row.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(
    v_session,
    'Wan Chai Promenade — 7pm sharp',
    'Wan Chai Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_edit_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_edit_count - v_initial_count = 1,
    'second save fans out only to other admins'
  );

  -- No-op save: no new notification rows.
  select count(*) into v_initial_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform public.set_session_venue(
    v_session,
    'Wan Chai Promenade — 7pm sharp',
    'Wan Chai Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_edit_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_edit_count = v_initial_count,
    'no-op save does not notify anyone'
  );

  -- Reset clears location/maps_query but preserves member_notified_at.
  select member_notified_at into v_member_notified_at
    from public.operational_session_venue_overrides where session_id = v_session;
  perform public.set_session_venue(v_session, null, null, false);
  select count(*) into v_after_reset_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reset_count - v_initial_count = 1,
    'reset fans out only to other admins'
  );
  perform pg_temp.op_assert(
    (select location from public.operational_session_venue_overrides where session_id = v_session) is null,
    'reset clears the override location'
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides where session_id = v_session)
      = v_member_notified_at,
    'reset preserves member_notified_at so members are not re-notified'
  );

  -- Reconfirmation after reset does not re-notify members.
  perform public.set_session_venue(
    v_session,
    'Causeway Bay Promenade — 7pm sharp',
    'Causeway Bay Promenade, Hong Kong',
    false
  );
  select count(*) into v_after_reconfirm_count from public.notifications
    where kind = 'operational_session_venue_updated';
  perform pg_temp.op_assert(
    v_after_reconfirm_count - v_after_reset_count = 1,
    'reconfirmation after reset notifies only other admins'
  );

  -- A partial row does not consume member dedupe or create blank copy. Once
  -- both usable values are present, that same session confirms exactly once.
  perform public.set_session_venue(
    v_partial_session,
    null,
    'Victoria Park Swimming Pool, Hong Kong',
    true
  );
  perform pg_temp.op_assert(
    (select member_notified_at from public.operational_session_venue_overrides
      where session_id = v_partial_session) is null,
    'partial override does not consume member_notified_at'
  );
  perform pg_temp.op_assert(
    not exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_partial_session
         and profile_id in (v_member_a, v_member_b, v_member_c)
    ),
    'partial override creates no member notification copy'
  );
  perform public.set_session_venue(
    v_partial_session,
    'Victoria Park Swimming Pool',
    'Victoria Park Swimming Pool, Hong Kong',
    true
  );
  select count(*) into v_partial_member_count
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_partial_session
     and profile_id in (v_member_a, v_member_b, v_member_c);
  perform pg_temp.op_assert(
    v_partial_member_count = 3,
    'completing a partial override notifies approved members exactly once'
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and profile_id = v_member_a
         and destination = '#/activity/' || v_partial_session
         and body = 'ITC Swimming on 2026-08-25 is at Victoria Park Swimming Pool. Check the activity page for details.'
    ),
    'completed partial override uses Swimming display copy'
  );

  -- A six-argument WNT Tamar save stores the dated point.
  perform public.set_session_venue(
    v_other_session, 'Tamar Park', 'Tamar Park', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat = 22.2825 and meeting_lng = 114.1659
       from public.operational_session_venue_overrides
      where session_id = v_other_session),
    'dated WNT meeting point is stored'
  );

  -- Moving only the point audits Admins once without repeating members.
  select count(*) into v_member_before_point
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_other_session
     and profile_id in (v_member_a, v_member_b, v_member_c);
  select count(*) into v_admin_before_point
    from public.notifications
   where kind = 'operational_session_venue_updated'
     and destination = '#/activity/' || v_other_session
     and profile_id = v_super;
  perform public.set_session_venue(
    v_other_session, 'Tamar Park', 'Tamar Park', false,
    22.2827, 114.1661
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated'
        and destination = '#/activity/' || v_other_session
        and profile_id in (v_member_a, v_member_b, v_member_c)) = v_member_before_point,
    'coordinate-only edit does not repeat member fan-out'
  );
  perform pg_temp.op_assert(
    (select count(*) from public.notifications
      where kind = 'operational_session_venue_updated'
        and destination = '#/activity/' || v_other_session
        and profile_id = v_super) = v_admin_before_point + 1,
    'coordinate-only edit creates one Admin audit notification'
  );

  -- Partial and out-of-range Tamar points are rejected before persistence.
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      22.28, null
    );
    raise exception 'partial point should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      91, 114.16
    );
    raise exception 'latitude should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;
  begin
    perform public.set_session_venue(
      'wnt-2026-09-09', 'Tamar Park', 'Tamar Park', true,
      22.28, -181
    );
    raise exception 'longitude should fail';
  exception when others then
    if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
  end;

  -- Stale arguments never attach specialized points to another activity or venue.
  perform public.set_session_venue(
    'run-2026-09-14', 'Tamar Park', 'Tamar Park', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
       from public.operational_session_venue_overrides
      where session_id = 'run-2026-09-14'),
    'non-WNT save clears stale coordinates'
  );
  perform public.set_session_venue(
    v_non_tamar_session, 'Island ECC 9/F', 'Island ECC', true,
    22.2825, 114.1659
  );
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
       from public.operational_session_venue_overrides
      where session_id = v_non_tamar_session),
    'non-Tamar save clears stale coordinates'
  );

  -- The old signature remains usable and reset clears the point while retaining dedupe.
  select member_notified_at into v_retained_notified_at
    from public.operational_session_venue_overrides
   where session_id = v_other_session;
  perform public.set_session_venue(v_other_session, null, null, false);
  perform pg_temp.op_assert(
    (select meeting_lat is null and meeting_lng is null
        and member_notified_at = v_retained_notified_at
       from public.operational_session_venue_overrides
      where session_id = v_other_session),
    'four-argument reset clears point and retains member dedupe'
  );

  -- The browser's six named arguments admit lunch without retaining stale
  -- meeting coordinates, and the compatibility overload can reset it.
  perform public.set_session_venue(
    'lunch-2026-08-22', 'Cafe Deco, Central', 'Cafe Deco, Central', true,
    null, null
  );
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'lunch-2026-08-22'
         and activity_id = 'lunch'
         and location = 'Cafe Deco, Central'
         and maps_query = 'Cafe Deco, Central'
         and meeting_lat is null
         and meeting_lng is null
    ),
    'six-argument lunch venue save persists without meeting coordinates'
  );
  perform public.set_session_venue('lunch-2026-08-22', null, null, false);
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'lunch-2026-08-22'
         and activity_id = 'lunch'
         and location is null
         and maps_query is null
         and meeting_lat is null
         and meeting_lng is null
    ),
    'four-argument lunch venue reset clears the retained override'
  );

  reset role;
end $$;

-- Public venue details are selectable through the actual anon and
-- authenticated roles, while every direct mutation privilege is denied.
do $$
declare
  v_anon_count integer;
  v_authenticated_count integer;
begin
  set local role anon;
  select count(*) into v_anon_count
    from public.operational_session_venue_overrides;
  reset role;
  perform pg_temp.op_assert(v_anon_count > 0, 'anon can select venue overrides');

  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select count(*) into v_authenticated_count
    from public.operational_session_venue_overrides;
  reset role;
  perform pg_temp.op_assert(
    v_authenticated_count = v_anon_count,
    'authenticated clients can select the same public venue overrides'
  );
end $$;

do $$
declare
  v_denials integer := 0;
begin
  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  begin
    insert into public.operational_session_venue_overrides
      (session_id, activity_id, location, maps_query)
    values ('run-2026-09-07', 'run', 'Direct insert', 'Direct insert');
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  begin
    update public.operational_session_venue_overrides
       set location = 'Direct update'
     where session_id = 'wnt-2026-08-19';
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  begin
    delete from public.operational_session_venue_overrides
     where session_id = 'wnt-2026-08-19';
  exception when insufficient_privilege then
    v_denials := v_denials + 1;
  end;
  reset role;
  perform pg_temp.op_assert(
    v_denials = 3,
    'authenticated direct insert/update/delete are all denied'
  );
end $$;

-- Super Admins mutate successfully through the trusted RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'ff000000-0000-0000-0000-00000000f001', true);
  set local role authenticated;
  perform public.set_session_venue(
    'run-2026-09-07',
    'Tamar Park',
    'Tamar Park, Hong Kong',
    true
  );
  reset role;
  perform pg_temp.op_assert(
    exists (
      select 1 from public.operational_session_venue_overrides
       where session_id = 'run-2026-09-07'
         and set_by = 'ff000000-0000-0000-0000-00000000f001'
         and member_notified_at is not null
    ),
    'Super Admin RPC saves and records first member fan-out'
  );
end $$;

-- Denial: ordinary members cannot call the RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'member should not set_session_venue';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Denial: pending cannot call the RPC.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'pending should not set_session_venue';
  exception when others then
    if sqlerrm not like '%Administrator access required%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Denial: HYROX session id is rejected with the exact spec message.
do $$
begin
  perform ensure_operational_sessions(date '2026-08-01', 5);
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  set local role authenticated;
  begin
    perform public.set_session_venue('hyrox-2026-08-22', 'x', 'y', true);
    raise exception 'hyrox should be rejected';
  exception when others then
    if sqlerrm not like '%Activity venue is fixed.%' then
      raise;
    end if;
  end;
  reset role;
end $$;

-- Anon must not execute the RPC at all.
do $$
begin
  set local role anon;
  begin
    perform public.set_session_venue('wnt-2026-08-19', 'x', 'y', true);
    raise exception 'anon should not set_session_venue';
  exception when others then
    if sqlerrm not like '%permission denied%' and sqlerrm not like '%42501%' then
      raise;
    end if;
  end;
  reset role;
end $$;

update public.operational_activity_templates
   set venue = 'Midtown 28'
 where activity_id = 'hyrox-midtown';

update public.operational_sessions
   set venue = case id
     when 'hyrox-midtown-2026-08-22' then 'Midtown 28'
     when 'hyrox-midtown-2026-08-29' then 'Custom Midtown Venue'
   end
 where id in ('hyrox-midtown-2026-08-22', 'hyrox-midtown-2026-08-29');

insert into public.operational_bookings
  (profile_id, session_id, status, pay_deadline_at, snapshot)
values
  ('bb000000-0000-0000-0000-00000000b001',
   'hyrox-midtown-2026-08-22', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Midtown 28","price_hkd":180}'::jsonb),
  ('dd000000-0000-0000-0000-00000000d001',
   'hyrox-midtown-2026-08-29', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Custom Midtown Venue","price_hkd":180}'::jsonb);

\ir ../migrations/20260813000002_midtown28_fitness.sql

select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_activity_templates where activity_id = 'hyrox-midtown'),
  'migration must correct the exact old Midtown template venue'
);
select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-22'),
  'migration must correct an exact old Midtown session venue'
);
select pg_temp.op_assert(
  (select venue = 'Custom Midtown Venue'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-29'),
  'migration must preserve a custom Midtown session venue'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Midtown28 Fitness'
     from public.operational_bookings
    where profile_id = 'bb000000-0000-0000-0000-00000000b001'
      and session_id = 'hyrox-midtown-2026-08-22'),
  'migration must correct an exact old Midtown booking snapshot'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Custom Midtown Venue'
     from public.operational_bookings
    where profile_id = 'dd000000-0000-0000-0000-00000000d001'
      and session_id = 'hyrox-midtown-2026-08-29'),
  'migration must preserve a custom Midtown booking snapshot'
);

rollback;

-- =====================================================================
-- Seed: 15 August 2026 cancelled sessions (post-migration assertions)
-- =====================================================================

do $$
declare
  v_hyrox_reason text;
  v_midtown_reason text;
  v_hyrox_source text;
  v_midtown_source text;
  v_published_count integer;
begin
  select cancel_reason, cancelled_source
    into v_hyrox_reason, v_hyrox_source
    from public.operational_sessions where id = 'hyrox-2026-08-15';
  perform pg_temp.op_assert(v_hyrox_reason = 'HYROX race weekend', 'hyrox 15 August cancel reason');
  perform pg_temp.op_assert(v_hyrox_source = 'system', 'hyrox 15 August source label');

  select cancel_reason, cancelled_source
    into v_midtown_reason, v_midtown_source
    from public.operational_sessions where id = 'hyrox-midtown-2026-08-15';
  perform pg_temp.op_assert(v_midtown_reason = 'HYROX race weekend', 'midtown 15 August cancel reason');
  perform pg_temp.op_assert(v_midtown_source = 'system', 'midtown 15 August source label');

  select count(*) into v_published_count
    from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename in (
       'operational_sessions',
       'operational_bookings',
       'operational_queue_entries',
       'operational_receipts',
       'collector_assignments',
       'collector_payout_profiles'
     );
  perform pg_temp.op_assert(v_published_count = 6, 'all operational tables published to realtime');
end $$;
