-- Island Training Club — role_changes + notifications + audit trigger
--
-- Captures every role mutation in role_changes (audit log) and fires a
-- welcome notification when a role flips to 'member'. Both writes are
-- driven by the same Postgres trigger on public.profiles updates so
-- the audit log cannot be bypassed by the client. Apply via the
-- Supabase SQL editor or `supabase db push`.

create table public.role_changes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  changed_by  uuid references public.profiles(id),
  old_role    text not null,
  new_role    text not null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index role_changes_profile_idx on public.role_changes (profile_id, created_at desc);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

-- Audit log + welcome notification trigger.
create function public.record_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.role is distinct from NEW.role then
    insert into public.role_changes (profile_id, changed_by, old_role, new_role)
    values (NEW.id, auth.uid(), OLD.role, NEW.role);

    if NEW.role = 'member' then
      insert into public.notifications (profile_id, kind, title, body)
      values (
        NEW.id,
        'welcome',
        'Welcome to Island Training Club',
        'Your application has been approved. You can now book sessions and access the member area.'
      );
    end if;
  end if;
  return NEW;
end;
$$;

create trigger profiles_audit_role_change
  after update on public.profiles
  for each row execute function public.record_role_change();