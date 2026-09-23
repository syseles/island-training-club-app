# Retire BFT and Midtown HYROX Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Island ECC the only active HYROX session while retaining BFT/Midtown test rows in Supabase but making them unreadable and immutable through the live app.

**Architecture:** A forward-only Supabase migration creates the authoritative retirement boundary using exact activity relationships, revoked pool RPCs, filtered RLS, and guarded wrappers around shared RPCs. A small frontend retirement classifier filters stale live/local records before cache entry, v24 removes pool records from active local state, and member/Admin routes delete the obsolete pool workflow while preserving Island ECC’s direct paid-session lifecycle.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, vanilla JavaScript ES modules, localStorage state migrations, Node smoke tests, Bash safety tests, rollback-scoped SQL integration tests, Vercel static deployment.

**Spec:** `docs/superpowers/specs/2026-09-21-retire-bft-midtown-hyrox-pool-design.md`

## Global Constraints

- Island ECC (`hyrox-quarry-bay`) is the sole active HYROX product and keeps its existing wording and direct booking workflow.
- Retired IDs are exactly `hyrox-bft` and `hyrox-midtown`; substring matching is never authoritative.
- Existing Supabase pool-domain rows remain physically present and row counts remain unchanged.
- Browser roles cannot read or mutate retained pool-domain records.
- No retirement cancellation or member notification is emitted.
- Use a new forward-only migration; do not edit or replay historical migrations.
- Bump local state from v23 to v24 with an explicit migration.
- Do not add dependencies, a build step, or framework code.
- Do not touch Shop, merchandise, catalog/cart, or product imagery.
- Apply and verify the database migration before deploying dependent frontend code.

---

### Task 1: Establish the authoritative Supabase retirement boundary

**Files:**
- Create: `supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql`
- Create: `supabase/tests/retire_hyrox_pool_safety.sh`
- Create: `supabase/tests/retire_hyrox_pool_integration.sql`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: SQL helpers `public.operational_is_retired_hyrox_activity(text) returns boolean`, `public.operational_is_retired_hyrox_session(text) returns boolean`, and `public.operational_is_retired_hyrox_booking(uuid) returns boolean`.
- Produces: an inactive template boundary for `hyrox-bft` and `hyrox-midtown` while explicitly preserving `hyrox-quarry-bay`.
- Produces: browser-denied pool RPCs and guarded shared RPCs that later frontend tasks may assume cannot mutate retired rows.
- Consumes: existing operational tables/functions from migrations `20260808000001` through `20260920000001`.

- [ ] **Step 1: Add the failing static migration safety test**

Create `supabase/tests/retire_hyrox_pool_safety.sh`. The script must fail unless the new migration:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql"
test -f "$MIGRATION"
grep -Fq "hyrox-bft" "$MIGRATION"
grep -Fq "hyrox-midtown" "$MIGRATION"
grep -Fq "hyrox-quarry-bay" "$MIGRATION"
grep -Fq "operational_is_retired_hyrox_activity" "$MIGRATION"
grep -Fq "operational_is_retired_hyrox_session" "$MIGRATION"
grep -Fq "operational_is_retired_hyrox_booking" "$MIGRATION"
grep -Fq "revoke execute" "$MIGRATION"
! grep -Eiq '\b(delete from|truncate)\b.*(operational_hyrox|operational_bookings|operational_receipts|notifications)' "$MIGRATION"
! grep -Eiq 'insert into public\.notifications|cancel_hyrox_cycle\s*\(' "$MIGRATION"
echo "retired HYROX pool migration safety passed"
```

Extend `app/smoke.mjs` to assert that the migration version is unique and the historical pool migration files retain their current SHA/content markers.

- [ ] **Step 2: Run the safety tests and verify RED**

Run:

```bash
bash supabase/tests/retire_hyrox_pool_safety.sh
node app/smoke.mjs
```

Expected: the safety script fails because `20260922000001_retire_bft_midtown_hyrox_pool.sql` does not exist.

- [ ] **Step 3: Add the failing rollback-scoped authenticated integration test**

Create `supabase/tests/retire_hyrox_pool_integration.sql`, opening the test with `begin;` and ending it with `rollback;`. Build fixtures for one member, one Admin, BFT/Midtown/Island ECC sessions, one pool cycle, pool bookings/receipt/queues/replacement/notifications, and one Island ECC direct booking.

The test must assert:

```sql
-- trusted owner still sees retained fixtures
select retire_assert((select count(*) from public.operational_hyrox_cycles where id = v_cycle_id) = 1,
  'trusted pool cycle must remain stored');
