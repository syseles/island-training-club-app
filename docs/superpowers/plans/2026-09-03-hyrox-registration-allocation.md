# HYROX Registration and Venue Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate BFT/Midtown sign-ups with one 32-place weekly HYROX registration pool, non-binding venue preferences, collector-confirmed threshold planning, capacity-safe venue allocation and distinct weekly/switch queues.

**Architecture:** Add a parent `operational_hyrox_cycles` record over the existing dated BFT and Midtown child sessions. Extend bookings and receipts additively so payment can be confirmed before a child venue is assigned, add a dedicated cycle queue table, and expose all live mutations through locked Supabase RPCs; local mode mirrors the same transitions behind `store.js`. Schedule and member/admin views render one pooled card only for dates whose cycle has opened, while Quarry Bay and legacy dates keep their existing direct-session flow.

**Tech Stack:** Vanilla JavaScript ES modules, HTML string templates, CSS, localStorage migrations, Supabase/PostgreSQL migrations and `SECURITY DEFINER` RPCs, RLS, Realtime, Node smoke tests, Bash/psql integration verification.

**Spec:** `docs/superpowers/specs/2026-09-03-hyrox-registration-allocation-design.md`

## Global Constraints

- Work only on `feature/hyrox-registration-allocation`, based on `origin/testing`.
- Do not touch Shop, merchandise or Giving behaviour.
- Add no npm dependency, bundler, framework, service worker or real payment processing.
- `store.js` remains the only localStorage seam; bump `STATE_VERSION` and migrate existing state additively.
- Supabase owns live cycles, bookings, queues, receipts and notifications; a live error must never fall back to local state.
- The pooled workflow contains BFT Causeway Bay (`hyrox-bft`, 11:15, capacity 20) and Midtown28 Fitness (`hyrox-midtown`, 11:00, capacity 12) only.
- Quarry Bay remains independently booked and cannot overlap a pooled registration for the same Saturday.
- A scheduled cycle is visible but locked until Monday 18:00 `Asia/Hong_Kong`; later Saturdays remain locked until their own Monday opening.
- The first 32 active registrations may pay; registration #33 onward joins a weekly waitlist and must not receive payment controls.
- Venue preference is `bft`, `midtown` or `either`; it does not reserve venue capacity.
- Direct registration and weekly-waitlist join both require preference plus explicit BFT fallback acknowledgement; promotion preserves both values.
- The acknowledgement is exactly `I understand that my booking will be at BFT at 11:15 if only BFT opens.`
- Standard payment is due Thursday 18:00. Original holders receive final grace to Thursday 19:00; members promoted at 19:00 receive until Thursday 20:00.
- Before Thursday 18:00, an unpaid cancellation promotes the oldest weekly-waitlist entry with the standard Thursday deadline and original-holder grace.
- At Thursday 18:00, registration and waitlist joins close; unmarked holders remain booked and receive the final-grace warning.
- At Thursday 19:00, still-unmarked original holders move to the back of the non-payable waitlist and the oldest pre-existing waitlist entries receive one promotion round.
- At Thursday 20:00, unmarked promoted bookings expire without further promotion and all remaining weekly-waitlist entries dissolve.
- After pending claims are reconciled, collector-confirmed counts `0–20` automatically derive `bft_only`; `21–32` automatically derive `both`. The collector cannot override the result.
- BFT and Midtown allocations never exceed 20 and 12 respectively.
- Venue changes close Friday 21:00 `Asia/Hong_Kong`; a switch-queued member retains the current guaranteed venue.
- Pooled paid members receive no member refund, cancellation, deferral or peer-transfer action.
- Keep Wednesday Night Training free/open with no booking or capacity.
- Every behaviour change starts with a failing smoke or SQL integration assertion and ends with a focused commit.
- Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` after every JavaScript task.
- Run the operational SQL verifier only against an explicitly acknowledged disposable Supabase-compatible database.

---

## File Map

### New files

- `app/js/hyrox-cycle.js` — pure IDs, HKT deadlines and deterministic allocation helpers; no state or browser side effects.
- `supabase/migrations/20260903000001_hyrox_cycle_schema.sql` — cycle/queue tables, additive booking/receipt fields, indexes, RLS and grants.
- `supabase/migrations/20260903000002_hyrox_cycle_member_rpcs.sql` — member reserve, waitlist, release and payment-marking paths plus direct-session guards.
- `supabase/migrations/20260903000003_hyrox_cycle_reconciliation.sql` — collector approval/rejection, deadline sweep, plan derivation and provisional allocation.
- `supabase/migrations/20260903000004_hyrox_cycle_allocation.sql` — venue moves, switch queues, Friday closure, cycle cancellation, child-session guards and Realtime publication.
- `supabase/tests/operational_hyrox_cycle_concurrency.sh` — real parallel reservation and last-venue allocation checks against the disposable database.

### Modified files

- `app/js/store.js` — state v19 migration, local cycle engine, public selectors/actions and live/local branching.
- `app/js/operations.js` — live cycle/queue hydration, row builders, selectors, error mapping, RPC adapters and Realtime subscriptions.
- `app/js/views.js` — pooled Schedule/detail/registration/payment/booking/admin states and final venue presentation.
- `app/js/app.js` — pooled routes plus delegated member/collector/Admin actions with busy/error handling.
- `app/styles.css` — combined venue card, preference selector, allocation capacity and queue-state styling.
- `app/smoke.mjs` — pure/local state, copy, route and migration regression coverage.
- `app/live-auth-smoke.mjs` — fake Supabase hydration, RPC payload, no-fallback and delegated-control coverage.
- `supabase/tests/operational_backend_integration.sql` — schema/RLS, threshold, concurrency, queue, allocation, cancellation and cutover assertions.
- `docs/runbooks/operational-backend.md` — migration order, live activation, verification and rollback boundary.
- `README.md` — pooled workflow and state ownership summary.

---

### Task 1: Add pure HYROX cycle IDs, HKT deadlines and allocation rules

**Files:**
- Create: `app/js/hyrox-cycle.js`
- Modify: `app/smoke.mjs` near the existing payment deadline helper checks

**Interfaces:**
- Consumes: ISO Saturday dates (`YYYY-MM-DD`) and booking-like rows `{ id, paidAt, venuePreference }`.
- Produces:
  - `HYROX_POOL_CAPACITY`, `HYROX_BFT_CAPACITY`, `HYROX_MIDTOWN_CAPACITY`
  - `HYROX_BFT_ACTIVITY_ID`, `HYROX_MIDTOWN_ACTIVITY_ID`
  - `hyroxCycleId(dateISO): string`
  - `hyroxRegistrationOpensAt(dateISO): number`
  - `hyroxPaymentReminderAt(dateISO): number`
  - `hyroxPaymentDeadline(dateISO): number`
  - `hyroxHolderGraceDeadline(dateISO): number`
  - `hyroxPromotedPaymentDeadline(dateISO): number`
  - `hyroxChoiceDeadline(dateISO): number`
  - `allocateHyroxVenues(bookings, options): Array<{ bookingId, sessionId, source }>`

- [x] **Step 1: Write failing pure-domain smoke assertions**

Add this import beside the current `data.js`/`store.js` imports in `app/smoke.mjs`:

```js
const hyroxCycle = await import("./js/hyrox-cycle.js");
```

Replace the legacy deadline block with the approved Monday opening, Thursday reminder/payment/grace/promotion and Friday venue-choice checkpoints. Keep unrelated legacy migration assertions, then add:

```js
assert.equal(hyroxCycle.hyroxCycleId("2026-09-05"), "hyrox-pool-2026-09-05");
assert.equal(
  hyroxCycle.hyroxRegistrationOpensAt("2026-09-05"),
  Date.parse("2026-08-31T18:00:00+08:00")
);
assert.equal(
  hyroxCycle.hyroxPaymentReminderAt("2026-09-05"),
  Date.parse("2026-09-03T17:00:00+08:00")
);
assert.equal(
  hyroxCycle.hyroxPaymentDeadline("2026-09-05"),
  Date.parse("2026-09-03T18:00:00+08:00")
);
assert.equal(
  hyroxCycle.hyroxHolderGraceDeadline("2026-09-05"),
  Date.parse("2026-09-03T19:00:00+08:00")
);
assert.equal(
  hyroxCycle.hyroxPromotedPaymentDeadline("2026-09-05"),
  Date.parse("2026-09-03T20:00:00+08:00")
);
assert.equal(
  hyroxCycle.hyroxChoiceDeadline("2026-09-05"),
  Date.parse("2026-09-04T21:00:00+08:00")
);
const allocations = hyroxCycle.allocateHyroxVenues([
  { id: "paid-midtown", paidAt: 1, venuePreference: "midtown" },
  { id: "paid-bft", paidAt: 2, venuePreference: "bft" },
  { id: "paid-either", paidAt: 3, venuePreference: "either" },
], {
  bftSessionId: "hyrox-bft-2026-09-05",
  midtownSessionId: "hyrox-midtown-2026-09-05",
});
assert.deepEqual(allocations.map(({ bookingId, sessionId }) => [bookingId, sessionId]), [
  ["paid-midtown", "hyrox-midtown-2026-09-05"],
  ["paid-bft", "hyrox-bft-2026-09-05"],
  ["paid-either", "hyrox-bft-2026-09-05"],
]);
console.log("ok  pooled HYROX deadlines and deterministic venue allocation");
```

- [x] **Step 2: Run the smoke test and verify the missing module failure**

Run: `node app/smoke.mjs`
Expected: FAIL with `Cannot find module .../app/js/hyrox-cycle.js`.

- [x] **Step 3: Create the pure helper module**

Create `app/js/hyrox-cycle.js` with these exports and validation:

```js
export const HYROX_BFT_ACTIVITY_ID = "hyrox-bft";
export const HYROX_MIDTOWN_ACTIVITY_ID = "hyrox-midtown";
export const HYROX_BFT_CAPACITY = 20;
export const HYROX_MIDTOWN_CAPACITY = 12;
export const HYROX_POOL_CAPACITY = 32;

