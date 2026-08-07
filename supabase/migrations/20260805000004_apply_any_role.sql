-- Island Training Club — every role applies
--
-- The self-insert policy on public.applications required the caller's
-- role to be 'pending', which blocked the bootstrap super_admin (and
-- any other non-pending role) from ever submitting an application.
-- The product rule is that every account has an application on file,
-- so ownership alone gates the insert. (An application row already
-- existing for the profile is prevented by the primary key.)
--
-- Apply via the Supabase SQL editor or `supabase db push`.

drop policy "self insert application" on public.applications;
create policy "self insert application"
  on public.applications for insert
  with check (auth.uid() = profile_id);
