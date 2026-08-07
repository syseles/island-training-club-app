\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'verification failed: %', message;
  end if;
end;
$$;

-- Supabase-compatible databases already own auth.users and auth.uid().
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'owner-test@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'admin-test@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'member-test@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'applicant-one@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', 'applicant-two@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000006', 'fallback-target@itc.invalid', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000007', 'unsupported-target@itc.invalid', '{}'::jsonb);

select pg_temp.assert_true(
  (select count(*) = 7 and bool_and(role = 'pending') from public.profiles),
  'every auth-created profile must bootstrap pending'
);

update public.profiles set full_name = 'Owner Test', role = 'super_admin'
 where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Admin Test', role = 'admin'
 where id = '10000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Member Test', role = 'member'
 where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set full_name = 'Applicant One', role = 'pending'
 where id = '10000000-0000-0000-0000-000000000004';
update public.profiles set full_name = 'Applicant Two', role = 'pending'
 where id = '10000000-0000-0000-0000-000000000005';
update public.profiles set full_name = 'Fallback Target', role = 'member'
 where id = '10000000-0000-0000-0000-000000000006';
update public.profiles set full_name = 'Unsupported Target', role = 'member'
 where id = '10000000-0000-0000-0000-000000000007';
truncate public.notifications, public.role_changes;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

-- A profile without an application produces no submission event.
select pg_temp.assert_true(
  not exists (select 1 from public.notifications),
  'profile bootstrap must not notify'
);

-- A submitted insert fans out exactly once; ordinary edits do not duplicate it.
insert into public.applications (profile_id, mobile, is_minor, privacy_accepted_at)
values ('10000000-0000-0000-0000-000000000004', '+852 6000 0004', false, now());
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_application_submitted') = 2,
  'submitted insert must notify the current Admin and Super Admin'
);
update public.applications set mobile = '+852 6111 0004'
 where profile_id = '10000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_application_submitted') = 2,
  'editing a submitted application must not duplicate its event'
);

-- Approval preserves audit/welcome behavior and creates the trusted fan-out.
update public.profiles set role = 'member'
 where id = '10000000-0000-0000-0000-000000000004';
select pg_temp.assert_true(
  (select count(*) from public.role_changes where profile_id = '10000000-0000-0000-0000-000000000004') = 1,
  'approval must be audited'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where profile_id = '10000000-0000-0000-0000-000000000004' and kind = 'welcome') = 1,
  'approval must preserve the member welcome'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_application_approved') = 2,
  'approval must fan out to both operational recipients'
);

-- Decline and every supported privilege transition receive the exact kind.
insert into public.applications (profile_id, mobile, is_minor, privacy_accepted_at)
values ('10000000-0000-0000-0000-000000000005', '+852 6000 0005', false, now());
update public.profiles set role = 'declined'
 where id = '10000000-0000-0000-0000-000000000005';
update public.profiles set role = 'admin'
 where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'member'
 where id = '10000000-0000-0000-0000-000000000003';
update public.profiles set role = 'pending'
 where id = '10000000-0000-0000-0000-000000000003';
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_application_declined') = 2,
  'decline kind/fan-out is incorrect'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_role_promoted') = 3,
  'promotion must reach recipients including the newly promoted Admin'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_role_demoted') = 2,
  'demotion kind/fan-out is incorrect'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'admin_membership_revoked') = 2,
  'revocation kind/fan-out is incorrect'
);

-- Unsupported transitions remain in the complete audit trail but do not create
-- an operational notification.
create temporary table operational_notification_checkpoint as
select count(*)::bigint as count
  from public.notifications
 where kind like 'admin_%';
update public.profiles set role = 'declined'
 where id = '10000000-0000-0000-0000-000000000007';
select pg_temp.assert_true(
  exists (select 1 from public.role_changes
           where profile_id = '10000000-0000-0000-0000-000000000007'
             and old_role = 'member' and new_role = 'declined'),
  'unsupported transition must still be audited'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind like 'admin_%') =
    (select count from operational_notification_checkpoint),
  'unsupported transition must not create an operational notification'
);

-- A service operation without a matching actor profile keeps a nullable audit
-- actor and uses the approved fallback copy.
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000099', true);
update public.profiles set role = 'pending'
 where id = '10000000-0000-0000-0000-000000000006';
select pg_temp.assert_true(
  exists (select 1 from public.role_changes
           where profile_id = '10000000-0000-0000-0000-000000000006' and changed_by is null),
  'unmatched actor must be stored as null'
);
select pg_temp.assert_true(
  exists (select 1 from public.notifications
           where kind = 'admin_membership_revoked' and body like 'An administrator revoked Fallback Target%'),
  'unmatched actor copy must use the safe fallback'
);

-- Browser privileges plus self-row RLS form the complete mutation boundary.
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'authenticated must be able to select own notifications'
);
select pg_temp.assert_true(
  has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE'),
  'authenticated must be able to update read_at'
);
select pg_temp.assert_true(
  not has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE'),
  'authenticated must not be able to update trusted content'
);
select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.notifications', 'UPDATE'),
  'anonymous clients must not have notification UPDATE'
);

insert into public.notifications (id, profile_id, kind, title, body) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'welcome', 'Own row', 'Own body'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'admin_role_promoted', 'Other row', 'Other body');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
update public.notifications set read_at = now()
 where id = '30000000-0000-0000-0000-000000000001';
do $$
declare changed integer;
begin
  update public.notifications set read_at = now()
   where id = '30000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'cross-user notification update escaped RLS'; end if;
end;
$$;
do $$
begin
  begin
    update public.notifications set title = 'forged'
     where id = '30000000-0000-0000-0000-000000000001';
    raise exception 'trusted notification content update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
select pg_temp.assert_true(
  (select read_at is not null from public.notifications where id = '30000000-0000-0000-0000-000000000001'),
  'recipient could not mark own row read'
);
select pg_temp.assert_true(
  (select read_at is null from public.notifications where id = '30000000-0000-0000-0000-000000000002'),
  'recipient changed another row'
);
select pg_temp.assert_true(
  (select title = 'Own row' from public.notifications where id = '30000000-0000-0000-0000-000000000001'),
  'recipient changed trusted event content'
);

rollback;
\echo 'Admin notification database integration verification passed.'
