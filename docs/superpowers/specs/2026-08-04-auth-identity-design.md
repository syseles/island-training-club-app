# Auth, Identity & User Management — Design

**Date:** 2026-08-04
**Branch:** `feature/auth-identity` (non-Shop work; lands on `main`)
**Sub-projects:** A (Stack + Identity) + B (Approval workflow — see sibling spec `2026-08-04-approval-workflow-design.md`) + D (User & role management admin panel)
**Status:** Agreed in brainstorm. Sections marked ⏳ have details to be confirmed later.

## Problem

The Island Training Club prototype has frictionless email-only sign-in backed by localStorage. There is no real identity, no approval gate, no durable user record, and no UI for admins to review pending applicants or change roles. Every "user" is a typed email matched against seed data. Three demo accounts exist (`owner@itc.hk`, `admin@itc.hk`, `member@itc.hk`) plus two pending applicants.

Phase one calls for public visitors, pending applicants, approved members, admins, and a super admin — with an ITC leader required to approve every applicant before full member access. None of that is possible without a real backend holding users and roles, **and** without an admin UI to review pending applicants and adjust roles.

This branch covers **A (Stack + Identity)**, **B (Approval workflow)**, and **D (User & role management)** together. A defines the role model and RLS; D provides the admin UI that mutates role within those rules; B adds the application form, audit log, welcome notification, and approval criteria that wrap the approve-transition mechanic. B has its own spec on this branch — `2026-08-04-approval-workflow-design.md`. C (persistence migration) and E (policy & notifications) remain separate sub-projects and are out of scope here.

## Goals

- A live, public deployment where anyone can sign in with Google.
- A `profiles` table keyed to `auth.users` holding email, name, avatar, and a `role` column.
- Role values: `pending` | `member` | `admin` | `super_admin`. Roles are hierarchical in privilege (an admin is also a member — WhatsApp-admin model).
- Row-level security that:
  - Lets a user see only their own profile.
  - Lets admins and super admins see all profiles.
  - Lets admins approve `pending` → `member`.
  - Lets only super admins promote `member` → `admin`, demote `admin` → `member`, or revoke to `pending`.
- The first Google sign-in on the live deployment becomes the `super_admin`. Every subsequent sign-in is `pending` until an admin approves them.
- An admin-only `/admin/users` page that:
  - Lists all profiles with role, sign-up date, last sign-in.
  - Shows pending applicants prominently with a single **Approve** action.
  - Lets super admins promote `member` → `admin`, demote `admin` → `member`, and revoke to `pending`.
  - Confirms destructive actions with a typed-confirmation prompt.
  - Surfaces an empty state per section.
- Local development keeps working without Supabase — the localStorage seam still drives the prototype when no Supabase project is configured.

## Non-goals (sub-projects A + D)

- Application form fields beyond what Google provides (mobile, emergency contact, "how did you hear about us") — **B (approval workflow)**
- Welcome email / notification copy sent to a newly-approved member — **B (and E)**
- Approval audit log (who approved whom, when) — **B**
- Activity, booking, attendance, payment, refund admin surfaces — these live on `feature/payment-system` (session / payment admin is already partly built there) and continue to evolve there
- Migration of activities, bookings, donations, and receipts from localStorage to Postgres — **C (persistence migration)**
- Email / WhatsApp / push notifications — **E (policy & notifications)**
- Apple Sign-In, magic-link, or other identity providers — not requested
- Migrating the three demo accounts (`owner@`, `admin@`, `member@`) into the live Supabase project — out of scope; live starts clean
- Real OAuth permission screens, MFA, passkeys — not requested

## Stack & deployment surface

