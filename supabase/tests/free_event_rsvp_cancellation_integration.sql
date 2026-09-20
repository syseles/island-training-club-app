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
    not has_table_privilege('anon', 'public.operational_bookings', 'insert,update,delete')
      and not has_table_privilege('authenticated', 'public.operational_bookings', 'insert,update,delete'),
    'browser roles cannot mutate bookings directly'
  );
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f2000000-0000-0000-0000-000000000001', 'free-rsvp-admin@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000002', 'free-rsvp-a@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000003', 'free-rsvp-b@itc.invalid', '{}'::jsonb),
  ('f2000000-0000-0000-0000-000000000004', 'free-rsvp-c@itc.invalid', '{}'::jsonb);

update public.profiles set role = 'admin', full_name = 'Free RSVP Admin'
 where id = 'f2000000-0000-0000-0000-000000000001';
update public.profiles set role = 'member', full_name = 'Free RSVP A'
 where id = 'f2000000-0000-0000-0000-000000000002';
update public.profiles set role = 'member', full_name = 'Free RSVP B'
 where id = 'f2000000-0000-0000-0000-000000000003';
update public.profiles set role = 'member', full_name = 'Free RSVP C'
 where id = 'f2000000-0000-0000-0000-000000000004';

do $$
declare
  v_admin constant uuid := 'f2000000-0000-0000-0000-000000000001';
  v_member_a constant uuid := 'f2000000-0000-0000-0000-000000000002';
  v_member_b constant uuid := 'f2000000-0000-0000-0000-000000000003';
  v_member_c constant uuid := 'f2000000-0000-0000-0000-000000000004';
  v_session_id text;
  v_future_session_id text;
  v_future_before jsonb;
  v_booking_a_withdrawn uuid;
  v_booking_a_cancelled uuid;
  v_booking_b_cancelled uuid;
  v_booking_c_withdrawn uuid;
  v_booking_a_fresh uuid;
  v_cancelled_at timestamptz;
  v_rejected boolean;
  v_count integer;
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

  -- A member withdrawal records its own source and timestamp.
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

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  set local role authenticated;
  perform public.cancel_operational_session(v_session_id, 'Weather warning.');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  select cancelled_at into v_cancelled_at
    from public.operational_sessions
   where id = v_session_id;
  perform pg_temp.rsvp_assert(v_cancelled_at is not null, 'session cancellation is recorded');
  perform pg_temp.rsvp_assert(
    (select count(*) = 2
       from public.operational_bookings
      where id in (v_booking_a_cancelled, v_booking_b_cancelled)
        and status = 'cancelled'
        and cancellation_source = 'session'
        and cancelled_at = v_cancelled_at),
    'session cancellation marks only active confirmed RSVPs'
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
        and profile_id in (v_member_a, v_member_b))
    and not exists (
      select 1 from public.notifications
       where kind = 'operational_session_cancelled'
         and destination = '#/activity/' || v_session_id
         and profile_id = v_member_c
    ),
    'cancellation notifications target active attendees only'
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
         and profile_id = v_member_c
    ),
    'reopening targets only attendees cancelled by that occurrence'
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