const isoPattern = /^\d{4}-\d{2}-\d{2}$/;

function shiftISO(dateISO, days) {
  if (!isoPattern.test(dateISO)) throw new Error("Invalid HYROX cycle date.");
  const date = new Date(`${dateISO}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function hyroxCycleId(dateISO) {
  return `hyrox-pool-${dateISO}`;
}

export function hyroxRegistrationOpensAt(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -5)}T18:00:00+08:00`);
}

export function hyroxPaymentReminderAt(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T17:00:00+08:00`);
}

export function hyroxPaymentDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T18:00:00+08:00`);
}

export function hyroxHolderGraceDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T19:00:00+08:00`);
}

export function hyroxPromotedPaymentDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -2)}T20:00:00+08:00`);
}

export function hyroxChoiceDeadline(dateISO) {
  return Date.parse(`${shiftISO(dateISO, -1)}T21:00:00+08:00`);
}

export function allocateHyroxVenues(bookings, {
  bftSessionId,
  midtownSessionId,
  bftCapacity = HYROX_BFT_CAPACITY,
  midtownCapacity = HYROX_MIDTOWN_CAPACITY,
}) {
  const remaining = new Map([
    [bftSessionId, bftCapacity],
    [midtownSessionId, midtownCapacity],
  ]);
  return [...bookings]
    .sort((a, b) => (a.paidAt - b.paidAt) || a.id.localeCompare(b.id))
    .map((booking) => {
      const preferred = booking.venuePreference === "midtown"
        ? midtownSessionId
        : booking.venuePreference === "bft" ? bftSessionId : null;
      const first = preferred || (remaining.get(bftSessionId) > 0 ? bftSessionId : midtownSessionId);
      const alternate = first === bftSessionId ? midtownSessionId : bftSessionId;
      const sessionId = remaining.get(first) > 0 ? first : alternate;
      if (!sessionId || remaining.get(sessionId) <= 0) throw new Error("HYROX venue capacity exceeded.");
      remaining.set(sessionId, remaining.get(sessionId) - 1);
      return {
        bookingId: booking.id,
        sessionId,
        source: preferred === sessionId ? "preference" : "automatic",
      };
    });
}
```

- [x] **Step 4: Add overflow and stable-order assertions**

Create 21 BFT-preferring rows, assert the first 20 receive BFT, the 21st receives Midtown, and reversing equal-`paidAt` input still allocates in booking-ID order.

```js
const bftDemand = Array.from({ length: 21 }, (_, index) => ({
  id: `booking-${String(index + 1).padStart(2, "0")}`,
  paidAt: 100,
  venuePreference: "bft",
}));
const bftDemandAllocation = hyroxCycle.allocateHyroxVenues(bftDemand, {
  bftSessionId: "hyrox-bft-2026-09-05",
  midtownSessionId: "hyrox-midtown-2026-09-05",
});
assert.equal(bftDemandAllocation.filter((row) => row.sessionId.includes("hyrox-bft")).length, 20);
assert.equal(bftDemandAllocation.at(-1).sessionId, "hyrox-midtown-2026-09-05");
```

- [x] **Step 5: Run local smoke**

Run: `node app/smoke.mjs`
Expected: PASS including `pooled HYROX deadlines and deterministic venue allocation`.

- [x] **Step 6: Commit**

```bash
git add app/js/hyrox-cycle.js app/smoke.mjs
git commit -m "feat(hyrox): add pooled cycle domain rules"
```

---

### Task 2: Add the additive Supabase cycle schema and RLS boundaries

**Files:**
- Create: `supabase/migrations/20260903000001_hyrox_cycle_schema.sql`
- Modify: `supabase/tests/operational_backend_integration.sql` in Schema foundations
- Modify: `app/smoke.mjs` in the migration-file marker checks

**Interfaces:**
- Consumes: existing `operational_sessions`, `operational_bookings`, `operational_receipts`, `profiles` and `touch_updated_at()`.
- Produces: `operational_hyrox_cycles`, `operational_hyrox_queue_entries`, nullable pooled booking/receipt session links and additive cycle/allocation columns.

- [ ] **Step 1: Add failing schema assertions**

In `operational_backend_integration.sql`, extend Schema foundations with assertions for both new tables, RLS, browser read-only grants, the booking columns and nullable pooled session links:

```sql
perform pg_temp.op_assert(
  to_regclass('public.operational_hyrox_cycles') is not null,
  'operational_hyrox_cycles exists'
);
perform pg_temp.op_assert(
  to_regclass('public.operational_hyrox_queue_entries') is not null,
  'operational_hyrox_queue_entries exists'
);
perform pg_temp.op_assert(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_bookings'
       and column_name = 'hyrox_cycle_id'
  ),
  'operational_bookings has hyrox_cycle_id'
);
perform pg_temp.op_assert(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'operational_bookings'
       and column_name = 'session_id' and is_nullable = 'YES'
  ),
  'pooled bookings may be unallocated'
);
```

Add `../supabase/migrations/20260903000001_hyrox_cycle_schema.sql` to the static migration existence list in `app/smoke.mjs`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL because `20260903000001_hyrox_cycle_schema.sql` does not exist.

With the disposable database environment configured, run:

```bash
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL with `operational_hyrox_cycles exists`.

- [ ] **Step 3: Create cycle and queue tables**

Create the migration with the exact IDs/states and HKT deadlines from the spec:

```sql
create table public.operational_hyrox_cycles (
  id text primary key check (id = 'hyrox-pool-' || session_date::text),
  session_date date not null unique check (extract(dow from session_date) = 6),
  bft_session_id text not null unique references public.operational_sessions(id),
  midtown_session_id text not null unique references public.operational_sessions(id),
  registration_state text not null default 'draft'
    check (registration_state in ('draft','open','reconciling','closed','cancelled')),
  venue_plan text not null default 'pending'
    check (venue_plan in ('pending','bft_only','both')),
  registration_capacity integer not null default 32 check (registration_capacity = 32),
  registration_opens_at timestamptz not null,
  payment_deadline_at timestamptz not null,
  holder_grace_deadline_at timestamptz not null,
  promoted_payment_deadline_at timestamptz not null,
  venue_choice_deadline_at timestamptz not null,
  capacity_warning_sent_at timestamptz,
  payment_reminder_sent_at timestamptz,
  holder_grace_started_at timestamptz,
  waitlist_promoted_at timestamptz,
  reconciliation_started_at timestamptz,
  opened_at timestamptz,
  plan_confirmed_at timestamptz,
  plan_confirmed_by uuid references public.profiles(id),
  plan_confirmed_source text
    check (plan_confirmed_source in ('automatic_sweep','payment_reconciliation','admin_retry')),
  allocation_closed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((venue_plan = 'pending' and plan_confirmed_at is null
          and plan_confirmed_by is null and plan_confirmed_source is null)
      or (venue_plan <> 'pending' and plan_confirmed_at is not null
          and plan_confirmed_source is not null)),
  check (registration_state <> 'closed' or venue_plan <> 'pending'),
  check (allocation_closed_at is null or registration_state in ('closed','cancelled')),
  check ((cancelled_at is null and cancelled_by is null and cancel_reason is null)
      or (cancelled_at is not null and cancelled_by is not null
          and cancel_reason is not null and length(btrim(cancel_reason)) > 0)),
  check (registration_opens_at < payment_deadline_at),
  check (holder_grace_deadline_at = payment_deadline_at + interval '1 hour'),
  check (promoted_payment_deadline_at = holder_grace_deadline_at + interval '1 hour'),
  check (venue_choice_deadline_at > promoted_payment_deadline_at)
);

create table public.operational_hyrox_queue_entries (
  id uuid primary key default gen_random_uuid(),
  cycle_id text not null references public.operational_hyrox_cycles(id),
  profile_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('weekly_waitlist','venue_switch')),
  target_session_id text references public.operational_sessions(id),
  venue_preference text check (venue_preference in ('bft','midtown','either')),
  fallback_acknowledged_at timestamptz,
  status text not null default 'active'
    check (status in ('active','promoted','matched','left','dissolved')),
  joined_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((kind = 'weekly_waitlist' and target_session_id is null
          and venue_preference is not null and fallback_acknowledged_at is not null)
      or (kind = 'venue_switch' and target_session_id is not null
          and venue_preference is null and fallback_acknowledged_at is null)),
  check ((status = 'active' and resolved_at is null)
      or (status <> 'active' and resolved_at is not null))
);
```

