-- Island Training Club — fix infinite recursion in profiles RLS
--
-- Policies on public.profiles subqueried public.profiles to find the
-- caller's role. Postgres rejects that with 42P17 ("infinite recursion
-- detected in policy"), so EVERY profile read failed and the app
-- rendered signed-in users as visitors. A SECURITY DEFINER function
-- reads the caller's role bypassing RLS; policies use it instead.
--
-- Apply via the Supabase SQL editor or `supabase db push`.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- --- public.profiles policies (the recursive ones) ------------------------

drop policy "admin read all" on public.profiles;
create policy "admin read all"
  on public.profiles for select
  using (
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      public.current_user_role()
    ) in ('admin','super_admin')
  );

drop policy "self update non-role" on public.profiles;
create policy "self update non-role"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = public.current_user_role()
  );

drop policy "admin approve pending" on public.profiles;
create policy "admin approve pending"
  on public.profiles for update
  using (
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      public.current_user_role()
    ) = 'admin'
    and role = 'pending'
  )
  with check (role = 'member');

drop policy "super_admin update all" on public.profiles;
create policy "super_admin update all"
  on public.profiles for update
  using (
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      public.current_user_role()
    ) = 'super_admin'
  );

-- The applications / role_changes policies also subquery profiles, but
-- they read only the caller's own row — allowed by the "self read"
-- policy once the profiles policies above no longer recurse. No change
-- needed there.
