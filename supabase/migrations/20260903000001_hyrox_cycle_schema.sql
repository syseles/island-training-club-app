-- Island Training Club — pooled HYROX cycle schema
--
-- Adds the parent weekly cycle and its two distinct queue types. Existing
-- venue-specific operational rows remain intact; pooled bookings and receipts
-- use additive nullable cycle/session links until venue allocation completes.

-- =====================================================================
-- Weekly BFT/Midtown cycles
-- =====================================================================

create table public.operational_hyrox_cycles (
  id                            text primary key,
  session_date                  date not null unique,
  bft_session_id                text not null unique
                                  references public.operational_sessions(id),
  midtown_session_id            text not null unique
                                  references public.operational_sessions(id),
  registration_state            text not null default 'draft'
                                  check (registration_state in (
                                    'draft', 'open', 'reconciling', 'closed', 'cancelled'
                                  )),
  venue_plan                    text not null default 'pending'
                                  check (venue_plan in ('pending', 'bft_only', 'both')),
  registration_capacity        integer not null default 32
                                  check (registration_capacity = 32),
  registration_opens_at        timestamptz not null,
  payment_deadline_at           timestamptz not null,
  holder_grace_deadline_at      timestamptz not null,
  promoted_payment_deadline_at  timestamptz not null,
  venue_choice_deadline_at      timestamptz not null,
  capacity_warning_sent_at      timestamptz,
  payment_reminder_sent_at      timestamptz,
  holder_grace_started_at       timestamptz,
  waitlist_promoted_at          timestamptz,
  reconciliation_started_at    timestamptz,
  opened_at                     timestamptz,
  plan_confirmed_at             timestamptz,
  plan_confirmed_by             uuid references public.profiles(id),
  plan_confirmed_source         text
                                  check (plan_confirmed_source in (
                                    'automatic_sweep',
                                    'payment_reconciliation',
                                    'admin_retry'
                                  )),
  allocation_closed_at         timestamptz,
  cancelled_at                  timestamptz,
  cancelled_by                  uuid references public.profiles(id),
  cancel_reason                 text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (id = 'hyrox-pool-' || session_date::text),
  check (extract(dow from session_date) = 6),
  check (bft_session_id <> midtown_session_id),
  check (
    (venue_plan = 'pending'
      and plan_confirmed_at is null
      and plan_confirmed_by is null
      and plan_confirmed_source is null)
    or
    (venue_plan <> 'pending'
      and plan_confirmed_at is not null
      and plan_confirmed_source is not null)
  ),
  check (registration_state <> 'closed' or venue_plan <> 'pending'),
  check (allocation_closed_at is null
    or registration_state in ('closed', 'cancelled')),
  check (
    (registration_state <> 'cancelled'
      and cancelled_at is null
      and cancelled_by is null
      and cancel_reason is null)
    or
    (registration_state = 'cancelled'
      and cancelled_at is not null
      and cancelled_by is not null
      and cancel_reason is not null
      and length(btrim(cancel_reason)) > 0)
  ),
  check (registration_opens_at < payment_deadline_at),
  check (holder_grace_deadline_at = payment_deadline_at + interval '1 hour'),
  check (promoted_payment_deadline_at = holder_grace_deadline_at + interval '1 hour'),
  check (venue_choice_deadline_at > promoted_payment_deadline_at)
);

create index operational_hyrox_cycles_state_date
  on public.operational_hyrox_cycles(registration_state, session_date);

-- =====================================================================
-- Add pooled scope and allocation history to bookings/receipts
-- =====================================================================

