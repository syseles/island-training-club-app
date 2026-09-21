-- Island Training Club — forward-only declined profile decision repair evidence
-- Run only against a clean, disposable Supabase local migration chain.
-- Every fixture and mutation is rollback-scoped.

\set ON_ERROR_STOP on

begin;

-- The hosted API supplies table-level transport privileges before RLS. The
-- clean CLI chain does not, so grant them only inside this transaction; the
-- final ROLLBACK removes them after the policies have been exercised.
grant select, update on table public.profiles to authenticated;
grant select on table public.applications to authenticated;

create function pg_temp.decision_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'declined profile decision integration failed: %', message;
  end if;
end;
$$;

create function pg_temp.decision_claim(p_sub uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
end;
$$;

select pg_temp.decision_assert(
  exists (
    select 1
      from supabase_migrations.schema_migrations
     where version = '20260921000002'
       and name = 'declined_profile_decisions'
  ),
  'forward migration 20260921000002 was not applied by the clean chain'
);

select pg_temp.decision_assert(
  (
    select count(*) = 1
      from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_role_check'
       and pg_get_constraintdef(oid) =
         'CHECK ((role = ANY (ARRAY[''pending''::text, ''member''::text, ''admin''::text, ''super_admin''::text, ''declined''::text])))'
  ),
  'profiles_role_check does not contain exactly the five approved roles'
);

select pg_temp.decision_assert(
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'admin approve pending'
  )
  and (
    select count(*) = 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'admin decide pending'
       and cmd = 'UPDATE'
  ),
  'exactly one admin decide pending UPDATE policy must replace the old policy'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f3200000-0000-0000-0000-000000000001', 'decision-admin@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000002', 'decision-super-admin@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000003', 'decision-member@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000004', 'decision-self@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000005', 'decision-no-application@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000006', 'decision-approve@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000007', 'decision-decline@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000008', 'decision-constraint@itc.invalid', '{}'::jsonb),
  ('f3200000-0000-0000-0000-000000000009', 'decision-super-target@itc.invalid', '{}'::jsonb);

update public.profiles set role = 'admin', full_name = 'Decision Admin'
 where id = 'f3200000-0000-0000-0000-000000000001';
update public.profiles set role = 'super_admin', full_name = 'Decision Super Admin'
 where id = 'f3200000-0000-0000-0000-000000000002';
update public.profiles set role = 'member', full_name = 'Decision Member'
 where id = 'f3200000-0000-0000-0000-000000000003';
update public.profiles set role = 'member', full_name = 'Decision Self'
 where id = 'f3200000-0000-0000-0000-000000000004';
update public.profiles set full_name = 'No Application'
 where id = 'f3200000-0000-0000-0000-000000000005';
update public.profiles set full_name = 'Approve Candidate'
 where id = 'f3200000-0000-0000-0000-000000000006';
update public.profiles set full_name = 'Decline Candidate'
 where id = 'f3200000-0000-0000-0000-000000000007';
update public.profiles set role = 'declined', full_name = 'Constraint Declined'
 where id = 'f3200000-0000-0000-0000-000000000008';
update public.profiles set role = 'member', full_name = 'Super Target'
 where id = 'f3200000-0000-0000-0000-000000000009';

select pg_temp.decision_assert(
  (select role = 'declined' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000008'),
  'profiles_role_check rejected declined'
);

do $$
begin
  begin
    update public.profiles set role = 'unknown_role'
     where id = 'f3200000-0000-0000-0000-000000000008';
    raise exception 'profiles_role_check accepted an unknown role';
  exception when check_violation then
    null;
  end;
end;
$$;

insert into public.applications (profile_id, mobile, is_minor, privacy_accepted_at)
values
  ('f3200000-0000-0000-0000-000000000006', '+852 6000 0006', false, clock_timestamp()),
  ('f3200000-0000-0000-0000-000000000007', '+852 6000 0007', false, clock_timestamp());

-- An ordinary member cannot decide another pending profile.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000003');
set local role authenticated;
update public.profiles set role = 'member'
 where id = 'f3200000-0000-0000-0000-000000000006';
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'pending' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000006'),
  'ordinary member decided another pending profile'
);

-- Admin is still blocked when the pending target has no submitted application.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000001');
set local role authenticated;
do $$
declare
  rejected boolean := false;
begin
  begin
    update public.profiles set role = 'declined'
     where id = 'f3200000-0000-0000-0000-000000000005';
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Admin decision without a submitted application was not rejected';
  end if;
end;
$$;
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'pending' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000005'),
  'Admin decided a pending profile without a submitted application'
);

-- Admin may approve or decline only submitted pending applications.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000001');
set local role authenticated;
update public.profiles set role = 'member'
 where id = 'f3200000-0000-0000-0000-000000000006';
update public.profiles set role = 'declined'
 where id = 'f3200000-0000-0000-0000-000000000007';
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'member' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000006')
  and
  (select role = 'declined' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000007'),
  'Admin could not approve and decline submitted pending profiles'
);

-- Terminal member/declined rows cannot be changed through the Admin policy.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000001');
set local role authenticated;
update public.profiles set role = 'declined'
 where id = 'f3200000-0000-0000-0000-000000000006';
update public.profiles set role = 'member'
 where id = 'f3200000-0000-0000-0000-000000000007';
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'member' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000006')
  and
  (select role = 'declined' from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000007'),
  'Admin changed a terminal member or declined row'
);

-- The pre-existing Super Admin policy still permits arbitrary profile updates.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000002');
set local role authenticated;
update public.profiles set role = 'admin', full_name = 'Super Updated Target'
 where id = 'f3200000-0000-0000-0000-000000000009';
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'admin' and full_name = 'Super Updated Target'
     from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000009'),
  'Super Admin existing update policy no longer functions'
);

-- Self-update remains available for profile fields but cannot elevate role.
select pg_temp.decision_claim('f3200000-0000-0000-0000-000000000004');
set local role authenticated;
update public.profiles set full_name = 'Self Updated'
 where id = 'f3200000-0000-0000-0000-000000000004';
do $$
begin
  begin
    update public.profiles set role = 'admin'
     where id = 'f3200000-0000-0000-0000-000000000004';
    raise exception 'self-update changed role';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
select pg_temp.decision_claim(null);
select pg_temp.decision_assert(
  (select role = 'member' and full_name = 'Self Updated'
     from public.profiles
    where id = 'f3200000-0000-0000-0000-000000000004'),
  'self-update role boundary or ordinary profile update regressed'
);

do $$
begin
  raise notice 'OK: declined profile decision forward boundary';
end;
$$;

rollback;
