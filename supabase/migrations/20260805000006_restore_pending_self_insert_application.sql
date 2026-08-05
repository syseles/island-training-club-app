-- Island Training Club — restore pending-only application inserts
--
-- Migration 20260805000004 broadened self-insert to every profile role.
-- Applications are pending-only: approved members and administrators may
-- read/update their existing application, but may not create a new one.
-- Keep both ownership and current profile role in the insert check.

drop policy if exists "self insert application" on public.applications;
create policy "self insert application"
  on public.applications for insert
  with check (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );
