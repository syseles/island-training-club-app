-- Island Training Club — Row Level Security policies
--
-- One migration so the policies are easy to reason about together.
-- Each table gets a default-deny posture; explicit policies open the
-- doors. Client code uses the anon key + session JWT; service_role
-- bypasses RLS for any future admin scripts.

-- ==========================================================================
-- public.profiles
-- ==========================================================================

alter table public.profiles enable row level security;

-- Anyone authenticated can read their own row.
create policy "self read"
  on public.profiles for select
  using (auth.uid() = id);

-- Admins and super_admins can read all rows.
create policy "admin read all"
  on public.profiles for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- Anyone authenticated can update non-role columns of their own row.
create policy "self update non-role"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- Admins can approve pending -> member.
create policy "admin approve pending"
  on public.profiles for update
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) = 'admin'
    and role = 'pending'
  )
  with check (role = 'member');

-- Super admins can update any row's role (and other columns).
create policy "super_admin update all"
  on public.profiles for update
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) = 'super_admin'
  );

-- Inserts: blocked for everyone. The trigger is the only path.
-- No INSERT policy required; default deny under RLS.

-- Deletes: blocked for everyone. Cascade via auth.users only.
-- No DELETE policy required; default deny under RLS.


-- ==========================================================================
-- public.applications
-- ==========================================================================

alter table public.applications enable row level security;

-- Pending users can read their own application.
create policy "self read application"
  on public.applications for select
  using (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

-- Pending users can submit / update their own application.
create policy "self insert application"
  on public.applications for insert
  with check (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

create policy "self update application"
  on public.applications for update
  using (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  )
  with check (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

-- Admins and super_admins can read all applications.
create policy "admin read all applications"
  on public.applications for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- No DELETE policy: blocked by default.


-- ==========================================================================
-- public.role_changes (audit log)
-- ==========================================================================

alter table public.role_changes enable row level security;

-- Admins and super_admins can read all role changes.
create policy "admin read role_changes"
  on public.role_changes for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- INSERT blocked (trigger is the only path, security definer).


-- ==========================================================================
-- public.notifications
-- ==========================================================================

alter table public.notifications enable row level security;

-- Users can read their own notifications.
create policy "self read notifications"
  on public.notifications for select
  using (auth.uid() = profile_id);

-- Users can mark their own notifications as read (read_at only).
create policy "self mark notification read"
  on public.notifications for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- INSERT blocked (trigger is the only path).
-- No DELETE policy: blocked by default. Soft-delete via read_at.