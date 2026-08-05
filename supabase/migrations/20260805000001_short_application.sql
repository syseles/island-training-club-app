-- Island Training Club — short application form
--
-- The post-Google sign-up application now collects only mobile + privacy
-- consent up front; date of birth, emergency contact, heard-source, and
-- the waiver/guidelines acceptances are completed later from the Profile
-- page. Relax the NOT NULL constraints accordingly. The
-- applications_minor_guardian CHECK still holds (guardian required only
-- when is_minor), and the heard_source CHECK still validates non-null
-- values.
--
-- Apply via the Supabase SQL editor or `supabase db push`.

alter table public.applications alter column date_of_birth drop not null;
alter table public.applications alter column emergency_name drop not null;
alter table public.applications alter column emergency_phone drop not null;
alter table public.applications alter column heard_source drop not null;
alter table public.applications alter column waiver_accepted_at drop not null;
alter table public.applications alter column guidelines_accepted_at drop not null;
