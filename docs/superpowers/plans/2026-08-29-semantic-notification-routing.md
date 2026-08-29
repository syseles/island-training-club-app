# Semantic Notification Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every known notification to its relevant app destination, especially `Booking reserved` to the exact booking payment page.

**Architecture:** Keep explicit valid destinations authoritative. Add deterministic client fallbacks for stable section-level destinations, then add a forward-only Supabase migration with one security-definer resolver and one `BEFORE INSERT` trigger that assigns entity-specific destinations while the related transaction rows are visible. Backfill only uniquely matched historical rows.

**Tech Stack:** Vanilla ES modules, delegated hash routing, Supabase PostgreSQL functions/triggers, Node smoke tests, disposable-database SQL verifier.

## Global Constraints

- Implement on `feature/notification-routing` only.
- Use migration `20260829000007_notification_destinations.sql`; `00005` and `00006` are reserved by Admin and RSVP branches.
- `operational_booking_reserved` must route to `#/pay/<booking-id>` when an exact booking is known.
- Preserve any explicit destination that starts with `#/`.
- Never route a member to another profile’s booking; entity matching must include `profile_id` and require exactly one candidate.
- Unknown kinds and ambiguous historical entity matches retain safe fallback behavior.
- Preserve notification producer function bodies/signatures, notification RLS, `read_at`, copy, and mark-read-before-navigation behavior.
- Do not add dependencies, a build step, or localStorage changes.
- Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, `bash supabase/tests/verify_operational_backend_safety.sh`, and `git diff --check` before completion.

---

### Task 1: Add semantic client fallback routes

**Files:**
- Modify: `app/js/data.js` in `notificationDestination()`
- Test: `app/smoke.mjs` near notification helper assertions
- Test: `app/live-auth-smoke.mjs` near notification rendering and delegated opening

**Interfaces:**
- Produces: unchanged `notificationDestination(kind, destination)` signature.
- Consumes: optional explicit internal hash destination.
- Invariant: entity-specific explicit routes win; kind-only fallback never invents a booking or session ID.

- [ ] **Step 1: Write failing pure mapping tests**

Add a table-driven assertion for these exact stable fallbacks:

```js
const notificationFallbacks = new Map([
  ["operational_booking_reserved", "#/account/payments"],
  ["operational_rsvp_confirmed", "#/account/payments"],
  ["operational_payment_approved", "#/account/payments"],
  ["operational_session_deferred", "#/account/payments"],
  ["operational_session_cancelled_no_defer", "#/schedule"],
  ["operational_payment_marked", "#/admin/payments"],
  ["operational_gym_finalized", "#/admin/payments"],
  ["operational_session_cancelled", "#/schedule"],
  ["operational_session_venue_updated", "#/schedule"],
  ["admin_application_submitted", "#/admin/approvals"],
  ["admin_application_approved", "#/admin/members"],
  ["admin_application_declined", "#/admin/members"],
  ["admin_role_promoted", "#/admin/members"],
  ["admin_role_demoted", "#/admin/members"],
  ["admin_membership_revoked", "#/admin/members"],
  ["admin_role_changed", "#/admin/members"],
  ["giving_campaign_published", "#/giving"],
  ["welcome", "#/account"],
]);
```

Also assert a valid explicit route such as `#/pay/booking-123` wins for every kind, malformed/foreign values do not, and an unknown kind falls back to `#/account`.

- [ ] **Step 2: Run RED**

Run: `node app/smoke.mjs`

Expected: FAIL because operational booking/payment kinds currently fall through to `#/account`.

- [ ] **Step 3: Implement kind-level fallbacks**

Refactor `notificationDestination()` into stable sets/maps while preserving the leading-`#/` explicit-route check. Return only the exact routes in Step 1; do not parse body text or infer IDs in the client.

- [ ] **Step 4: Verify rendering and delegated navigation**

In `app/live-auth-smoke.mjs`, render known notifications without explicit destinations and assert their `data-destination` section fallbacks. Preserve existing tests proving notification opening marks unread rows before setting `location.hash`, and that failed mark-read prevents navigation.

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: both suites pass.

- [ ] **Step 5: Commit**

```bash
git add app/js/data.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(notifications): add semantic route fallbacks"
```

---

### Task 2: Assign exact destinations at the notification insert boundary

