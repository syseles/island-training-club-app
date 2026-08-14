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

-- run tests as a SQL function that can switch auth.uid() per case.
do $$
declare
  v_session_count integer;
  v_status text;
  v_dummy text;
  v_other_id uuid;
  v_other_id2 uuid;
  v_pending_book uuid;
begin
  -- Pending cannot reserve.
  perform set_config('request.jwt.claim.sub', 'cc000000-0000-0000-0000-00000000c001', true);
  set local role authenticated;
  begin
    perform reserve_operational_session('hyrox-2026-08-22');
    raise exception 'pending should not reserve';
  exception when others then
    if sqlerrm not like '%Approved membership required%' then
      raise;
    end if;
  end;

  -- Member can reserve an open session.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  select id into v_pending_book
    from reserve_operational_session('hyrox-2026-08-22');
  select status into v_status from public.operational_bookings where id = v_pending_book;
  perform pg_temp.op_assert(v_status = 'reserved', 'reserved booking created');

  -- Duplicate reservation is rejected.
  begin
    perform reserve_operational_session('hyrox-2026-08-22');
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
  v_target_session uuid;
  v_new_booking uuid;
  v_role text;
  v_status text;
begin
  -- Generate additional sessions to cover later dates.
  perform ensure_operational_sessions(date '2026-08-01', 12);
  -- Member reserves and marks payment.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending_book
    from reserve_operational_session('hyrox-2026-08-29');
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
      from defer_operational_booking(v_pending_book, 'hyrox-2026-09-05');
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
  v_session_id text := 'hyrox-2026-10-03';
  v_deferred_count integer;
  v_cancelled_count integer;
  v_dissolved_count integer;
begin
  -- Generate a fresh session.
  perform ensure_operational_sessions(date '2026-08-01', 10);

  -- Tighten capacity so two reservations fill the session.
  update public.operational_sessions set capacity = 2 where id = v_session_id;

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
  select id into v_interest_id from join_operational_queue('hyrox-midtown-2026-10-03', 'interest');

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
begin
  perform ensure_operational_sessions(date '2026-08-01', 16);
  -- member reserves; admin cancels session; cancellation defers to no target.
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_pending from reserve_operational_session('hyrox-2026-11-14');
  perform mark_operational_payment(v_pending, 'payme', 'REF-200');
  perform set_config('request.jwt.claim.sub', 'aa000000-0000-0000-0000-00000000a001', true);
  perform approve_operational_payment(v_pending);
  -- Cancel without future targets: confirmed booking becomes cancelled.
  perform cancel_operational_session('hyrox-2026-11-14', 'Venue flooded');
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
begin
  perform set_config('request.jwt.claim.sub', 'bb000000-0000-0000-0000-00000000b001', true);
  set local role authenticated;
  select id into v_booking from reserve_operational_session('hyrox-2026-09-12');
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
  v_initial_count integer;
  v_after_edit_count integer;
  v_after_reset_count integer;
  v_after_reconfirm_count integer;
  v_member_notified_at timestamptz;
begin
  perform ensure_operational_sessions(date '2026-08-01', 5);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;

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

  -- Cancel-related cancellation flag does not block override saves.
  update public.operational_sessions
     set cancelled_at = null, cancelled_by = null,
         cancelled_source = null, cancel_reason = null
   where id = v_session;
  perform public.set_session_venue(
    v_other_session,
    'Tamar Park',
    'Tamar Park, Hong Kong',
    true
  );
  perform pg_temp.op_assert(
    (select location from public.operational_session_venue_overrides where session_id = v_other_session)
      = 'Tamar Park',
    'cancellation state of operational_sessions does not block venue override writes'
  );

  reset role;
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
