-- Island Training Club — free-event RSVP cancellation integration evidence
-- Run only against an acknowledged disposable Supabase-compatible database.
-- The entire fixture and all mutations are rolled back.

\set ON_ERROR_STOP on

begin;

create function pg_temp.rsvp_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'free RSVP integration failed: %', message;
  end if;
end;
$$;

-- Simulate a free one-off created before the authority migration, then reapply
-- the actual migration in this rollback-scoped transaction to prove backfill.
-- The database starts at the source tip, so temporarily remove only the two
-- new authority constraints before inserting the historical fixture.
alter table public.operational_activity_templates
  drop constraint operational_activity_templates_free_one_off_rsvp_check;
alter table public.operational_sessions
  drop constraint operational_sessions_free_one_off_uncapped_check;

insert into public.operational_activity_templates
  (activity_id, name, venue, weekday, start_time, duration_minutes,
   capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
values
  ('event-existing-free-regression', 'Existing free event', 'TBC',
   extract(dow from current_date + 60)::smallint, '18:00', 60,
   9, 0, true, false, 'Other', null, false);
insert into public.operational_sessions
  (id, activity_id, session_date, start_time, duration_minutes,
   venue, capacity, price_hkd, is_open)
values
  ('event-existing-free-regression-' || (current_date + 60)::text,
   'event-existing-free-regression', current_date + 60, '18:00', 60,
   'TBC', 9, 0, true);

\ir ../migrations/20260920000001_free_event_rsvp_cancellation.sql

do $$
begin
  perform pg_temp.rsvp_assert(
    (select count(*) = 3
       from public.operational_activity_templates
      where activity_id in ('wnt', 'run', 'water')
        and requires_rsvp
        and price_hkd = 0
        and capacity is null),
    'recurring free templates require RSVP and remain uncapped/zero-price'
  );
  perform pg_temp.rsvp_assert(
    (select t.requires_rsvp and t.capacity is null and s.capacity is null
       from public.operational_activity_templates t
       join public.operational_sessions s on s.activity_id = t.activity_id
      where t.activity_id = 'event-existing-free-regression'),
    'existing free one-off is normalized to explicit uncapped RSVP'
  );
  perform pg_temp.rsvp_assert(
    not exists (
      select 1
        from public.operational_sessions s
        join public.operational_activity_templates t on t.activity_id = s.activity_id
       where s.activity_id in ('wnt', 'run', 'water')
         and extract(dow from s.session_date)::integer <> t.weekday
    )
    and (select count(distinct activity_id) = 3
           from public.operational_sessions
          where activity_id in ('wnt', 'run', 'water')),
    'recurring occurrences use declared weekdays'
  );
  perform pg_temp.rsvp_assert(
    not has_table_privilege('anon', 'public.operational_bookings', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.operational_bookings', 'insert,update,delete'),
    'browser roles cannot mutate bookings directly'
  );
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f2000000-0000-0000-0000-000000000001', 'free-rsvp-admin@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000002', 'free-rsvp-a@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000003', 'free-rsvp-b@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000004', 'free-rsvp-c@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000005', 'free-rsvp-pending@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000006', 'free-rsvp-declined@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000007', 'free-rsvp-unrelated@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000008', 'free-rsvp-other-admin@itc.invalid', '{}'::jsonb);

update public.profiles set role = 'admin', full_name = 'Free RSVP Admin'
 where id = 'f2000000-0000-0000-0000-000000000001';
update public.profiles set role = 'member', full_name = 'Free RSVP A'
 where id = 'f2000000-0000-0000-0000-000000000002';
update public.profiles set role = 'member', full_name = 'Free RSVP B'
 where id = 'f2000000-0000-0000-0000-000000000003';
update public.profiles set role = 'member', full_name = 'Free RSVP C'
 where id = 'f2000000-0000-0000-0000-000000000004';
update public.profiles set role = 'pending', full_name = 'Free RSVP Pending'
 where id = 'f2000000-0000-0000-0000-000000000005';
update public.profiles set role = 'declined', full_name = 'Free RSVP Declined'
 where id = 'f2000000-0000-0000-0000-000000000006';
update public.profiles set role = 'member', full_name = 'Free RSVP Unrelated'
 where id = 'f2000000-0000-0000-0000-000000000007';
update public.profiles set role = 'super_admin', full_name = 'Free RSVP Other Admin'
 where id = 'f2000000-0000-0000-0000-000000000008';

do $$
declare
  v_admin constant uuid := 'f2000000-0000-0000-0000-000000000001';
  v_member_a constant uuid := 'f2000000-0000-0000-0000-000000000002';
  v_member_b constant uuid := 'f2000000-0000-0000-0000-000000000003';
  v_member_c constant uuid := 'f2000000-0000-0000-0000-000000000004';
  v_pending constant uuid := 'f2000000-0000-0000-0000-000000000005';
  v_declined constant uuid := 'f2000000-0000-0000-0000-000000000006';
  v_unrelated constant uuid := 'f2000000-0000-0000-0000-000000000007';
  v_rsvp_admin constant uuid := 'f2000000-0000-0000-0000-000000000008';
  v_started_activity_id constant text := 'event-started-free-rsvp-regression';
  v_session_id text;
  v_future_session_id text;
  v_started_session_id text;
  v_free_one_off_id text;
  v_paid_one_off_id text;
  v_legacy_queue_id uuid;
  v_future_before jsonb;
  v_booking_a_withdrawn uuid;
  v_booking_a_cancelled uuid;
  v_booking_b_cancelled uuid;
  v_booking_c_withdrawn uuid;
  v_booking_pending uuid;
  v_booking_declined uuid;
  v_booking_rsvp_admin uuid;
  v_booking_a_fresh uuid;
  v_started_booking_id uuid;
  v_started_queue_id uuid;
  v_cancelled_at timestamptz;
  v_cancel_started_at timestamptz;
  v_cancel_finished_at timestamptz;
  v_started_session_before jsonb;
  v_started_booking_before jsonb;
  v_started_queue_before jsonb;
  v_rejected boolean;
  v_count integer;
  v_started_notification_count integer;
  v_error text;
begin
  select s.id into v_session_id
    from public.operational_sessions s
   where s.activity_id = 'wnt'
     and (s.session_date + s.start_time) at time zone 'Asia/Hong_Kong' > now()
   order by s.session_date
   limit 1;
  select s.id, to_jsonb(s) into v_future_session_id, v_future_before
    from public.operational_sessions s
   where s.activity_id = 'wnt'
     and s.id <> v_session_id
     and (s.session_date + s.start_time) at time zone 'Asia/Hong_Kong' > now()
   order by s.session_date
   limit 1;
  perform pg_temp.rsvp_assert(
    v_session_id is not null and v_future_session_id is not null,
    'migration materializes at least two future recurring occurrences'
  );

  -- A locked, explicit zero-price RSVP occurrence that has reached its Hong
  -- Kong start must reject cancellation before session, queue, booking, or
  -- notification state changes. The enclosing transaction rolls back every
  -- fixture after these assertions.
  v_started_session_id := v_started_activity_id || '-'
    || ((now() at time zone 'Asia/Hong_Kong')::date)::text;
  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    (v_started_activity_id, 'Started free RSVP', 'TBC',
     extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::smallint,
     '00:00', 60, null, 0, true, false, 'Other', null, true);
  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_started_session_id, v_started_activity_id,
     (now() at time zone 'Asia/Hong_Kong')::date,
     '00:00', 60, 'TBC', null, 0, true);
  insert into public.operational_bookings
    (profile_id, session_id, status, pay_deadline_at, paid_at, snapshot)
  values
    (v_member_a, v_started_session_id, 'confirmed', now(), now(),
     jsonb_build_object(
       'name', 'Started free RSVP',
       'dateISO', ((now() at time zone 'Asia/Hong_Kong')::date)::text,
       'time', '00:00',
       'price', 0
     ))
  returning id into v_started_booking_id;
  insert into public.operational_queue_entries
    (session_id, profile_id, kind, status)
  values (v_started_session_id, v_member_b, 'waitlist', 'active')
  returning id into v_started_queue_id;

  select to_jsonb(s) into v_started_session_before
    from public.operational_sessions s where s.id = v_started_session_id;
  select to_jsonb(b) into v_started_booking_before
    from public.operational_bookings b where b.id = v_started_booking_id;
  select to_jsonb(q) into v_started_queue_before
    from public.operational_queue_entries q where q.id = v_started_queue_id;
  select count(*) into v_started_notification_count
    from public.notifications
   where destination = '#/activity/' || v_started_session_id;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.cancel_operational_session(v_started_session_id, 'Too late');
  exception when check_violation then
    v_rejected := sqlerrm = 'Session has already started.';
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected,
    'started RSVP cancellation is rejected without mutation');
  perform pg_temp.rsvp_assert(
    (select to_jsonb(s) = v_started_session_before
       from public.operational_sessions s where s.id = v_started_session_id)
    and (select to_jsonb(b) = v_started_booking_before
       from public.operational_bookings b where b.id = v_started_booking_id)
    and (select to_jsonb(q) = v_started_queue_before
       from public.operational_queue_entries q where q.id = v_started_queue_id)
    and (select count(*) = v_started_notification_count
       from public.notifications
      where destination = '#/activity/' || v_started_session_id),
    'started RSVP rejection leaves session, queue, booking, and notifications unchanged'
  );

  -- The current nine-argument browser call remains compatible: free one-offs
  -- are normalized to RSVP/null capacity, while paid one-offs keep capacity.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  select id into v_free_one_off_id
    from public.create_operational_event(
      'Future free one-off', current_date + 70, '18:00', 60, 'TBC', null,
      'Other', 0, 7
    );
  perform pg_sleep(1.1);
  select id into v_paid_one_off_id
    from public.create_operational_event(
      'Future paid one-off', current_date + 71, '18:00', 60, 'TBC', null,
      'Other', 120, 7
    );
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(
    (select t.requires_rsvp and t.capacity is null and s.capacity is null
       from public.operational_sessions s
       join public.operational_activity_templates t on t.activity_id = s.activity_id
      where s.id = v_free_one_off_id),
    'future free one-off defaults to uncapped RSVP'
  );
  perform pg_temp.rsvp_assert(
    (select not t.requires_rsvp and t.capacity = 7 and s.capacity = 7
            and s.price_hkd = 120
       from public.operational_sessions s
       join public.operational_activity_templates t on t.activity_id = s.activity_id
      where s.id = v_paid_one_off_id),
    'paid one-off remains capacity-limited'
  );

  -- Every member queue entry point categorically rejects explicit free RSVP
  -- sessions, including attempts to leave a legacy active row.
  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  foreach v_error in array array['waitlist', 'interest'] loop
    v_rejected := false;
    begin
      perform public.join_operational_queue(v_session_id, v_error);
    exception when check_violation then
      v_rejected := sqlerrm = 'RSVP sessions do not use queues.';
    end;
    perform pg_temp.rsvp_assert(v_rejected, 'RSVP queue joins are rejected');
  end loop;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.operational_queue_entries
    (session_id, profile_id, kind, status)
  values (v_session_id, v_member_c, 'waitlist', 'active')
  returning id into v_legacy_queue_id;

  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.leave_operational_queue(v_legacy_queue_id);
  exception when check_violation then
    v_rejected := sqlerrm = 'RSVP sessions do not use queues.';
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected, 'RSVP queue leave is rejected');

  -- Anonymous and ordinary members cannot call Admin cancellation.
  v_rejected := false;
  set local role anon;
  begin
    perform public.cancel_operational_session(v_session_id, 'unauthorized');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.rsvp_assert(v_rejected, 'anonymous cancellation is rejected');

  v_rejected := false;
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  begin
    perform public.cancel_operational_session(v_session_id, 'unauthorized');
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected, 'member Admin cancellation is rejected');

  -- Member A joins, duplicate prevention fires, and another member cannot
  -- inspect A's identity-bearing booking row through RLS.
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select id into v_booking_a_withdrawn
    from public.reserve_operational_session(v_session_id);
  perform pg_temp.rsvp_assert(
    (select status = 'confirmed' from public.operational_bookings where id = v_booking_a_withdrawn),
    'member RSVP confirms immediately'
  );
  v_rejected := false;
  begin
    perform public.reserve_operational_session(v_session_id);
  exception when sqlstate '23514' then
    v_rejected := true;
  end;
  perform pg_temp.rsvp_assert(v_rejected, 'duplicate active RSVP is rejected');
  reset role;

  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  select count(*) into v_count
    from public.operational_bookings
   where id = v_booking_a_withdrawn;
  perform pg_temp.rsvp_assert(v_count = 0, 'booking RLS hides another attendee identity');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Withdrawal authorization is based on the caller's current approved role,
  -- not the role held when the RSVP was created.
  update public.profiles set role = 'pending' where id = v_member_a;
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.withdraw_operational_rsvp(v_booking_a_withdrawn);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected, 'pending withdrawal is rejected');

  update public.profiles set role = 'declined' where id = v_member_a;
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.withdraw_operational_rsvp(v_booking_a_withdrawn);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected, 'declined withdrawal is rejected');

  update public.profiles set role = 'member' where id = v_member_a;
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  perform public.withdraw_operational_rsvp(v_booking_a_withdrawn);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(
    (select status = 'cancelled'
        and cancellation_source = 'member'
        and cancelled_at is not null
       from public.operational_bookings
      where id = v_booking_a_withdrawn),
    'member withdrawal records member cancellation metadata'
  );

  -- A and B are active at cancellation time. C withdraws first and must not
  -- receive cancellation or reopening notices.
  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select id into v_booking_a_cancelled
    from public.reserve_operational_session(v_session_id);
  reset role;

  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  select id into v_booking_b_cancelled
    from public.reserve_operational_session(v_session_id);
  reset role;

  perform set_config('request.jwt.claim.sub', v_member_c::text, true);
  set local role authenticated;
  select id into v_booking_c_withdrawn
    from public.reserve_operational_session(v_session_id);
  perform public.withdraw_operational_rsvp(v_booking_c_withdrawn);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- The attendee roster remains available only to currently approved roles.
  perform set_config('request.jwt.claim.sub', v_pending::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.get_operational_attendee_names(v_session_id);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.rsvp_assert(v_rejected, 'pending attendee roster access is rejected');

  perform set_config('request.jwt.claim.sub', v_declined::text, true);
  set local role authenticated;
  v_rejected := false;
  begin
    perform public.get_operational_attendee_names(v_session_id);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_rejected, 'declined attendee roster access is rejected');

  perform set_config('request.jwt.claim.sub', v_member_b::text, true);
  set local role authenticated;
  select count(*) into v_count
    from public.get_operational_attendee_names(v_session_id);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(v_count = 2, 'approved attendee roster access succeeds');

  -- Profiles that RSVP while approved but become pending/declined before an
  -- operational change retain auditable bookings without receiving notices.
  update public.profiles set role = 'member' where id = v_pending;
  perform set_config('request.jwt.claim.sub', v_pending::text, true);
  set local role authenticated;
  select id into v_booking_pending
    from public.reserve_operational_session(v_session_id);
  reset role;
  update public.profiles set role = 'pending' where id = v_pending;

  update public.profiles set role = 'member' where id = v_declined;
  perform set_config('request.jwt.claim.sub', v_declined::text, true);
  set local role authenticated;
  select id into v_booking_declined
    from public.reserve_operational_session(v_session_id);
  reset role;
  update public.profiles set role = 'declined' where id = v_declined;

  perform set_config('request.jwt.claim.sub', v_rsvp_admin::text, true);
  set local role authenticated;
  select id into v_booking_rsvp_admin
    from public.reserve_operational_session(v_session_id);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.operational_session_venue_overrides where session_id = v_session_id;
  delete from public.notifications
   where destination = '#/activity/' || v_session_id
     and kind in ('operational_session_venue_updated', 'operational_session_time_updated');

  -- Location-only saves (maps missing) remain audit-only for admins; shared
  -- fan-out requires usable stored location and maps. Time changes still
  -- notify active approved RSVPs exactly once; exact repeats create no rows.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.set_session_venue(
    v_session_id, 'Central Harbourfront', null, true, null, null
  );
  perform public.set_session_venue(
    v_session_id, 'Central Harbourfront', null, false, null, null
  );
  perform public.set_operational_session_time(v_session_id, '19:31');
  perform public.set_operational_session_time(v_session_id, '19:31');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform pg_temp.rsvp_assert(
    not exists (
      select 1 from public.notifications
       where kind = 'operational_session_venue_updated'
         and destination = '#/activity/' || v_session_id
         and profile_id in (v_member_a, v_member_b, v_member_c, v_pending, v_declined, v_unrelated)
         and title in ('Venue confirmed', 'Venue updated')
    ),
    'partial venue saves do not shared-notify members without usable stored maps'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 1
       from public.notifications
      where kind = 'operational_session_venue_updated'
        and destination = '#/activity/' || v_session_id
        and profile_id = v_rsvp_admin
        and title = 'Session venue updated'
        and body = format(
          'Free RSVP Admin set the venue for %s to Central Harbourfront.',
          v_session_id
        )),
    'non-actor RSVP Admin receives exactly one venue row with audit semantics'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 2
       from public.notifications
      where kind = 'operational_session_time_updated'
        and destination = '#/activity/' || v_session_id
        and profile_id in (v_member_a, v_member_b))
    and not exists (
      select 1 from public.notifications
       where kind = 'operational_session_time_updated'
         and destination = '#/activity/' || v_session_id
         and profile_id in (v_member_c, v_pending, v_declined, v_unrelated)
    ),
    'time changes notify active approved RSVPs exactly once'
  );

  perform set_config('request.jwt.claim.sub', v_rsvp_admin::text, true);
  set local role authenticated;
  perform public.withdraw_operational_rsvp(v_booking_rsvp_admin);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  v_cancel_started_at := clock_timestamp();
  perform public.cancel_operational_session(v_session_id, 'Weather warning.');
  v_cancel_finished_at := clock_timestamp();
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  select cancelled_at into v_cancelled_at
    from public.operational_sessions
   where id = v_session_id;
  perform pg_temp.rsvp_assert(v_cancelled_at is not null, 'session cancellation is recorded');
  perform pg_temp.rsvp_assert(
    v_cancelled_at between v_cancel_started_at and v_cancel_finished_at,
    'cancellation uses one captured wall-clock timestamp'
  );
  perform pg_temp.rsvp_assert(
    (select status = 'dissolved' and resolved_at = v_cancelled_at
       from public.operational_queue_entries where id = v_legacy_queue_id),
    'cancellation dissolves active RSVP queues'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 4
       from public.operational_bookings
      where id in (v_booking_a_cancelled, v_booking_b_cancelled,
                   v_booking_pending, v_booking_declined)
        and status = 'cancelled'
        and cancellation_source = 'session'
        and cancelled_at = v_cancelled_at),
    'session cancellation marks every active confirmed RSVP for audit'
  );
  perform pg_temp.rsvp_assert(
    (select cancellation_source = 'member' and cancelled_at <> v_cancelled_at
       from public.operational_bookings where id = v_booking_c_withdrawn),
    'prior member withdrawal keeps its source'
  );
  perform pg_temp.rsvp_assert(
    not exists (
      select 1 from public.operational_bookings
       where profile_id in (v_member_a, v_member_b, v_member_c)
         and status = 'deferred'
    ),
    'RSVP cancellation never enters paid deferral'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 2
       from public.notifications
      where kind = 'operational_session_cancelled'
        and destination = '#/activity/' || v_session_id
        and created_at = v_cancelled_at
        and profile_id in (v_member_a, v_member_b))
    and not exists (
      select 1 from public.notifications
       where kind = 'operational_session_cancelled'
         and destination = '#/activity/' || v_session_id
         and profile_id in (v_member_c, v_pending, v_declined, v_unrelated)
    ),
    'cancellation notifications target active attendees only; currently approved profiles only'
  );
  perform pg_temp.rsvp_assert(
    (select to_jsonb(s) = v_future_before
       from public.operational_sessions s where s.id = v_future_session_id),
    'cancellation leaves the future occurrence unchanged'
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.reopen_operational_rsvp(v_session_id);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform pg_temp.rsvp_assert(
    (select cancelled_at is null and cancelled_by is null
        and cancelled_source is null and cancel_reason is null
       from public.operational_sessions where id = v_session_id),
    'reopening clears only occurrence cancellation state'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 2
       from public.notifications
      where kind = 'operational_rsvp_reopened'
        and destination = '#/activity/' || v_session_id
        and profile_id in (v_member_a, v_member_b))
    and not exists (
      select 1 from public.notifications
       where kind = 'operational_rsvp_reopened'
         and destination = '#/activity/' || v_session_id
         and profile_id in (v_member_c, v_pending, v_declined, v_unrelated)
    ),
    'reopening targets only attendees cancelled by that occurrence; currently approved profiles only'
  );
  perform pg_temp.rsvp_assert(
    (select count(*) = 2
       from public.operational_bookings
      where id in (v_booking_a_cancelled, v_booking_b_cancelled)
        and status = 'cancelled'),
    'reopening leaves old bookings cancelled'
  );

  perform set_config('request.jwt.claim.sub', v_member_a::text, true);
  set local role authenticated;
  select id into v_booking_a_fresh
    from public.reserve_operational_session(v_session_id);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.rsvp_assert(
    (select status = 'confirmed' from public.operational_bookings where id = v_booking_a_fresh)
      and v_booking_a_fresh <> v_booking_a_cancelled,
    'member can create a fresh RSVP after reopening'
  );
  perform pg_temp.rsvp_assert(
    (select to_jsonb(s) = v_future_before
       from public.operational_sessions s where s.id = v_future_session_id),
    'reopening and fresh RSVP leave the future occurrence unchanged'
  );
end $$;

rollback;
