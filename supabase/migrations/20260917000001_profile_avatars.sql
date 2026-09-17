-- Island Training Club — secure private profile avatars.
-- Browser clients have no direct table or Storage mutation path. Authenticated
-- Edge Functions use service-only transition RPCs and the private bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.profile_avatars (
  profile_id          uuid primary key references public.profiles(id) on delete cascade,
  google_object_path  text,
  active_object_path  text,
  pending_object_path text,
  state               text not null default 'active'
                        check (state in ('active', 'hidden', 'pending_review')),
  moderated_by        uuid references public.profiles(id) on delete set null,
  moderation_reason   text,
  moderated_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (state <> 'pending_review' or pending_object_path is not null),
  check (state <> 'hidden' or nullif(btrim(moderation_reason), '') is not null)
);

create table public.profile_avatar_audit (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null check (
               action in (
                 'upload_attempt', 'upload', 'remove', 'google_import',
                 'hide', 'submit_review', 'approve', 'reject'
               )
             ),
  reason     text,
  created_at timestamptz not null default now()
);

create index profile_avatar_audit_profile_created
  on public.profile_avatar_audit (profile_id, created_at desc);

create trigger profile_avatars_touch_updated_at
  before update on public.profile_avatars
  for each row execute function public.touch_updated_at();

alter table public.profile_avatars enable row level security;
alter table public.profile_avatar_audit enable row level security;

revoke all on table public.profile_avatars from public, anon, authenticated;
revoke all on table public.profile_avatar_audit from public, anon, authenticated;
revoke all on sequence public.profile_avatar_audit_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_avatars to service_role;
grant select, insert on table public.profile_avatar_audit to service_role;
grant usage, select on sequence public.profile_avatar_audit_id_seq to service_role;

create function public.avatar_prevent_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Profile avatar audit rows are immutable.' using errcode = '42501';
end;
$$;

create trigger profile_avatar_audit_immutable
  before update or delete on public.profile_avatar_audit
  for each row execute function public.avatar_prevent_audit_mutation();