- [ ] **Step 4: Add booking and receipt fields plus integrity indexes**

Use additive alters and preserve all existing rows:

```sql
alter table public.operational_bookings
  alter column session_id drop not null,
  add column hyrox_cycle_id text references public.operational_hyrox_cycles(id),
  add column venue_preference text check (venue_preference in ('bft','midtown','either')),
  add column fallback_acknowledged_at timestamptz,
  add column promoted_from_waitlist_at timestamptz,
  add column allocation_state text check (allocation_state in ('provisional','final')),
  add column allocation_source text check (allocation_source in ('preference','member','automatic','admin')),
  add column allocated_at timestamptz,
  add column allocation_snapshot jsonb,
  add column payment_rejected_at timestamptz,
  add column payment_rejected_by uuid references public.profiles(id),
  add column payment_rejection_reason text;

create unique index operational_bookings_one_active_per_hyrox_cycle
  on public.operational_bookings(profile_id, hyrox_cycle_id)
  where hyrox_cycle_id is not null and status in ('reserved','confirmed');

alter table public.operational_receipts
  alter column session_id drop not null,
  add column hyrox_cycle_id text references public.operational_hyrox_cycles(id),
  add constraint operational_receipts_scope_check check (
    (hyrox_cycle_id is null and session_id is not null)
    or hyrox_cycle_id is not null
  );

create unique index operational_hyrox_queue_one_active_per_member
  on public.operational_hyrox_queue_entries(profile_id, cycle_id)
  where status = 'active';

create index operational_hyrox_queue_order
  on public.operational_hyrox_queue_entries(cycle_id, kind, target_session_id, status, joined_at, id);
```

Add check constraints so non-pooled bookings require `session_id`, while pooled bookings require preference and fallback acknowledgement; allocation fields must be all-null or all-present:

```sql
alter table public.operational_bookings
  add constraint operational_bookings_scope_check check (
    (hyrox_cycle_id is null and session_id is not null
      and venue_preference is null and fallback_acknowledged_at is null)
    or
    (hyrox_cycle_id is not null and venue_preference is not null
      and fallback_acknowledged_at is not null)
  ),
  add constraint operational_bookings_allocation_check check (
    (allocation_state is null and allocation_source is null
      and allocated_at is null and allocation_snapshot is null)
    or
    (session_id is not null and allocation_state is not null
      and allocation_source is not null and allocated_at is not null
      and allocation_snapshot is not null)
  ),
  add constraint operational_bookings_payment_rejection_check check (
    (payment_rejected_at is null and payment_rejected_by is null
      and payment_rejection_reason is null)
    or
    (payment_rejected_at is not null and payment_rejected_by is not null
      and payment_rejection_reason is not null
      and length(btrim(payment_rejection_reason)) > 0)
  );
```

- [ ] **Step 5: Add updated-at trigger, RLS, policies and grants**

Use existing role helpers and deny direct writes:

```sql
create trigger operational_hyrox_cycles_touch_updated_at
  before update on public.operational_hyrox_cycles
  for each row execute function public.touch_updated_at();

alter table public.operational_hyrox_cycles enable row level security;
alter table public.operational_hyrox_queue_entries enable row level security;

create policy "public read HYROX cycles"
  on public.operational_hyrox_cycles for select using (true);
create policy "member read own HYROX cycle queues"
  on public.operational_hyrox_queue_entries for select
  using (profile_id = (select auth.uid()) or public.operational_is_admin());

revoke all on public.operational_hyrox_cycles from anon, authenticated;
revoke all on public.operational_hyrox_queue_entries from anon, authenticated;
grant select on public.operational_hyrox_cycles to anon, authenticated;
grant select on public.operational_hyrox_queue_entries to authenticated;
```

Do not create INSERT/UPDATE/DELETE policies or grants for browser roles.

- [ ] **Step 6: Run schema verification**

Run:

```bash
node app/smoke.mjs
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: both PASS; schema assertions verify RLS and no browser writes.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903000001_hyrox_cycle_schema.sql \
  supabase/tests/operational_backend_integration.sql app/smoke.mjs
git commit -m "feat(hyrox): add pooled registration schema"
```

---

### Task 3: Add scheduled member registration, weekly waitlist and booking-specific payment guards

**Files:**
- Create: `supabase/migrations/20260903000002_hyrox_cycle_member_rpcs.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `app/smoke.mjs` migration marker list

**Interfaces:**
- Consumes: Task 2 cycle/booking/queue schema and existing approved-member helpers.
- Produces:
  - `reserve_hyrox_cycle(text,text,boolean)`
  - `join_hyrox_cycle_waitlist(text,text,boolean)`
  - `leave_hyrox_cycle_queue(uuid)`
  - pooled branches in `release_operational_reservation(uuid)`, `mark_operational_payment(uuid,text,text)`, `reserve_operational_session(text)` and `join_operational_queue(text,text)`.

- [ ] **Step 1: Add failing member-RPC assertions**

Add transactional SQL scenarios that:

1. create a future BFT/Midtown pair and `hyrox-pool-<date>` cycle;
2. reject reserve before `registration_opens_at` and expose the cycle as locked;
3. advance to Monday 18:00 HKT and verify the first reserve call opens the due cycle under the same lock;
4. reject `fallback_acknowledged = false`;
5. reserve with each preference;
6. fill 32 active registrations and reject the 33rd reservation;
7. reject a weekly-waitlist join without fallback acknowledgement, then place
   the 33rd member on `weekly_waitlist` with preference and acknowledgement but
   without a booking;
8. reject direct BFT/Midtown reservation and legacy Midtown interest/waitlist joins from the moment that cycle is scheduled; and
9. reject a pooled reservation when the member already holds active Quarry Bay.

Use dynamic dates derived from `current_date` and existing approved fixture users; do not add a hard-coded date to the suite.

- [ ] **Step 2: Run verifier and verify missing-function failure**

Run:

```bash
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL with `function reserve_hyrox_cycle(text,text,boolean) does not exist`.

- [ ] **Step 3: Implement `reserve_hyrox_cycle`**

The function must lock the cycle first, transition a due scheduled cycle to `open`, validate approved membership, `now() >= registration_opens_at`, `now() < payment_deadline_at`, exact preference, true fallback acknowledgement, clean child sessions and no active Quarry booking. Count active cycle bookings under the lock and insert only below 32:

```sql
insert into public.operational_bookings (
  profile_id, session_id, hyrox_cycle_id, status, reserved_at,
  pay_deadline_at, venue_preference, fallback_acknowledged_at, snapshot
) values (
  v_uid, null, v_cycle.id, 'reserved', now(), v_cycle.holder_grace_deadline_at,
  p_preference, now(),
  jsonb_build_object(
    'name', 'ITC HYROX',
    'kind', 'paid',
    'booking_mode', 'weekly_pool',
    'session_date', v_cycle.session_date,
    'price_hkd', v_bft.price_hkd,
    'venues', jsonb_build_array(
      jsonb_build_object('session_id', v_bft.id, 'venue', v_bft.venue,
        'start_time', v_bft.start_time, 'capacity', v_bft.capacity),
      jsonb_build_object('session_id', v_midtown.id, 'venue', v_midtown.venue,
        'start_time', v_midtown.start_time, 'capacity', v_midtown.capacity)
    )
  )
) returning * into v_booking;
```

Insert a transactional reservation notification stating the standard Thursday 6 PM deadline. When the 32nd active booking is inserted, stamp `capacity_warning_sent_at` once and notify every unmarked holder that an unpaid place can move to the waitlist.

- [ ] **Step 4: Implement weekly queue join/leave**

`join_hyrox_cycle_waitlist` accepts `(p_cycle_id, p_preference, p_fallback_acknowledged)`, locks the cycle, opens an eligible due draft, requires the Monday-to-Thursday registration window and 32 active registrations, validates the exact preference and true acknowledgement, rejects any active cycle booking/queue for the member and inserts `kind = 'weekly_waitlist'` with `venue_preference` and `fallback_acknowledged_at`. `leave_hyrox_cycle_queue` enforces owner/Admin authorization and transitions only active entries to `left` with `resolved_at = now()`.

- [ ] **Step 5: Replace direct-session and payment/release functions safely**

In this forward migration, `create or replace` the existing functions:

- `reserve_operational_session`: when the target is BFT/Midtown and any scheduled non-cancelled cycle references it, raise `Use the weekly HYROX registration.`; for Quarry Bay, reject if the member owns an active same-date pooled booking.
- `join_operational_queue`: reject legacy Midtown interest/waitlist joins whenever any scheduled non-cancelled cycle references that child session; keep Quarry Bay and unscheduled legacy dates unchanged.
- `mark_operational_payment`: for a pooled booking, lock its cycle and reject at or after that booking’s `pay_deadline_at`; original holders therefore close at Thursday 7 PM and the one Thursday 7 PM promotion cohort closes at Thursday 8 PM. Resolve collector notification from `cycle.session_date` rather than nullable `session_id`.
- `release_operational_reservation`: for a pooled booking released before Thursday 18:00, cancel it and promote exactly the oldest active weekly-waitlist entry into a new original-cohort reservation with `pay_deadline_at = holder_grace_deadline_at`, the queue entry’s stored preference and its recorded fallback acknowledgement. From Thursday 18:00 onward, do not promote until the single lifecycle sweep at Thursday 19:00.

