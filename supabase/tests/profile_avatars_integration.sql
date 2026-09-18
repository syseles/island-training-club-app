-- Private profile-avatar schema, privilege, transition, and audit checks.
-- Run only through verify_profile_avatars.sh on an acknowledged disposable DB.
\set ON_ERROR_STOP on

create function pg_temp.avatar_assert(ok boolean, message text)
returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then
    raise exception 'profile-avatar verification failed: %', message;
  end if;
end;
$$;

-- Schema, bucket, RLS, and function privilege foundations.
do $$
declare
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
begin
  perform pg_temp.avatar_assert(
    to_regclass('public.profile_avatars') is not null,
    'profile_avatars table missing'
  );
  perform pg_temp.avatar_assert(
    to_regclass('public.profile_avatar_audit') is not null,
    'profile_avatar_audit table missing'
  );

  select public, file_size_limit, allowed_mime_types
    into v_public, v_limit, v_mimes
    from storage.buckets where id = 'profile-avatars';
  perform pg_temp.avatar_assert(found, 'profile-avatars bucket missing');
  perform pg_temp.avatar_assert(v_public is false, 'bucket must be private');
  perform pg_temp.avatar_assert(v_limit = 2097152, 'bucket limit must be 2 MB');
  perform pg_temp.avatar_assert(v_mimes = array['image/jpeg']::text[], 'bucket must accept JPEG only');

  perform pg_temp.avatar_assert(
    (select relrowsecurity from pg_class where oid = 'public.profile_avatars'::regclass),
    'profile_avatars RLS disabled'
  );
  perform pg_temp.avatar_assert(
    (select relrowsecurity from pg_class where oid = 'public.profile_avatar_audit'::regclass),
    'profile_avatar_audit RLS disabled'
  );
  perform pg_temp.avatar_assert(
    not has_table_privilege('authenticated', 'public.profile_avatars', 'INSERT,UPDATE,DELETE'),
    'authenticated has avatar mutation privileges'
  );
  perform pg_temp.avatar_assert(
    not has_table_privilege('authenticated', 'public.profile_avatar_audit', 'INSERT,UPDATE,DELETE'),
    'authenticated has audit mutation privileges'
  );
  perform pg_temp.avatar_assert(
    has_function_privilege('service_role', 'public.avatar_record_upload_attempt(uuid,uuid)', 'execute'),
    'service_role cannot record attempts'
  );
  perform pg_temp.avatar_assert(
    not has_function_privilege('authenticated', 'public.avatar_record_upload_attempt(uuid,uuid)', 'execute'),
    'authenticated can record attempts'
  );
  perform pg_temp.avatar_assert(
    has_function_privilege('service_role', 'public.avatar_activate_custom(uuid,uuid,text)', 'execute'),
    'service_role cannot activate custom avatar'
  );
  perform pg_temp.avatar_assert(
    not has_function_privilege('authenticated', 'public.avatar_activate_custom(uuid,uuid,text)', 'execute'),
    'authenticated can activate custom avatar'
  );
end $$;

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-0000-0000-000000000001', 'avatar-admin@itc.invalid', '{}'::jsonb),
  ('22000000-0000-0000-0000-000000000002', 'avatar-member@itc.invalid', '{}'::jsonb),
  ('33000000-0000-0000-0000-000000000003', 'avatar-pending@itc.invalid', '{}'::jsonb);
update public.profiles set full_name = 'Avatar Admin', role = 'admin'
 where id = '11000000-0000-0000-0000-000000000001';
update public.profiles set full_name = 'Avatar Member', role = 'member'
 where id = '22000000-0000-0000-0000-000000000002';
update public.profiles set full_name = 'Avatar Pending', role = 'pending'
 where id = '33000000-0000-0000-0000-000000000003';

insert into public.profile_avatar_audit (profile_id, actor_id, action)
values (
  '11000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'upload_attempt'
);
insert into storage.objects (bucket_id, name, owner)
values (
  'profile-avatars',
  '22000000-0000-0000-0000-000000000002/seed.jpg',
  '22000000-0000-0000-0000-000000000002'
);