select retire_assert((select count(*) from public.operational_bookings where hyrox_cycle_id = v_cycle_id) > 0,
  'trusted pool bookings must remain stored');

-- templates and provisioning
select retire_assert(not (select active from public.operational_activity_templates where activity_id = 'hyrox-bft'),
  'BFT template must be inactive');
select retire_assert(not (select active from public.operational_activity_templates where activity_id = 'hyrox-midtown'),
  'Midtown template must be inactive');
select retire_assert((select active from public.operational_activity_templates where activity_id = 'hyrox-quarry-bay'),
  'Island ECC must remain active');

-- browser access and mutation
set local role authenticated;
select set_config('request.jwt.claim.sub', v_member_id::text, true);
select retire_expect_denied('select * from public.operational_hyrox_cycles');
select retire_expect_denied('select public.reserve_hyrox_cycle(''' || v_cycle_id || ''',''either'',true)');
reset role;

-- shared direct-session behavior remains available
set local role authenticated;
select set_config('request.jwt.claim.sub', v_member_id::text, true);
select public.reserve_operational_session(v_island_ecc_session_id);
reset role;
```

Also assert unchanged fixture row counts, no new notification rows, no newly provisioned cycles, Admin denial for pool controls, replacement-list exclusion, and successful Island ECC payment/confirmation/attendance/replacement/receipt/waitlist operations.

- [ ] **Step 4: Run the integration test and verify RED**

Start/reset the disposable local Supabase stack, then run:

```bash
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/retire_hyrox_pool_integration.sql
```

Expected: FAIL because templates remain active, pool reads/mutations remain available, and provisioning still creates cycles.

- [ ] **Step 5: Implement the forward-only migration**

Create `supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql` with these exact boundaries:

```sql
create or replace function public.operational_is_retired_hyrox_activity(p_activity_id text)
returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(p_activity_id, '') = any (array['hyrox-bft', 'hyrox-midtown']);
$$;

create or replace function public.operational_is_retired_hyrox_session(p_session_id text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.operational_sessions s
    where s.id = p_session_id
      and public.operational_is_retired_hyrox_activity(s.activity_id)
  );
$$;

create or replace function public.operational_is_retired_hyrox_booking(p_booking_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
     where b.id = p_booking_id
       and (b.hyrox_cycle_id is not null
         or public.operational_is_retired_hyrox_activity(s.activity_id))
  );
$$;
```

Then:

- assert all three canonical templates exist and `hyrox-quarry-bay` is not classified retired;
- update only `hyrox-bft` and `hyrox-midtown` templates to `active = false`;
- revoke browser execution for every pool-only function:
  `ensure_hyrox_cycles`, `reserve_hyrox_cycle`, `join_hyrox_cycle_waitlist`, `leave_hyrox_cycle_queue`, `schedule_hyrox_cycle`, `sweep_hyrox_cycle_deadlines`, `reject_hyrox_cycle_payment`, `finalize_hyrox_venue_plan`, `select_hyrox_cycle_venue`, `join_hyrox_venue_switch_queue`, `leave_hyrox_venue_switch_queue`, `close_hyrox_venue_allocation`, `cancel_hyrox_cycle`, `send_hyrox_collector_payment_reminder`, `send_hyrox_member_payment_reminders`, and `send_hyrox_venue_reminders` using their exact signatures;
- replace provisioning/background entry points with owner-only no-op or retired-state functions so scheduled/internal calls cannot create records or notifications;
- revoke direct browser access to `operational_hyrox_cycles` and `operational_hyrox_queue_entries`;
- replace operational template/session/booking/queue/receipt SELECT policies so retired relationships are excluded for both members and Admins;
- replace notification SELECT/update policies so exact `operational_hyrox_*` kinds and notification destinations resolving to retired bookings/sessions are excluded;
- wrap shared RPCs by renaming each existing implementation to an owner-only `_pre_pool_retirement_20260922` function, revoking that renamed function from browser roles, and recreating the public signature with a retired-target guard before delegating. Apply this to direct reservation/release, payment mark/approve/reject where shared, attendance, gym finalization, replacement create/read/list/decision, and any generic session mutation that accepts a retired child session;
- preserve grants and behavior for `hyrox-quarry-bay` and all non-retired sessions;
- revoke execute on the three helper functions from `anon, authenticated` so callers cannot use them as an enumeration side channel.

Do not issue `DELETE`, `TRUNCATE`, cancellation calls, or notification inserts.

- [ ] **Step 6: Run backend tests and verify GREEN**

Run:

```bash
bash supabase/tests/retire_hyrox_pool_safety.sh
node app/smoke.mjs
supabase db reset --local --no-seed
docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/retire_hyrox_pool_integration.sql
```

Expected: all pass; the SQL test ends with `ROLLBACK` and `OK: retired HYROX pool boundary`.

- [ ] **Step 7: Commit the backend boundary**

```bash
git add supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql \
  supabase/tests/retire_hyrox_pool_safety.sh \
  supabase/tests/retire_hyrox_pool_integration.sql app/smoke.mjs
git commit -m "feat(hyrox): retire BFT Midtown backend"
```

---

### Task 2: Add a single exact frontend retirement classifier and filter live caches

**Files:**
- Create: `app/js/hyrox-retirement.js`
- Create: `app/hyrox-retirement-smoke.mjs`
- Modify: `app/js/operations.js`
- Modify: `app/js/store.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces: `RETIRED_HYROX_ACTIVITY_IDS`, `isRetiredHyroxActivityId(id)`, `isRetiredHyroxSession(session)`, `isRetiredHyroxBooking(booking, getSession)`, `isRetiredHyroxReceipt(receipt, getBooking)`, `isRetiredHyroxNotification(notification, getBooking)`, and `isRetiredHyroxLegacyRouteId(id)`.
- Consumes: canonical normalized fields `activityId`, `activity_id`, `sessionId`, `session_id`, `cycleId`, `hyrox_cycle_id`, `bookingId`, and notification `kind`/`destination`.
- Guarantees: `hyrox-quarry-bay` is always false.

- [ ] **Step 1: Write the failing classifier tests**

Create `app/hyrox-retirement-smoke.mjs` with assertions including:

```js
assert.equal(isRetiredHyroxActivityId("hyrox-bft"), true);
assert.equal(isRetiredHyroxActivityId("hyrox-midtown"), true);
assert.equal(isRetiredHyroxActivityId("hyrox-quarry-bay"), false);
assert.equal(isRetiredHyroxActivityId("event-hyrox-bft-party"), false);
assert.equal(isRetiredHyroxSession({ activityId: "hyrox-bft" }), true);
assert.equal(isRetiredHyroxSession({ id: "hyrox-bft-2099-01-03" }), false,
  "session IDs alone are not authoritative for hydrated records");
assert.equal(isRetiredHyroxBooking({ cycleId: "hyrox-pool-1" }, () => null), true);
assert.equal(isRetiredHyroxBooking({ sessionId: "ecc" }, () => ({ activityId: "hyrox-quarry-bay" })), false);
```

Add fixtures proving receipts inherit retirement from bookings and `operational_hyrox_*` notifications or destinations linked to retired bookings are hidden without hiding Island ECC payment notifications.

- [ ] **Step 2: Run the classifier test and verify RED**

Run: `node app/hyrox-retirement-smoke.mjs`

Expected: FAIL because `app/js/hyrox-retirement.js` does not exist.

- [ ] **Step 3: Implement the classifier**

Create `app/js/hyrox-retirement.js` using exact `Set` membership and relationship callbacks. Do not classify arbitrary strings by substring. Permit an ID-prefix check only in a separately named route helper such as `isRetiredHyroxLegacyRouteId(id)`, limited to known legacy route forms:

```js
export const RETIRED_HYROX_ACTIVITY_IDS = new Set(["hyrox-bft", "hyrox-midtown"]);
export const isRetiredHyroxActivityId = (id) => RETIRED_HYROX_ACTIVITY_IDS.has(String(id || ""));
export const isRetiredHyroxSession = (session) =>
  isRetiredHyroxActivityId(session?.activityId ?? session?.activity_id);
export const isRetiredHyroxBooking = (booking, getSession = () => null) =>
  Boolean(booking?.cycleId ?? booking?.hyrox_cycle_id)
  || isRetiredHyroxSession(getSession(booking?.sessionId ?? booking?.session_id));
```

Implement receipt and notification classification through related booking/session resolution and exact pool notification kinds.

- [ ] **Step 4: Write failing live-cache boundary tests**

Extend `app/live-auth-smoke.mjs` so mixed Supabase fixture responses contain BFT, Midtown, and Island ECC rows across sessions, bookings, receipts, queues, cycles, replacements, and notifications. Assert:

```js
assert.deepEqual(store.upcomingSessions(21).map((row) => row.activityId), ["hyrox-quarry-bay"]);
assert.equal(store.getBooking("pooled-booking"), null);
assert.equal(store.getReceipt("pooled-receipt"), null);
assert.equal(store.listHyroxCycles().length, 0);
assert.ok(store.getSession(islandEccSessionId));
```

Also assert hydration issues no `operational_hyrox_cycles` or `operational_hyrox_queue_entries` browser query/subscription.

- [ ] **Step 5: Run live-auth smoke and verify RED**

Run: `node app/live-auth-smoke.mjs`

Expected: FAIL because retired rows still hydrate and cycle tables are still queried/subscribed.

- [ ] **Step 6: Filter live hydration and remove cycle cache access**

In `app/js/operations.js`:

- import the classifier;
- remove cycle/queue tables from `LIVE_TABLES`, hydration queries, cache shape, and Realtime subscriptions;
- filter templates, sessions, bookings, queues, receipts, assignments, overrides, and replacements before committing `liveCache`;
- make `listLiveHyroxCycles`, `getLiveHyroxCycle`, and `liveHyroxQueuesForCycle` return empty/null temporarily for compatibility until active call sites are removed;
- ensure shared selectors resolve Island ECC normally.

In `app/js/store.js`:

- filter live/local booking, receipt, notification, replacement, and session selectors through the classifier;
- make legacy pool getters return null/empty;
- reject retired targets with `This session is no longer available.` before any live RPC call;
- keep direct Island ECC operations unchanged.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
node app/hyrox-retirement-smoke.mjs
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: all pass.

- [ ] **Step 8: Commit the frontend data boundary**

```bash
git add app/js/hyrox-retirement.js app/hyrox-retirement-smoke.mjs \
  app/js/operations.js app/js/store.js app/live-auth-smoke.mjs
git commit -m "feat(hyrox): filter retired pool data"
```

---

### Task 3: Migrate local state to v24 and seed only Island ECC

**Files:**
- Modify: `app/js/data.js`
- Modify: `app/js/store.js`
- Modify: `app/js/hyrox-cycle.js` or delete it if no active imports remain after Task 5
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: retirement predicates from `app/js/hyrox-retirement.js`.
- Produces: `STATE_VERSION = 24` and a deterministic v23-to-v24 migration.
- Guarantees: all v9-v23 fixtures reach v24 with non-pool records intact.

- [ ] **Step 1: Write failing v24 migration and seed tests**

Extend `app/smoke.mjs` with a v23 fixture containing BFT/Midtown templates, generated sessions, cycle queues, pooled bookings/receipts/replacements/notifications/overrides/duty assignments, plus Island ECC and unrelated records.

Assert after migration:

```js
assert.equal(state.version, 24);
assert.equal(state.activities.some((row) => ["hyrox-bft", "hyrox-midtown"].includes(row.id)), false);
assert.equal(state.activities.some((row) => row.id === "hyrox-quarry-bay"), true);
assert.equal(state.hyroxCycles.length, 0);
assert.equal(state.hyroxCycleQueues.length, 0);
assert.equal(state.bookings.some((row) => row.cycleId), false);
assert.equal(state.receipts.some((row) => row.bookingId === pooledBookingId), false);
assert.ok(state.bookings.some((row) => row.id === islandEccBookingId));
assert.ok(state.notifications.some((row) => row.id === unrelatedNotificationId));
```

Test fresh state contains Island ECC and no BFT/Midtown activities.

- [ ] **Step 2: Run smoke and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because state remains v23 and pool seeds/records remain active.

- [ ] **Step 3: Implement v24**

In `app/js/data.js`, remove `hyrox-bft` and `hyrox-midtown` from `SEED_ACTIVITIES`; retain `hyrox-quarry-bay` unchanged.

In `app/js/store.js`:

- set `STATE_VERSION = 24`;
- add a v24 migration after all earlier migration steps;
- collect retired session IDs and pool booking IDs before filtering;
- remove retired records from active local arrays/maps in dependency order;
- clear `hyroxCycles` and `hyroxCycleQueues` without removing those state keys;
- remove retired overrides, collector/duty references, replacements, and notifications;
- preserve Island ECC and unrelated rows exactly;
- finish with `state.version = STATE_VERSION` through the existing migration path.

Do not rewrite older migration steps: genuine v9-v22 fixtures must first migrate normally, then pass through v24 retirement.

- [ ] **Step 4: Run migration regression tests and verify GREEN**

Run:

```bash
node app/smoke.mjs
node app/hyrox-retirement-smoke.mjs
```

Expected: all migration fixtures reach v24 and pass.

- [ ] **Step 5: Commit local retirement**

```bash
git add app/js/data.js app/js/store.js app/js/hyrox-cycle.js app/smoke.mjs
git commit -m "feat(hyrox): migrate local state off pool"
```

---

### Task 4: Remove member pool routes, views, actions, and copy

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/js/views.js`
- Modify: `app/js/store.js`
- Modify: `app/js/operations.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`
- Test: `app/test-html.mjs`

**Interfaces:**
- Consumes: `isRetiredHyroxLegacyRouteId(id)` and active-row filters from Task 2.
- Produces: `viewRetiredSession()` returning the neutral copy `This session is no longer available.`
- Removes: active `#/hyrox/:cycle`, `#/hyrox/:cycle/register`, pool registration/payment/allocation, and Midtown-interest actions.

- [ ] **Step 1: Write failing member UI and route tests**

Add smoke assertions that visitor/member Home, Schedule, Profile, bookings, history, payments, receipts, and notifications contain Island ECC but do not contain:

```js
/BFT Causeway Bay|Midtown28|Midtown 28|BFT \+ Midtown Pool|venue allocation|switch queue|Wait for Midtown/i
```

Assert old routes:

```js
assert.match(await renderRoute("#/activity/hyrox-bft-2099-01-03"), /This session is no longer available/);
assert.match(await renderRoute("#/hyrox/hyrox-pool-2099-01-03"), /This session is no longer available/);
assert.match(await renderRoute("#/booking/retired-pool-booking"), /This session is no longer available/);
```

Assert Island ECC still renders reserve/pay/booking/receipt/replacement controls.

- [ ] **Step 2: Run app tests and verify RED**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/test-html.mjs
```

Expected: FAIL on pool cards/copy/routes.

- [ ] **Step 3: Remove active member pool presentation**

In `app/js/views.js`:

- add `viewRetiredSession()` using the neutral unavailable state;
- delete `hyroxCycleVenues`, venue preference/status helpers, `hyroxCycleRow`, `hyroxVenueCards`, `viewHyroxCycle`, `viewHyroxRegistration`, and `pooledBookingRow` once call sites are gone;
- render Schedule from ordinary active sessions only;
- remove pooled booking branches from Home, Profile, booking, payment, and receipt views;
- preserve generic direct paid-session branches used by Island ECC.

In `app/js/app.js`:

- remove active pool route rendering and return `viewRetiredSession()` for known legacy pool IDs;
- remove delegated `hyrox-allocation-close`, pool reserve/waitlist/venue-selection/switch, pool payment rejection, pool cancellation, and Midtown-interest handlers;
- preserve generic direct-session handlers.

In `app/js/store.js` and `operations.js`, remove now-unused active pool exports/imports and RPC adapters. Delete `app/js/hyrox-cycle.js` only if `rg 'hyrox-cycle.js' app` confirms no compatibility import remains.

Remove CSS used exclusively by deleted pool components; keep shared classes and Island ECC styles.

- [ ] **Step 4: Run focused member tests and verify GREEN**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/test-html.mjs
node app/replacement-operations-smoke.mjs
```

Expected: all pass with Island ECC controls intact and no member pool UI.

- [ ] **Step 5: Commit member UI retirement**

```bash
git add app/js/app.js app/js/views.js app/js/store.js app/js/operations.js \
  app/js/hyrox-cycle.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): remove member pool workflow"
```

---

### Task 5: Remove Admin pool operations while preserving Island ECC administration

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/js/store.js`
- Modify: `app/js/operations.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`
- Test: `app/replacement-operations-smoke.mjs`

**Interfaces:**
- Consumes: filtered direct paid-session selectors from Tasks 2–4.
- Produces: Admin Activities/Payments containing only active generic controls and the existing Island ECC handoff/roster.
- Removes: pool setup, allocation, financial rosters, venue queues, pooled attendance, and collector reminders.

- [ ] **Step 1: Write failing Admin regression tests**

Assert Admin Activities and Payments do not render pool-specific content or action contracts:

```js
for (const html of [adminActivitiesHtml, adminPaymentsHtml]) {
  assert.doesNotMatch(html, /BFT|Midtown|shared pool|venue allocation|switch queue/i);
  assert.doesNotMatch(html, /hyrox-allocation-close|midtown-toggle|form-cancel-hyrox-cycle/);
}
assert.match(adminActivitiesHtml, /Island ECC/);
assert.match(adminPaymentsHtml, /Island ECC/);
```

Add delegated-handler source assertions proving pool actions are absent and direct Island ECC payment, attendance, replacement, and waitlist actions remain.

- [ ] **Step 2: Run Admin tests and verify RED**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/replacement-operations-smoke.mjs
```

Expected: FAIL because pooled Admin cards and handlers remain.

- [ ] **Step 3: Remove Admin pool code**

In `app/js/views.js`, delete active use of:

- `adminHyroxGymControls`,
- `paymentVisibleHyroxCycles`,
- `adminHyroxCycleCards`,
- `adminHyroxWeeklyBookingSetup`,
- BFT/Midtown venue handoff pairing and pooled queue labels.

Keep and simplify `adminIslandEccHandoff` so it consumes the direct Island ECC session, not a cycle. Ensure generic paid-session controls include Island ECC exactly once.

In `app/js/app.js`, remove remaining Admin pool mutation handlers and forms. In `store.js`/`operations.js`, remove unused pool Admin adapters. Preserve direct session, payment, attendance, replacement, collector payout, and queue methods.

- [ ] **Step 4: Run Admin and whole-app tests and verify GREEN**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/replacement-operations-smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
node app/avatar-smoke.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit Admin retirement**

```bash
git add app/js/views.js app/js/app.js app/js/store.js app/js/operations.js \
  app/live-auth-smoke.mjs app/smoke.mjs app/replacement-operations-smoke.mjs
git commit -m "feat(admin): remove HYROX pool operations"
```

---

### Task 6: Update current documentation and complete branch verification

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/operational-backend.md`
- Modify: `docs/runbooks/live-auth.md`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: final retired behavior from Tasks 1–5.
- Produces: current documentation naming Island ECC as the sole active HYROX session and a rollout/rollback procedure for migration `20260922000001`.

- [ ] **Step 1: Add failing documentation contracts**

Extend `app/smoke.mjs` to assert current docs:

- name migration `20260922000001_retire_bft_midtown_hyrox_pool.sql`;
- state Island ECC is the only active HYROX session;
- say retained pool test records are hidden, not deleted;
- contain backend-first deployment and forward-only rollback instructions;
- do not describe BFT/Midtown as current launch behavior.

Historical specs/plans are excluded from this copy assertion.

- [ ] **Step 2: Run smoke and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because README/runbooks still describe the shared pool as active.

- [ ] **Step 3: Update current docs**

Update `README.md`, `docs/runbooks/operational-backend.md`, and `docs/runbooks/live-auth.md` with:

- Island ECC-only current behavior;
- exact migration order;
- production inventory queries and count-only evidence rules;
- migration apply/verification steps;
- frontend deployment order;
- browser denial and Island ECC acceptance checks;
- forward rollback approach.

Do not rewrite historical design/plan documents.

- [ ] **Step 4: Run the complete local verification matrix**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/avatar-smoke.mjs
node app/replacement-operations-smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
node app/test-html.mjs
bash supabase/tests/retire_hyrox_pool_safety.sh
bash supabase/tests/declined_profile_decisions_safety.sh
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
bash supabase/tests/prayer_requests_safety.sh
(cd supabase/functions && "$HOME/.deno/bin/deno" test --allow-env --allow-read --allow-net)
(cd supabase/functions && "$HOME/.deno/bin/deno" fmt --check)
(cd supabase/functions && "$HOME/.deno/bin/deno" lint)
git diff --check origin/main...HEAD
```

Reset a disposable local Supabase stack and rerun both the retirement integration and adjacent prayer/declined integrations. Expected: every command passes.

- [ ] **Step 5: Conduct a whole-branch review**

Review `origin/main...HEAD` for:

- any remaining active BFT/Midtown UI/action/RPC path;
- accidental Island ECC filtering;
- direct-table browser leaks;
- destructive SQL or notification side effects;
- migration version collisions;
- Shop or unrelated changes.

Fix findings test-first and rerun Step 4.

- [ ] **Step 6: Commit documentation and final test contracts**

```bash
git add README.md docs/runbooks/operational-backend.md docs/runbooks/live-auth.md app/smoke.mjs
git commit -m "docs(hyrox): document pool retirement rollout"
```

---

### Task 7: Deploy backend, validate Testing, and promote production

**Files:**
- No product source files unless acceptance finds a test-first defect.
- Record non-secret evidence under ignored `.superpowers/sdd/2026-09-21-retire-hyrox-pool/`.

**Interfaces:**
- Consumes: reviewed migration `20260922000001` and the exact accepted frontend branch.
- Produces: migrated Supabase project, accepted Testing deployment, and promoted production deployment.

- [ ] **Step 1: Run the read-only production inventory**

From a linked Supabase worktree, query count-only evidence for templates, sessions, cycles, bookings by state, receipts, queues, replacements, and notifications related through exact activity/cycle relationships. Record the current remote migration list and SHA-256 of the new migration.

Assert Island ECC exists and is active. Confirm the future pool rows match the user-authorized test-data classification. Do not log member names, emails, request content, or payment references.

- [ ] **Step 2: Apply only migration `20260922000001`**

Verify remote preflight still has active pool templates and does not have version `20260922000001`. Apply the reviewed file unchanged with `supabase db query --linked --file supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql`; verify policies/grants/helpers/template states and unchanged retained row counts; then record only version `20260922000001` with `supabase migration repair 20260922000001 --status applied --linked --yes`.

Stop immediately if the file hash, preflight state, row counts, or Island ECC assertions differ.

- [ ] **Step 3: Run authenticated backend acceptance**

Using disposable member/Admin fixtures, prove:

- browser roles cannot read pool cycles/queues or resolve pool bookings/receipts/replacements;
- every pool mutation is denied without side effects;
- provisioning creates zero pool rows;
- no retirement notification appears;
- Island ECC reserve → mark paid → Admin confirm → attendance → replacement → receipt and waitlist behavior passes.

Delete all disposable users/content and verify zero remaining fixture rows.

- [ ] **Step 4: Open and merge the reviewed PR to `testing`**

Push the feature branch, open a PR targeting `testing`, wait for checks, merge, and wait for the Testing Vercel deployment. Run `app/deployment-routing-smoke.mjs` against the Testing origin.

- [ ] **Step 5: Run Testing browser acceptance**

At 375px in current Chrome and Safari, verify visitor/member/Admin surfaces, old deep links, no BFT/Midtown text or controls, no clipping, and the full Island ECC lifecycle. Include pending/declined gates and notification/history counts so retired rows cannot leak indirectly.

Clean all fixtures and verify database row counts for retained pool data are unchanged from Step 1.

- [ ] **Step 6: Promote the exact Testing snapshot to `main`**

After final review and fresh verification, open `testing -> main`, confirm no Shop files, merge after green checks, and wait for the canonical production deployment.

- [ ] **Step 7: Run production acceptance and cleanup**

Run canonical routing smoke against `https://island-training-club.vercel.app/`. Repeat disposable Island ECC reserve/payment/confirmation/receipt acceptance and old pool deep-link denial. Verify:

- BFT/Midtown are absent from all live surfaces;
- retained pool row counts equal Step 1;
- no retirement notifications were created;
- all temporary users/content are deleted;
- migration history contains `20260922000001` exactly once.

Stop local Supabase containers and report commits, PRs, migration hash/time, browser evidence, retained counts, and cleanup evidence.
