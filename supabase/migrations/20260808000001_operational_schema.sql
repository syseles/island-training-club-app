-- Island Training Club — shared HYROX operational schema
--
-- Adds the operational tables, indexes, constraints, RLS, and privileges
-- that the Supabase RPC layer (Tasks 2-4) will operate on. The migration
-- also seeds the two recurring HYROX activity templates.
--
-- Tables intentionally have no INSERT/UPDATE policies for members. All
-- mutations for sessions, bookings, queues, receipts, and collector
-- operations are routed through SECURITY DEFINER functions added in
-- later migrations. Members and admins read through explicit policies.

-- =====================================================================
-- Helpers
-- =====================================================================

create or replace function public.operational_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'super_admin');
$$;

-- =====================================================================
-- Activity templates
-- =====================================================================

create table public.operational_activity_templates (
  activity_id        text primary key
                        check (activity_id in ('hyrox', 'hyrox-midtown')),
  name               text not null,
  venue              text not null,
  weekday            smallint not null check (weekday between 0 and 6),
  start_time         time not null,
  duration_minutes   integer not null check (duration_minutes > 0),
  capacity           integer not null check (capacity > 0),
  price_hkd          integer not null check (price_hkd > 0),
  default_open       boolean not null default true,
  active             boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- =====================================================================
-- Sessions
-- =====================================================================

create table public.operational_sessions (
  id                 text primary key,
  activity_id        text not null references public.operational_activity_templates(activity_id),
  session_date       date not null,
  start_time         time not null,
  duration_minutes   integer not null check (duration_minutes > 0),
  venue              text not null,
  capacity           integer not null check (capacity > 0),
  price_hkd          integer not null check (price_hkd > 0),
  is_open            boolean not null default true,
  venue_tbc          boolean not null default false,
  notice             text,
  cancelled_at       timestamptz,
  cancelled_by       uuid references public.profiles(id),
  cancelled_source   text check (cancelled_source in ('admin', 'system')),
  cancel_reason      text,
  gym_confirmed_at   timestamptz,
  gym_confirmed_by   uuid references public.profiles(id),
  gym_note           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (activity_id, session_date),
  check (id = activity_id || '-' || session_date::text),
  check (
    (cancelled_at is null
        and cancelled_by is null
        and cancelled_source is null
        and cancel_reason is null)
    or
    (cancelled_at is not null
        and length(btrim(cancel_reason)) > 0
        and ((cancelled_source = 'admin' and cancelled_by is not null)
          or (cancelled_source = 'system' and cancelled_by is null)))
  ),
  check (
    (gym_confirmed_at is null and gym_confirmed_by is null)
    or (gym_confirmed_at is not null and gym_confirmed_by is not null)
  ),
  check (not (cancelled_at is not null and gym_confirmed_at is not null))
);

-- =====================================================================
-- Bookings
-- =====================================================================

create table public.operational_bookings (
  id                       uuid primary key default gen_random_uuid(),
  profile_id               uuid not null references public.profiles(id),
  session_id               text not null references public.operational_sessions(id),
  status                   text not null
                              check (status in ('reserved', 'confirmed', 'cancelled', 'expired', 'deferred')),
  reserved_at              timestamptz not null default now(),
  pay_deadline_at          timestamptz not null,
  payment_marked_at        timestamptz,
  payment_method           text
                              check (payment_method is null or payment_method in ('payme', 'fps')),
  payment_reference        text,
  paid_at                  timestamptz,
  confirmed_by             uuid references public.profiles(id),
  deferred_from_booking_id uuid references public.operational_bookings(id),
  deferred_to_booking_id   uuid references public.operational_bookings(id),
  snapshot                 jsonb not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index operational_bookings_one_active_per_session
  on public.operational_bookings(profile_id, session_id)
  where status in ('reserved', 'confirmed');

create index operational_bookings_session_status
  on public.operational_bookings(session_id, status);

-- =====================================================================
-- Queue entries (waitlist + interest)
-- =====================================================================

create table public.operational_queue_entries (
  id           uuid primary key default gen_random_uuid(),
  session_id   text not null references public.operational_sessions(id),
  profile_id   uuid not null references public.profiles(id),
  kind         text not null check (kind in ('waitlist', 'interest')),
  status       text not null default 'active'
                  check (status in ('active', 'promoted', 'left', 'dissolved')),
  joined_at    timestamptz not null default now(),
  resolved_at  timestamptz
);

create unique index operational_queue_one_active_per_session
  on public.operational_queue_entries(profile_id, session_id)
  where status = 'active';

create index operational_queue_session_order
  on public.operational_queue_entries(session_id, kind, status, joined_at, id);

-- =====================================================================
-- Receipts
-- =====================================================================

create table public.operational_receipts (
  id                uuid primary key default gen_random_uuid(),
  receipt_number    text not null unique,
  booking_id        uuid not null references public.operational_bookings(id),
  profile_id        uuid not null references public.profiles(id),
  session_id        text not null references public.operational_sessions(id),
  amount_hkd        integer not null check (amount_hkd >= 0),
  currency          text not null default 'HKD',
  payment_method    text not null check (payment_method in ('payme', 'fps')),
  status            text not null default 'issued'
                      check (status in ('issued', 'voided')),
  issued_at         timestamptz not null default now(),
  issued_by         uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

create index operational_receipts_member on public.operational_receipts(profile_id, issued_at desc);

-- =====================================================================
-- Collector duty and payout
-- =====================================================================

create table public.collector_assignments (
  week_start          date primary key,
  collector_profile_id uuid not null references public.profiles(id),
  assigned_by         uuid not null references public.profiles(id),
  assigned_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.collector_payout_profiles (
  profile_id   uuid primary key references public.profiles(id),
  payme_link   text,
  fps_phone    text,
  updated_at   timestamptz not null default now()
);

-- =====================================================================
-- Updated-at triggers
-- =====================================================================

create trigger operational_activity_templates_touch_updated_at
  before update on public.operational_activity_templates
  for each row execute function public.touch_updated_at();

create trigger operational_sessions_touch_updated_at
  before update on public.operational_sessions
  for each row execute function public.touch_updated_at();

create trigger operational_bookings_touch_updated_at
  before update on public.operational_bookings
  for each row execute function public.touch_updated_at();

create trigger collector_assignments_touch_updated_at
  before update on public.collector_assignments
  for each row execute function public.touch_updated_at();

create trigger collector_payout_profiles_touch_updated_at
  before update on public.collector_payout_profiles
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.operational_activity_templates enable row level security;
alter table public.operational_sessions enable row level security;
alter table public.operational_bookings enable row level security;
alter table public.operational_queue_entries enable row level security;
alter table public.operational_receipts enable row level security;
alter table public.collector_assignments enable row level security;
alter table public.collector_payout_profiles enable row level security;

-- Templates: anyone can read; admins manage.
create policy "public read operational templates"
  on public.operational_activity_templates for select
  using (true);

create policy "admin manage operational templates"
  on public.operational_activity_templates for all
  using (public.operational_is_admin())
  with check (public.operational_is_admin());

-- Sessions: public read (cancellation reason visible); admin manage.
create policy "public read operational sessions"
  on public.operational_sessions for select
  using (true);

create policy "admin manage operational sessions"
  on public.operational_sessions for all
  using (public.operational_is_admin())
  with check (public.operational_is_admin());

-- Bookings: members read own; admins read all. Writes only via RPC.
create policy "member read own operational bookings"
  on public.operational_bookings for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

create policy "admin read all operational bookings"
  on public.operational_bookings for select
  using (public.operational_is_admin());

-- Queue: members read own; admins read all. Writes only via RPC.
create policy "member read own operational queue"
  on public.operational_queue_entries for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

create policy "admin read all operational queue"
  on public.operational_queue_entries for select
  using (public.operational_is_admin());

-- Receipts: members read own; admins read all.
create policy "member read own operational receipts"
  on public.operational_receipts for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

create policy "admin read all operational receipts"
  on public.operational_receipts for select
  using (public.operational_is_admin());

-- Collector assignments: any approved member reads; admins manage.
create policy "approved read collector assignments"
  on public.collector_assignments for select
  using (public.current_user_role() in ('member', 'admin', 'super_admin'));

create policy "admin manage collector assignments"
  on public.collector_assignments for all
  using (public.operational_is_admin())
  with check (public.operational_is_admin());

-- Payout: self read/manage; admin manage.
create policy "self read operational payout"
  on public.collector_payout_profiles for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

create policy "self update operational payout"
  on public.collector_payout_profiles for update
  using (profile_id = (select auth.uid()) or public.operational_is_admin())
  with check (profile_id = (select auth.uid()) or public.operational_is_admin());

create policy "admin manage operational payout"
  on public.collector_payout_profiles for all
  using (public.operational_is_admin())
  with check (public.operational_is_admin());

-- =====================================================================
-- Privileges
-- =====================================================================

revoke all on table public.operational_activity_templates from anon;
revoke all on table public.operational_sessions from anon;
revoke all on table public.operational_bookings from anon;
revoke all on table public.operational_queue_entries from anon;
revoke all on table public.operational_receipts from anon;
revoke all on table public.collector_assignments from anon;
revoke all on table public.collector_payout_profiles from anon;

revoke all on table public.operational_activity_templates from authenticated;
revoke all on table public.operational_sessions from authenticated;
revoke all on table public.operational_bookings from authenticated;
revoke all on table public.operational_queue_entries from authenticated;
revoke all on table public.operational_receipts from authenticated;
revoke all on table public.collector_assignments from authenticated;
revoke all on table public.collector_payout_profiles from authenticated;

grant select on table public.operational_activity_templates to anon, authenticated;
grant select on table public.operational_sessions to anon, authenticated;
grant select on table public.operational_bookings to anon, authenticated;
grant select on table public.operational_queue_entries to anon, authenticated;
grant select on table public.operational_receipts to anon, authenticated;
grant select on table public.collector_assignments to anon, authenticated;
grant select on table public.collector_payout_profiles to anon, authenticated;
grant insert, update on table public.collector_assignments to authenticated;
grant insert, update on table public.collector_payout_profiles to authenticated;

-- =====================================================================
-- Activity templates seed
-- =====================================================================

insert into public.operational_activity_templates
  (activity_id, name, venue, weekday, start_time, duration_minutes, capacity, price_hkd, default_open)
values
  ('hyrox',         'ITC HYROX', 'BFT Causeway Bay', 6, '11:15', 60, 20, 180, true),
  ('hyrox-midtown', 'ITC HYROX', 'Midtown 28',       6, '11:00', 60, 12, 180, false)
on conflict (activity_id) do nothing;
