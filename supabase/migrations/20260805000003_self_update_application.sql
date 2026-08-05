-- Island Training Club — members can read/update their own application
--
-- The self read/update policies on public.applications required the
-- caller's role to still be 'pending', so an approved member could
-- neither view nor edit their application details from Profile →
-- Membership Details. Ownership is what matters; keep the role check
-- on INSERT (only pending users apply) but drop it from read/update.
--
-- Apply via the Supabase SQL editor or `supabase db push`.

drop policy "self read application" on public.applications;
create policy "self read application"
  on public.applications for select
  using (auth.uid() = profile_id);

drop policy "self update application" on public.applications;
create policy "self update application"
  on public.applications for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