Use queue ordering `joined_at, id` and perform booking cancellation, promotion and notifications in one transaction.

- [ ] **Step 6: Verify member paths and existing direct-session regressions**

Run:

```bash
node app/smoke.mjs
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: pooled member assertions PASS and existing RSVP/Quarry/legacy HYROX tests remain green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903000002_hyrox_cycle_member_rpcs.sql \
  supabase/tests/operational_backend_integration.sql app/smoke.mjs
git commit -m "feat(hyrox): add pooled member registration RPCs"
```

---

### Task 4: Add automatic lifecycle checkpoints, collector reconciliation and threshold allocation

**Files:**
- Create: `supabase/migrations/20260903000003_hyrox_cycle_reconciliation.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `app/smoke.mjs` migration marker list

**Interfaces:**
- Consumes: pooled bookings and queue entries from Task 3.
- Produces:
  - `schedule_hyrox_cycle(text)`
  - `sweep_hyrox_cycle_deadlines(timestamptz default now())`
  - `reject_hyrox_cycle_payment(uuid,text)`
  - pooled branch in `approve_operational_payment(uuid)`
  - `finalize_hyrox_venue_plan(text)`

- [ ] **Step 1: Add failing reconciliation scenarios**

Add SQL assertions for:

- scheduling creates a cycle only for matching future BFT/Midtown sessions and rejects active legacy child bookings/queues;
- opening is Monday 18:00 HKT; reminders/transitions occur Thursday 17:00, 18:00, 19:00 and 20:00; venue choice closes Friday 21:00;
- the Monday sweep opens once and notifies approved members, while a repeated sweep creates no duplicate notifications;
- the Thursday 17:00 sweep reminds unmarked holders once;
- the Thursday 18:00 sweep keeps unmarked originals booked, starts grace, notifies them and sends collector totals;
- the Thursday 19:00 sweep demotes still-unmarked originals to the back of the non-payable waitlist and promotes only the oldest pre-existing entries with a 20:00 hard deadline;
- the Thursday 20:00 sweep expires unmarked promoted bookings without another promotion, dissolves remaining weekly entries and sends updated collector totals;
- payment claims marked before each booking’s hard deadline survive every sweep;
- pending payment claims block plan finalization, resolving the last claim after Thursday 20:00 automatically finalizes, and a 20:00 sweep with no pending claims finalizes immediately;
- rejected claims record actor/time/reason, reopen payment before that booking’s hard deadline and expire at/after it;
- 20 confirmed payments derive `bft_only` with 20 final BFT allocations;
- 21 confirmed payments derive `both` with 20/1 allocation for 21 BFT-preferring members; and
- receipt issuance succeeds while `session_id` is null and later links to the allocated child session.

- [ ] **Step 2: Run verifier and verify failure**

Run:

```bash
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL with `function schedule_hyrox_cycle(text) does not exist`.

- [ ] **Step 3: Implement cycle scheduling and exact checkpoints**

`schedule_hyrox_cycle` accepts `hyrox-pool-YYYY-MM-DD`, derives/locks `hyrox-bft-<date>` and `hyrox-midtown-<date>`, validates capacities/price and no active legacy child inventory, then inserts a draft scheduled cycle. Compute checkpoints with PostgreSQL timezone conversion:

```sql
v_registration_opens := ((v_date - 5)::date + time '18:00') at time zone 'Asia/Hong_Kong';
v_payment_deadline := ((v_date - 2)::date + time '18:00') at time zone 'Asia/Hong_Kong';
v_holder_grace_deadline := ((v_date - 2)::date + time '19:00') at time zone 'Asia/Hong_Kong';
v_promoted_payment_deadline := ((v_date - 2)::date + time '20:00') at time zone 'Asia/Hong_Kong';
v_choice_deadline := ((v_date - 1)::date + time '21:00') at time zone 'Asia/Hong_Kong';
```

Keep `venue_plan = 'pending'`. `sweep_hyrox_cycle_deadlines` changes a due draft to open, stamps `opened_at` once and inserts one registration-opened notification per approved member.

- [ ] **Step 4: Implement approval, rejection and idempotent lifecycle sweep**

For pooled approval, lock cycle then booking, require a claim marked before `booking.pay_deadline_at`, set `status = 'confirmed'`, `paid_at = now()`, create one cycle-linked receipt with null session, and notify the member. Do not release sibling BFT/Midtown holds because cycle scheduling already rejects them.

`reject_hyrox_cycle_payment` records `payment_rejected_at`, `payment_rejected_by` and a required reason. Before `booking.pay_deadline_at` it clears `payment_marked_at`, `payment_method` and `payment_reference` so the reserved member can submit again; at/after that deadline it sets status `expired`. In both cases it creates a member notification containing the reason.

`sweep_hyrox_cycle_deadlines(p_now)` locks each cycle and uses null checkpoint timestamps as idempotency guards. At Thursday 19:00 it counts still-unmarked originals into `v_freed_count`; demoted entries receive `joined_at = p_now`, so the promotion query can select only entries that were already waiting:

```sql
update public.operational_bookings
   set status = 'expired', updated_at = p_now
 where hyrox_cycle_id = v_cycle.id
   and status = 'reserved'
   and payment_marked_at is null
   and promoted_from_waitlist_at is null;

for v_booking in
  select * from public.operational_bookings
   where hyrox_cycle_id = v_cycle.id
     and status = 'expired'
     and payment_marked_at is null
     and promoted_from_waitlist_at is null
     and updated_at = p_now
   order by reserved_at, id
loop
  insert into public.operational_hyrox_queue_entries
    (cycle_id, profile_id, kind, venue_preference,
     fallback_acknowledged_at, status, joined_at)
  values
    (v_cycle.id, v_booking.profile_id, 'weekly_waitlist',
     v_booking.venue_preference, v_booking.fallback_acknowledged_at,
     'active', p_now);
end loop;

for v_queue in
  select * from public.operational_hyrox_queue_entries
   where cycle_id = v_cycle.id
     and kind = 'weekly_waitlist'
     and status = 'active'
     and joined_at < p_now
   order by joined_at, id
   limit v_freed_count
   for update skip locked
loop
  insert into public.operational_bookings
    (profile_id, session_id, hyrox_cycle_id, status, reserved_at,
     pay_deadline_at, venue_preference, fallback_acknowledged_at,
     promoted_from_waitlist_at, snapshot)
  values
    (v_queue.profile_id, null, v_cycle.id, 'reserved', p_now,
     v_cycle.promoted_payment_deadline_at, v_queue.venue_preference,
     v_queue.fallback_acknowledged_at, p_now, v_weekly_snapshot);
  update public.operational_hyrox_queue_entries
     set status = 'promoted', resolved_at = p_now
   where id = v_queue.id;
end loop;

update public.operational_bookings
   set status = 'expired', updated_at = p_now
 where hyrox_cycle_id = v_cycle.id
   and status = 'reserved'
   and payment_marked_at is null
   and promoted_from_waitlist_at is not null
   and p_now >= v_cycle.promoted_payment_deadline_at;
```

At Thursday 20:00 dissolve every remaining active weekly entry, set `registration_state = 'reconciling'` and emit the payment-closure/member/collector notifications in the same transaction. Checkpoint timestamps prevent duplicate notifications on repeated calls.

- [ ] **Step 5: Implement derived plan and deterministic allocation**

A private locked finalization helper requires non-null `reconciliation_started_at`, returns while claims remain unresolved, counts `status = 'confirmed'`, derives the plan automatically and loops confirmed bookings ordered by `paid_at, id`. The Thursday 20:00 sweep invokes it with source `automatic_sweep` when no claims are pending; pooled approval/rejection invokes it with source `payment_reconciliation` after resolving the last claim. `finalize_hyrox_venue_plan` exposes the same idempotent helper to Admin/Super Admin with source `admin_retry` for recovery only and accepts no venue-plan argument. Only actor-triggered sources populate `plan_confirmed_by`.

For `bft_only`, assign every confirmed booking to BFT with `allocation_state = 'final'`. For `both`, track BFT/Midtown counts, honor the preferred venue while capacity remains, send `either` to BFT first, then overflow to the alternate venue, and write:

```sql
update public.operational_bookings
   set session_id = v_target_session_id,
       allocation_state = case when v_now >= v_cycle.venue_choice_deadline_at
         then 'final' else 'provisional' end,
       allocation_source = v_source,
       allocated_at = v_now,
       allocation_snapshot = coalesce(allocation_snapshot, '[]'::jsonb)
         || jsonb_build_array(jsonb_build_object(
           'session_id', v_target.id,
           'venue', v_target.venue,
           'start_time', v_target.start_time,
           'capacity', v_target.capacity,
           'source', v_source,
           'assigned_at', v_now
         ))
 where id = v_booking.id;
```

Update cycle to `registration_state = 'closed'`, set plan actor/time, update receipt session links and notify each member. If finalization occurs before Friday 21:00, the notification is also the venue-choice reminder and states that changes close Friday 9 PM. If finalization occurs at/after Friday 21:00, stamp `allocation_closed_at`, mark every allocation final and dissolve any switch entry in the same transaction so gym finalization is immediately available.

