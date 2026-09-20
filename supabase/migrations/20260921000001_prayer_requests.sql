-- Island Training Club — private member prayer requests
--
-- Browser roles have no direct table access. Approved members and Admins use
-- five narrow security-definer RPCs that re-read the authoritative profile.

create table public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_text text,
  anonymous_to_leaders boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'prayed_for', 'closed', 'withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  withdrawn_at timestamptz,
  status_changed_by uuid references public.profiles(id) on delete set null,
  constraint prayer_request_text_state check (
    (status = 'withdrawn' and request_text is null)
    or
    (status <> 'withdrawn' and request_text is not null
      and char_length(btrim(request_text)) between 1 and 2000)
  ),
  constraint prayer_request_closed_state check (
    (status = 'closed') = (closed_at is not null)
  ),
  constraint prayer_request_withdrawn_state check (
    (status = 'withdrawn') = (withdrawn_at is not null)
  )
);

create index prayer_requests_owner_created_idx
  on public.prayer_requests (owner_id, created_at desc);
create index prayer_requests_status_created_idx
  on public.prayer_requests (status, created_at asc);

alter table public.prayer_requests enable row level security;
revoke all on table public.prayer_requests from public, anon, authenticated;

-- These helpers are deliberately private to the database owner. Public RPCs
-- call them to avoid trusting role claims from JWT metadata.
create function public.prayer_assert_approved()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  select p.role
    into v_role
    from public.profiles p
   where p.id = v_actor;

  if v_actor is null or v_role is null
      or v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

create function public.prayer_assert_admin()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  select p.role
    into v_role
    from public.profiles p
   where p.id = v_actor;

  if v_actor is null or v_role is null
      or v_role not in ('admin', 'super_admin') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

revoke all on function public.prayer_assert_approved()
  from public, anon, authenticated;
revoke all on function public.prayer_assert_admin()
  from public, anon, authenticated;

