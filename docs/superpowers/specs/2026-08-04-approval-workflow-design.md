# Approval Workflow — Design

**Date:** 2026-08-04
**Branch:** `feature/auth-identity` (non-Shop work; lands on `main`)
**Sub-project:** B (Approval workflow)
**Sibling specs on this branch:** `2026-08-04-auth-identity-design.md` (covers A and D)
**Status:** Agreed in brainstorm. Sections marked ⏳ have details to be confirmed later.

## Problem

After Google sign-in, an applicant lands in `profiles` with `role = 'pending'`. They have only what Google provides (email, full name, avatar). Admins reviewing pending applicants see no application data, no audit trail of role changes, and the newly-approved member gets no welcome.

The product brief's signup recommendation calls for additional fields (mobile/WhatsApp, age confirmation, emergency contact, "how did you hear about us"), explicit approval criteria (complete, plausible, non-duplicative, non-abusive, age-compliant; not fitness-based), and acceptance of the participation waiver, privacy policy, and community guidelines. None of that exists today.

This sub-project delivers the **data shape and UI scaffold** for that flow. Policy text — the criteria wording, the welcome copy, the waiver, the privacy text, the community guidelines — is owned by the ITC leadership workshop flagged in the handoff and is marked ⏳ here. The implementation lands with placeholder copy; the workshop fills in the words.

## Goals

- An application form at `/app/#/apply` that pending users see right after their first Google sign-in, and can revisit anytime from the Profile tab.
- A `public.applications` table storing the extra fields, keyed to the user's profile id, with DB-level NOT NULL and check constraints that mirror the spec's "complete" criterion.
- Waiver / privacy / guidelines acceptance checkboxes recorded on the application, each with its own timestamp.
- An audit log `public.role_changes` table that records every role mutation: who, when, old role, new role, optional reason. Written automatically by a Postgres trigger; cannot be bypassed by the client.
- A welcome notification inserted into `public.notifications` when a role flips to `member`. Surfaced in the prototype's notification UI.
- Approval criteria documented as explicit ⏳ items awaiting ITC leadership review. The data model supports recording rationale via `role_changes.reason`; the admin panel UI surfaces it.
- Local development keeps working without Supabase — the localStorage seam still drives the prototype when no Supabase project is configured.

## Non-goals (sub-project B)

- **E — Policy & notifications.** Email / WhatsApp / push channels, waiver text, privacy text, community guidelines text, welcome copy, and final approval criteria wording are owned by the ITC leadership workshop and are not in this spec.
- **D — Activity / booking / payment admin.** Stays on `feature/payment-system`.
- **C — Persistence migration.** localStorage stays for activities, bookings, etc.
- Apple Sign-In, magic-link, or other identity providers — not requested.

## Application form

Route: `/app/#/apply`, rendered by a new `viewApply()` function in `views.js`. Class palette follows AGENTS.md (`.card`, `.kicker`, `.badge`, `.display`, `.btn`, `.muted`, `.section-head`).

Post-sign-in redirect: after Google OAuth callback, if `role = 'pending'` and no `applications` row exists, the user is sent to `/apply`. After submission, they're sent home (still pending, awaiting admin review). The redirect logic lives in the same entry-point shim that A adds in `store.js`.

The form fields (required unless noted):

- **Mobile / WhatsApp number** — text, single field, validated with a phone-shaped regex at submit time. ⏳ exact HK format pending.
- **Date of birth** — date picker. Used to derive age. If under 18, two extra fields appear and become required: **Guardian name** and **Guardian phone**.
- **Emergency contact name** — text.
- **Emergency contact phone** — text, same phone regex.
- **How did you hear about ITC?** — single-select dropdown: Friend or family / Search engine / Social media / Event / Other (with optional free-text detail). ⏳ exact options pending.
- **Preferred name** — text, optional.
- **Photo / media consent** — checkbox, optional. ⏳ copy pending.
- **Waiver acceptance** — checkbox, required. ⏳ copy pending.
- **Privacy policy acceptance** — checkbox, required. ⏳ copy pending.
- **Community guidelines acceptance** — checkbox, required. ⏳ copy pending.

Submission writes a single row to `public.applications`. DB-level NOT NULL constraints and a check constraint enforce "complete" (every required field present, and minor applications include guardian info).

The form has an "Edit" affordance for users who have already submitted but are still pending — admins see both submissions side by side if a user resubmits.

## Audit log

Table: `public.role_changes` (see Data model below). Trigger: Postgres `after update` on `public.profiles`; if `OLD.role <> NEW.role`, insert a row with `changed_by = auth.uid()`.

The admin panel's `/admin/users` page shows each user's most recent role change inline ("Approved by [admin] on [date]" or "Self-promoted via first-sign-in bootstrap"). D's existing UI gains one new column or one expandable row per user, displaying the latest `role_changes` row joined to that user.

The trigger is `security definer` so it can write even when the calling user wouldn't normally have INSERT permission on `role_changes` (RLS denies client-side writes).

## Welcome notification

Table: `public.notifications`. When the `record_role_change` trigger fires and `NEW.role = 'member'`, it inserts a `notifications` row with `kind = 'welcome'`, the title "Welcome to Island Training Club", and a placeholder body. ⏳ copy pending ITC review.

UI: a notification badge on the Profile tab showing unread count, opening a list. Tapping a notification calls `update notifications set read_at = now() where id = ...`. Marking-as-read is the only client-writable path on this table (RLS gates the `read_at` column).

## Approval criteria (⏳)

