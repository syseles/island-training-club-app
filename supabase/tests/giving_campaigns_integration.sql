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

insert into auth.users (id, email, raw_user_meta_data) values
  ('41000000-0000-0000-0000-000000000001', 'giving-owner@itc.invalid', '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000002', 'giving-admin@itc.invalid', '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000003', 'giving-member@itc.invalid', '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000004', 'giving-pending@itc.invalid', '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000005', 'giving-declined@itc.invalid', '{}'::jsonb);

update public.profiles set full_name = 'Giving Owner', role = 'super_admin'
 where id = '41000000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Giving Admin', role = 'admin'
 where id = '41000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Giving Member', role = 'member'
 where id = '41000000-0000-0000-0000-000000000003';
update public.profiles set full_name = 'Giving Pending', role = 'pending'
 where id = '41000000-0000-0000-0000-000000000004';
update public.profiles set full_name = 'Giving Declined', role = 'declined'
 where id = '41000000-0000-0000-0000-000000000005';
truncate public.notifications, public.role_changes;

select pg_temp.assert_true(
  to_regclass('public.giving_campaigns') is not null,
  'migration application did not create giving_campaigns'
);
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.giving_campaigns', 'SELECT')
  and has_table_privilege('authenticated', 'public.giving_campaigns', 'INSERT')
  and has_table_privilege('authenticated', 'public.giving_campaigns', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.giving_campaigns', 'DELETE')
  and not has_table_privilege('anon', 'public.giving_campaigns', 'SELECT'),
  'Giving browser privileges must omit visitor access and DELETE'
);

-- Admin RLS: an authenticated Admin can create and edit a campaign.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
insert into public.giving_campaigns (
  id, title, description, goal_hkd, fps_id, fps_payee, creator_profile_id
) values (
  '42000000-0000-0000-0000-000000000001', 'Winter Relief',
  'Support our partner community this winter.', 25000, '1234567', 'Island Training Club',
  '41000000-0000-0000-0000-000000000002'
);
update public.giving_campaigns set description = 'Support our partner community throughout winter.'
 where id = '42000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert_true(
  (select status = 'draft' and published_at is null and closed_at is null
     from public.giving_campaigns where id = '42000000-0000-0000-0000-000000000001'),
  'Admin RLS create/edit or draft timestamps failed'
);

-- Publication audience fan-out: first Draft -> Published reaches exactly the
-- member, Admin, and Super Admin, with pending/declined exclusion.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
update public.giving_campaigns set status = 'published'
 where id = '42000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'giving_campaign_published') = 3,
  'audience fan-out must create exactly three notifications'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.notifications
     where kind = 'giving_campaign_published'
       and profile_id in (
         '41000000-0000-0000-0000-000000000004',
         '41000000-0000-0000-0000-000000000005'
       )
  ),
  'pending/declined exclusion failed'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications
    where kind = 'giving_campaign_published'
      and title = 'New Giving campaign'
      and body = 'ITC published “Winter Relief”.'
      and profile_id in (
        '41000000-0000-0000-0000-000000000001',
        '41000000-0000-0000-0000-000000000002',
        '41000000-0000-0000-0000-000000000003'
      )) = 3,
  'publication audience or exact copy is incorrect'
);
select pg_temp.assert_true(
  (select published_at is not null and closed_at is null
     from public.giving_campaigns where id = '42000000-0000-0000-0000-000000000001'),
  'publication timestamps are inconsistent'
);

-- Member RLS: approved members see Published only and cannot mutate it.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
select pg_temp.assert_true(
  (select count(*) from public.giving_campaigns) = 1,
  'member RLS must expose the Published campaign'
);
do $$
declare changed integer;
begin
  update public.giving_campaigns set title = 'Member forgery'
   where id = '42000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'member update unexpectedly succeeded';
  end if;
end;
$$;
reset role;