create function public.submit_prayer_request(
  p_request_text text,
  p_anonymous_to_leaders boolean
)
returns table (
  id uuid,
  request_text text,
  anonymous_to_leaders boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  withdrawn_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_request_text text;
begin
  v_actor := public.prayer_assert_approved();
  v_request_text := btrim(coalesce(p_request_text, ''));
  if char_length(v_request_text) not between 1 and 2000 then
    raise exception 'Prayer request must be between 1 and 2000 characters.'
      using errcode = '22023';
  end if;

  return query
    insert into public.prayer_requests as r
      (owner_id, request_text, anonymous_to_leaders, status_changed_by)
    values
      (v_actor, v_request_text, coalesce(p_anonymous_to_leaders, false), v_actor)
    returning r.id,
              r.request_text,
              r.anonymous_to_leaders,
              r.status,
              r.created_at,
              r.updated_at,
              r.closed_at,
              r.withdrawn_at;
end;
$$;

create function public.list_my_prayer_requests()
returns table (
  id uuid,
  request_text text,
  anonymous_to_leaders boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  withdrawn_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := public.prayer_assert_approved();

  return query
    select r.id,
           r.request_text,
           r.anonymous_to_leaders,
           r.status,
           r.created_at,
           r.updated_at,
           r.closed_at,
           r.withdrawn_at
      from public.prayer_requests r
     where r.owner_id = v_actor
     order by r.created_at desc, r.id;
end;
$$;

create function public.set_my_prayer_request_state(
  p_request_id uuid,
  p_action text
)
returns table (
  id uuid,
  request_text text,
  anonymous_to_leaders boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz,
  withdrawn_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_status text;
begin
  v_actor := public.prayer_assert_approved();

  if p_action is null or p_action not in ('close', 'withdraw') then
    raise exception 'Prayer request action must be close or withdraw.'
      using errcode = '22023';
  end if;

  select r.status
    into v_status
    from public.prayer_requests r
   where r.id = p_request_id
     and r.owner_id = v_actor
   for update;
  if not found then
    raise exception 'Prayer request not found.' using errcode = 'P0002';
  end if;

  if p_action = 'close' then
    if v_status not in ('new', 'prayed_for') then
      raise exception 'Prayer request cannot be closed from its current state.'
        using errcode = '23514';
    end if;

    update public.prayer_requests as r
       set status = 'closed',
           closed_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           status_changed_by = auth.uid()
     where r.id = p_request_id
       and r.owner_id = auth.uid()
       and r.status in ('new', 'prayed_for');
  else
    if v_status = 'withdrawn' then
      raise exception 'Prayer request is already withdrawn.'
        using errcode = '23514';
    end if;

    update public.prayer_requests as r
       set status = 'withdrawn',
           request_text = null,
           closed_at = null,
           withdrawn_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           status_changed_by = auth.uid()
     where r.id = p_request_id
       and r.owner_id = auth.uid()
       and r.status <> 'withdrawn';
  end if;

  return query
    select r.id,
           r.request_text,
           r.anonymous_to_leaders,
           r.status,
           r.created_at,
           r.updated_at,
           r.closed_at,
           r.withdrawn_at
      from public.prayer_requests r
     where r.id = p_request_id
       and r.owner_id = v_actor;
end;
$$;

create function public.list_admin_prayer_requests()
returns table (
  id uuid,
  display_name text,
  request_text text,
  anonymous_to_leaders boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.prayer_assert_admin();

  return query
    select r.id,
           case
             when r.anonymous_to_leaders then 'Anonymous member'
             else coalesce(nullif(btrim(p.full_name), ''), 'Member')
           end as display_name,
           r.request_text,
           r.anonymous_to_leaders,
           r.status,
           r.created_at,
           r.updated_at,
           r.closed_at
      from public.prayer_requests r
      join public.profiles p on p.id = r.owner_id
     where r.status <> 'withdrawn'
     order by case r.status
                when 'new' then 1
                when 'prayed_for' then 2
                when 'closed' then 3
                else 4
              end,
              case when r.status <> 'closed' then r.created_at end asc,
              case when r.status = 'closed' then r.created_at end desc,
              r.id;
end;
$$;

create function public.set_admin_prayer_request_status(
  p_request_id uuid,
  p_status text
)
returns table (
  id uuid,
  display_name text,
  request_text text,
  anonymous_to_leaders boolean,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  closed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_current_status text;
  v_changed_at timestamptz;
begin
  v_actor := public.prayer_assert_admin();

  if p_status is null or p_status not in ('prayed_for', 'closed') then
    raise exception 'Prayer request status must be prayed_for or closed.'
      using errcode = '22023';
  end if;

  select r.status
    into v_current_status
    from public.prayer_requests r
   where r.id = p_request_id
   for update;
  if not found then
    raise exception 'Prayer request not found.' using errcode = 'P0002';
  end if;

  if v_current_status in ('closed', 'withdrawn')
      or (p_status = 'prayed_for' and v_current_status <> 'new')
      or (p_status = 'closed' and v_current_status not in ('new', 'prayed_for')) then
    raise exception 'Prayer request cannot change to that status.'
      using errcode = '23514';
  end if;

  v_changed_at := clock_timestamp();
  update public.prayer_requests
     set status = p_status,
         closed_at = case when p_status = 'closed' then v_changed_at else null end,
         updated_at = v_changed_at,
         status_changed_by = v_actor
   where prayer_requests.id = p_request_id;

  return query
    select r.id,
           case
             when r.anonymous_to_leaders then 'Anonymous member'
             else coalesce(nullif(btrim(p.full_name), ''), 'Member')
           end as display_name,
           r.request_text,
           r.anonymous_to_leaders,
           r.status,
           r.created_at,
           r.updated_at,
           r.closed_at
      from public.prayer_requests r
      join public.profiles p on p.id = r.owner_id
     where r.id = p_request_id
       and r.status <> 'withdrawn';
end;
$$;

revoke all on function public.submit_prayer_request(text, boolean)
  from public, anon, authenticated;
revoke all on function public.list_my_prayer_requests()
  from public, anon, authenticated;
revoke all on function public.set_my_prayer_request_state(uuid, text)
  from public, anon, authenticated;
revoke all on function public.list_admin_prayer_requests()
  from public, anon, authenticated;
revoke all on function public.set_admin_prayer_request_status(uuid, text)
  from public, anon, authenticated;

grant execute on function public.submit_prayer_request(text, boolean)
  to authenticated;
grant execute on function public.list_my_prayer_requests()
  to authenticated;
grant execute on function public.set_my_prayer_request_state(uuid, text)
  to authenticated;
grant execute on function public.list_admin_prayer_requests()
  to authenticated;
grant execute on function public.set_admin_prayer_request_status(uuid, text)
  to authenticated;
