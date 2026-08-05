alter table public.applications
  add column whatsapp_reminders boolean not null default false,
  add column email_receipts boolean not null default false,
  add column community_news boolean not null default false;

update public.applications
set is_minor = case
  when date_of_birth is null then is_minor
  else date_of_birth > (current_date - interval '18 years')::date
end;

update public.applications
set date_of_birth = null;

alter table public.applications
  alter column date_of_birth drop not null;