- [ ] **Step 6: Run SQL and JavaScript verification**

Run:

```bash
node app/smoke.mjs
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: exact 20/21 threshold tests and all preserved operational tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903000003_hyrox_cycle_reconciliation.sql \
  supabase/tests/operational_backend_integration.sql app/smoke.mjs
git commit -m "feat(hyrox): add collector reconciliation and allocation"
```

---

### Task 5: Add venue changes, switch queues, Friday closure and cycle cancellation

**Files:**
- Create: `supabase/migrations/20260903000004_hyrox_cycle_allocation.sql`
- Create: `supabase/tests/operational_hyrox_cycle_concurrency.sh`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `supabase/tests/verify_operational_backend.sh`
- Modify: `app/smoke.mjs` migration marker list

**Interfaces:**
- Consumes: closed cycles with `bft_only` or `both` and allocated confirmed bookings.
- Produces:
  - `select_hyrox_cycle_venue(uuid,text)`
  - `join_hyrox_venue_switch_queue(uuid,text)`
  - `leave_hyrox_venue_switch_queue(uuid)`
  - `close_hyrox_venue_allocation(text)`
  - `cancel_hyrox_cycle(text,text)`
  - pooled guards in `cancel_operational_session` and `finalize_operational_gym`
  - Realtime publication for both new tables.

- [ ] **Step 1: Add failing allocation-lifecycle tests**

Add SQL scenarios that assert:

- BFT-only rejects venue changes and switch queues;
- a two-venue member moves immediately when target capacity exists;
- a full target creates an ordered `venue_switch` entry while preserving current `session_id`;
- opposite-direction requests atomically swap the two bookings and mark both entries `matched`;
- simultaneous last-place moves cannot exceed 20/12;
- Friday 21:00 closure marks every provisional allocation final and dissolves unmatched switch entries;
- late plan finalization stamps `allocation_closed_at`, marks allocations final and cannot open a switch queue;
- gym finalization rejects pooled child sessions before allocation closure;
- pooled child-session cancellation directs the Admin to cycle cancellation and the legacy Midtown-open RPC is blocked;
- cycle cancellation atomically cancels both children, expires unpaid bookings, dissolves queues and defers confirmed bookings to the next available pooled cycle or emits follow-up notifications; and
- both new tables appear in `supabase_realtime` exactly once.

Create `operational_hyrox_cycle_concurrency.sh` with explicit
`ITC_OPERATIONS_TEST_DATABASE_URL` and `ITC_ALLOW_DATABASE_RESET=1` safety
gates. Generate per-run UUIDs, create one open cycle with 31 registrations, then
run two background `psql` reservation calls. Assert exactly one succeeds, the
active booking count is 32, and the losing member can then join at weekly
waitlist position one. Run two background calls for the last BFT allocation and
assert final venue counts no greater than 20/12. Clean every per-run fixture in
an EXIT trap.

- [ ] **Step 2: Run verifier and verify failure**

Run:

```bash
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL with `function select_hyrox_cycle_venue(uuid,text) does not exist`.

- [ ] **Step 3: Implement immediate moves and switch queue entry**

Each member RPC locks cycle, both child sessions in ID order and the member booking. Require `venue_plan = 'both'`, `allocation_state = 'provisional'`, `now() < venue_choice_deadline_at`, ownership and target membership in the cycle.

`select_hyrox_cycle_venue` counts confirmed target allocations; if below capacity, update booking/session and append a new object to the booking’s `allocation_snapshot` history, then resolve the member’s active switch entry. If full, raise `Target venue is full.` without changing allocation.

`join_hyrox_venue_switch_queue` first checks for target vacancy and performs the move instead of queueing. If full, select the oldest active opposite-direction entry `for update skip locked`; when found, swap both bookings atomically and mark the opposite entry `matched`. Otherwise insert the caller’s active ordered entry.

- [ ] **Step 4: Implement queue leave and Friday closure**

`leave_hyrox_venue_switch_queue` permits owner/Admin and transitions only an active switch entry to `left`.

`close_hyrox_venue_allocation` locks the cycle and both sessions, requires `now() >= venue_choice_deadline_at`, updates all provisional cycle bookings to `final`, dissolves active switch entries, records `allocation_closed_at` and sends final-venue notifications.

- [ ] **Step 5: Implement cycle cancellation and child guards**

`cancel_hyrox_cycle` requires a nonblank reason and atomically:

1. locks cycle and both children;
2. stamps both child sessions with the canonical cancellation reason;
3. expires/cancels unpaid registrations;
4. dissolves active cycle queues;
5. carries confirmed payment into the next future pool that is open, before its payment deadline and below 32 active registrations, using the same preference; otherwise it notifies Admin/member for manual credit follow-up; and
6. records transactional notifications.

Replace linked child cancellation with `Cancel the weekly HYROX cycle instead.`. Replace `set_operational_midtown_open` so it rejects any child referenced by a non-draft pooled cycle with `Midtown availability is derived from the weekly HYROX plan.`. Extend gym finalization so a child referenced by a pooled cycle requires non-null `allocation_closed_at` and the child must be enabled by the plan.

- [ ] **Step 6: Add Realtime publication idempotently**

Use the existing publication guard pattern:

```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_hyrox_cycles'
  ) then
    alter publication supabase_realtime add table public.operational_hyrox_cycles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_hyrox_queue_entries'
  ) then
    alter publication supabase_realtime add table public.operational_hyrox_queue_entries;
  end if;
end;
$$;
```

- [ ] **Step 7: Register and run the concurrency verifier**

Append this after the existing RSVP concurrency call in
`verify_operational_backend.sh`:

```bash
echo "Running pooled HYROX concurrency checks"
ITC_OPERATIONS_PSQL_BIN="$psql_bin" \
  bash "$repo_root/supabase/tests/operational_hyrox_cycle_concurrency.sh"
```

Run:

```bash
node app/smoke.mjs
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: all schema, RLS, RPC, concurrency, cancellation, RSVP and notification checks PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260903000004_hyrox_cycle_allocation.sql \
  supabase/tests/operational_hyrox_cycle_concurrency.sh \
  supabase/tests/operational_backend_integration.sql \
  supabase/tests/verify_operational_backend.sh app/smoke.mjs
git commit -m "feat(hyrox): add venue switching and cycle lifecycle"
```

---

### Task 6: Hydrate pooled live state and expose RPC adapters

**Files:**
- Modify: `app/js/operations.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: Supabase tables/RPCs from Tasks 2–5.
- Produces:
  - `listLiveHyroxCycles()`
  - `getLiveHyroxCycle(id)`
  - `liveHyroxQueuesForCycle(id)`
  - live booking fields `cycleId`, `venuePreference`, `promotedFromWaitlistAt`, `allocationState`, `allocationSource`, `allocationSnapshot`
  - live RPC wrappers named after every member/Admin function in Tasks 3–5.

- [ ] **Step 1: Extend fake Supabase and write failing hydration assertions**

Add fixture arrays for `operational_hyrox_cycles` and `operational_hyrox_queue_entries` to `app/live-auth-smoke.mjs`. Hydrate one open cycle and assert:

```js
assert.equal(store.getHyroxCycle("hyrox-pool-2099-01-03")?.venuePlan, "pending");
assert.equal(store.hyroxCycleQueues("hyrox-pool-2099-01-03").weeklyWaitlist[0].userId, fixtureMember.id);
assert.equal(store.getBooking("pooled-booking")?.venuePreference, "midtown");
```

Record table subscriptions and assert both new tables subscribe exactly once.

- [ ] **Step 2: Run live smoke and verify failure**

Run: `node app/live-auth-smoke.mjs`
Expected: FAIL because pooled live selectors/row fields are absent.

- [ ] **Step 3: Add cycle and cycle-queue row builders/cache collections**

Extend `LIVE_TABLES`, `liveCache`, `fetchOperationalState` and `replaceState`. Use these UI shapes:

```js
function buildHyroxCycleRow(row) {
  return {
    id: row.id,
    dateISO: String(row.session_date).slice(0, 10),
    bftSessionId: row.bft_session_id,
    midtownSessionId: row.midtown_session_id,
    registrationState: row.registration_state,
    venuePlan: row.venue_plan,
    capacity: row.registration_capacity,
    paymentDeadlineAt: parseTimestamp(row.payment_deadline_at),
    venueChoiceDeadlineAt: parseTimestamp(row.venue_choice_deadline_at),
    registrationOpensAt: parseTimestamp(row.registration_opens_at),
    holderGraceDeadlineAt: parseTimestamp(row.holder_grace_deadline_at),
    promotedPaymentDeadlineAt: parseTimestamp(row.promoted_payment_deadline_at),
    capacityWarningSentAt: parseTimestamp(row.capacity_warning_sent_at),
    paymentReminderSentAt: parseTimestamp(row.payment_reminder_sent_at),
    holderGraceStartedAt: parseTimestamp(row.holder_grace_started_at),
    waitlistPromotedAt: parseTimestamp(row.waitlist_promoted_at),
    reconciliationStartedAt: parseTimestamp(row.reconciliation_started_at),
    openedAt: parseTimestamp(row.opened_at),
    planConfirmedAt: parseTimestamp(row.plan_confirmed_at),
    planConfirmedBy: row.plan_confirmed_by,
    planConfirmedSource: row.plan_confirmed_source || null,
    allocationClosedAt: parseTimestamp(row.allocation_closed_at),
    cancelledAt: parseTimestamp(row.cancelled_at),
    cancelReason: row.cancel_reason || null,
  };
}

function buildHyroxQueueRow(row) {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    userId: row.profile_id,
    kind: row.kind,
    targetSessionId: row.target_session_id || null,
    venuePreference: row.venue_preference || null,
    fallbackAcknowledgedAt: parseTimestamp(row.fallback_acknowledged_at),
    status: row.status,
    joinedAt: parseTimestamp(row.joined_at),
    resolvedAt: parseTimestamp(row.resolved_at),
  };
}
```