-- Pending RLS (and declined) admits no rows.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select count(*) from public.giving_campaigns) = 0,
  'pending RLS must expose no campaigns'
);
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000005', true);
select pg_temp.assert_true(
  (select count(*) from public.giving_campaigns) = 0,
  'declined RLS must expose no campaigns'
);
reset role;

-- Published descriptive edits are allowed but duplicate suppression keeps the
-- first-publication fan-out at one event per recipient.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
update public.giving_campaigns set title = 'Winter Relief 2027'
 where id = '42000000-0000-0000-0000-000000000001';
update public.giving_campaigns set status = 'published'
 where id = '42000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'giving_campaign_published') = 3,
  'duplicate suppression failed on Published edits'
);

-- The one-open invariant rejects a Draft while a Published campaign exists.
do $$
begin
  begin
    insert into public.giving_campaigns (
      id, title, description, goal_hkd, fps_id, fps_payee, creator_profile_id
    ) values (
      '42000000-0000-0000-0000-000000000002', 'Competing draft', 'Must fail.',
      1, '1', 'ITC', '41000000-0000-0000-0000-000000000002'
    );
    raise exception 'second open campaign unexpectedly succeeded';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Close is timestamped. Closed immutability and no republish reject every
-- Closed -> Closed business/identity/timestamp edit and Closed -> Published
-- transition; only trigger-managed updated_at behavior is exempt.
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
update public.giving_campaigns set status = 'closed'
 where id = '42000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.assert_true(
  (select published_at is not null and closed_at is not null
     from public.giving_campaigns where id = '42000000-0000-0000-0000-000000000001'),
  'close timestamps are inconsistent'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
do $$
begin
  begin
    update public.giving_campaigns set title = 'Changed after close'
     where id = '42000000-0000-0000-0000-000000000001';
    raise exception 'closed immutability unexpectedly allowed an edit';
  exception when check_violation then
    null;
  end;
  begin
    update public.giving_campaigns set created_at = created_at - interval '1 day'
     where id = '42000000-0000-0000-0000-000000000001';
    raise exception 'closed immutability unexpectedly allowed created_at mutation';
  exception when check_violation then
    null;
  end;
  begin
    update public.giving_campaigns set id = '42000000-0000-0000-0000-000000000099'
     where id = '42000000-0000-0000-0000-000000000001';
    raise exception 'closed immutability unexpectedly allowed id mutation';
  exception when check_violation then
    null;
  end;
  begin
    update public.giving_campaigns set status = 'published'
     where id = '42000000-0000-0000-0000-000000000001';
    raise exception 'closed campaign unexpectedly republished';
  exception when check_violation then
    null;
  end;
end;
$$;
reset role;

-- The INSERT-Published first-publish guard also fans out once. Once that row
-- closes, the one-open invariant permits a new Draft.
insert into public.giving_campaigns (
  id, title, description, goal_hkd, fps_id, fps_payee, status, creator_profile_id
) values (
  '42000000-0000-0000-0000-000000000003', 'Direct appeal', 'Published atomically.',
  5000, '7654321', 'Island Training Club', 'published',
  '41000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications
    where kind = 'giving_campaign_published'
      and title = 'New Giving campaign'
      and body = 'ITC published “Direct appeal”.') = 3,
  'insert-Published first-publish fan-out failed'
);
update public.giving_campaigns set status = 'closed'
 where id = '42000000-0000-0000-0000-000000000003';
insert into public.giving_campaigns (
  id, title, description, goal_hkd, fps_id, fps_payee, creator_profile_id
) values (
  '42000000-0000-0000-0000-000000000004', 'Next draft', 'Allowed after closure.',
  10000, '2222222', 'Island Training Club',
  '41000000-0000-0000-0000-000000000001'
);
select pg_temp.assert_true(
  (select count(*) from public.giving_campaigns where status in ('draft', 'published')) = 1,
  'one-open invariant must permit exactly one new Draft after closure'
);

rollback;
\echo 'Giving campaign database integration verification passed.'
