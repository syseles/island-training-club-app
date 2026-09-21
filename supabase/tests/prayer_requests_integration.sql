-- Island Training Club — private prayer-request database integration evidence
-- Run only against an acknowledged disposable Supabase-compatible database.
-- Every fixture and mutation is rollback-scoped.

\set ON_ERROR_STOP on

begin;

create function pg_temp.prayer_claim(p_sub uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('f3100000-0000-0000-0000-000000000001', 'prayer-pending@itc.invalid', '{}'::jsonb),
  ('f3100000-0000-0000-0000-000000000002', 'prayer-member-a@itc.invalid', '{}'::jsonb),
  ('f3100000-0000-0000-0000-000000000003', 'prayer-member-b@itc.invalid', '{}'::jsonb),
  ('f3100000-0000-0000-0000-000000000004', 'prayer-admin@itc.invalid', '{}'::jsonb),
  ('f3100000-0000-0000-0000-000000000005', 'prayer-super-admin@itc.invalid', '{}'::jsonb),
  ('f3100000-0000-0000-0000-000000000006', 'prayer-declined@itc.invalid', '{}'::jsonb);

update public.profiles set role = 'pending', full_name = 'Prayer Pending'
 where id = 'f3100000-0000-0000-0000-000000000001';
update public.profiles set role = 'member', full_name = 'Member Alpha'
 where id = 'f3100000-0000-0000-0000-000000000002';
update public.profiles set role = 'member', full_name = 'Member Beta'
 where id = 'f3100000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin', full_name = 'Prayer Admin'
 where id = 'f3100000-0000-0000-0000-000000000004';
update public.profiles set role = 'super_admin', full_name = 'Prayer Super Admin'
 where id = 'f3100000-0000-0000-0000-000000000005';
update public.profiles set role = 'declined', full_name = 'Prayer Declined'
 where id = 'f3100000-0000-0000-0000-000000000006';

do $$
declare
  v_pending constant uuid := 'f3100000-0000-0000-0000-000000000001';
  v_member_a constant uuid := 'f3100000-0000-0000-0000-000000000002';
  v_member_b constant uuid := 'f3100000-0000-0000-0000-000000000003';
  v_admin constant uuid := 'f3100000-0000-0000-0000-000000000004';
  v_super_admin constant uuid := 'f3100000-0000-0000-0000-000000000005';
  v_declined constant uuid := 'f3100000-0000-0000-0000-000000000006';
  v_identified_a uuid;
  v_anonymous_a uuid;
  v_identified_b uuid;
  v_member_closed uuid;
  v_admin_owned uuid;
  v_super_admin_owned uuid;
  v_count integer;
  v_rejected boolean;
  v_columns text[];
  v_order uuid[];
  v_text text;
  v_anon boolean;
begin
  if to_regclass('public.prayer_requests') is null then
    raise exception 'prayer integration failed: prayer_requests table is missing';
  end if;

  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'prayer_requests'
       and c.relrowsecurity
  ) then
    raise exception 'prayer integration failed: prayer_requests RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.prayer_requests', 'select,insert,update,delete')
      or has_table_privilege('authenticated', 'public.prayer_requests', 'select,insert,update,delete') then
    raise exception 'prayer integration failed: browser roles have direct table privileges';
  end if;

  if (
    select count(*)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'submit_prayer_request',
         'list_my_prayer_requests',
         'set_my_prayer_request_state',
         'list_admin_prayer_requests',
         'set_admin_prayer_request_status'
       )
       and p.prosecdef
       and coalesce(p.proconfig @> array['search_path=public']::text[], false)
  ) <> 5 then
    raise exception 'prayer integration failed: five pinned security-definer RPCs are required';
  end if;

  if not has_function_privilege(
      'authenticated', 'public.submit_prayer_request(text,boolean)', 'execute')
      or not has_function_privilege(
      'authenticated', 'public.list_my_prayer_requests()', 'execute')
      or not has_function_privilege(
      'authenticated', 'public.set_my_prayer_request_state(uuid,text)', 'execute')
      or not has_function_privilege(
      'authenticated', 'public.list_admin_prayer_requests()', 'execute')
      or not has_function_privilege(
      'authenticated', 'public.set_admin_prayer_request_status(uuid,text)', 'execute') then
    raise exception 'prayer integration failed: authenticated RPC grants are incomplete';
  end if;

  if has_function_privilege('anon', 'public.submit_prayer_request(text,boolean)', 'execute')
      or has_function_privilege('anon', 'public.list_my_prayer_requests()', 'execute')
      or has_function_privilege('anon', 'public.set_my_prayer_request_state(uuid,text)', 'execute')
      or has_function_privilege('anon', 'public.list_admin_prayer_requests()', 'execute')
      or has_function_privilege('anon', 'public.set_admin_prayer_request_status(uuid,text)', 'execute') then
    raise exception 'prayer integration failed: anon can execute a prayer RPC';
  end if;

  if has_function_privilege('anon', 'public.prayer_assert_approved()', 'execute')
      or has_function_privilege('authenticated', 'public.prayer_assert_approved()', 'execute')
      or has_function_privilege('anon', 'public.prayer_assert_admin()', 'execute')
      or has_function_privilege('authenticated', 'public.prayer_assert_admin()', 'execute') then
    raise exception 'prayer integration failed: browser roles can execute private role helpers';
  end if;

  foreach v_text in array array[
    'submit_prayer_request',
    'list_my_prayer_requests',
    'set_my_prayer_request_state'
  ] loop
    select array_agg(p.proargnames[s.i] order by s.i)
      into v_columns
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral generate_subscripts(p.proargnames, 1) s(i)
     where n.nspname = 'public'
       and p.proname = v_text
       and p.proargmodes[s.i] in ('o', 't');
    if v_columns is distinct from array[
      'id', 'request_text', 'anonymous_to_leaders', 'status',
      'created_at', 'updated_at', 'closed_at', 'withdrawn_at'
    ]::text[] then
      raise exception 'prayer integration failed: % member result columns are unsafe or incomplete: %',
        v_text, v_columns;
    end if;
  end loop;

  foreach v_text in array array[
    'list_admin_prayer_requests',
    'set_admin_prayer_request_status'
  ] loop
    select array_agg(p.proargnames[s.i] order by s.i)
      into v_columns
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral generate_subscripts(p.proargnames, 1) s(i)
     where n.nspname = 'public'
       and p.proname = v_text
       and p.proargmodes[s.i] in ('o', 't');
    if v_columns is distinct from array[
      'id', 'display_name', 'request_text', 'anonymous_to_leaders',
      'status', 'created_at', 'updated_at', 'closed_at'
    ]::text[] or v_columns && array['owner_id', 'email']::text[] then
      raise exception 'prayer integration failed: % Admin result columns expose identity or are incomplete: %',
        v_text, v_columns;
    end if;
  end loop;

  -- Anon is denied by ACL, and an authenticated session without a profile
  -- identity is denied by the authoritative profile helper.
  v_rejected := false;
  set local role anon;
  begin
    perform 1 from public.submit_prayer_request('not signed in', false);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: anon submission succeeded';
  end if;
  v_rejected := false;
  begin
    perform 1 from public.list_my_prayer_requests();
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  if not v_rejected then
    raise exception 'prayer integration failed: anon member listing succeeded';
  end if;

  v_rejected := false;
  perform pg_temp.prayer_claim(null);
  set local role authenticated;
  begin
    perform 1 from public.submit_prayer_request('missing profile identity', false);
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: unauthenticated submission succeeded';
  end if;
  v_rejected := false;
  begin
    perform 1 from public.list_my_prayer_requests();
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: unauthenticated member listing succeeded';
  end if;

  v_rejected := false;
  perform pg_temp.prayer_claim(v_pending);
  set local role authenticated;
  begin
    perform 1 from public.submit_prayer_request('pending request', false);
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: pending submission succeeded';
  end if;
  v_rejected := false;
  begin
    perform 1 from public.list_my_prayer_requests();
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: pending member listing succeeded';
  end if;

  v_rejected := false;
  perform pg_temp.prayer_claim(v_declined);
  set local role authenticated;
  begin
    perform 1 from public.submit_prayer_request('declined request', false);
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: declined submission succeeded';
  end if;
  v_rejected := false;
  begin
    perform 1 from public.list_my_prayer_requests();
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: declined member listing succeeded';
  end if;

  -- Server-side request normalization and length checks.
  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  v_rejected := false;
  begin
    perform 1 from public.submit_prayer_request('   ', false);
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: blank request was accepted';
  end if;
  v_rejected := false;
  begin
    perform 1 from public.submit_prayer_request(repeat('x', 2001), false);
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: oversized request was accepted';
  end if;

  select r.id, r.request_text, r.anonymous_to_leaders
    into v_identified_a, v_text, v_anon
    from public.submit_prayer_request('  Please pray for Alpha  ', false) r;
  if v_text <> 'Please pray for Alpha' or v_anon then
    raise exception 'prayer integration failed: identified request was not normalized';
  end if;
  select r.id
    into v_anonymous_a
    from public.submit_prayer_request('Please pray privately for Alpha', true) r;
  reset role;
  perform pg_temp.prayer_claim(null);

  perform pg_temp.prayer_claim(v_member_b);
  set local role authenticated;
  select r.id
    into v_identified_b
    from public.submit_prayer_request('Please pray for Beta', false) r;
  reset role;
  perform pg_temp.prayer_claim(null);

  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  select count(*), array_agg(r.id order by r.created_at desc)
    into v_count, v_order
    from public.list_my_prayer_requests() r;
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_count <> 2
      or not (v_order @> array[v_identified_a, v_anonymous_a]::uuid[])
      or v_order @> array[v_identified_b]::uuid[] then
    raise exception 'prayer integration failed: member list is not owner-scoped to two rows';
  end if;

  -- Another member cannot close or withdraw an owned request.
  perform pg_temp.prayer_claim(v_member_b);
  set local role authenticated;
  foreach v_text in array array['close', 'withdraw'] loop
    v_rejected := false;
    begin
      perform 1 from public.set_my_prayer_request_state(v_identified_a, v_text);
    exception when sqlstate 'P0002' then
      v_rejected := true;
    end;
    if not v_rejected then
      raise exception 'prayer integration failed: member B performed % on member A row', v_text;
    end if;
  end loop;
  reset role;
  perform pg_temp.prayer_claim(null);

  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  foreach v_text in array array['close', 'withdraw'] loop
    v_rejected := false;
    begin
      perform 1 from public.set_my_prayer_request_state(v_identified_b, v_text);
    exception when sqlstate 'P0002' then
      v_rejected := true;
    end;
    if not v_rejected then
      raise exception 'prayer integration failed: member A performed % on member B row', v_text;
    end if;
  end loop;
  reset role;
  perform pg_temp.prayer_claim(null);
  if (select status from public.prayer_requests where id = v_identified_a) <> 'new'
      or (select status from public.prayer_requests where id = v_identified_b) <> 'new' then
    raise exception 'prayer integration failed: cross-owner mutation changed state';
  end if;

  -- Direct table reads and writes fail even for an approved authenticated role.
  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  v_rejected := false;
  begin
    execute 'select count(*) from public.prayer_requests' into v_count;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: direct SELECT succeeded';
  end if;

  v_rejected := false;
  begin
    execute $sql$
      insert into public.prayer_requests (owner_id, request_text)
      values ('f3100000-0000-0000-0000-000000000002', 'direct insert')
    $sql$;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: direct INSERT succeeded';
  end if;

  v_rejected := false;
  begin
    execute format(
      'update public.prayer_requests set status = %L where id = %L',
      'closed', v_identified_a
    );
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: direct UPDATE succeeded';
  end if;

  v_rejected := false;
  begin
    execute format('delete from public.prayer_requests where id = %L', v_identified_a);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: direct DELETE succeeded';
  end if;

  -- Ordinary members cannot use either Admin RPC despite the authenticated
  -- transport-level grant.
  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  v_rejected := false;
  begin
    perform 1 from public.list_admin_prayer_requests();
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: member listed Admin requests';
  end if;

  v_rejected := false;
  begin
    perform 1 from public.set_admin_prayer_request_status(v_identified_a, 'prayed_for');
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: member changed Admin status';
  end if;

  -- Admin output identifies only opted-in rows and preserves oldest-first new
  -- ordering. The anonymous row carries no stable owner field by contract.
  perform pg_temp.prayer_claim(v_admin);
  set local role authenticated;
  select count(*) into v_count
    from public.list_admin_prayer_requests() r
   where (r.id = v_identified_a and r.display_name = 'Member Alpha')
      or (r.id = v_identified_b and r.display_name = 'Member Beta')
      or (r.id = v_anonymous_a and r.display_name = 'Anonymous member');
  select array_agg(r.id order by ordinality)
    into v_order
    from public.list_admin_prayer_requests() with ordinality as r(
      id, display_name, request_text, anonymous_to_leaders, status,
      created_at, updated_at, closed_at, ordinality
    );
  if v_count <> 3 or v_order <> array[v_identified_a, v_anonymous_a, v_identified_b]::uuid[] then
    raise exception 'prayer integration failed: initial Admin names/redaction/order are incorrect';
  end if;

  -- Admin advances new -> prayed_for. New rows remain before prayed-for rows.
  perform 1 from public.set_admin_prayer_request_status(v_identified_a, 'prayed_for');
  select array_agg(r.id order by ordinality)
    into v_order
    from public.list_admin_prayer_requests() with ordinality as r(
      id, display_name, request_text, anonymous_to_leaders, status,
      created_at, updated_at, closed_at, ordinality
    );
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_order <> array[v_anonymous_a, v_identified_b, v_identified_a]::uuid[] then
    raise exception 'prayer integration failed: new/prayed_for Admin ordering is incorrect';
  end if;

  -- Super Admin advances prayed_for -> closed.
  perform pg_temp.prayer_claim(v_super_admin);
  set local role authenticated;
  perform 1 from public.set_admin_prayer_request_status(v_identified_a, 'closed');
  reset role;
  perform pg_temp.prayer_claim(null);
  if not (select status = 'closed' and closed_at is not null
            from public.prayer_requests where id = v_identified_a) then
    raise exception 'prayer integration failed: Super Admin did not close prayed-for row';
  end if;

  -- Repeated terminal edits and unsupported statuses fail. Direct new -> closed
  -- remains a legal Admin transition.
  perform pg_temp.prayer_claim(v_admin);
  set local role authenticated;
  v_rejected := false;
  begin
    perform 1 from public.set_admin_prayer_request_status(v_identified_a, 'closed');
  exception when sqlstate '23514' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: repeated Admin close succeeded';
  end if;

  v_rejected := false;
  begin
    perform 1 from public.set_admin_prayer_request_status(v_identified_b, 'withdrawn');
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'prayer integration failed: illegal Admin status succeeded';
  end if;
  perform 1 from public.set_admin_prayer_request_status(v_identified_b, 'closed');
  select array_agg(r.id order by ordinality)
    into v_order
    from public.list_admin_prayer_requests() with ordinality as r(
      id, display_name, request_text, anonymous_to_leaders, status,
      created_at, updated_at, closed_at, ordinality
    );
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_order <> array[v_anonymous_a, v_identified_b, v_identified_a]::uuid[] then
    raise exception 'prayer integration failed: active/closed Admin ordering is incorrect';
  end if;

  -- The owner withdraws one active and one closed row. Each withdrawal is a
  -- single atomic mutation that erases text and clears any closure timestamp.
  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  perform 1 from public.set_my_prayer_request_state(v_anonymous_a, 'withdraw');
  perform 1 from public.set_my_prayer_request_state(v_identified_a, 'withdraw');
  select count(*) into v_count
    from public.list_my_prayer_requests() r
   where r.id in (v_anonymous_a, v_identified_a)
     and r.status = 'withdrawn'
     and r.request_text is null
     and r.closed_at is null
     and r.withdrawn_at is not null;
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_count <> 2 then
    raise exception 'prayer integration failed: withdrawn rows are absent or retain sensitive state';
  end if;

  if exists (
    select 1
      from public.prayer_requests
     where id in (v_anonymous_a, v_identified_a)
       and (request_text is not null or closed_at is not null or withdrawn_at is null
         or status_changed_by <> v_member_a)
  ) then
    raise exception 'prayer integration failed: withdrawal was not atomically persisted';
  end if;

  perform pg_temp.prayer_claim(v_admin);
  set local role authenticated;
  select count(*) into v_count
    from public.list_admin_prayer_requests() r
   where r.id in (v_anonymous_a, v_identified_a);
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_count <> 0 then
    raise exception 'prayer integration failed: withdrawn rows remain in Admin output';
  end if;

  -- Member close is separately supported for owned new rows; a withdrawn row
  -- is immutable through the member RPC.
  perform pg_temp.prayer_claim(v_member_a);
  set local role authenticated;
  select r.id into v_member_closed
    from public.submit_prayer_request('Member closes this request', false) r;
  perform 1 from public.set_my_prayer_request_state(v_member_closed, 'close');
  if not exists (
    select 1
      from public.list_my_prayer_requests() r
     where r.id = v_member_closed and r.status = 'closed' and r.closed_at is not null
  ) then
    raise exception 'prayer integration failed: member close did not persist';
  end if;

  v_rejected := false;
  begin
    perform 1 from public.set_my_prayer_request_state(v_anonymous_a, 'withdraw');
  exception when sqlstate '23514' then
    v_rejected := true;
  end;
  reset role;
  perform pg_temp.prayer_claim(null);
  if not v_rejected then
    raise exception 'prayer integration failed: withdrawn member row was mutable';
  end if;

  -- Administrative roles are also approved members for submission and can
  -- read/withdraw only their own member-history rows.
  perform pg_temp.prayer_claim(v_admin);
  set local role authenticated;
  select r.id into v_admin_owned
    from public.submit_prayer_request('Admin-owned prayer request', false) r;
  if not exists (
    select 1 from public.list_my_prayer_requests() r where r.id = v_admin_owned
  ) then
    raise exception 'prayer integration failed: Admin approved-member submission/list failed';
  end if;
  perform 1 from public.set_my_prayer_request_state(v_admin_owned, 'withdraw');
  reset role;
  perform pg_temp.prayer_claim(null);

  perform pg_temp.prayer_claim(v_super_admin);
  set local role authenticated;
  select r.id into v_super_admin_owned
    from public.submit_prayer_request('Super-Admin-owned prayer request', true) r;
  if not exists (
    select 1 from public.list_my_prayer_requests() r where r.id = v_super_admin_owned
  ) then
    raise exception 'prayer integration failed: Super Admin approved-member submission/list failed';
  end if;
  perform 1 from public.set_my_prayer_request_state(v_super_admin_owned, 'withdraw');
  select count(*) into v_count from public.list_admin_prayer_requests();
  reset role;
  perform pg_temp.prayer_claim(null);
  if v_count <> 2 then
    raise exception 'prayer integration failed: Super Admin list or withdrawn exclusion failed';
  end if;

  raise notice 'OK: private prayer-request database boundary';
end $$;

rollback;
