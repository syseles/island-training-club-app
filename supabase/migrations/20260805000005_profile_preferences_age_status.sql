alter table public.applications
  add column if not exists whatsapp_reminders boolean not null default false,
  add column if not exists email_receipts boolean not null default false,
  add column if not exists community_news boolean not null default false;

update public.applications
set is_minor = case
  when date_of_birth is null then is_minor
  else date_of_birth > (current_date - interval '18 years')::date
end;

-- Drop the constraint before clearing DOB values. This ordering also lets
-- the migration be safely rerun after a failed SQL Editor attempt.
alter table public.applications
  alter column date_of_birth drop not null;

update public.applications
set date_of_birth = null;
