# Shared HYROX Operations Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace device-local HYROX registrations, queues, payments, cancellation, collector duty, and gym confirmation with an atomic Supabase backend synchronized across browsers.

**Architecture:** Add normalized operational tables and security-definer RPCs with RLS, notifications, concurrency locks, Realtime publication, and initial cancellation seed rows. In live mode, `store.js` hydrates a shared cache and routes mutations to RPCs without local fallback; local mode retains the existing synchronous prototype engine. `app.js` awaits mutations and subscribes/refetches; `views.js` continues rendering synchronously from the cache.

**Tech Stack:** PostgreSQL/Supabase migrations, PL/pgSQL RPCs, Supabase RLS and Realtime, Supabase JS v2, vanilla ES modules, Node smoke suites, Bash/psql safety verification.

## Global Constraints

- Work only on `feature/shared-operations`, based on `origin/testing`.
- Do not touch Shop/merchandise code.
- Do not add npm dependencies or a build step.
- No live operational mutation may fall back to localStorage after a Supabase error.
- Existing local operation functions remain available only when `isLive()` is false.
- Start with clean Supabase operational records; do not import browser-local bookings or overrides.
- Both 15 August 2026 sessions must be seeded cancelled with `cancel_reason = 'HYROX race weekend'`.
- Member-facing cancellation copy must be exactly `Session cancelled by ITC — [reason]`.
- Cancellation preserves current rules: paid bookings defer same-venue; unpaid reservations cancel; queues dissolve.
- Supabase-backed notifications are required for registration, payment, promotion, cancellation, and gym finalization.
- Operational updates use Realtime plus visibility-focus refetch.
- Database/network failures fail closed and show an error.
- Live migrations are deployed manually by the user through Supabase SQL Editor; never embed database passwords or service-role keys.
- Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` after every JavaScript task.
- Never stage unrelated untracked files.

---

## File map

### New database files

- `supabase/migrations/20260808000001_operational_schema.sql` — templates, sessions, bookings, queues, receipts, collector tables, indexes, constraints, RLS foundations.
- `supabase/migrations/20260808000002_operational_member_rpcs.sql` — session generation, reserve, queue, mark-paid, member deferral.
- `supabase/migrations/20260808000003_operational_admin_rpcs.sql` — payment approval, cancellation, admin session controls, gym finalization, duty/payout, notifications.
- `supabase/migrations/20260808000004_operational_realtime_seed.sql` — Realtime publication and 15 August cancellation seed.
- `supabase/tests/operational_backend_integration.sql` — schema/RLS/workflow/concurrency assertions.
- `supabase/tests/verify_operational_backend.sh` — destructive disposable-database migration/integration verifier.
- `supabase/tests/verify_operational_backend_safety.sh` — verifies destructive safety gates without touching a database.

### Modified application files

- `app/js/store.js` — Supabase operational cache, readers, mutation adapters, local/live ownership boundary, Realtime subscription.
- `app/js/app.js` — async operational handlers, busy/error controls, subscription and focus refresh.
- `app/js/views.js` — shared-state rendering, cancellation copy, action gating, loading/error states.
- `app/live-auth-smoke.mjs` — fake operational Supabase/RPC/Realtime regression coverage.
- `app/smoke.mjs` — local engine remains intact and cancellation copy contract.
- `docs/runbooks/live-auth.md` — ownership boundary update.
- `docs/runbooks/operational-backend.md` — SQL Editor deployment, verification, rollback, two-browser test.

---

### Task 1: Add the operational schema and destructive verifier

**Files:**
- Create: `supabase/tests/operational_backend_integration.sql`
- Create: `supabase/tests/verify_operational_backend.sh`
- Create: `supabase/tests/verify_operational_backend_safety.sh`
- Create: `supabase/migrations/20260808000001_operational_schema.sql`

**Interfaces:**
- Tables: `operational_activity_templates`, `operational_sessions`, `operational_bookings`, `operational_queue_entries`, `operational_receipts`, `collector_assignments`, `collector_payout_profiles`
- Helper: `operational_is_admin(): boolean`
- Helper: `operational_touch_updated_at(): trigger`
- Test environment: `ITC_OPERATIONS_TEST_DATABASE_URL`, `ITC_ALLOW_DATABASE_RESET=1`, optional `ITC_OPERATIONS_PSQL_BIN`

- [ ] **Step 1: Write the failing schema integration assertions**

Create `supabase/tests/operational_backend_integration.sql` beginning with transaction-scoped assertions:

```sql
\set ON_ERROR_STOP on
begin;