- **Backend:** Supabase free tier (project already exists in the owner's dashboard).
- **Auth:** Supabase Auth, Google OAuth provider enabled. Phone (SMS OTP via Twilio) is a planned secondary provider — not shipped in A, deferred to a follow-up task. Both providers would link to the same `auth.users` row, so the data model needs no change.
- **Database:** Postgres (managed by Supabase).
- **Hosting:** Vercel (already in use; `git log main` shows previous Vercel-driven commits).
- **Client lib:** `@supabase/supabase-js` — the only npm dependency added to this repo. Loaded via `<script type="module">` import, no bundler, no build step (matches the prototype's "no build" constraint).
- **Env vars exposed to the browser:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`. These are publishable; RLS protects data.
- **Never sent to the browser:** `SUPABASE_SERVICE_ROLE_KEY`. Not needed for A or D; not committed to git; documented in the runbook for any future admin scripts.

## Auth flow

- **Entry point:** the existing Account screen currently shows the frictionless email field. Replace it with a single "Continue with Google" button. Email-only sign-in is removed.
- **OAuth round-trip:** `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: '<site origin>/app/' } })`. Supabase handles the redirect and callback; the prototype only handles the success/error result.
- **Session storage:** Supabase JWT in localStorage (the Supabase default). Page load calls `supabase.auth.getSession()`; missing or expired → treat the user as a public visitor (existing behaviour).
- **Sign-out:** `supabase.auth.signOut()` clears the JWT and redirects to the home tab.
- **Profile hydration:** on each page load that needs the current user, `supabase.auth.getUser()` plus a `select * from profiles where id = auth.uid()` — both cached for the session. The result is what the rest of the prototype reads instead of the current email-string lookup.
- **First-sign-in bootstrap:** see the next section.

## First-sign-in bootstrap

The first Google sign-in on the live deployment becomes `super_admin`. Implemented as a Postgres `after insert` trigger on `auth.users` that creates the matching `profiles` row:

- If `count(*) from profiles = 0` → insert with `role = 'super_admin'`.
- Otherwise → insert with `role = 'pending'`.

Operational caveat: this depends on the owner being **literally first** to sign in on the live deployment. If anyone else signs in first, they become super_admin and the owner must use the Supabase dashboard SQL editor to fix the row. The owner controls when this deployment first opens to the public — the runbook (added as part of A's implementation) makes this constraint explicit and gives the SQL snippet to recover.

## Data model

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        text not null
                check (role in ('pending','member','admin','super_admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth.users row is inserted.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_count int;
begin
  select count(*) into existing_count from public.profiles;
  if existing_count = 0 then
    insert into public.profiles (id, email, full_name, avatar_url, role)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'avatar_url',
      'super_admin'
    );
  else
    insert into public.profiles (id, email, full_name, avatar_url, role)
    values (
      new.id,
      new.email,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'avatar_url',
      'pending'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at honest.
create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
```

A migration file is added under `supabase/migrations/` so the schema is reproducible. The seed SQL is in this spec for review; the actual file is produced during implementation.

## Row-level security

```sql
alter table public.profiles enable row level security;

-- Anyone authenticated can read their own row.
create policy "self read"
  on public.profiles for select
  using (auth.uid() = id);

-- Admins and super_admins can read all rows.
create policy "admin read all"
  on public.profiles for select
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) in ('admin','super_admin')
  );

-- Anyone authenticated can update non-role columns of their own row.
create policy "self update non-role"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
  );

-- Admins can approve pending -> member.
create policy "admin approve pending"
  on public.profiles for update
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) = 'admin'
    and role = 'pending'
  )
  with check (role = 'member');

-- Super admins can update any row's role (and other columns).
create policy "super_admin update all"
  on public.profiles for update
  using (
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role'),
      (select role from public.profiles where id = auth.uid())
    ) = 'super_admin'
  );

-- Inserts: blocked for everyone. The trigger is the only path.
-- No INSERT policy required; default deny under RLS.

-- Deletes: blocked for everyone. Cascade via auth.users only.
-- No DELETE policy required; default deny under RLS.
```

The `coalesce(...)` pattern lets us choose later whether role lives in `app_metadata` (JWT claim) or in the `profiles.role` column itself. The admin panel's role-mutation paths write to `profiles.role` directly (no JWT round-trip), so the subquery path applies. ⏳ Migrating role into `app_metadata` for a faster RLS check is a future optimisation, not in scope here.