create function public.avatar_assert_approved_self(
  p_profile_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_profile_id is null or p_actor_id is null or p_profile_id <> p_actor_id then
    raise exception 'Avatar action must target the authenticated profile.'
      using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_actor_id;
  if v_role is null or v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
end;
$$;

create function public.avatar_assert_admin(p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = p_actor_id;
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;
end;
$$;

create function public.avatar_assert_object_path(
  p_profile_id uuid,
  p_kind text,
  p_object_path text
)
returns void
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_pattern text;
begin
  if p_kind not in ('google', 'custom', 'pending') then
    raise exception 'Invalid avatar object kind.' using errcode = '22023';
  end if;
  v_pattern := '^' || p_profile_id::text || '/' || p_kind
    || '-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]jpg$';
  if p_object_path is null or p_object_path !~ v_pattern then
    raise exception 'Invalid avatar object path.' using errcode = '22023';
  end if;
end;
$$;

create function public.avatar_record_upload_attempt(
  p_profile_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
begin
  perform public.avatar_assert_approved_self(p_profile_id, p_actor_id);
  perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text, 917));

  select count(*) into v_attempts
    from public.profile_avatar_audit
   where profile_id = p_profile_id
     and action = 'upload_attempt'
     and created_at > now() - interval '1 hour';

  insert into public.profile_avatar_audit (profile_id, actor_id, action)
  values (p_profile_id, p_actor_id, 'upload_attempt');

  return v_attempts < 10;
end;
$$;

create function public.avatar_set_google(
  p_profile_id uuid,
  p_actor_id uuid,
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar public.profile_avatars;
  v_previous_path text;
begin
  perform public.avatar_assert_approved_self(p_profile_id, p_actor_id);
  perform public.avatar_assert_object_path(p_profile_id, 'google', p_object_path);

  insert into public.profile_avatars (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select google_object_path into v_previous_path
    from public.profile_avatars where profile_id = p_profile_id for update;

  update public.profile_avatars
     set google_object_path = p_object_path
   where profile_id = p_profile_id
  returning * into v_avatar;

  insert into public.profile_avatar_audit (profile_id, actor_id, action)
  values (p_profile_id, p_actor_id, 'google_import');
  return jsonb_build_object(
    'avatar', to_jsonb(v_avatar),
    'replaced_object_paths', to_jsonb(array_remove(array[v_previous_path], null))
  );
end;
$$;

create function public.avatar_activate_custom(
  p_profile_id uuid,
  p_actor_id uuid,
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_state text;
  v_previous_path text;
  v_avatar public.profile_avatars;
begin
  perform public.avatar_assert_approved_self(p_profile_id, p_actor_id);
  perform public.avatar_assert_object_path(p_profile_id, 'custom', p_object_path);

  insert into public.profile_avatars (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select state, active_object_path into v_existing_state, v_previous_path
    from public.profile_avatars
   where profile_id = p_profile_id for update;
  if v_existing_state in ('hidden', 'pending_review') then
    raise exception 'Moderated profiles must submit replacements for review.'
      using errcode = '23514';
  end if;

  update public.profile_avatars
     set active_object_path = p_object_path,
         pending_object_path = null,
         state = 'active',
         moderated_by = null,
         moderation_reason = null,
         moderated_at = null
   where profile_id = p_profile_id
  returning * into v_avatar;

  insert into public.profile_avatar_audit (profile_id, actor_id, action)
  values (p_profile_id, p_actor_id, 'upload');
  return jsonb_build_object(
    'avatar', to_jsonb(v_avatar),
    'replaced_object_paths', to_jsonb(array_remove(array[v_previous_path], null))
  );
end;
$$;

create function public.avatar_remove_custom(
  p_profile_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar public.profile_avatars;
  v_previous_paths text[];
begin
  perform public.avatar_assert_approved_self(p_profile_id, p_actor_id);

  insert into public.profile_avatars (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select array_remove(array[active_object_path, pending_object_path], null)
    into v_previous_paths
    from public.profile_avatars where profile_id = p_profile_id for update;

  update public.profile_avatars
     set active_object_path = null,
         pending_object_path = null,
         state = case when state = 'active' then 'active' else 'hidden' end
   where profile_id = p_profile_id
  returning * into v_avatar;

  insert into public.profile_avatar_audit (profile_id, actor_id, action)
  values (p_profile_id, p_actor_id, 'remove');
  return jsonb_build_object(
    'avatar', to_jsonb(v_avatar),
    'replaced_object_paths', to_jsonb(coalesce(v_previous_paths, array[]::text[]))
  );
end;
$$;

create function public.avatar_hide(
  p_profile_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns public.profile_avatars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar public.profile_avatars;
begin
  perform public.avatar_assert_admin(p_actor_id);
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A moderation reason is required.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.profile_avatars (
    profile_id, state, moderated_by, moderation_reason, moderated_at
  ) values (
    p_profile_id, 'hidden', p_actor_id, btrim(p_reason), now()
  )
  on conflict (profile_id) do update
    set pending_object_path = null,
        state = 'hidden',
        moderated_by = excluded.moderated_by,
        moderation_reason = excluded.moderation_reason,
        moderated_at = excluded.moderated_at
  returning * into v_avatar;

  insert into public.profile_avatar_audit (profile_id, actor_id, action, reason)
  values (p_profile_id, p_actor_id, 'hide', btrim(p_reason));
  return v_avatar;
end;
$$;

create function public.avatar_submit_review(
  p_profile_id uuid,
  p_actor_id uuid,
  p_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar public.profile_avatars;
  v_previous_path text;
begin
  perform public.avatar_assert_approved_self(p_profile_id, p_actor_id);
  perform public.avatar_assert_object_path(p_profile_id, 'pending', p_object_path);

  select pending_object_path into v_previous_path
    from public.profile_avatars where profile_id = p_profile_id for update;

  update public.profile_avatars
     set pending_object_path = p_object_path,
         state = 'pending_review'
   where profile_id = p_profile_id
     and state in ('hidden', 'pending_review')
  returning * into v_avatar;
  if not found then
    raise exception 'Profile photo is not in moderated state.' using errcode = '23514';
  end if;

  insert into public.profile_avatar_audit (profile_id, actor_id, action)
  values (p_profile_id, p_actor_id, 'submit_review');
  return jsonb_build_object(
    'avatar', to_jsonb(v_avatar),
    'replaced_object_paths', to_jsonb(array_remove(array[v_previous_path], null))
  );
end;
$$;

create function public.avatar_decide_review(
  p_profile_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_reason text
)
returns public.profile_avatars
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avatar public.profile_avatars;
begin
  perform public.avatar_assert_admin(p_actor_id);
  if p_decision not in ('approve', 'reject') then
    raise exception 'Review decision must be approve or reject.' using errcode = '22023';
  end if;
  if p_decision = 'reject' and nullif(btrim(p_reason), '') is null then
    raise exception 'A rejection reason is required.' using errcode = '23514';
  end if;

  if p_decision = 'approve' then
    update public.profile_avatars
       set active_object_path = pending_object_path,
           pending_object_path = null,
           state = 'active',
           moderated_by = null,
           moderation_reason = null,
           moderated_at = null
     where profile_id = p_profile_id and state = 'pending_review'
    returning * into v_avatar;
  else
    update public.profile_avatars
       set pending_object_path = null,
           state = 'hidden',
           moderated_by = p_actor_id,
           moderation_reason = btrim(p_reason),
           moderated_at = now()
     where profile_id = p_profile_id and state = 'pending_review'
    returning * into v_avatar;
  end if;
  if not found then
    raise exception 'No pending profile photo review.' using errcode = '23514';
  end if;

  insert into public.profile_avatar_audit (profile_id, actor_id, action, reason)
  values (
    p_profile_id,
    p_actor_id,
    case when p_decision = 'approve' then 'approve' else 'reject' end,
    nullif(btrim(p_reason), '')
  );
  return v_avatar;
end;
$$;

revoke all on function public.avatar_prevent_audit_mutation() from public, anon, authenticated;
revoke all on function public.avatar_assert_approved_self(uuid, uuid) from public, anon, authenticated;
revoke all on function public.avatar_assert_admin(uuid) from public, anon, authenticated;
revoke all on function public.avatar_assert_object_path(uuid, text, text) from public, anon, authenticated;
revoke all on function public.avatar_record_upload_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.avatar_set_google(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.avatar_activate_custom(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.avatar_remove_custom(uuid, uuid) from public, anon, authenticated;
revoke all on function public.avatar_hide(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.avatar_submit_review(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.avatar_decide_review(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.avatar_record_upload_attempt(uuid, uuid) to service_role;
grant execute on function public.avatar_set_google(uuid, uuid, text) to service_role;
grant execute on function public.avatar_activate_custom(uuid, uuid, text) to service_role;
grant execute on function public.avatar_remove_custom(uuid, uuid) to service_role;
grant execute on function public.avatar_hide(uuid, uuid, text) to service_role;
grant execute on function public.avatar_submit_review(uuid, uuid, text) to service_role;
grant execute on function public.avatar_decide_review(uuid, uuid, text, text) to service_role;