select plan(18);
select has_table('public', 'operational_activity_templates');
select has_table('public', 'operational_sessions');
select has_table('public', 'operational_bookings');
select has_table('public', 'operational_queue_entries');
select has_table('public', 'operational_receipts');
select has_table('public', 'collector_assignments');
select has_table('public', 'collector_payout_profiles');

select col_is_pk('public', 'operational_sessions', 'id');
select col_is_pk('public', 'operational_bookings', 'id');
select col_is_pk('public', 'operational_queue_entries', 'id');
select col_is_pk('public', 'operational_receipts', 'id');
select col_is_pk('public', 'collector_assignments', 'week_start');
select col_is_pk('public', 'collector_payout_profiles', 'profile_id');

select policies_are('public', 'operational_sessions', array[
  'public read operational sessions',
  'admin manage operational sessions'
]);
select policies_are('public', 'operational_bookings', array[
  'member read own operational bookings',
  'admin read all operational bookings'
]);
select policies_are('public', 'operational_queue_entries', array[
  'member read own operational queue',
  'admin read all operational queue'
]);
select policies_are('public', 'operational_receipts', array[
  'member read own operational receipts',
  'admin read all operational receipts'
]);
select policies_are('public', 'collector_assignments', array[
  'approved read collector assignments',
  'admin manage collector assignments'
]);

