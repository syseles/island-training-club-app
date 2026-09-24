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
  ('43000000-0000-0000-0000-000000000001', 'ann-super@itc.invalid', '{}'::jsonb),
  ('43000000-0000-0000-0000-000000000002', 'ann-admin@itc.invalid', '{}'::jsonb),
  ('43000000-0000-0000-0000-000000000003', 'ann-other-admin@itc.invalid', '{}'::jsonb),
  ('43000000-0000-0000-0000-000000000004', 'ann-member-on@itc.invalid', '{}'::jsonb),
  ('43000000-0000-0000-0000-000000000005', 'ann-member-off@itc.invalid', '{}'::jsonb),
  ('43000000-0000-0000-0000-000000000006', 'ann-pending@itc.invalid', '{}'::jsonb);

select pg_temp.assert_true(
  (select count(*) = 6 and bool_and(role = 'pending') from public.profiles),
  'every auth-created profile must bootstrap pending'
);

update public.profiles set full_name = 'Ann Super', role = 'super_admin'
 where id = '43000000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Ann Actor Admin', role = 'admin'
 where id = '43000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Ann Other Admin', role = 'admin'
 where id = '43000000-0000-0000-0000-000000000003';
update public.profiles set full_name = 'Ann Member On', role = 'member'
 where id = '43000000-0000-0000-0000-000000000004';
update public.profiles set full_name = 'Ann Member Off', role = 'member'
 where id = '43000000-0000-0000-0000-000000000005';
update public.profiles set full_name = 'Ann Pending', role = 'pending'
 where id = '43000000-0000-0000-0000-000000000006';

insert into public.applications (profile_id, mobile, is_minor, privacy_accepted_at, community_news)
values
  ('43000000-0000-0000-0000-000000000004', '+852 6000 0004', false, now(), true),
  ('43000000-0000-0000-0000-000000000005', '+852 6000 0005', false, now(), false);

truncate public.notifications, public.role_changes;

select pg_temp.assert_true(
  to_regclass('public.community_announcements') is not null,
  'migration application did not create community_announcements'
);
select pg_temp.assert_true(
  has_table_privilege('authenticated', 'public.community_announcements', 'SELECT')
  and has_table_privilege('authenticated', 'public.community_announcements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.community_announcements', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.community_announcements', 'DELETE')
  and not has_table_privilege('anon', 'public.community_announcements', 'SELECT'),
  'community announcement browser privileges must omit visitor access, UPDATE, and DELETE'
);
select pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.publish_community_announcement(text,text,text)',
    'execute'
  ),
  'authenticated must execute publish_community_announcement'
);

-- Publish via RPC as the acting admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '43000000-0000-0000-0000-000000000002', true);
select public.publish_community_announcement(
  'Saturday social',
  E'Bring **shoes**\n\n- water\n- smile',
  'https://example.test/photo.webp'
);
reset role;

select pg_temp.assert_true(
  (select count(*) from public.community_announcements) = 1,
  'publish RPC must insert one published row'
);

select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'community_announcement_published') = 2,
  'shared fan-out must reach opted-in member and acting admin only'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.notifications
     where kind = 'community_announcement_published'
       and profile_id in (
         '43000000-0000-0000-0000-000000000005',
         '43000000-0000-0000-0000-000000000006'
       )
  ),
  'opted-out member and pending profile must not receive shared notifications'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications
    where kind = 'community_announcement_published'
      and title = 'Saturday social'
      and body = 'Saturday social — Bring shoes water smile'
      and destination = '#/community/announcements'
      and profile_id in (
        '43000000-0000-0000-0000-000000000002',
        '43000000-0000-0000-0000-000000000004'
      )) = 2,
  'shared copy and destination are incorrect'
);

select pg_temp.assert_true(
  (select count(*) from public.notifications where kind = 'community_announcement_audit') = 2,
  'audit fan-out must reach other admins only'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.notifications
     where kind = 'community_announcement_audit'
       and profile_id = '43000000-0000-0000-0000-000000000002'
  ),
  'acting admin must not receive audit notification'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications
    where kind = 'community_announcement_audit'
      and title = 'Announcement published'
      and body = 'Ann Actor Admin published “Saturday social”.'
      and destination = '#/community/announcements'
      and profile_id = '43000000-0000-0000-0000-000000000003') = 1,
  'other admin audit copy is incorrect'
);
select pg_temp.assert_true(
  (select count(*) from public.notifications
    where kind = 'community_announcement_audit'
      and body = 'Ann Actor Admin published “Saturday social”.'
      and profile_id = '43000000-0000-0000-0000-000000000001') = 1,
  'super admin audit copy is incorrect'
);

-- Approved members can read published announcements; pending cannot.
set local role authenticated;
select set_config('request.jwt.claim.sub', '43000000-0000-0000-0000-000000000004', true);
select pg_temp.assert_true(
  (select count(*) from public.community_announcements) = 1,
  'member RLS must expose published announcements'
);
select set_config('request.jwt.claim.sub', '43000000-0000-0000-0000-000000000006', true);
select pg_temp.assert_true(
  (select count(*) from public.community_announcements) = 0,
  'pending RLS must expose no announcements'
);
reset role;

rollback;
\echo 'Community announcement database integration verification passed.'
