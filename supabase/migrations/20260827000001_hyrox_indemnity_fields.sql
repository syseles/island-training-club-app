-- Island Training Club — versioned Hyrox indemnity fields
--
-- Existing applications remain readable. Null values identify legacy rows
-- that must re-sign through Profile > Indemnity.

alter table public.applications
  add column if not exists waiver_signature_text text,
  add column if not exists waiver_signed_at date,
  add column if not exists waiver_form_version text,
  add column if not exists emergency_relationship text;
