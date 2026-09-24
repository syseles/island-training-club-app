-- Island Training Club — web push ops preference (phase 1: column only)
-- No sender, subscriptions, or service worker in this migration.

alter table public.applications
  add column if not exists web_push_ops boolean not null default false;

comment on column public.applications.web_push_ops is
  'Opt-in for future browser push on operational booking/payment/venue inbox kinds. Phase 1 preference only; no send path yet.';