**Files:**
- Create: `supabase/migrations/20260829000007_notification_destinations.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Test: `app/smoke.mjs` migration source contracts

**Interfaces:**
- Produces: `public.resolve_notification_destination(uuid, text, timestamptz)` returning `text` or null.
- Produces: `public.route_notification_destination()` trigger function and `notifications_route_destination` `BEFORE INSERT` trigger.
- Consumes: `notifications.profile_id`, `kind`, `created_at`, and operational booking/session timestamps.

- [ ] **Step 1: Write failing migration source contracts**

In `app/smoke.mjs`, load `20260829000007_notification_destinations.sql` and assert it contains:

```js
for (const marker of [
  "security definer",
  "set search_path = public",
  "before insert on public.notifications",
  "resolve_notification_destination",
  "operational_booking_reserved",
  "#/pay/",
  "count(*)",
  "profile_id",
  "revoke all on function public.resolve_notification_destination",
]) assert.ok(notificationRoutingMigrationSource.toLowerCase().includes(marker));
```

Assert the migration does not disable RLS or grant notification-table writes.

- [ ] **Step 2: Run RED**

Run: `node app/smoke.mjs`

Expected: FAIL with `ENOENT` because migration `00007` does not exist.

- [ ] **Step 3: Implement the resolver**

Create a `STABLE`, `SECURITY DEFINER`, fixed-search-path PL/pgSQL function:

```sql
public.resolve_notification_destination(
  p_profile_id uuid,
  p_kind text,
  p_created_at timestamptz
) returns text
```

For stable kinds, return the exact section routes from the design. For booking-specific kinds, select candidates belonging to `p_profile_id` whose relevant timestamp is within five seconds of `p_created_at`; return an entity route only when `count(*) = 1`:

- `operational_booking_reserved`: `reserved_at` → `#/pay/<id>`
- `operational_rsvp_confirmed`: `reserved_at` → `#/booking/<id>`
- `operational_payment_approved`: `paid_at` → `#/booking/<id>`
- `operational_session_deferred`: new booking `reserved_at` with non-null `deferred_from_booking_id` → `#/booking/<id>`

For session-specific kinds, require exactly one timestamp-matched session when the transaction supplies no profile-owned booking relation:

- `operational_session_cancelled_no_defer`: cancelled session → `#/activity/<session-id>`
- `operational_session_cancelled`: cancelled session → `#/activity/<session-id>`

Return null for zero or multiple candidates. Never parse notification body text.

- [ ] **Step 4: Add the insert trigger and safe grants**

Create `route_notification_destination()` as `SECURITY DEFINER` with fixed search path. If `NEW.destination` begins with `#/`, return it unchanged. Otherwise set it from the resolver and return `NEW`.

Drop/recreate one `BEFORE INSERT` trigger named `notifications_route_destination`. Revoke resolver/trigger-function execution from `public` and `anon`; no browser execution grant is needed because the trigger invokes them internally. Do not alter notification RLS or producer functions.

- [ ] **Step 5: Backfill existing rows safely**

Update only rows with null or malformed destinations:

```sql
update public.notifications n
   set destination = public.resolve_notification_destination(
     n.profile_id, n.kind, n.created_at
   )
 where (n.destination is null or left(n.destination, 2) <> '#/')
   and public.resolve_notification_destination(
     n.profile_id, n.kind, n.created_at
   ) is not null;
```

Do not change `read_at`, title, body, kind, or explicit valid destinations. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 6: Add SQL integration scenarios**

In `supabase/tests/operational_backend_integration.sql`, inside rollback-safe transactions, assert:

- A newly reserved paid booking creates `Booking reserved` with exact `#/pay/<booking-id>`.
- A new RSVP creates exact Booking Details destination.
- Payment approval and deferral route to the exact resulting booking.
- Payment-marked/gym-finalized Admin rows use `#/admin/payments`.
- Explicit `#/giving` remains unchanged.
- Same-profile unique historical reservation backfills correctly.
- A same-time ambiguous pair remains null.
- Another profile’s booking is never selected.
- Existing `read_at` remains unchanged.

- [ ] **Step 7: Run available verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

If disposable database credentials are available, also run `bash supabase/tests/verify_operational_backend.sh`. Otherwise report SQL execution and deployment as unverified.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260829000007_notification_destinations.sql \
  supabase/tests/operational_backend_integration.sql app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(notifications): route operational destinations"
```

---

### Task 3: Prove exact Booking reserved payment navigation

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Verify: `app/js/views.js` notification row renderer
- Verify: `app/js/app.js` `notification-open` delegation

**Interfaces:**
- Consumes: live notification row with `destination = '#/pay/<booking-id>'`.
- Produces: end-to-end regression evidence from rendered row through delegated hash navigation.

- [ ] **Step 1: Add exact rendered-route coverage**

Use the live reservation fixture’s real booking ID. Add a notification row whose destination matches `#/pay/${booking.id}`, render Notifications, and extract the `Booking reserved` button. Assert its exact `data-destination` is the payment route, not `#/account` or `#/account/payments`.

- [ ] **Step 2: Add delegated open coverage**

Dispatch the real `notification-open` handler with that notification ID/destination. Assert:

1. `markNotificationRead()` completes.
2. `location.hash` becomes exactly `#/pay/<booking-id>`.
3. The payment view accepts the current member’s reserved booking.

Repeat with an already-read row to prove read state does not change routing.

- [ ] **Step 3: Run final verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
git status --short --branch
```

Expected: all available checks pass. Do not claim live routing fixed until migration `00007` is applied remotely.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-29-semantic-notification-routing.md app/live-auth-smoke.mjs
git commit -m "test(notifications): cover payment destination navigation"
```
