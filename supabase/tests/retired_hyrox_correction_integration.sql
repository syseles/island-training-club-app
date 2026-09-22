-- Expanded by verify_retired_hyrox_correction.py; disposable local DB only.
-- Drift, migration, fixtures, default ACLs and tests all roll back together.
\set ON_ERROR_STOP on
begin;
create temporary table correction_failures (message text);
grant insert, select on correction_failures to anon, authenticated, service_role;
create function pg_temp.correction_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    insert into correction_failures values (message);
    raise warning 'FAIL: %', message;
  end if;
end;
$$;

-- Model the reported postgres/public function defaults, and prove a newly
-- created helper receives the unintended grants. Do not globally fix defaults.
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
create function public.correction_default_acl_probe() returns boolean
language sql as $$ select true; $$;
select pg_temp.correction_assert(
  has_function_privilege('anon', 'public.correction_default_acl_probe()', 'execute')
  and has_function_privilege('authenticated', 'public.correction_default_acl_probe()', 'execute')
  and has_function_privilege('service_role', 'public.correction_default_acl_probe()', 'execute'),
  'production default function ACL drift reproduced');
-- Existing objects retain ACLs on CREATE OR REPLACE, so install the observed
-- service grants explicitly as well as the default privilege mechanism.
grant execute on function public.operational_is_retired_hyrox_activity(text),
  public.operational_is_retired_hyrox_booking(uuid),
  public.operational_is_retired_hyrox_session(text),
  public.operational_notification_is_retired_hyrox(text,text,timestamptz,text,text),
  private.operational_booking_is_active(uuid),
  private.operational_session_is_active(text),
  private.operational_notification_is_active(text,text,timestamptz,text,text)
  to service_role;
-- RESTORE PRODUCTION ATTENDEE BODY
grant execute on function public.get_operational_attendee_names_pre_pool_retirement_20260922(text)
  to service_role;
grant all on table public.notifications to anon, authenticated;
-- Table revokes alone do not remove independently granted column privileges.
grant update (title, body, read_at), insert (title), references (id)
  on public.notifications to anon, authenticated;

create temporary table correction_before as
select (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
         where schemaname = 'public' and tablename = 'notifications') as policies,
       (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d) as defaults,
       (select md5(coalesce(jsonb_agg(to_jsonb(n) order by id)::text, ''))
          from public.notifications n) as notifications,
       pg_get_functiondef('public.get_operational_attendee_names(text)'::regprocedure) as wrapper;

-- APPLY FORWARD CORRECTION

select pg_temp.correction_assert(
  policies = (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p
               where schemaname = 'public' and tablename = 'notifications')
  and defaults = (select jsonb_agg(to_jsonb(d) order by oid) from pg_default_acl d)
  and notifications = (select md5(coalesce(jsonb_agg(to_jsonb(n) order by id)::text, ''))
                          from public.notifications n)
  and wrapper = pg_get_functiondef('public.get_operational_attendee_names(text)'::regprocedure),
  'correction preserves reviewed RLS, global defaults, notification rows and guarded wrapper')
from correction_before;

-- Catalog privilege predicates only: NEVER execute TRUNCATE or forbidden DML.
do $$
declare r text; privilege text; col record; signature text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      perform pg_temp.correction_assert(
        has_table_privilege(r, 'public.notifications', privilege)
          = (r = 'authenticated' and privilege = 'SELECT'),
        r || ' exact notification table grant: ' || privilege);
    end loop;
    for col in select attname from pg_attribute
      where attrelid = 'public.notifications'::regclass and attnum > 0 and not attisdropped loop
      foreach privilege in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
        perform pg_temp.correction_assert(
          has_column_privilege(r, 'public.notifications', col.attname, privilege)
            = (r = 'authenticated' and (privilege = 'SELECT'
                 or (privilege = 'UPDATE' and col.attname = 'read_at'))),
          r || ' exact notification column grant: ' || col.attname || '/' || privilege);
      end loop;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach signature in array array[
      'public.operational_is_retired_hyrox_activity(text)',
      'public.operational_is_retired_hyrox_session(text)',
      'public.operational_is_retired_hyrox_booking(uuid)',
      'public.operational_notification_is_retired_hyrox(text,text,timestamptz,text,text)',
      'public.get_operational_attendee_names_pre_pool_retirement_20260922(text)'
    ] loop
      perform pg_temp.correction_assert(has_function_privilege(r, signature, 'execute')
        = (r = 'service_role' and signature = 'public.operational_is_retired_hyrox_session(text)'),
        r || ' exact helper grant: ' || signature);
    end loop;
  end loop;
  foreach signature in array array[
    'private.operational_booking_is_active(uuid)',
    'private.operational_session_is_active(text)',
    'private.operational_notification_is_active(text,text,timestamptz,text,text)'
  ] loop
    perform pg_temp.correction_assert(not has_function_privilege('service_role', signature, 'execute'),
      'no service-role policy adapter grant: ' || signature);
    perform pg_temp.correction_assert(has_function_privilege('authenticated', signature, 'execute'),
      'authenticated policy adapter retained: ' || signature);
    perform pg_temp.correction_assert(has_function_privilege('anon', signature, 'execute')
      = (signature not like '%notification%'), 'anon policy adapter boundary: ' || signature);
  end loop;