## Admin panel — user & role management

A single new route at `/app/#/admin/users`, rendered by a new `viewAdminUsers()` function in `views.js`. The route is reachable from a new "Admin" entry in the bottom navigation, visible only when the current user's role is `admin` or `super_admin`. The existing `getCurrentUser()` helper already returns role; the nav just filters entries.

The page shows:

- **Header:** "Admin · Users".
- **Summary line:** "N pending · M members · K admins · 1 super admin".
- **Pending applicants section** (only when N > 0): each row shows avatar, full name, email, sign-up date, with a single **Approve** button. Approve sets role to `member`. There is no "Reject" — pending applicants stay pending until an admin approves; the criteria for approval live in B.
- **Members list:** avatar, full name, email, role badge, joined date. Actions per role:
  - `member` row, viewed by `admin` or `super_admin`: **Promote to admin** (greyed out for admins with a tooltip "Only super admins can promote"; active for super admins).
  - `admin` row, viewed by `super_admin` (not themselves): **Demote to member**.
  - Any row except `super_admin`, viewed by `super_admin`: **Revoke** (sets role to `pending`, requires a typed-confirmation prompt: type the user's email to confirm).
  - Self row in any role: no actions; UI explains "You can't change your own role."
- **Empty state** for each section when it has no rows.

Actions write to `public.profiles` via the Supabase client using the session JWT (anon role). RLS enforces who can change what (see the policies above). The UI does optimistic updates with rollback on error; toast on success or failure.

The Admin nav entry joins the existing nav structure (`app/js/views.js` already builds the tab list from role-gated entries). On `/admin/users` the prototype renders the page using the same `card` / `kicker` / `badge` / `display` / `btn` / `muted` / `section-head` class palette per AGENTS.md.

## Demo account handling

- The seed accounts (`owner@itc.hk`, `admin@itc.hk`, `member@itc.hk`) and the two pending applicants (`marco.santos@example.com`, `jenny.wu@example.com`) stay in `app/js/data.js` for local development.
- **None are migrated to Supabase.** The live system starts clean.
- Local dev (`window.SUPABASE_URL` unset): prototype uses the localStorage seam + seed accounts as today.
- Production (`window.SUPABASE_URL` set): prototype uses Supabase, the seed accounts are unreachable, and the only way in is Google sign-in.

This split is the key affordance that lets the owner continue refining UX locally without provisioning a Supabase project on every machine.

## `store.js` seam

- **Not replaced in A or D.** `store.js` keeps reading and writing localStorage. C is the persistence migration sub-project.
- A thin entry-point shim is added: when `window.SUPABASE_URL` is set, user-related reads and writes (`getCurrentUser`, `signIn`, `signOut`, `listProfiles`, `updateProfileRole`, etc.) route through Supabase instead of localStorage. Everything else — activities, bookings, donations, attendance — stays on localStorage.
- This lets the owner ship live auth + admin panel in production without disrupting the existing flows, and lets A/B compare the localStorage-only build against the live-auth build by toggling the env var.
- The shim lives in `app/js/store.js` at the top of the file, gated on `window.SUPABASE_URL`. It does not change the rest of the prototype's rendering paths — `views.js` keeps reading from `getCurrentUser()` exactly as today; the new `viewAdminUsers()` reads from `listProfiles()` via the same seam.

## Error & edge handling

- **Token expired mid-session:** Supabase's client auto-refreshes; if refresh fails, the user is treated as logged out and bounced to the home tab (no toast on first bounce — same as today for unknown users).
- **User revoked in DB while signed in:** next API call returns 401 or 403. The shim clears the session and bounces to home.
- **OAuth cancelled by user:** Supabase surfaces an error in the URL hash; the shim catches and shows a one-line toast ("Sign-in was cancelled").
- **Network failure during OAuth callback:** Supabase client retries on its own. If the callback ultimately fails, the shim shows "Connection failed — try again" with a retry button.
- **First-sign-in race (two browsers signing in simultaneously):** the trigger's `count(*)` and `insert` run inside the same transaction; the second insert sees `existing_count = 1` and gets `pending`. Acceptable — the owner controls when the deployment opens to the public.
- **Profile row missing for an auth.users row** (e.g. trigger was added after some users already existed): the shim's `getCurrentUser` falls back to a minimal profile with `role = 'pending'` and writes it back. A one-time backfill query is included in the runbook.
- **Admin tries to demote themselves:** button is hidden in the UI; if somehow reached, RLS rejects the update with a permission error.
- **Admin clicks Approve twice quickly:** the second click is a no-op (role already `member`); `updated_at` advances; toast is shown once.
- **Admin promotes someone while offline:** the Supabase client queues the request and retries on reconnect; RLS re-evaluates and either succeeds or fails when the queue drains.

## Testing

- Extend `app/smoke.mjs` (or add a new `app/auth.smoke.mjs` if the existing file is already long) to cover:
  - The OAuth button is present on the Account screen in both local and live configurations.
  - In live configuration, the email-only sign-in input is gone.
  - In local configuration, the frictionless email field still works against the seed accounts (no regression).
  - The first-sign-in rule is testable against a Supabase local instance: two sign-ups, first is super_admin, second is pending.
  - RLS: a `pending` user cannot read another user's profile row; an admin can; a super_admin can update any other user's role; an admin can update `pending` → `member` but cannot update `member` → `admin`.
  - The `/admin/users` route renders the pending list, the members list, and the empty states; the Approve button is wired to a Supabase update call; destructive buttons require a typed confirmation.
- Manual staging check: sign in with three Google accounts on the staging deployment — first becomes super_admin, second becomes pending, the admin (the first) approves the second. Confirm the second now sees the member area.
- The smoke suite must pass before declaring done (per AGENTS.md).

## Operational runbook (additions)

The runbook lives in `docs/runbooks/live-auth.md` (new file in this branch's implementation) and covers:

- How to set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel env vars for the production deployment.
- How to confirm Google OAuth is enabled in the Supabase dashboard (Providers → Google → Enable; redirect URL set to `<origin>/auth/v1/callback`).
- The first-sign-in caveat and the SQL snippet to recover if anyone else signs in first:
  ```sql
  update public.profiles
     set role = 'super_admin'
   where email = '<owner email>';
  ```
- The one-time backfill query if the trigger is added after users already exist:
  ```sql
  insert into public.profiles (id, email, full_name, avatar_url, role)
  select u.id, u.email,
         u.raw_user_meta_data->>'full_name',
         u.raw_user_meta_data->>'avatar_url',
         'pending'
    from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id);
  ```
- How to tear down and reseed the local Supabase project during development.
- How to bootstrap a second admin during development: in the Supabase dashboard, edit the desired user's profile row to `role = 'admin'`. (No service-role script needed for A+D.)

## Explicit out-of-scope (deferred)

- **B — Approval workflow.** Covered by the sibling spec `2026-08-04-approval-workflow-design.md` on this branch. Adds the application form, audit log, welcome notification, and approval criteria that wrap the approve-transition mechanic in D. Approval criteria text and welcome copy are ⏳ awaiting ITC leadership review (flagged in B's spec).
- **C — Persistence migration.** Activities, bookings, donations, and receipts stay on localStorage. When C runs, `store.js` stops reading from localStorage for those tables and starts reading from Postgres tables defined there.
- **D — Activity / booking / payment admin.** Activity creation/editing, capacity changes, payment confirmations, refund flows, attendee lists, etc. already live partially on `feature/payment-system` (per the commits there) and continue to evolve there. This spec covers user & role admin only.
- **E — Policy & notifications.** Waiver text, privacy text, approval criteria, retention, and any email / WhatsApp / push channels are not in this spec. They are owned by the policy workshop flagged in the handoff document.
- **`feature/admin-info` (the branch the owner reserved earlier).** Removed; user/role admin lives on `feature/auth-identity`. The branch was empty behind main (tip at `64eb436`, an ancestor of main, no admin-info-specific commits) and has been deleted from origin to avoid confusion.