The product brief states: "Approval should check that the application is complete, plausible, non-duplicative, non-abusive, and compliant with applicable age or guardian requirements. Approval should not depend on fitness level."

Spec implementation, by criterion:

- **Complete** — enforced by form validation and DB NOT NULL / check constraints (see Data model).
- **Plausible** — admin judgement. Admin can record a `reason` on the audit log via an optional prompt before clicking Approve.
- **Non-duplicative** — DB-level: `applications.profile_id` is the primary key, so one application per profile. Cross-account duplication (same person signing up with two Google accounts) is detected by admins reviewing pending applicants side-by-side and is not enforced automatically. ⏳ exact operational rule pending.
- **Non-abusive** — admin judgement. Same `reason` path on the audit log.
- **Age-compliant** — DB-level check constraint enforces that minor applications include guardian name and phone.

Final operational wording of "plausible" and "non-abusive" — including what counts as incomplete, what an admin should look for, and what a `reason` should contain — is ⏳ awaiting ITC leadership review. Until then, admins use their judgement and record rationale in `role_changes.reason` (optional field).

## Data model

```sql
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

create table public.role_changes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  changed_by  uuid references public.profiles(id),
  old_role    text not null,
  new_role    text not null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index role_changes_profile_idx on public.role_changes (profile_id, created_at desc);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

-- Audit log + welcome notification trigger.
create function public.record_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.role is distinct from NEW.role then
    insert into public.role_changes (profile_id, changed_by, old_role, new_role)
    values (NEW.id, auth.uid(), OLD.role, NEW.role);

    if NEW.role = 'member' then
      insert into public.notifications (profile_id, kind, title, body)
      values (
        NEW.id,
        'welcome',
        'Welcome to Island Training Club',
        'Your application has been approved. You can now book sessions and access the member area.'
      );
    end if;
  end if;
  return NEW;
end;
$$;

create trigger profiles_audit_role_change
  after update on public.profiles
  for each row execute function public.record_role_change();

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
```

Migrations land under `supabase/migrations/` alongside A's migration (separate files, applied in order).

## Row-level security

```sql
alter table public.applications enable row level security;

-- Pending users can read their own application.
create policy "self read application"
  on public.applications for select
  using (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

-- Pending users can submit / update their own application.
create policy "self insert application"
  on public.applications for insert
  with check (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

create policy "self update application"
  on public.applications for update
  using (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  )
  with check (
    auth.uid() = profile_id
    and (select role from public.profiles where id = auth.uid()) = 'pending'
  );

-- Admins and super_admins can read all applications.
create policy "admin read all applications"
  on public.applications for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- No DELETE policy: blocked by default.

alter table public.role_changes enable row level security;

-- Admins and super_admins can read all role changes.
create policy "admin read role_changes"
  on public.role_changes for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- INSERT blocked (trigger is the only path, security definer).

alter table public.notifications enable row level security;

-- Users can read their own notifications.
create policy "self read notifications"
  on public.notifications for select
  using (auth.uid() = profile_id);

-- Users can mark their own notifications as read (read_at only).
create policy "self mark notification read"
  on public.notifications for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- INSERT blocked (trigger is the only path).
-- No DELETE policy: blocked by default. Soft-delete via read_at.
```

## Auth flow integration

After Google OAuth callback, the entry-point shim's post-sign-in handler:

1. `supabase.auth.getUser()` → user.
2. `select * from profiles where id = auth.uid()` → profile row.
3. `select 1 from applications where profile_id = auth.uid()` → whether application exists.
4. Redirect:
   - `super_admin` / `admin` / `member` → home tab.
   - `pending` without application → `/apply`.
   - `pending` with application → home tab (their application is awaiting admin review).

The shim caches the result for the session so subsequent page loads don't re-query.

## Testing

- Extend smoke tests:
  - RLS: a `pending` user can read and write their own application; cannot read another user's application.
  - RLS: an `admin` can read all applications.
  - RLS: a non-admin cannot read `role_changes`.
  - Trigger: when a profile's role flips from `pending` to `member`, exactly one row is added to `role_changes` and one to `notifications`.
  - DB constraint: under-18 application without guardian name and phone is rejected by `applications_minor_guardian`.
  - DB constraint: every NOT NULL column rejects null inserts.
- Manual: sign in as a new Google account → redirected to `/apply` → fill the form → submit → see "Awaiting review" state. Sign in as admin → see the new pending applicant in `/admin/users` → click Approve → check that a `role_changes` row exists and the welcome notification appears on the user's profile.

## Operational runbook (additions)

The runbook from A's spec extends with:

- How to inspect a user's `role_changes` history in the Supabase dashboard (`select * from role_changes where profile_id = ... order by created_at desc`).
- How to read pending applications directly from `select * from applications join profiles on ... where profiles.role = 'pending'`.
- ⏳ Until the welcome copy lands, edits to the welcome notification body are SQL-only: `update notifications set body = '...' where kind = 'welcome'`.

## Explicit out-of-scope (deferred)

- **E — Policy & notifications.** Waiver text, privacy text, community guidelines text, welcome copy, approval criteria wording, and any email / WhatsApp / push channels are not in this spec. They are owned by the ITC leadership workshop. Until they land, the data model supports them but UI uses placeholder text marked ⏳ above.
- **C — Persistence migration.** Activities, bookings, donations, receipts stay on localStorage.
- **D — Activity / booking / payment admin.** Lives on `feature/payment-system`.
- **A — Stack & identity.** Covered by `2026-08-04-auth-identity-design.md`.