Extend `buildBookingRow` and `buildReceiptRow` with `cycleId`, `venuePreference`, `fallbackAcknowledgedAt`, `promotedFromWaitlistAt`, `allocationState`, `allocationSource`, `allocatedAt`, `allocationSnapshot`, `paymentRejectedAt`, `paymentRejectedBy` and `paymentRejectionReason`; tolerate null `session_id`.

- [ ] **Step 4: Add live selectors, errors and RPC wrappers**

Add exact wrappers:

```js
export const liveReserveHyroxCycle = (cycleId, preference, fallbackAcknowledged) =>
  runOperationalRpc("reserve_hyrox_cycle", {
    p_cycle_id: cycleId,
    p_preference: preference,
    p_fallback_acknowledged: fallbackAcknowledged,
  });
export const liveJoinHyroxCycleWaitlist = (cycleId, preference, fallbackAcknowledged) =>
  runOperationalRpc("join_hyrox_cycle_waitlist", {
    p_cycle_id: cycleId,
    p_preference: preference,
    p_fallback_acknowledged: fallbackAcknowledged,
  });
export const liveFinalizeHyroxVenuePlan = (cycleId) =>
  runOperationalRpc("finalize_hyrox_venue_plan", { p_cycle_id: cycleId });
export const liveSelectHyroxVenue = (bookingId, sessionId) =>
  runOperationalRpc("select_hyrox_cycle_venue", {
    p_booking_id: bookingId,
    p_target_session_id: sessionId,
  });
```

Add wrappers for cycle scheduling/sweeping, weekly waitlist join/leave, reject payment, switch join/leave, close allocation and cycle cancellation. Map every exact domain error from the spec in `operationalProblem`.

- [ ] **Step 5: Advance lifecycle on synchronization and subscribe/refetch both tables**

Before authenticated initial hydration and focus refetch, call `sweep_hyrox_cycle_deadlines` with the server default timestamp, then fetch authoritative rows. The reserve RPC independently opens a due scheduled cycle, so availability never depends on a client sweep. Add `postgres_changes` subscriptions for `operational_hyrox_cycles` and `operational_hyrox_queue_entries`; use the existing coalesced `scheduleRealtimeRefresh()` rather than view-owned subscriptions. Surface a sweep failure through the live error path and never fall back to local state.

- [ ] **Step 6: Run both JavaScript suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS with cycle hydration, null-session booking and subscription assertions.

- [ ] **Step 7: Commit**

```bash
git add app/js/operations.js app/live-auth-smoke.mjs
git commit -m "feat(hyrox): hydrate live pooled operations"
```

---

### Task 7: Add local state v19 and pooled registration/payment actions

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: Task 1 pure helpers and Task 6 live adapters.
- Produces public store functions:
  - `hyroxCycles()` / `getHyroxCycle(id)` / `hyroxCycleForDate(dateISO)`
  - `scheduleHyroxCycle(dateISO)`
  - `reserveHyroxCycle(userId, cycleId, preference, fallbackAcknowledged, now)`
  - `joinHyroxCycleWaitlist(userId, cycleId, preference, fallbackAcknowledged, now)`
  - `leaveHyroxCycleQueue(userId, entryId)`
  - `hyroxCycleQueues(cycleId)` / `hyroxCycleQueuePosition(userId, cycleId, kind, targetSessionId)`
  - `sweepHyroxCycleDeadlines(now)`

- [ ] **Step 1: Write failing v19 migration and local registration tests**

Add tests that persist a genuine v18 state without cycle keys, load it, and assert version 19 plus empty object/array collections without losing bookings. Then schedule a future cycle, verify it is locked before Monday 6 PM and assert every checkpoint:

```js
const cycle = store.scheduleHyroxCycle("2099-01-03");
assert.equal(cycle.id, "hyrox-pool-2099-01-03");
assert.equal(cycle.registrationState, "draft");
assert.equal(cycle.registrationOpensAt, Date.parse("2098-12-29T18:00:00+08:00"));
assert.equal(cycle.paymentDeadlineAt, Date.parse("2099-01-01T18:00:00+08:00"));
assert.equal(cycle.holderGraceDeadlineAt, Date.parse("2099-01-01T19:00:00+08:00"));
assert.equal(cycle.promotedPaymentDeadlineAt, Date.parse("2099-01-01T20:00:00+08:00"));
assert.throws(() => store.reserveHyroxCycle(
  "fixture-member", cycle.id, "midtown", true,
  Date.parse("2098-12-29T17:59:59+08:00")
), /opens Monday at 6 PM/);
store.sweepHyroxCycleDeadlines(Date.parse("2098-12-29T18:00:00+08:00"));
const pooled = store.reserveHyroxCycle(
  "fixture-member", cycle.id, "midtown", true,
  Date.parse("2098-12-29T18:00:01+08:00")
);
assert.equal(pooled.sessionId, null);
assert.equal(pooled.cycleId, cycle.id);
assert.equal(pooled.venuePreference, "midtown");
assert.throws(() => store.reserveHyroxCycle("fixture-member-2", cycle.id, "bft", false), /fallback/);
```

Fill 32 with approved fixtures; assert the next reservation throws full. Assert weekly waitlist join requires preference and fallback acknowledgement, stores both, reports position one and creates no booking/payment route for that member.

- [ ] **Step 2: Run smoke and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL because `scheduleHyroxCycle` is not exported.

- [ ] **Step 3: Bump and migrate state**

Set `STATE_VERSION = 19`. Add `hyroxCycles: {}` and `hyroxCycleQueues: {}` to `freshState()`. Normalize both before migration early return. Add `v < 19` without modifying existing booking/session records:

```js
if (v < 19) {
  if (!state.hyroxCycles || Array.isArray(state.hyroxCycles)) state.hyroxCycles = {};
  if (!state.hyroxCycleQueues || Array.isArray(state.hyroxCycleQueues)) state.hyroxCycleQueues = {};
}
```

- [ ] **Step 4: Implement selectors/scheduling/reserve/queue actions**

Use pure helpers for IDs/checkpoints. A local cycle shape must match `buildHyroxCycleRow`. `scheduleHyroxCycle` requires an Admin actor, resolves matching BFT/Midtown sessions, rejects legacy active child bookings/queues and writes a draft cycle that is immediately visible as locked.

`reserveHyroxCycle` opens a due draft idempotently, then validates approved owner, Monday opening, Thursday 6 PM registration close, preference, fallback, no same-date Quarry booking and active count below 32. Store `payDeadlineAt: cycle.holderGraceDeadlineAt`, candidate venues and null `sessionId` exactly as the live shape.

`joinHyroxCycleWaitlist` performs the same preference/fallback/opening validation and closes at Thursday 6 PM. Queue entries use `{ id, cycleId, userId, kind, targetSessionId, venuePreference, fallbackAcknowledgedAt, status, joinedAt, resolvedAt }`; switch entries keep preference/acknowledgement null.

- [ ] **Step 5: Implement automatic opening and Thursday checkpoint sweep**

Before Thursday 6 PM, unpaid cancellation promotes the oldest weekly entry with holder grace to 7 PM. `sweepHyroxCycleDeadlines` opens due Monday cycles, sends one Thursday 5 PM reminder, starts holder grace and sends collector/member notices at 6 PM, demotes still-unmarked originals and promotes only the pre-existing oldest waitlist cohort at 7 PM, then expires unmarked promoted bookings without further promotion and dissolves remaining weekly entries at 8 PM. Persist each checkpoint timestamp before sending notifications so repeated calls are idempotent. Do not call the legacy `nextPayDeadline` helper for pooled bookings.

- [ ] **Step 6: Add live branches and verify no fallback**

At the top of each public action:

```js
if (isLive()) return liveOps.liveReserveHyroxCycle(
  cycleId, preference, fallbackAcknowledged
);
```

Add live-auth tests that reject the fake RPC and assert local `state.hyroxCycles`, bookings and queues remain unchanged.

- [ ] **Step 7: Run JavaScript suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS including v19 preservation, 32/33 capacity, fallback and no-live-fallback checks.

- [ ] **Step 8: Commit**

```bash
git add app/js/store.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): add local pooled registration engine"
```

---