end;
$$;
select pg_temp.correction_assert(
  md5(prosrc) = '64c519f7652df631b654191575a51680'
  and prosecdef and provolatile = 's' and proconfig = array['search_path=public']
  and pg_get_userbyid(proowner) = 'postgres'
  and not exists (select 1 from aclexplode(proacl) where grantee = 0),
  'exact latest RSVP roster body, fixed definer metadata, postgres owner and no PUBLIC grant')
from pg_proc where oid = 'public.get_operational_attendee_names_pre_pool_retirement_20260922(text)'::regprocedure;
select pg_temp.correction_assert(
  has_function_privilege('authenticated', 'public.get_operational_attendee_names(text)', 'execute')
  and not has_function_privilege('anon', 'public.get_operational_attendee_names(text)', 'execute'),
  'public guarded roster ACL preserved');

insert into auth.users (id, email, raw_user_meta_data) values
 ('a2220000-0000-0000-0000-000000000001', 'correction-one@itc.invalid', '{}'),
 ('a2220000-0000-0000-0000-000000000002', 'correction-two@itc.invalid', '{}'),
 ('a2220000-0000-0000-0000-000000000003', 'correction-three@itc.invalid', '{}');
update public.profiles set role = 'member', full_name = case right(id::text, 1)
  when '1' then 'Payer' when '2' then 'Replacement' else 'Paid attendee' end
 where id::text like 'a2220000-%';
insert into public.operational_sessions
 (id, activity_id, session_date, start_time, duration_minutes, venue, capacity, price_hkd, is_open)
select activity_id || '-2098-01-04', activity_id, '2098-01-04', start_time,
 duration_minutes, venue, capacity, price_hkd, true
from public.operational_activity_templates
where activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay', 'wnt');
insert into public.operational_bookings
 (profile_id, session_id, status, pay_deadline_at, snapshot)
select 'a2220000-0000-0000-0000-000000000001', id, 'confirmed', now(), '{}'
from public.operational_sessions where session_date = '2098-01-04';
update public.operational_bookings
 set replacement_profile_id = 'a2220000-0000-0000-0000-000000000002',
 replacement_confirmed_at = now(), replacement_confirmed_by = 'a2220000-0000-0000-0000-000000000003'
where session_id = 'hyrox-quarry-bay-2098-01-04';
insert into public.operational_bookings (profile_id, session_id, status, pay_deadline_at, snapshot)
values ('a2220000-0000-0000-0000-000000000003', 'hyrox-quarry-bay-2098-01-04', 'confirmed', now(), '{}');
insert into public.notifications (id, profile_id, kind, title, body, destination) values
 ('a2220000-0000-0000-0000-000000000011', 'a2220000-0000-0000-0000-000000000001', 'welcome', 'Own', 'Fixture', '#/profile'),
 ('a2220000-0000-0000-0000-000000000012', 'a2220000-0000-0000-0000-000000000002', 'welcome', 'Other', 'Fixture', '#/profile'),
 ('a2220000-0000-0000-0000-000000000013', 'a2220000-0000-0000-0000-000000000001', 'operational_hyrox_reserved', 'Retired', 'Fixture', '#/activity/hyrox-bft-2098-01-04');

set local role service_role;
select pg_temp.correction_assert(
 public.operational_is_retired_hyrox_session('hyrox-bft-2098-01-04')
 and public.operational_is_retired_hyrox_session('hyrox-midtown-2098-01-04')
 and not public.operational_is_retired_hyrox_session('hyrox-quarry-bay-2098-01-04'),
 'service classifier still works via owner-only activity helper');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2220000-0000-0000-0000-000000000001', true);
select pg_temp.correction_assert(
 (select array_agg(display_name order by display_name) from public.get_operational_attendee_names('hyrox-quarry-bay-2098-01-04'))
 = array['Paid attendee', 'Replacement'], 'ECC paid/replacement attendees, not original payer');
select pg_temp.correction_assert(
 (select array_agg(display_name) from public.get_operational_attendee_names('wnt-2098-01-04'))
 = array['Payer'], 'free RSVP attendees through guarded wrapper');
select pg_temp.correction_assert(
 not exists (select 1 from public.get_operational_attendee_names('hyrox-bft-2098-01-04'))
 and not exists (select 1 from public.get_operational_attendee_names('hyrox-midtown-2098-01-04')),
 'guarded wrapper hides both retired rosters');
select pg_temp.correction_assert(
 (select count(*) from public.notifications where id::text like 'a2220000-%') = 1,
 'member reads only own active notification');
update public.notifications set read_at = now() where id::text like 'a2220000-%';
reset role;
select pg_temp.correction_assert(
 (select count(*) from public.notifications where id::text like 'a2220000-%' and read_at is not null) = 1
 and (select read_at is not null from public.notifications where id = 'a2220000-0000-0000-0000-000000000011'),
 'member mark-read works; other recipient and retired rows unchanged');
-- Pending callers still cannot obtain the restored free roster.
update public.profiles set role = 'pending' where id = 'a2220000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
  begin
    perform public.get_operational_attendee_names('wnt-2098-01-04');
    perform pg_temp.correction_assert(false, 'pending roster must deny');
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.notifications limit 1;
    perform pg_temp.correction_assert(false, 'anon notification SELECT must deny');
  exception when insufficient_privilege then null;
  end;
end; $$;
reset role;
do $$ begin
  if exists (select 1 from correction_failures) then
    raise exception 'forward correction failed: % assertions', (select count(*) from correction_failures);
  end if;
  raise notice 'OK: production drift correction, exact grants, rosters and notification boundary';
end; $$;
rollback;