alter table public.operational_bookings
  alter column session_id drop not null,
  add column hyrox_cycle_id text references public.operational_hyrox_cycles(id),
  add column venue_preference text
    check (venue_preference in ('bft', 'midtown', 'either')),
  add column fallback_acknowledged_at timestamptz,
  add column promoted_from_waitlist_at timestamptz,
  add column allocation_state text
    check (allocation_state in ('provisional', 'final')),
  add column allocation_source text
    check (allocation_source in ('preference', 'member', 'automatic', 'admin')),
  add column allocated_at timestamptz,
  add column allocation_snapshot jsonb,
  add column payment_rejected_at timestamptz,
  add column payment_rejected_by uuid references public.profiles(id),
  add column payment_rejection_reason text,
  add constraint operational_bookings_scope_check check (
    (hyrox_cycle_id is null
      and session_id is not null
      and venue_preference is null
      and fallback_acknowledged_at is null
      and promoted_from_waitlist_at is null
      and allocation_state is null
      and allocation_source is null
      and allocated_at is null
      and allocation_snapshot is null)
    or
    (hyrox_cycle_id is not null
      and venue_preference is not null
      and fallback_acknowledged_at is not null)
  ),
  add constraint operational_bookings_allocation_check check (
    (allocation_state is null
      and allocation_source is null
      and allocated_at is null
      and allocation_snapshot is null
      and (hyrox_cycle_id is null or session_id is null))
    or
    (session_id is not null
      and allocation_state is not null
      and allocation_source is not null
      and allocated_at is not null
      and allocation_snapshot is not null
      and jsonb_typeof(allocation_snapshot) = 'array')
  ),
  add constraint operational_bookings_payment_rejection_check check (
    (payment_rejected_at is null
      and payment_rejected_by is null
      and payment_rejection_reason is null)
    or
    (payment_rejected_at is not null
      and payment_rejected_by is not null
      and payment_rejection_reason is not null
      and length(btrim(payment_rejection_reason)) > 0)
  );

create unique index operational_bookings_one_active_per_hyrox_cycle
  on public.operational_bookings(profile_id, hyrox_cycle_id)
  where hyrox_cycle_id is not null
    and status in ('reserved', 'confirmed');

create index operational_bookings_hyrox_cycle_status
  on public.operational_bookings(hyrox_cycle_id, status, payment_marked_at);

alter table public.operational_receipts
  alter column session_id drop not null,
  add column hyrox_cycle_id text references public.operational_hyrox_cycles(id),
  add constraint operational_receipts_scope_check check (
    (hyrox_cycle_id is null and session_id is not null)
    or hyrox_cycle_id is not null
  );

create index operational_receipts_hyrox_cycle
  on public.operational_receipts(hyrox_cycle_id, issued_at desc);

-- =====================================================================
-- Weekly and venue-switch queues
-- =====================================================================

create table public.operational_hyrox_queue_entries (
  id                       uuid primary key default gen_random_uuid(),
  cycle_id                 text not null references public.operational_hyrox_cycles(id),
  profile_id               uuid not null references public.profiles(id),
  kind                     text not null
                             check (kind in ('weekly_waitlist', 'venue_switch')),
  target_session_id        text references public.operational_sessions(id),
  venue_preference         text
                             check (venue_preference in ('bft', 'midtown', 'either')),
  fallback_acknowledged_at timestamptz,
  status                   text not null default 'active'
                             check (status in (
                               'active', 'promoted', 'matched', 'left', 'dissolved'
                             )),
  joined_at                timestamptz not null default now(),
  resolved_at              timestamptz,
  check (
    (kind = 'weekly_waitlist'
      and target_session_id is null
      and venue_preference is not null
      and fallback_acknowledged_at is not null)
    or
    (kind = 'venue_switch'
      and target_session_id is not null
      and venue_preference is null
      and fallback_acknowledged_at is null)
  ),
  check (
    (status = 'active' and resolved_at is null)
    or (status <> 'active' and resolved_at is not null)
  )
);

create unique index operational_hyrox_queue_one_active_per_member
  on public.operational_hyrox_queue_entries(profile_id, cycle_id)
  where status = 'active';

create index operational_hyrox_queue_order
  on public.operational_hyrox_queue_entries(
    cycle_id, kind, target_session_id, status, joined_at, id
  );

-- =====================================================================
-- Updated timestamp and read-only browser access
-- =====================================================================

create trigger operational_hyrox_cycles_touch_updated_at
  before update on public.operational_hyrox_cycles
  for each row execute function public.touch_updated_at();

alter table public.operational_hyrox_cycles enable row level security;
alter table public.operational_hyrox_queue_entries enable row level security;

create policy "public read HYROX cycles"
  on public.operational_hyrox_cycles for select
  using (true);

create policy "member read own HYROX cycle queues"
  on public.operational_hyrox_queue_entries for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

revoke all on table public.operational_hyrox_cycles from anon, authenticated;
revoke all on table public.operational_hyrox_queue_entries from anon, authenticated;

grant select on table public.operational_hyrox_cycles to anon, authenticated;
grant select on table public.operational_hyrox_queue_entries to authenticated;