### Task 8: Add local reconciliation, allocation, switches and cancellation parity

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: Task 7 local cycles/bookings/queues and Task 1 allocation helper.
- Produces:
  - `rejectHyroxCyclePayment(bookingId, reason, now)`
  - `finalizeHyroxVenuePlan(cycleId, now)`
  - `selectHyroxCycleVenue(bookingId, sessionId, now)`
  - `joinHyroxVenueSwitchQueue(bookingId, sessionId, now)`
  - `leaveHyroxVenueSwitchQueue(entryId)`
  - `closeHyroxVenueAllocation(cycleId, now)`
  - `cancelHyroxCycle(cycleId, reason, now)`
  - pooled branches in payment approval, receipts, deferral and gym finalization.

- [ ] **Step 1: Write failing 20/21, switch and policy assertions**

Create two local cycles. Confirm 20 payments in one and assert `bft_only`, final BFT assignments and no venue changes. Confirm 21 BFT-preference payments in the second and assert `both`, BFT count 20, Midtown count 1 and provisional allocation.

Then fill both venue capacities, queue a Midtown-assigned member for BFT and assert:

```js
const beforeSession = store.getBooking(memberBooking.id).sessionId;
const entry = store.joinHyroxVenueSwitchQueue(memberBooking.id, bftSession.id);
assert.equal(entry.kind, "venue_switch");
assert.equal(store.getBooking(memberBooking.id).sessionId, beforeSession);
assert.equal(store.hyroxCycleQueuePosition(memberBooking.userId, cycle.id, "venue_switch", bftSession.id), 1);
```

Assert pooled `deferTargetsFor` is empty and `deferBooking` rejects with `Paid pooled HYROX bookings cannot be deferred.`.

- [ ] **Step 2: Run smoke and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL because `finalizeHyroxVenuePlan` is not exported.

- [ ] **Step 3: Extend payment approval and rejection**

`confirmBookingPayment` branches on `booking.cycleId`: create a cycle-linked receipt without assuming a session, do not release child sibling holds, and keep `status = 'confirmed'`. `rejectHyroxCyclePayment` requires Admin, a reserved/marked pooled booking and nonblank reason; before `booking.payDeadlineAt` reopen payment, otherwise expire and notify.

- [ ] **Step 4: Implement plan finalization and receipt linking**

Reject unresolved marked payments. Derive plan solely from confirmed count. Use `allocateHyroxVenues`; for BFT-only set final BFT, for both set provisional unless now is at/after Friday 21:00. Append initial allocation objects to each booking’s `allocationSnapshot` history, update receipt `sessionId`, stamp cycle actor/time and notify members.

- [ ] **Step 5: Implement capacity moves and switch matching**

Use one private local transaction-style function that validates everything before mutating arrays. A vacancy moves immediately and appends an allocation-history object. A full target keeps current assignment and inserts a switch entry. An opposite active request swaps both assignments, appends one history object per booking and marks the existing request matched. Recompute counts before every commit to enforce 20/12.

- [ ] **Step 6: Implement allocation close/cycle cancellation and pooled policy guards**

Friday close marks provisional allocations final and dissolves switch queues. `cancelHyroxCycle` atomically cancels both session overrides, expires unpaid, dissolves queues and carries confirmed bookings into the next available pooled cycle; if none exists, cancel and notify follow-up.

Return no defer targets for pooled bookings; reject direct defer. Block `confirmGymBooking` for pooled child sessions until allocation closes. Preserve all legacy/Quarry direct-session behaviour.

- [ ] **Step 7: Add live RPC branches and run suites**

Wire each public action, including `leaveHyroxVenueSwitchQueue`, to its Task 6 adapter when live. Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS with threshold, allocation, guaranteed-place switch queue, no-deferral and cancellation parity checks.

- [ ] **Step 8: Commit**

```bash
git add app/js/store.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): add pooled allocation lifecycle"
```

---

### Task 9: Render one pooled Schedule card and transparent registration UI

**Files:**
- Modify: `app/js/views.js` around `sessionRow`, `viewSchedule`, `viewCheckout`
- Modify: `app/js/app.js` route switch and submit delegation
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: cycle selectors/actions from Tasks 7–8.
- Produces:
  - `viewHyroxCycle(cycleId)`
  - `viewHyroxRegistration(cycleId)`
  - routes `#/hyrox/:cycleId` and `#/hyrox/:cycleId/register`
  - submit action `form-hyrox-reserve`

- [ ] **Step 1: Write failing combined-card and registration-copy tests**

Schedule a local cycle and render Schedule before Monday 6 PM. Assert exactly one `href="#/hyrox/<cycle-id>"`, `Opens Monday at 6 PM`, no reserve/direct BFT/Midtown CTA for that date, and one separate Quarry Bay row. Advance the lifecycle sweep to Monday 6 PM; render as visitor, pending and approved member and assert all see both venue names/times while only approved sees reserve.

Assert registration includes:

```js
for (const marker of [
  "Your preference helps us plan. It does not reserve a particular gym.",
  'value="bft"', 'value="midtown"', 'value="either"',
  "If 20 or fewer people have paid, we’ll only book BFT CwB",
  "If more than 20 people have paid, we’ll book both gyms",
  "Thursday 6 PM", "Friday 9 PM",
  'name="fallbackAcknowledged"',
  "I understand that my booking will be at BFT at 11:15 if only BFT opens.",
  "Reserve &amp; continue to pay",
]) assert.match(registrationHtml, new RegExp(marker));
```

- [ ] **Step 2: Run smoke and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL because `viewHyroxCycle` is not exported.

- [ ] **Step 3: Group pooled Schedule rows without hiding Quarry Bay**

In `viewSchedule`, when a scheduled draft/open/reconciling/closed/cancelled cycle exists for the selected date, remove only its BFT/Midtown child rows and insert one cycle presentation item. A draft item is visibly locked while `now < registrationOpensAt`; at/after Monday 6 PM its effective presentation is open even if an anonymous client has not invoked the authenticated sweep, and the reserve RPC performs the authoritative transition. Never group Quarry Bay. Render status badges from the member’s cycle booking/queue state; a cancelled cycle shows one canonical cancellation card rather than two child rows.

- [ ] **Step 4: Add detail and registration views**

`viewHyroxCycle` always displays date, price, BFT/Midtown names, times, capacities, Monday opening, payment/grace and venue-choice deadlines. Use existing membership gates. Before opening it shows the locked state. When full before Thursday 6 PM, the weekly-waitlist form repeats the three preference controls and required BFT fallback acknowledgement, while showing exact no-payment copy and join/leave actions.

`viewHyroxRegistration` renders a semantic radio group, required fallback checkbox and `form-hyrox-reserve`. Keep controls at least 44px high and use existing `.card`, `.kicker`, `.badge`, `.btn`, `.muted` classes plus focused additions.

- [ ] **Step 5: Add routes and reserve submission**

Parse hash segments so:

```js
case "hyrox":
  out = arg2 === "register"
    ? views.viewHyroxRegistration(arg)
    : views.viewHyroxCycle(arg);
  break;
```

In submit delegation, read `preference` and `fallbackAcknowledged`, call `store.reserveHyroxCycle`, and navigate to `#/pay/<booking-id>` only after success. Use `withBusyControl` and render errors through the existing toast/feedback path.

- [ ] **Step 6: Add responsive styles**

Add `.hyrox-pool-card`, `.hyrox-venue-options`, `.hyrox-preference-grid`, `.hyrox-threshold-rule` and `.hyrox-queue-state`. At widths below 600px use one-column venue cards; maintain visible focus, 44px controls and no layout-shifting selected state.

- [ ] **Step 7: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS for visitor/pending/member pooled presentation and delegated reserve RPC payload.

- [ ] **Step 8: Commit**

```bash
git add app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): add pooled registration experience"
```

---

### Task 10: Render payment-pending, provisional, switch-queue and final member states

**Files:**
- Modify: `app/js/views.js` around `viewHome`, `viewPay`, `viewBooking`, Profile History and receipts
- Modify: `app/js/app.js` click delegation
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: pooled booking/allocation selectors and actions from Tasks 7–8.
- Produces member controls `join-hyrox-weekly-waitlist`, `leave-hyrox-cycle-queue`, `select-hyrox-venue`, `join-hyrox-switch-queue` and `leave-hyrox-switch-queue`.

- [ ] **Step 1: Write failing state-specific rendering tests**

Assert these eight exact state headings/copy fragments:

```text
Pay HK$180 by Thursday 6 PM
Final payment grace — pay now by Thursday 7 PM
You’ve been promoted — pay by Thursday 8 PM
Payment being confirmed
Your weekly HYROX place is confirmed
Both gyms confirmed
Your venue is provisional until Friday 9 PM
Your venue is final
```

For a pooled payment page, assert the payment note contains weekly date/member but neither BFT nor Midtown. For a confirmed pooled booking, assert no `defer-to`, `release-reservation`, refund or member-cancel control.

Before allocation, assert Home **My Week**, Profile History and Payments & Receipts render the weekly date plus `Venue pending` without dereferencing a null session. After allocation, assert those surfaces render the assigned venue and receipt link once.

For full BFT, assert `BFT switch queue`, queue position and `Your Midtown place remains guaranteed while you wait.`.

- [ ] **Step 2: Run smoke and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL on the first pooled booking-state copy assertion.

- [ ] **Step 3: Make `viewPay` null-session safe**