select * from finish();
rollback;
```

If pgTAP is not installed on the disposable Supabase-compatible target, enable the `pgtap` extension in the verifier before running this test.

- [ ] **Step 2: Create the verifier by adapting the existing Giving safety pattern**

`verify_operational_backend.sh` must:

1. Require `psql`.
2. Require `ITC_OPERATIONS_TEST_DATABASE_URL`.
3. Require `ITC_ALLOW_DATABASE_RESET=1`.
4. Reject targets where `public.profiles` exists, `auth.users` is nonempty, required Supabase roles/functions are absent, or unexpected public objects exist.
5. Support `--safety-check-only`.
6. Apply every ordered `supabase/migrations/*.sql`.
7. Ensure `create extension if not exists pgtap` is available on the disposable target.
8. Run existing notification/Giving integration tests, then `operational_backend_integration.sql`.

Use the exact environment prefix:

```bash
psql_bin="${ITC_OPERATIONS_PSQL_BIN:-psql}"
```

`verify_operational_backend_safety.sh` invokes the verifier with missing/unsafe combinations and asserts nonzero exits without mutating a database.

- [ ] **Step 3: Run the safety verifier and prove the test harness works**

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: all safety cases pass.

If a disposable URL is available:

```bash
ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...' \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_operational_backend.sh
```

Expected RED: `operational_activity_templates` does not exist.

If no disposable URL is available, record the database test as pending external infrastructure; do not claim SQL integration passed.

- [ ] **Step 4: Implement the normalized schema migration**

Create `20260808000001_operational_schema.sql` with:

```sql
create function public.operational_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('admin', 'super_admin');
$$;

create table public.operational_activity_templates (
  activity_id text primary key check (activity_id in ('hyrox', 'hyrox-midtown')),
  name text not null,
  venue text not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  capacity integer not null check (capacity > 0),
  price_hkd integer not null check (price_hkd > 0),
  default_open boolean not null default true,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.operational_sessions (
  id text primary key,
  activity_id text not null references public.operational_activity_templates(activity_id),
  session_date date not null,
  start_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  venue text not null,
  capacity integer not null check (capacity > 0),
  price_hkd integer not null check (price_hkd > 0),
  is_open boolean not null default true,
  venue_tbc boolean not null default false,
  notice text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_source text check (cancelled_source in ('admin', 'system')),
  cancel_reason text,
  gym_confirmed_at timestamptz,
  gym_confirmed_by uuid references public.profiles(id),
  gym_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, session_date),
  check (id = activity_id || '-' || session_date::text),
  check ((cancelled_at is null and cancelled_by is null and cancelled_source is null and cancel_reason is null)
      or (cancelled_at is not null
          and length(btrim(cancel_reason)) > 0
          and ((cancelled_source = 'admin' and cancelled_by is not null)
            or (cancelled_source = 'system' and cancelled_by is null)))),
  check ((gym_confirmed_at is null and gym_confirmed_by is null)
      or (gym_confirmed_at is not null and gym_confirmed_by is not null)),
  check (not (cancelled_at is not null and gym_confirmed_at is not null))
);
```

Add the remaining tables exactly as specified in the design, including timestamps, checks, foreign keys, and snapshot JSONB. Add partial unique indexes:

```sql
create unique index operational_bookings_one_active
  on public.operational_bookings(profile_id, session_id)
  where status in ('reserved', 'confirmed');

create unique index operational_queue_one_active
  on public.operational_queue_entries(profile_id, session_id)
  where status = 'active';
```

Create update triggers, enable RLS on every table, revoke default anon/authenticated writes, and grant only required SELECT/EXECUTE privileges. Critical session/booking/queue writes must have no direct browser policy; they are RPC-only. Template/collector direct writes are admin-only.

Insert templates:

```sql
insert into public.operational_activity_templates
(activity_id, name, venue, weekday, start_time, duration_minutes, capacity, price_hkd, default_open)
values
('hyrox', 'ITC HYROX', 'BFT Causeway Bay', 6, '11:15', 60, 20, 180, true),
('hyrox-midtown', 'ITC HYROX', 'Midtown 28', 6, '11:00', 60, 12, 180, false);
```

- [ ] **Step 5: Run schema verification**

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

If disposable DB is configured, run full verifier. Expected: schema assertions pass; later workflow assertions may still fail until Tasks 2–4.

- [ ] **Step 6: Commit schema and verifier**

```bash
git add supabase/migrations/20260808000001_operational_schema.sql \
  supabase/tests/operational_backend_integration.sql \
  supabase/tests/verify_operational_backend.sh \
  supabase/tests/verify_operational_backend_safety.sh
git commit -m "feat(operations): add shared HYROX schema"
```

---

### Task 2: Add deterministic session generation and member RPCs

**Files:**
- Modify: `supabase/tests/operational_backend_integration.sql`
- Create: `supabase/migrations/20260808000002_operational_member_rpcs.sql`

**Interfaces:**
- `ensure_operational_sessions(p_start_date date, p_weeks integer default 16): setof operational_sessions`
- `reserve_operational_session(p_session_id text): operational_bookings`
- `join_operational_queue(p_session_id text, p_kind text): operational_queue_entries`
- `leave_operational_queue(p_entry_id uuid): operational_queue_entries`
- `mark_operational_payment(p_booking_id uuid, p_method text, p_reference text): operational_bookings`
- `defer_operational_booking(p_booking_id uuid, p_target_session_id text): operational_bookings`

- [ ] **Step 1: Add failing SQL workflow tests**

Extend the integration test with fixture profiles/auth identities and `set local role authenticated` plus JWT claim setup. Assert:

- Pending profile cannot reserve.
- Approved member can reserve an open session.
- Duplicate active reservation fails.
- Capacity cannot exceed session capacity.
- Full session permits ordered waitlist join.
- Closed Midtown permits interest join but not reservation.
- A member cannot mutate another member's booking/queue.
- Mark payment accepts only PayMe/FPS and only the owner.
- Deferral rejects full, cancelled, started, or other-venue target.

Use `throws_ok(...)` with stable exception messages:

```text
Approved membership required.
Session is cancelled.
Session is not open.
Session is full.
Already booked.
Not authorized for this booking.
```

- [ ] **Step 2: Run full SQL verifier and confirm member tests fail**

Expected RED: member RPC functions do not exist.

- [ ] **Step 3: Implement bounded session generation**

`ensure_operational_sessions`:

- Validate `p_weeks between 1 and 16`.
- Normalize start to the first Saturday on/after `p_start_date`.
- Cross join active templates with `generate_series`.
- Insert deterministic rows using template snapshots and `on conflict do nothing`.
- Return the requested window ordered by date/activity.
- Permit execution to anon/authenticated because inserts are deterministic and bounded; revoke direct table inserts.

- [ ] **Step 4: Implement member RPCs with row locking**

Each function is `security definer set search_path = public` and verifies `auth.uid()` plus role.

`reserve_operational_session` locks the session, checks cancellation/open/start/capacity/duplicates, inserts reserved booking, computes existing Thursday/Friday deadline rules server-side, and returns the row.

`join_operational_queue` locks the session and validates:

- `waitlist` only when open and full.
- `interest` only for closed `hyrox-midtown`.
- no active booking or queue duplicate.

`mark_operational_payment` locks the member-owned reserved booking, rejects duplicate marking, stores method/reference/server timestamp, and inserts `payment-marked` notifications for the assigned collector plus admins when no collector exists.

`defer_operational_booking` locks source/target sessions and source booking in deterministic ID order, requires confirmed/paid ownership, same activity, future available target, creates target confirmed booking, links source/target, marks source deferred, and promotes the freed source capacity.

- [ ] **Step 5: Run SQL verifier**

Expected: member workflow/RLS tests pass.

- [ ] **Step 6: Commit member RPCs**

```bash
git add supabase/migrations/20260808000002_operational_member_rpcs.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat(operations): add member booking and queue RPCs"
```

---

### Task 3: Add administrator payment, session, cancellation, and collector RPCs

**Files:**
- Modify: `supabase/tests/operational_backend_integration.sql`
- Create: `supabase/migrations/20260808000003_operational_admin_rpcs.sql`

**Interfaces:**
- `approve_operational_payment(p_booking_id uuid): operational_bookings`
- `cancel_operational_session(p_session_id text, p_reason text): operational_sessions`
- `set_operational_session_time(p_session_id text, p_time time): operational_sessions`
- `set_operational_venue_tbc(p_session_id text, p_enabled boolean): operational_sessions`
- `set_operational_notice(p_session_id text, p_notice text): operational_sessions`
- `set_operational_midtown_open(p_session_id text, p_enabled boolean): operational_sessions`
- `finalize_operational_gym(p_session_id text, p_note text): operational_sessions`
- `set_collector_assignment(p_week_start date, p_profile_id uuid): collector_assignments`
- `update_collector_payout_profile(p_payme_link text, p_fps_phone text): collector_payout_profiles`
- `sweep_operational_deadlines(p_now timestamptz default now()): integer`

- [ ] **Step 1: Add failing admin/atomicity tests**

Assert:

- Member cannot approve payment, cancel, finalize gym, edit session, or assign collector.
- Admin payment approval requires marked payment, creates a confirmed booking and one receipt, and releases conflicting same-week venue holds/queues.
- Gym finalization records actor/time/note for active session.
- Cancelled session rejects gym finalization, opening, reservation, mark-paid, and approval.
- Cancellation reason is required.
- Cancellation defers paid bookings to next available same-venue session, cancels unpaid reservations, dissolves queues, and inserts notifications atomically.
- A forced failure during cancellation rolls back session/bookings/queues/notifications.
- Collector assignment is shared and payout data is visible only through the assigned-collector view/RPC.
- Deadline sweep expires overdue unpaid reservations and promotes queue entries in order.

Use exact stale/conflict messages:

```text
Administrator access required.
Cancellation reason is required.
Session is cancelled.
This session changed on another device.
Payment has not been marked.
```

- [ ] **Step 2: Run SQL verifier and confirm admin tests fail**

Expected RED: admin RPC functions do not exist.

- [ ] **Step 3: Implement payment approval and receipt creation**

`approve_operational_payment` locks booking and session, verifies admin and active approved owner, checks marked payment/cancellation, sets `confirmed`, `paid_at`, `confirmed_by`, inserts one receipt using a sequence-backed `ITC-YYYY-NNNN` number, releases other same-Saturday holds/queues, promotes newly freed capacity, and notifies the member.

- [ ] **Step 4: Implement atomic cancellation**

`cancel_operational_session` follows the exact nine-step transaction in the design. It locks the session first; target sessions in deterministic ascending ID order; bookings in ID order. It writes `cancelled_source = 'admin'`, `cancelled_by = auth.uid()`, and stores only the admin-entered text in `cancel_reason`.

For 15 August, member-facing rendering later composes:

```text
Session cancelled by ITC — HYROX race weekend
```

- [ ] **Step 5: Implement gym/session controls and collector operations**

All administrator mutations lock the session/assignment row and return its complete updated row. `finalize_operational_gym` rejects any non-null `cancelled_at` while holding the session lock. `set_operational_midtown_open` converts ordered interest entries to reservations up to capacity, with remaining entries becoming waitlist.

Payout update allows the owner or admin; member-facing payout read returns only the assigned collector for the booking week.

- [ ] **Step 6: Implement deadline sweep and shared notifications**

Expire overdue reservations, preserve queues, promote in server order, assign the correct Thursday/Friday/2-hour deadline, and create notifications in the same transaction.

- [ ] **Step 7: Run SQL verifier**

Expected: all schema/member/admin/RLS/atomicity tests pass on disposable DB.

- [ ] **Step 8: Commit admin RPCs**

```bash
git add supabase/migrations/20260808000003_operational_admin_rpcs.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat(operations): add atomic admin workflow RPCs"
```

---

### Task 4: Publish Realtime tables and seed cancelled August sessions

**Files:**
- Modify: `supabase/tests/operational_backend_integration.sql`
- Create: `supabase/migrations/20260808000004_operational_realtime_seed.sql`

**Interfaces:**
- Realtime publication includes six operational tables.
- Seed rows: `hyrox-2026-08-15`, `hyrox-midtown-2026-08-15`.

- [ ] **Step 1: Add failing publication and seed assertions**

Assert both seed rows exist with:

```sql
session_date = date '2026-08-15'
cancel_reason = 'HYROX race weekend'
cancelled_at is not null
cancelled_source = 'system'
cancelled_by is null
```

Use explicit system provenance: `cancelled_source = 'system'` and `cancelled_by = null`. Administrative cancellation always writes `cancelled_source = 'admin'` and requires `cancelled_by = auth.uid()`.

Assert `pg_publication_tables` includes:

```text
operational_sessions
operational_bookings
operational_queue_entries
operational_receipts
collector_assignments
collector_payout_profiles
```

- [ ] **Step 2: Run verifier and confirm seed/publication tests fail**

- [ ] **Step 3: Implement publication and seed migration**

Use idempotent publication additions guarded through `pg_publication_tables`; do not fail if the migration is replayed on a project where the table is already published.

Generate the rolling window including 15 August, then update both IDs with `cancelled_at = now()`, `cancelled_source = 'system'`, `cancelled_by = null`, and `cancel_reason = 'HYROX race weekend'`.

- [ ] **Step 4: Run complete database verifier**

Expected: every SQL integration assertion passes.

- [ ] **Step 5: Commit Realtime and seed**

```bash
git add supabase/migrations/20260808000004_operational_realtime_seed.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat(operations): publish and seed shared sessions"
```

---

### Task 5: Add a live operational cache and readers to `store.js`

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/store.js`

**Interfaces:**

```js
export async function hydrateOperationalState({ force = false } = {}): Promise<OperationalState>
export async function refreshOperationalState(): Promise<OperationalState>
export function subscribeOperationalState(onChange): () => void
export function operationalStateStatus(): { loading, loaded, error, updatedAt }
```

Internal state:

```js
const liveOperations = {
  sessions: new Map(),
  bookings: [],
  queues: [],
  receipts: [],
  assignments: [],
  payout: null,
  loaded: false,
  loading: null,
  error: null,
  updatedAt: 0,
};
```

- [ ] **Step 1: Extend fake Supabase tables and write failing hydration tests**

In `app/live-auth-smoke.mjs`, add representative rows for every operational table and fake `.select()` query chains. Assert:

- `hydrateOperationalState()` queries all shared collections.
- Calling it concurrently deduplicates the in-flight request.
- `getSession()`/upcoming session override shows Supabase cancellation, reason, gym status, open state, time, and notice.
- Booking/queue/receipt/duty selectors return live rows instead of local fixtures in live mode.
- Failed hydration sets error status and never substitutes local operational data.

- [ ] **Step 2: Run live-auth smoke and verify missing API failure**

```bash
node app/live-auth-smoke.mjs
```

- [ ] **Step 3: Implement cache hydration and row normalization**

Add mapping helpers that preserve existing view shapes:

```js
normalizeOperationalSession(row)
normalizeOperationalBooking(row)
normalizeOperationalQueue(row)
normalizeOperationalReceipt(row)
```

Hydrate with `Promise.all`, generation ownership, and one in-flight promise. Session reads request a bounded rolling date window; member reads rely on RLS; admins receive all permitted rows.

- [ ] **Step 4: Branch synchronous selectors by live ownership**

Update selectors used by views (`getSession`, `upcomingSessions`, booking/queue/receipt/headcount/duty/gym selectors) so:

```js
if (isLive()) return readFromLiveOperations(...);
return readFromLocalState(...);
```

Do not change local function behavior or local smoke fixture shapes.

- [ ] **Step 5: Add subscription API with refetch coalescing**

One Supabase channel subscribes to all operational tables. Any event schedules a coalesced `refreshOperationalState()`; do not trust partial payloads for cross-table derived state. Invoke registered listeners only after refresh succeeds.

- [ ] **Step 6: Run both JS smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

- [ ] **Step 7: Commit live readers/cache**

```bash
git add app/js/store.js app/live-auth-smoke.mjs
git commit -m "feat(operations): hydrate shared operational state"
```

---

### Task 6: Add live-aware operational mutation adapters

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/store.js`

**Interfaces:**

```js
reserveSessionShared(userId, sessionId)
joinWaitlistShared(userId, sessionId)
leaveWaitlistShared(userId, sessionId)
joinInterestShared(userId, sessionId)
leaveInterestShared(userId, sessionId)
markBookingPaidShared(bookingId, method, reference)
confirmBookingPaymentShared(bookingId)
deferBookingShared(bookingId, targetSessionId)
cancelSessionWeekShared(sessionId, reason)
setSessionTimeShared(sessionId, time)
setVenueTBCShared(sessionId, enabled)
setSessionNoticeShared(sessionId, notice)
setMidtownOpenShared(sessionId, enabled)
confirmGymBookingShared(sessionId, note)
setDutyShared(profileId, weekStart)
updateCollectorPayoutsShared(profileId, values)
sweepOperationalDeadlinesShared(now)
```

Each returns a Promise in both modes; local mode wraps the existing synchronous result with `Promise.resolve` semantics.

- [ ] **Step 1: Write failing live RPC routing tests**

Fake `supabase.rpc()` and assert every adapter:

- Calls the exact RPC and argument names.
- Reconciles/refetches on success.
- Throws mapped domain/network errors.
- Does not invoke/local-write `itc.prototype.v1` in live mode.
- Delegates to existing local functions when live mode is absent.

Explicitly test Supabase error mapping:

```text
Session is full.
Session is cancelled.
Administrator access required.
This session changed on another device. We refreshed the latest status.
Unable to save — try again.
```

- [ ] **Step 2: Run live-auth smoke and verify missing adapter failure**

- [ ] **Step 3: Implement one RPC helper and all adapters**

```js
async function operationalRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw operationalProblem(error);
  await refreshOperationalState();
  return data;
}
```

Adapters must check caller-supplied owner IDs match `getCurrentUser().id` before invoking member RPCs, while the database remains authoritative.

- [ ] **Step 4: Prove no live fallback**

In live-auth smoke, force `.rpc()` to fail and assert localStorage's operational JSON is byte-identical before/after the rejected call.

- [ ] **Step 5: Run both JS suites**

- [ ] **Step 6: Commit mutation adapters**

```bash
git add app/js/store.js app/live-auth-smoke.mjs
git commit -m "feat(operations): route live mutations through Supabase RPCs"
```

---

### Task 7: Make `app.js` operations asynchronous and Realtime-aware

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/app.js`

**Interfaces:**
- All operational click/form handlers await Task 6 adapters.
- One operational subscription lifecycle per signed-in app session.
- `visibilitychange` calls `refreshOperationalState()` when visible.

- [ ] **Step 1: Add failing source/behavior assertions**

Assert operational handlers use shared adapter names and `await`; ban direct live UI calls to legacy mutations. Simulate a subscription callback and assert one generation-safe render. Simulate tab focus and assert one refetch.

- [ ] **Step 2: Run live-auth smoke and verify RED**

- [ ] **Step 3: Hydrate operations during async route render**

For Schedule, activity, booking/pay/receipt, and Admin Payments/Ops routes, await `hydrateOperationalState()` before view rendering. Preserve render-generation ownership so stale fetches cannot commit UI.

- [ ] **Step 4: Convert delegated mutations to busy/error flow**

For reserve, queue, mark paid, payment approval, cancellation, gym finalization, Midtown, session time/notice/TBC, duty, payout, and deferral:

1. Disable relevant controls with existing `withBusyControl` or form busy helper.
2. Await shared adapter.
3. Toast success only after fulfillment.
4. On stale error, refetch and show stale copy.
5. On other error, show error and retain current authoritative state.

- [ ] **Step 5: Add subscription and focus lifecycle**

Subscribe after authenticated hydration; unsubscribe/reset on sign-out. Coalesce subscription event renders. On document visibility becoming visible, force refresh and rerender only if the generation remains current.

- [ ] **Step 6: Run both JS suites**

- [ ] **Step 7: Commit app integration**

```bash
git add app/js/app.js app/live-auth-smoke.mjs
git commit -m "feat(operations): synchronize async admin and member actions"
```

---

### Task 8: Render shared operational state and cancellation reason everywhere

**Files:**
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/views.js`

**Interfaces:**
- `sessionCancellationCopy(session): string`
- Exact copy: `Session cancelled by ITC — ${session.cancelReason}`

- [ ] **Step 1: Add failing rendering tests**

Create a cancelled live session fixture with `cancelReason = 'HYROX race weekend'`. Assert exact copy on:

- Schedule row.
- Activity detail.
- Booking/history.
- Admin Activities/session controls.
- Payments/Ops.

Assert cancelled sessions omit/disable reserve, mark-paid, approve-payment, defer-to, Midtown-open, and gym-finalize controls. Assert active sessions still show their valid controls.

- [ ] **Step 2: Run JS suites and verify RED**

- [ ] **Step 3: Add one cancellation-copy helper**

```js
function sessionCancellationCopy(session) {
  return session?.cancelReason
    ? `Session cancelled by ITC — ${session.cancelReason}`
    : "Session cancelled by ITC";
}
```

Use this helper on all five surfaces; do not concatenate the fixed prefix in `store.js` or store it in SQL.

- [ ] **Step 4: Gate actions from authoritative state**

Views render controls from live cache fields (`cancelled`, `isOpen`, capacity, payment status, gym confirmation). Do not infer cancellation from local overrides in live mode.

Add loading/unavailable states when live operations have not hydrated or failed; never render local fixture demand as fallback.

- [ ] **Step 5: Run both suites**

- [ ] **Step 6: Commit shared rendering**

```bash
git add app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(operations): render shared session and payment status"
```

---

### Task 9: Retire live local operational state and document deployment

**Files:**
- Modify: `app/smoke.mjs`
- Modify: `app/js/store.js`
- Modify: `docs/runbooks/live-auth.md`
- Create: `docs/runbooks/operational-backend.md`

**Interfaces:**
- Marker: `itc.live.operations.backend.v1 = "supabase"`
- No deletion of unrelated local Community state.

- [ ] **Step 1: Add failing cutover test**

In live-auth smoke, seed conflicting local bookings/overrides and shared remote rows. Assert selectors choose remote rows. Assert initial live hydration writes the retirement marker but leaves prayers/Community state unchanged.

- [ ] **Step 2: Run live-auth smoke and verify RED**

- [ ] **Step 3: Implement the one-time live cutover marker**

On successful first live operational hydration:

```js
localStorage.setItem("itc.live.operations.backend.v1", "supabase");
```

Do not delete legacy data in this release; simply ensure no live selector/action reads or mutates it. This supports rollback inspection without split-brain behavior.

- [ ] **Step 4: Update ownership documentation**

Change `docs/runbooks/live-auth.md` so Supabase owns HYROX operations, bookings, queues, payment confirmation, receipts, collector duty, payouts, cancellation, and gym finalization. Remove the statement that Payment operations are localStorage-owned.

- [ ] **Step 5: Create SQL Editor deployment runbook**

`docs/runbooks/operational-backend.md` includes:

1. Backup/check queries.
2. Exact ordered migration filenames to paste/run.
3. Post-migration relation/function/policy/publication checks.
4. Seed verification:

```sql
select id, cancelled_at, cancel_reason
from public.operational_sessions
where id in ('hyrox-2026-08-15', 'hyrox-midtown-2026-08-15');
```

Expected both reasons: `HYROX race weekend`.

5. Two-browser test sequence.
6. Rollback instructions that roll app code back but do not drop tables.
7. Warning never to use service-role/database secrets in app HTML.

- [ ] **Step 6: Run both JS suites**

- [ ] **Step 7: Commit cutover/docs**

```bash
git add app/js/store.js app/smoke.mjs docs/runbooks/live-auth.md docs/runbooks/operational-backend.md
git commit -m "docs(operations): retire local live state and add deployment runbook"
```

---

### Task 10: Final verification and live SQL handoff

**Files:**
- Verify all files above.
- No runtime changes unless a failing test produces a TDD fix.

- [ ] **Step 1: Run complete automated JavaScript verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0, no `FAIL` lines.

- [ ] **Step 2: Run database safety verification**

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: all destructive safety gates pass.

- [ ] **Step 3: Run full disposable database verification when infrastructure is supplied**

```bash
ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...' \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_operational_backend.sh
```

Expected: all ordered migrations and integration tests pass. If the URL is not supplied, report this verification as blocked; do not claim database tests passed.

- [ ] **Step 4: Review source boundary and diff**

```bash
rg -n 'localStorage|state\.bookings|sessionOverrides|confirmGymBooking|cancelSessionWeek' app/js/store.js app/js/app.js app/js/views.js
rg -n 'operational_sessions|operational_bookings|cancel_operational_session|finalize_operational_gym' supabase app/js

git diff --check
git status --short
git diff --stat origin/testing...HEAD
git log --oneline origin/testing..HEAD
```

Review every live operational call site; local references are allowed only behind explicit non-live paths.

- [ ] **Step 5: Push feature branch for Vercel preview**

```bash
git push -u origin feature/shared-operations
```

- [ ] **Step 6: User applies SQL through Supabase SQL Editor**

The user runs, in order:

```text
20260808000001_operational_schema.sql
20260808000002_operational_member_rpcs.sql
20260808000003_operational_admin_rpcs.sql
20260808000004_operational_realtime_seed.sql
```

Then runs the post-deployment verification queries in `docs/runbooks/operational-backend.md` and shares any SQL errors verbatim.

- [ ] **Step 7: Complete two-browser acceptance test**

Before merging to `testing`, verify:

1. Both Aug 15 sessions display `Session cancelled by ITC — HYROX race weekend`.
2. Two admins see the same session/payment/gym state without reload.
3. Cancellation prevents payment approval and gym finalization.
4. Active future session completes registration → mark paid → approve → finalize with gym.
5. Background-tab focus refetch reconciles missed Realtime events.

- [ ] **Step 8: Merge only after the external SQL and two-browser gates pass**

Do not merge the app into `testing` before the live project contains the required schema/RPCs; otherwise live operations fail closed by design.
