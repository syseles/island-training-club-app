-- Island Training Club — profiles + first-sign-in bootstrap
--
-- Creates the public.profiles table, an after-insert trigger on
-- auth.users that creates a matching profile row, and a touch trigger
-- that keeps updated_at honest. Apply via the Supabase SQL editor or
-- `supabase db push`.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        text not null
                check (role in ('pending','member','admin','super_admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth.users row is inserted.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count int;
begin
  select count(*) into existing_count from public.profiles;
  if existing_count = 0 then
    insert into public.profiles (id, email, full_name, avatar_url, role)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'avatar_url',
      'super_admin'
    );
  else
    insert into public.profiles (id, email, full_name, avatar_url, role)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'avatar_url',
      'pending'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at honest.
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();