Use `booking.cycleId` to resolve collector duty by cycle date. Build payment note as `ITC HYROX · <date> · <member>` and show both possible venues in explanatory copy, not as assigned location. Before Thursday 6 PM show the standard deadline; for an unmarked original between 6–7 PM show final-grace copy; for `promotedFromWaitlistAt` show the Thursday 8 PM hard deadline. Keep existing PayMe/FPS controls.

- [ ] **Step 4: Render allocation states in `viewBooking`**

Branch pooled bookings before legacy confirmed-booking deferral rendering:

- reserved/unmarked before Thursday 6 PM: standard payment CTA and unpaid cancel;
- original reserved/unmarked Thursday 6–7 PM: final-grace warning and payment CTA;
- promoted reserved/unmarked Thursday 7–8 PM: promotion notice and payment CTA;
- reserved/marked: collector confirmation state, no cancel;
- confirmed/unallocated: guaranteed weekly place, venue decision pending;
- BFT-only final: BFT detail/directions/calendar;
- two-venue provisional: both capacity cards, current assignment and change/queue controls;
- final: one final venue, directions/calendar and receipt.

Always derive current counts from store selectors rather than snapshot counts. Reuse the pooled booking presenter on Home **My Week**, Profile History and Payments & Receipts so an unallocated booking says `Venue pending`; after allocation use the receipt/session link and avoid duplicate weekly entries.

- [ ] **Step 5: Add delegated queue/move controls**

Each handler uses `withBusyControl`, awaits the exact store action, shows success only after resolution and calls `renderWithFeedback()`. On target-full response, leave current allocation visible and offer `join-hyrox-switch-queue`; do not optimistically move DOM state.

- [ ] **Step 6: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS for all member states, exact RPC args, duplicate-click suppression and failed-live-RPC no-fallback assertions.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): add member venue allocation states"
```

---

### Task 11: Add collector reconciliation and pooled Admin controls

**Files:**
- Modify: `app/js/views.js` around `adminOps`, `adminPaidSessionControls`, `adminFinalizeGym`
- Modify: `app/js/app.js` Admin click/submit delegation
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: Admin cycle actions and cycle/member selectors from Tasks 7–8.
- Produces Admin controls `hyrox-cycle-schedule`, `hyrox-payment-reject`, `hyrox-plan-retry`, `hyrox-allocation-close`, `form-cancel-hyrox-cycle`.

- [ ] **Step 1: Write failing Admin dashboard assertions**

Build a cycle with 32 reservations, 22 confirmed, three marked-pending, seven unpaid and four historical/dissolved queue fixtures. Assert the dashboard renders authoritative active counts and:

```text
Saturday HYROX · Payment reconciliation
22 confirmed paid
3 payment claims to review
7 unpaid
Review 3 pending payment claims before the venue plan can be confirmed automatically.
```

Assert the cycle is locked before Monday 6 PM and opens automatically afterward. Assert no collector choice between one or two gyms is rendered; after Thursday 8 PM the card prompts only for unresolved payment claims, and resolving the last claim reveals the automatic plan. Render **Retry automatic venue plan** only for a failed/stalled reconciliation state. Assert old Midtown manual toggle/interest controls are absent for the pooled date and gym finalization is unavailable before Friday 9 PM.

- [ ] **Step 2: Run smoke and verify failure**

Run: `node app/smoke.mjs`
Expected: FAIL because the pooled Admin cycle card is absent.

- [ ] **Step 3: Render weekly cycle and payment reconciliation cards**

Under Payments, render one card per scheduled/open/reconciling/closed cycle with the Monday opening time, lifecycle checkpoint, active/confirmed/pending/unpaid/waitlist totals, derived threshold preview and allocation counts. At Thursday 6 PM show the grace summary and at Thursday 8 PM show the final reconciliation summary. Keep existing collector duty/payout controls unchanged.

Add Confirm and Reject actions per payment claim. Reject requires a nonblank reason via an inline form, not `prompt()`.

- [ ] **Step 4: Render plan/allocation and gym controls**

After the Thursday 20:00 checkpoint, show unresolved payment-review actions or the automatically derived venue plan—never a collector choice between gym outcomes. A narrowly scoped **Retry automatic venue plan** action may call the idempotent recovery RPC only when reconciliation has no pending claims but the plan remains pending. After finalization show BFT/Midtown assigned counts and switch queues. Show **Close venue allocation** at/after Friday 21:00 when still open.

Under Activities, remove per-child Midtown toggle and cancellation for pooled dates; render one cycle cancellation form. Under Payments, enable per-venue WhatsApp/copy/finalize only after allocation closure and only for venues enabled by the plan.

- [ ] **Step 5: Add awaited Admin handlers**

Map controls to exact store functions, guard duplicate clicks/forms and use these success messages:

```text
HYROX cycle scheduled — registration opens Monday at 6 PM
Payment claim rejected — member notified
Automatic venue plan retried — members notified
Venue allocations finalized
HYROX cycle cancelled — members notified
```

A failed RPC shows its domain error, refetches through `renderWithFeedback()` and never displays success.

- [ ] **Step 6: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS for counts, gating, exact RPC payloads, busy controls and no-live-fallback behaviour.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(hyrox): add pooled collector operations"
```

---

### Task 12: Complete compatibility, documentation and release verification

**Files:**
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `docs/runbooks/operational-backend.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: complete pooled workflow from Tasks 1–11.
- Produces: verified migration/cutover contract, operator instructions and final regression evidence.

- [ ] **Step 1: Add clean-week cutover and legacy compatibility assertions**

Add tests proving:

- a BFT/Midtown date without a scheduled cycle keeps separate legacy cards/actions;
- a scheduled draft cycle uses one combined locked card and opens only at Monday 6 PM HKT;
- scheduling rejects any active legacy child booking or queue;
- historical BFT/Midtown/Quarry bookings and receipts remain readable after v19;
- Quarry Bay remains separately bookable and overlapping pooled reservation is rejected both ways;
- free/RSVP paths and existing notification destinations are unchanged; and
- cancellation copy remains `Session cancelled by ITC — <reason>`.

- [ ] **Step 2: Run tests and correct only demonstrated failures**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS. If an assertion fails, fix the owning implementation file from Tasks 6–11 and rerun both commands before proceeding.

- [ ] **Step 3: Update the operational runbook**

Document migrations in exact order:

```text
20260903000001_hyrox_cycle_schema.sql
20260903000002_hyrox_cycle_member_rpcs.sql
20260903000003_hyrox_cycle_reconciliation.sql
20260903000004_hyrox_cycle_allocation.sql
```

Add read-only SQL checks for tables, RLS, RPC execute privileges and Realtime publication. Add the activation rule: choose a clean future Saturday, deploy code and migrations, perform two-browser acceptance, then schedule that cycle before its Monday 6 PM HKT automatic opening. State that after the first pooled reservation, rollback must remain pooled-booking compatible.

- [ ] **Step 4: Update README ownership and product summary**

Change prototype state to v19, describe one BFT/Midtown weekly pool with Quarry Bay separate, and state Monday 6 PM opening, Thursday 6 PM standard payment, Thursday 7 PM holder grace, Thursday 8 PM promoted-member close and Friday 9 PM venue-choice close. Do not describe PayMe/FPS as real payment processing.

- [ ] **Step 5: Run the complete verification matrix**

Run:

```bash
node app/smoke.mjs
TZ=Asia/Hong_Kong node app/smoke.mjs
TZ=America/Los_Angeles node app/smoke.mjs
node app/live-auth-smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
git diff --check
```

With the disposable database environment configured:

```bash
ITC_ALLOW_DATABASE_RESET=1 bash supabase/tests/verify_operational_backend.sh
```

Expected: every command PASS; HKT checkpoints are identical under all host timezones; no SQL test exceeds 20/12, accepts an original-holder payment at/after Thursday 7 PM or accepts a promoted-member payment at/after Thursday 8 PM.

- [ ] **Step 6: Perform manual two-browser acceptance**

Use one Admin and multiple approved member profiles against the same disposable/staging Supabase project:

1. schedule a clean future cycle and verify it remains locked before Monday 6 PM;
2. cross Monday 6 PM and verify automatic opening plus member notifications;
3. verify combined Schedule card and separate Quarry Bay;
4. reserve/pay/confirm and inspect pending venue state;
5. verify member #33 sees weekly waitlist with no payment action;
6. exercise Thursday 5 PM reminder, 6 PM grace warning, 7 PM demotion/promotion and 8 PM closure;
7. verify exactly 20 derives BFT-only and 21 derives both automatically;
8. fill BFT, join its switch queue and confirm the Midtown assignment remains guaranteed;
9. match an opposite swap and observe Realtime in the second browser;
10. close Friday allocation, finalize gym lists and verify focus refetch.

- [ ] **Step 7: Commit documentation and final compatibility tests**

```bash
git add README.md docs/runbooks/operational-backend.md \
  app/smoke.mjs app/live-auth-smoke.mjs \
  supabase/tests/operational_backend_integration.sql
git commit -m "docs(hyrox): document pooled booking rollout"
```

- [ ] **Step 8: Final branch verification**

Run:

```bash
git status --short --branch
git log --oneline origin/testing..HEAD
git diff --stat origin/testing...HEAD
```

Expected: clean working tree; only HYROX registration/allocation commits and scoped files appear.