-- Authenticated callers cannot mutate either metadata table or this bucket.
do $$
begin
  perform set_config('request.jwt.claim.sub', '22000000-0000-0000-0000-000000000002', true);
  set local role authenticated;

  begin
    insert into public.profile_avatars (profile_id)
    values ('22000000-0000-0000-0000-000000000002');
    raise exception 'authenticated direct avatar insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profile_avatars set state = 'active'
     where profile_id = '22000000-0000-0000-0000-000000000002';
    raise exception 'authenticated direct avatar update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.profile_avatars
     where profile_id = '22000000-0000-0000-0000-000000000002';
    raise exception 'authenticated direct avatar delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.profile_avatar_audit (profile_id, actor_id, action)
    values (
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000002',
      'upload_attempt'
    );
    raise exception 'authenticated direct audit insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profile_avatar_audit set reason = 'browser tamper'
     where profile_id = '11000000-0000-0000-0000-000000000001';
    raise exception 'authenticated direct audit update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.profile_avatar_audit
     where profile_id = '11000000-0000-0000-0000-000000000001';
    raise exception 'authenticated direct audit delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name, owner)
    values (
      'profile-avatars',
      '22000000-0000-0000-0000-000000000002/direct.jpg',
      '22000000-0000-0000-0000-000000000002'
    );
    raise exception 'authenticated direct storage insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    update storage.objects set name = 'browser-tamper.jpg'
     where bucket_id = 'profile-avatars';
    raise exception 'authenticated direct storage update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from storage.objects where bucket_id = 'profile-avatars';
    raise exception 'authenticated direct storage delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  reset role;
end $$;

-- Authorization helpers reject absent actors before any state transition.
do $$
begin
  begin
    perform public.avatar_hide(
      '22000000-0000-0000-0000-000000000002',
      '44000000-0000-0000-0000-000000000004',
      'Invalid actor test'
    );
    raise exception 'missing moderator unexpectedly succeeded';
  exception when insufficient_privilege then
    if sqlerrm not like '%Administrator access required%' then raise; end if;
  end;
end $$;

-- Atomic rolling-hour rate limit records all attempts and permits ten.
do $$
declare
  i integer;
  allowed boolean;
begin
  for i in 1..10 loop
    select public.avatar_record_upload_attempt(
      '22000000-0000-0000-0000-000000000002',
      '22000000-0000-0000-0000-000000000002'
    ) into allowed;
    perform pg_temp.avatar_assert(allowed, 'one of first ten attempts was rejected');
  end loop;
  select public.avatar_record_upload_attempt(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002'
  ) into allowed;
  perform pg_temp.avatar_assert(not allowed, 'eleventh attempt was allowed');
end $$;

-- Complete state machine and append-only audit behavior.
do $$
declare
  row_state text;
  active_path text;
  pending_path text;
  audit_before bigint;
  transition_result jsonb;
begin
  perform public.avatar_set_google(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002/google-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'
  );
  perform public.avatar_activate_custom(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002/custom-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'
  );
  select state, active_object_path into row_state, active_path
    from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(
    row_state = 'active' and active_path like '%/custom-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg',
    'no-row to active-custom transition failed'
  );

  select public.avatar_remove_custom(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002'
  ) into transition_result;
  perform pg_temp.avatar_assert(
    transition_result->'replaced_object_paths' = jsonb_build_array(
      '22000000-0000-0000-0000-000000000002/custom-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'
    ),
    'remove transition did not return its locked replaced path'
  );
  select active_object_path into active_path from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(active_path is null, 'custom removal failed');

  perform public.avatar_activate_custom(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002/custom-cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg'
  );
  perform public.avatar_hide(
    '22000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'Inappropriate image'
  );
  select state into row_state from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(row_state = 'hidden', 'hide transition failed');

  perform public.avatar_submit_review(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002/pending-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg'
  );
  select state, pending_object_path into row_state, pending_path
    from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(
    row_state = 'pending_review' and pending_path like '%/pending-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg',
    'hidden to pending-review transition failed'
  );

  perform public.avatar_decide_review(
    '22000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'approve',
    null
  );
  select state, active_object_path, pending_object_path
    into row_state, active_path, pending_path
    from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(
    row_state = 'active' and active_path like '%/pending-dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg' and pending_path is null,
    'pending-review approval failed'
  );

  perform public.avatar_hide(
    '22000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'Second moderation'
  );
  perform public.avatar_submit_review(
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002/pending-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg'
  );
  perform public.avatar_decide_review(
    '22000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    'reject',
    'Still inappropriate'
  );
  select state, pending_object_path into row_state, pending_path
    from public.profile_avatars
   where profile_id = '22000000-0000-0000-0000-000000000002';
  perform pg_temp.avatar_assert(
    row_state = 'hidden' and pending_path is null,
    'pending-review rejection failed'
  );

  begin
    perform public.avatar_hide(
      '22000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000001',
      '   '
    );
    raise exception 'blank hide reason unexpectedly succeeded';
  exception when check_violation then null;
  end;

  select count(*) into audit_before from public.profile_avatar_audit;
  begin
    update public.profile_avatar_audit set reason = 'tampered';
    raise exception 'audit update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profile_avatar_audit;
    raise exception 'audit delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.avatar_assert(
    (select count(*) from public.profile_avatar_audit) = audit_before,
    'audit row count changed after immutable operations'
  );
end $$;

rollback;

\echo 'Profile-avatar integration checks passed.'
