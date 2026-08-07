-- Store the optional IECC donor ID on the member-owned application record.
-- Existing self-update RLS permits members to update only their own row.

alter table public.applications
  add column if not exists donor_id text
  constraint applications_donor_id_format
  check (donor_id is null or donor_id ~ '^[A-Z]+-[0-9]{4,5}$');
