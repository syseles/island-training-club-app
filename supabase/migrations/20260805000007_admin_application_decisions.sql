-- Island Training Club — complete Admin application decisions

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'member', 'admin', 'super_admin', 'declined'));

drop policy if exists "admin approve pending" on public.profiles;
drop policy if exists "admin decide pending" on public.profiles;
create policy "admin decide pending"
  on public.profiles for update
  using (
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      public.current_user_role()
    ) = 'admin'
    and role = 'pending'
  )
  with check (
    role in ('member', 'declined')
    and exists (
      select 1
      from public.applications as submitted_application
      where submitted_application.profile_id = public.profiles.id
        and submitted_application.submitted_at is not null
    )
  );
