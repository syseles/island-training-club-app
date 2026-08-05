-- Island Training Club — applications table
--
-- Stores the post-Google sign-up application form data. Pending users
-- insert/update their own row; admins and super_admins read all rows
-- (RLS added in a separate migration). Apply via the Supabase SQL
-- editor or `supabase db push`.

create table public.applications (
  profile_id              uuid primary key references public.profiles(id) on delete cascade,
  mobile                  text not null,
  date_of_birth           date not null,
  is_minor                boolean not null,
  guardian_name           text,
  guardian_phone          text,
  emergency_name          text not null,
  emergency_phone         text not null,
  heard_source            text not null check (heard_source in ('friend','family','search','social','event','other')),
  heard_detail            text,
  preferred_name          text,
  photo_consent           boolean not null default false,
  waiver_accepted_at      timestamptz not null,
  privacy_accepted_at     timestamptz not null,
  guidelines_accepted_at  timestamptz not null,
  submitted_at            timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint applications_minor_guardian
    check ((is_minor = false) or (guardian_name is not null and guardian_phone is not null))
);

create function public.touch_applications_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger applications_touch_updated_at
  before update on public.applications
  for each row execute function public.touch_applications_updated_at();