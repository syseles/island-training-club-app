# Admin Payment and Attendance Rosters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named payment-state rosters and a time-gated, reversible Expected ↔ Arrived workflow to Admin → Payments.

**Architecture:** Reuse the Admin-authorized operational booking cache and payment-user directory for all roster reads. Add `attended` booking state plus actor/timestamp columns and one narrow Admin-only Supabase mutation RPC; mirror the same classification, timing, and mutation rules in local mode. Render payment names continuously and unlock attendance controls per concrete paid session from 15 minutes before start until 24 hours after session end.

**Tech Stack:** Vanilla JavaScript ES modules, localStorage state/migrations, Supabase PostgreSQL/RPC, HTML `<details>` components, CSS, Node smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-08-admin-attendance-roster-design.md`

## Global Constraints

- Admin tabs remain **Members · Activities · Giving · Payments**; no Attendance tab.
- Payment due = `reserved` without `paymentMarkedAt`; Awaiting confirmation = `reserved` with `paymentMarkedAt`; Paid = `confirmed` or `attended`.
- Confirmed paid means Expected, not Arrived. Only an Admin action changes `confirmed → attended`.
- Attendance controls open exactly 15 minutes before concrete paid-session start and close exactly 24 hours after session end.
- Attendance is reversible only while the correction window is open.
- Payment, receipt, allocation, and booking-owner fields never change during attendance mutation.
- Financial names are Admin-only and contain no email, phone, donor ID, raw payload, queue, or unrelated profile data.
- Pooled unallocated bookings remain visible in financial groups but cannot be checked in.
- Free/open-attendance and RSVP sessions are excluded.
- Supabase live mode remains authoritative; no fallback to local domain state.
- Local prototype state advances from v21 to v22 through `migrate()`; existing bookings are preserved.
- No real payments, outbound messages, automatic attendance, No-show state, analytics, or export.
- No Shop paths or dependencies.
- Never run `supabase db reset --linked`; SQL execution requires an explicitly acknowledged disposable database.

---

### Task 1: Shared payment classification, attendance window, and v22 migration

**Files:**
- Modify: `app/js/store.js:43-590` and booking constructors near `app/js/store.js:1200-1560,2680-2730`
- Test: `app/smoke.mjs` near migration checks and payment fixtures

**Interfaces:**
- Consumes: `hktEventStartMs(dateISO, time)` from `app/js/data.js`; booking `{ status, paymentMarkedAt }`; session `{ dateISO, time, durationMin }`.
- Produces:
  - `paymentStateForBooking(booking): "payment_due" | "awaiting_confirmation" | "paid" | null`
  - `attendanceWindowForSession(session, now = Date.now()): { opensAt: number, closesAt: number, state: "upcoming" | "open" | "locked" }`
  - local state version 22 with `attendedAt` and `attendedBy` initialized on every booking.

- [ ] **Step 1: Write failing classification and exact-boundary tests**

Add to `app/smoke.mjs`:

```js
assert.equal(store.paymentStateForBooking({ status: "reserved", paymentMarkedAt: null }), "payment_due");
assert.equal(store.paymentStateForBooking({ status: "reserved", paymentMarkedAt: 1 }), "awaiting_confirmation");
assert.equal(store.paymentStateForBooking({ status: "confirmed", paymentMarkedAt: 1 }), "paid");
assert.equal(store.paymentStateForBooking({ status: "attended", paymentMarkedAt: 1 }), "paid");
for (const status of ["cancelled", "expired", "deferred", "withdrawn"]) {
  assert.equal(store.paymentStateForBooking({ status, paymentMarkedAt: 1 }), null);
}
const attendanceSession = {
  dateISO: "2026-09-12", time: "11:00", durationMin: 60,
};
const attendanceStart = data.hktEventStartMs(attendanceSession.dateISO, attendanceSession.time);
assert.deepEqual(store.attendanceWindowForSession(attendanceSession, attendanceStart - 15 * 60_000), {
  opensAt: attendanceStart - 15 * 60_000,
  closesAt: attendanceStart + 25 * 60 * 60_000,
  state: "open",
});
assert.equal(store.attendanceWindowForSession(attendanceSession, attendanceStart - 15 * 60_000 - 1).state, "upcoming");
assert.equal(store.attendanceWindowForSession(attendanceSession, attendanceStart + 25 * 60 * 60_000).state, "open");
assert.equal(store.attendanceWindowForSession(attendanceSession, attendanceStart + 25 * 60 * 60_000 + 1).state, "locked");
```

Add a v21 fixture containing confirmed and reserved bookings with all existing payment/allocation fields. After `store.load()`, assert version 22, both attendance properties are null, and the original booking objects otherwise retain their IDs, statuses, payment timestamps, snapshots, cycle IDs, and session IDs.

- [ ] **Step 2: Run the smoke suite and verify RED**

Run:

```sh
node app/smoke.mjs
```

Expected: FAIL because `paymentStateForBooking` and `attendanceWindowForSession` do not exist and the migrated version remains 21.

- [ ] **Step 3: Implement the shared helpers and migration**

In `app/js/store.js`, import/use the existing `hktEventStartMs`, bump `STATE_VERSION` to 22, and add:

```js
export function paymentStateForBooking(booking) {
  if (!booking) return null;
  if (booking.status === "reserved") {
    return booking.paymentMarkedAt != null ? "awaiting_confirmation" : "payment_due";
  }
  return ["confirmed", "attended"].includes(booking.status) ? "paid" : null;
}

export function attendanceWindowForSession(session, now = Date.now()) {
  const start = hktEventStartMs(session.dateISO, session.time);
  const opensAt = start - 15 * 60_000;
  const closesAt = start + Number(session.durationMin) * 60_000 + 24 * 60 * 60_000;
  return {
    opensAt,
    closesAt,
    state: now < opensAt ? "upcoming" : now <= closesAt ? "open" : "locked",
  };
}
```

Add the v22 migration step inside `migrate()`:

```js
if (v < 22) {
  for (const booking of state.bookings || []) {
    booking.attendedAt ??= null;
    booking.attendedBy ??= null;
  }
  v = 22;
}
```

Initialize `attendedAt: null` and `attendedBy: null` in every local booking constructor. Do not remove or rename existing booking fields.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```sh
node app/smoke.mjs
node --check app/js/store.js
node --check app/smoke.mjs
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 1**

```sh
git add app/js/store.js app/smoke.mjs
git commit -m "feat(attendance): add roster state rules"
```

---

### Task 2: Supabase attendance schema and Admin-only mutation RPC

**Files:**
- Create: `supabase/migrations/20260909000001_operational_attendance.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `app/smoke.mjs` near migration source-contract assertions
- Modify: `docs/runbooks/operational-backend.md` ordered migration/verification section

**Interfaces:**
- Consumes: `public.operational_bookings`, `public.operational_sessions`, `public.operational_assert_admin(text)`, `auth.uid()`.
- Produces:
  - columns `operational_bookings.attended_at timestamptz`, `attended_by uuid`
  - booking status `attended`
  - RPC `set_operational_attendance(p_booking_id uuid, p_arrived boolean) returns operational_bookings`.

- [ ] **Step 1: Write failing static SQL contract tests**

In `app/smoke.mjs`, load `20260909000001_operational_attendance.sql` and assert it contains:

```js
for (const marker of [
  "attended_at", "attended_by", "'attended'",
  "set_operational_attendance", "operational_assert_admin('set_attendance')",
  "for update", "Asia/Hong_Kong", "interval '15 minutes'", "interval '24 hours'",
  "price_hkd <= 0", "cancelled_at is not null", "p_arrived is null",
  "revoke all on function public.set_operational_attendance(uuid, boolean)",
  "grant execute on function public.set_operational_attendance(uuid, boolean) to authenticated",
]) assert.ok(attendanceMigrationSource.includes(marker));
assert.match(attendanceMigrationSource,
  /security definer[\s\S]*?set search_path = public/);
assert.doesNotMatch(attendanceMigrationSource,
  /grant execute on function public\.set_operational_attendance\(uuid, boolean\) to anon/);
```

Also assert the migration appears after `20260908000002_hyrox_venue_reminders.sql` in the operational runbook.

- [ ] **Step 2: Run the smoke suite and verify RED**

Run:

```sh
node app/smoke.mjs
```

Expected: FAIL because the attendance migration is missing.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260909000001_operational_attendance.sql` with these concrete operations:

```sql
alter table public.operational_bookings
  add column if not exists attended_at timestamptz,
  add column if not exists attended_by uuid references public.profiles(id);

alter table public.operational_bookings
  drop constraint if exists operational_bookings_status_check;
alter table public.operational_bookings
  add constraint operational_bookings_status_check
  check (status in ('reserved', 'confirmed', 'attended', 'cancelled', 'expired', 'deferred'));

alter table public.operational_bookings
  drop constraint if exists operational_bookings_attendance_consistent;
alter table public.operational_bookings
  add constraint operational_bookings_attendance_consistent check (
    (status = 'attended' and attended_at is not null and attended_by is not null)
    or
    (status <> 'attended' and attended_at is null and attended_by is null)
  );
```

Implement the RPC with:

```sql
create or replace function public.set_operational_attendance(
  p_booking_id uuid,
  p_arrived boolean
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_start timestamptz;
  v_close timestamptz;
begin
  perform public.operational_assert_admin('set_attendance');
  if p_arrived is null then
    raise exception 'Attendance state is required.' using errcode = '22004';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id
   for share;
  if not found then
    raise exception 'Assigned session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_session.price_hkd <= 0 then
    raise exception 'Attendance check-in is for paid sessions only.' using errcode = '23514';
  end if;
  if v_booking.status not in ('confirmed', 'attended') then
    raise exception 'Only confirmed-paid bookings can be checked in.' using errcode = '23514';
  end if;

  v_start := (v_session.session_date + v_session.start_time) at time zone 'Asia/Hong_Kong';
  v_close := v_start + make_interval(mins => v_session.duration_minutes) + interval '24 hours';
  if now() < v_start - interval '15 minutes' or now() > v_close then
    raise exception 'Attendance is outside the check-in window.' using errcode = '23514';
  end if;

  if p_arrived and v_booking.status = 'confirmed' then
    update public.operational_bookings
       set status = 'attended', attended_at = now(), attended_by = v_uid
     where id = p_booking_id returning * into v_booking;
  elsif not p_arrived and v_booking.status = 'attended' then
    update public.operational_bookings
       set status = 'confirmed', attended_at = null, attended_by = null
     where id = p_booking_id returning * into v_booking;
  end if;

  return v_booking;
end;
$$;

revoke all on function public.set_operational_attendance(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_operational_attendance(uuid, boolean)
  to authenticated;
```

Do not update receipt/payment/allocation fields. Document the new ordered migration and the disposable-database command in `docs/runbooks/operational-backend.md`.

- [ ] **Step 4: Add transactional SQL integration cases**

In `supabase/tests/operational_backend_integration.sql`, add a dedicated transaction that creates:

- Admin, member, and second Admin profiles;
- a paid session whose start is 10 minutes after current HKT time;
- a confirmed-paid booking for the member.

Use `pg_temp.op_as` to assert:

1. member invocation raises authorization error;
2. Admin mark changes only status/attendance columns;
3. repeated Admin mark preserves the first `attended_at` and `attended_by`;
4. second Admin undo restores confirmed and clears both attendance columns;
5. a null `p_arrived` value is rejected;
6. an unpaid reserved booking is rejected;
7. a price-zero RSVP session is rejected;
8. a cancelled paid session is rejected;
9. a session 16 minutes in the future is rejected;
10. a session more than duration + 24 hours in the past is rejected;
11. exact opening and closing boundaries are accepted.

Capture payment, receipt, allocation, owner, and session fields before mark/undo and compare them afterward. Roll back the transaction.

- [ ] **Step 5: Run non-destructive checks**

Run:

```sh
node app/smoke.mjs
git diff --check
bash supabase/tests/verify_operational_backend.sh --safety-check-only
```

Expected: smoke and diff checks pass. The safety check must refuse unless both disposable-database environment variables are explicitly configured. Do not execute the destructive verifier without acknowledged disposable infrastructure.

- [ ] **Step 6: Commit Task 2**

```sh
git add app/smoke.mjs docs/runbooks/operational-backend.md \
  supabase/migrations/20260909000001_operational_attendance.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat(attendance): add admin attendance RPC"
```

---

### Task 3: Live operational attendance mapping and mutation

**Files:**
- Modify: `app/js/operations.js:192-240,560-820`
- Test: `app/live-auth-smoke.mjs` near booking mapping and RPC bridge tests
- Test: `app/smoke.mjs` API/source contracts

**Interfaces:**
- Consumes: Supabase RPC `set_operational_attendance(p_booking_id, p_arrived)`.
- Produces:
  - booking fields `attendedAt: number | null`, `attendedBy: string | null`
  - `liveSetOperationalAttendance(bookingId: string, arrived: boolean): Promise<object>`.

- [ ] **Step 1: Write failing live mapping and RPC tests**

Extend a mocked operational booking row in `app/live-auth-smoke.mjs`:

```js
attended_at: "2026-09-12T03:01:00.000Z",
attended_by: "admin-id",
status: "attended",
```

Assert the hydrated booking exposes:

```js
assert.equal(mapped.status, "attended");
assert.equal(mapped.attendedAt, Date.parse("2026-09-12T03:01:00.000Z"));
assert.equal(mapped.attendedBy, "admin-id");
```

Add `set_operational_attendance` to the Supabase mock. Call:

```js
await operations.liveSetOperationalAttendance("booking-id", true);
```

Assert the RPC payload is exactly:

```js
{ p_booking_id: "booking-id", p_arrived: true }
```

Assert the returned row replaces/reconciles the matching cached booking and that an RPC error rejects with the normalized operational error.

- [ ] **Step 2: Run the focused live test and verify RED**

Run:

```sh
node app/live-auth-smoke.mjs
```

Expected attendance-specific failure: mapped attendance fields or `liveSetOperationalAttendance` are missing. If an unrelated pre-existing live-auth fixture fails earlier, record its exact output, run the source/API assertions through `node app/smoke.mjs`, and do not claim the unrelated suite passed.

- [ ] **Step 3: Implement live mapping and mutation**

Add to `buildBookingRow()`:

```js
attendedAt: parseTimestamp(row.attended_at),
attendedBy: row.attended_by || null,
```

Add:

```js
export async function liveSetOperationalAttendance(bookingId, arrived) {
  await runOperationalRpc("set_operational_attendance", {
    p_booking_id: bookingId,
    p_arrived: !!arrived,
  });
  return liveBookingById(bookingId);
}
```

`runOperationalRpc()` performs the authoritative cache refresh before resolving. Do not mutate a cached booking before Supabase succeeds.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```sh
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/operations.js
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: attendance mapping/RPC tests pass; full suites pass except any explicitly recorded unrelated baseline failure.

- [ ] **Step 5: Commit Task 3**

```sh
git add app/js/operations.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(attendance): bridge live check-in RPC"
```

---

### Task 4: Store attendance selectors and live/local mutation parity

**Files:**
- Modify: `app/js/store.js` near booking selectors and Admin mutations
- Test: `app/smoke.mjs` near payment authorization and Profile booking tests

**Interfaces:**
- Consumes: Task 1 helpers, `liveOps.liveSetOperationalAttendance`, existing Admin actor guards, `getBooking`, and `getSession`.
- Produces:
  - `paymentRosterBookings(): object[]`
  - `attendanceBookingsForSession(sessionId: string): object[]`
  - `setBookingAttendance(bookingId: string, arrived: boolean, now = Date.now()): Promise<object>`.

- [ ] **Step 1: Write failing local selector and mutation tests**

Create a local paid session and three member bookings representing Payment due, Awaiting confirmation, and confirmed-paid. Assert:

```js
assert.deepEqual(
  store.paymentRosterBookings().map((booking) => store.paymentStateForBooking(booking)),
  ["payment_due", "awaiting_confirmation", "paid"]
);
assert.deepEqual(
  store.attendanceBookingsForSession(session.id).map((booking) => booking.status),
  ["confirmed"]
);
```

With Admin signed in and `now` equal to the opening boundary:

```js
const arrived = await store.setBookingAttendance(confirmed.id, true, opensAt);
assert.equal(arrived.status, "attended");
assert.equal(arrived.attendedBy, admin.id);
assert.equal(arrived.attendedAt, opensAt);
assert.equal(store.paymentStateForBooking(arrived), "paid");
assert.equal(store.receiptForBooking(arrived.id).id, originalReceipt.id);
```

Call mark again at `opensAt + 1`; assert the original attendance actor/time remain. Undo and assert confirmed/null/null. Add rejection assertions for:

- ordinary member actor;
- reserved unpaid and payment-marked bookings;
- cancelled session;
- RSVP/price-zero session;
- unassigned pooled booking;
- one millisecond before opening;
- one millisecond after closing.

After marking a member Arrived, render Profile and assert its Attended stat and attended booking page each increase by exactly one. Restore the fixture before later smoke sections.

- [ ] **Step 2: Run smoke and verify RED**

Run:

```sh
node app/smoke.mjs
```

Expected: FAIL because roster selectors and `setBookingAttendance` do not exist.

- [ ] **Step 3: Implement selectors and mutation**

Implement:

```js
export function paymentRosterBookings() {
  requirePaymentAdminActor();
  const bookings = isLive() ? liveOps.listLiveBookings() : state.bookings;
  return bookings.filter((booking) => paymentStateForBooking(booking));
}

export function attendanceBookingsForSession(sessionId) {
  requirePaymentAdminActor();
  const bookings = isLive() ? liveOps.liveBookingsForSession(sessionId) : state.bookings;
  return bookings.filter((booking) =>
    booking.sessionId === sessionId && ["confirmed", "attended"].includes(booking.status)
  );
}
```

Implement `setBookingAttendance()` so live mode delegates to Task 3. In local mode:

1. resolve and authorize the current Admin/Super Admin;
2. resolve booking and concrete session;
3. reject cancelled/non-paid/unassigned/non-confirmed statuses;
4. evaluate Task 1’s window with injected `now`;
5. make same-state calls idempotent;
6. set/clear only status, `attendedAt`, and `attendedBy`;
7. call `save()` and return the booking.

Do not route this through member booking actions or payment confirmation.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```sh
node app/smoke.mjs
node --check app/js/store.js
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 4**

```sh
git add app/js/store.js app/smoke.mjs
git commit -m "feat(attendance): add authorized check-in seam"
```

---

### Task 5: Named financial rosters in Admin → Payments

**Files:**
- Modify: `app/js/views.js:2360-2640`
- Modify: `app/styles.css` near Admin HYROX/card/member-row styles
- Test: `app/smoke.mjs` near Admin Payments assertions
- Test: `app/live-auth-smoke.mjs` near Admin Payments rendering

**Interfaces:**
- Consumes: `store.paymentRosterBookings()`, `store.paymentStateForBooking()`, existing `memberUsers` from `listPaymentUsers()`, cycle/session lookups.
- Produces: stacked roster `<details>` cards and three named financial groups with stable classes/data attributes.

- [ ] **Step 1: Write failing roster rendering tests**

Build three booking fixtures owned by three distinct approved members. Render `await views.viewAdmin("payments")` and isolate one roster card using `data-payment-roster="<cycle-or-session-id>"`. Assert:

```js
for (const marker of [
  "Payment roster", "Payment due", "Awaiting confirmation", "Paid",
  "Due Member", "Claim Member", "Paid Member",
  'data-payment-state="payment_due"',
  'data-payment-state="awaiting_confirmation"',
  'data-payment-state="paid"',
]) assert.ok(rosterHtml.includes(marker));
```

Assert each member name occurs exactly once, each displayed count equals its group’s rows, and the roster region contains none of their emails, phones, donor IDs, queue entries, or raw JSON keys. Mark the paid booking attended and assert it stays in the Paid group with no count reduction.

Add a pooled unallocated fixture and assert all three financial names appear under the parent cycle with `Venue allocation pending`. Add a direct Quarry Bay fixture and assert it uses its concrete session card.

- [ ] **Step 2: Run smoke and verify RED**

Run:

```sh
node app/smoke.mjs
```

Expected: FAIL because named Payment due/Paid groups and roster hooks are absent.

- [ ] **Step 3: Implement directory-backed financial grouping**

Change `adminHyroxCycleCards()` and direct paid-session roster rendering to accept `memberUsers`. Build one directory:

```js
const memberDirectory = new Map(memberUsers.map((member) => [member.id, member]));
const displayName = (booking) => {
  const member = memberDirectory.get(booking.userId);
  return member ? (member.fullName || member.preferredName || "Member") : "Member";
};
```

Partition with `store.paymentStateForBooking()`, sort each group by `displayName().localeCompare(...)`, and render stable hooks:

```html
<details class="admin-payment-roster" data-payment-roster="...">
  <summary>...</summary>
  <details class="admin-payment-group" data-payment-state="payment_due">...</details>
  <details class="admin-payment-group" data-payment-state="awaiting_confirmation">...</details>
  <details class="admin-payment-group" data-payment-state="paid">...</details>
</details>
```

Render zero-count groups with `No members in this state.` Keep existing awaiting-confirmation reference and confirm/reject controls; do not duplicate the global Pending payments controls. Pass `memberUsers` from `adminOps()` into weekly cycle and direct-session helpers.

- [ ] **Step 4: Add mobile/accessibility CSS**

Add focused rules for:

```css
.admin-payment-roster > summary,
.admin-payment-group > summary,
.admin-attendance-session > summary { cursor: pointer; }

.admin-roster-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

@media (max-width: 600px) {
  .admin-roster-row { align-items: stretch; flex-direction: column; }
  .admin-roster-row .btn { width: 100%; }
}
```

Use semantic summaries, visible focus from existing global rules, escaped names, and no click-only `<div>` controls.

- [ ] **Step 5: Run rendering tests and verify GREEN**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/views.js
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: roster assertions pass; full suites pass except any separately recorded unrelated live-auth baseline failure.

- [ ] **Step 6: Commit Task 5**

```sh
git add app/js/views.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(admin): show named payment rosters"
```

---

### Task 6: Expected-arrivals UI and delegated attendance action

**Files:**
- Modify: `app/js/views.js` roster helpers from Task 5
- Modify: `app/js/app.js` click delegation near `confirm-payment`
- Modify: `app/styles.css` roster state styles
- Test: `app/smoke.mjs`
- Test: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `store.attendanceWindowForSession()`, `store.attendanceBookingsForSession()`, `store.setBookingAttendance()`.
- Produces: per-session Expected arrivals rendering and `data-action="attendance-toggle"` interaction.

- [ ] **Step 1: Write failing timing/state UI tests**

For a concrete paid session with one confirmed and one attended booking, temporarily replace `Date.now` with a fixed timestamp while rendering Admin Payments, then restore the original function in `finally`. Do not change the public `viewAdmin()` route API.

Assert before opening:

```js
assert.match(html, /Expected arrivals/);
assert.match(html, /Check-in opens 15 minutes before the session/);
assert.doesNotMatch(html, /data-action="attendance-toggle"/);
```

Assert at the exact opening boundary:

```js
assert.match(html, /1 arrived · 1 still expected/);
assert.match(html, /data-action="attendance-toggle"[^>]*data-arrived="1"/);
assert.match(html, />Mark Arrived</);
assert.match(html, /data-action="attendance-toggle"[^>]*data-arrived="0"/);
assert.match(html, />Undo</);
```

Assert one millisecond after closing that rows remain, controls disappear, and `Attendance locked` appears. Assert unallocated pooled, unpaid, RSVP, and cancelled bookings never receive controls.

- [ ] **Step 2: Run smoke and verify RED**

Run:

```sh
node app/smoke.mjs
```

Expected: FAIL because Expected-arrivals UI and attendance actions are absent.

- [ ] **Step 3: Implement Expected-arrivals rendering**

For each concrete paid session:

1. obtain `attendanceBookingsForSession(session.id)`;
2. partition confirmed as Expected and attended as Arrived;
3. sort Expected first, then Arrived, alphabetically within each list;
4. render count summary and read-only timing/locked copy;
5. render controls only when `attendanceWindowForSession(session).state === "open"`.

Use:

```html
<button class="btn sm" type="button"
  data-action="attendance-toggle"
  data-booking="..." data-arrived="1">Mark Arrived</button>
```

and for undo:

```html
<button class="btn ghost sm" type="button"
  data-action="attendance-toggle"
  data-booking="..." data-arrived="0">Undo</button>
```

For pooled cycles, render session sections only for assigned BFT/Midtown bookings. Before allocation, show `Expected-arrivals roster available after venue allocation.` Do not infer a venue from preference.

- [ ] **Step 4: Write failing delegated-action tests**

In `app/live-auth-smoke.mjs`, dispatch a click for each dataset value and assert:

- `data-arrived="1"` calls `setBookingAttendance(id, true)` once;
- `data-arrived="0"` calls `setBookingAttendance(id, false)` once;
- the clicked control is busy/disabled during the promise;
- success rerenders Admin Payments without changing `location.hash`;
- failure shows one error toast and rerenders authoritative data;
- repeated click while busy does not issue a second mutation.

Add a source assertion in `app/smoke.mjs` for the delegated `case "attendance-toggle"` and `await store.setBookingAttendance(...)` call.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```sh
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected attendance-specific failure: the delegated action is missing.

- [ ] **Step 6: Implement delegated action**

Add to `app/js/app.js` click delegation:

```js
case "attendance-toggle": {
  const bookingId = String(el.dataset.booking || "");
  const arrived = el.dataset.arrived === "1";
  if (!bookingId || !["0", "1"].includes(el.dataset.arrived)) break;
  await withBusyControl(el, arrived ? "Marking…" : "Undoing…", async () => {
    try {
      await store.setBookingAttendance(bookingId, arrived);
      toast(arrived ? "Marked Arrived" : "Attendance reset to Expected");
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to update attendance", true);
      await renderWithFeedback();
    }
  }, { busyKey: el });
  break;
}
```

Preserve the current hash. Do not optimistically change the roster before the store mutation resolves.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/app.js
node --check app/js/views.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: attendance UI/action tests pass; full suites pass except any explicitly documented unrelated live-auth baseline failure.

- [ ] **Step 8: Commit Task 6**

```sh
git add app/js/app.js app/js/views.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(admin): add expected arrival check-in"
```

---

### Task 7: Cross-domain regression review and final verification

**Files:**
- Modify if required by verified failures only: `README.md`, `docs/runbooks/operational-backend.md`, affected test files
- Review: all files changed since `31ef0cf`

**Interfaces:**
- Consumes: all Tasks 1–6.
- Produces: reviewed Group C branch with documented migration and no unrelated changes.

- [ ] **Step 1: Review requirement coverage**

Check the final diff against every spec section and explicitly verify:

```sh
git diff --name-only 31ef0cf..HEAD
git diff --stat 31ef0cf..HEAD
rg -n "Payment due|Awaiting confirmation|Paid|Expected arrivals|Mark Arrived|Attendance locked" app/js/views.js app/smoke.mjs
rg -n "set_operational_attendance|attended_at|attended_by" \
  app/js supabase/migrations/20260909000001_operational_attendance.sql \
  supabase/tests/operational_backend_integration.sql
```

Confirm that financial counts include attended bookings, attendance counts include only manually attended bookings, and no member-facing view exposes financial roster data.

- [ ] **Step 2: Run final automated verification**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/app.js
node --check app/js/store.js
node --check app/js/views.js
node --check app/js/operations.js
node --check app/live-auth-smoke.mjs
node --check app/smoke.mjs
git diff --check
```

If disposable database credentials were explicitly supplied, also run:

```sh
ITC_ALLOW_DATABASE_RESET=1 \
ITC_OPERATIONS_TEST_DATABASE_URL="$ITC_OPERATIONS_TEST_DATABASE_URL" \
bash supabase/tests/verify_operational_backend.sh
```

Otherwise report SQL execution as not run; do not substitute a linked reset.

- [ ] **Step 3: Verify branch and scope**

Run:

```sh
git fetch origin testing
test "$(git merge-base HEAD origin/testing)" = "$(git rev-parse origin/testing)"
if git diff --name-only origin/testing...HEAD | grep -Ei '(^|/)shop([/.]|$)|merchandise'; then
  echo "Shop scope violation" >&2
  exit 1
fi
git status --short --branch
```

Expected: no Shop paths, no whitespace errors, and only reviewed Group C commits above current `testing`.

- [ ] **Step 4: Update concise documentation if missing**

Ensure `README.md` states that Admin → Payments contains named financial rosters and time-gated attendance check-in, and `docs/runbooks/operational-backend.md` includes `20260909000001_operational_attendance.sql`. Do not add production payment or outbound-notification claims.

- [ ] **Step 5: Commit final verified documentation/test corrections**

If Step 4 changed files:

```sh
git add README.md docs/runbooks/operational-backend.md app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "docs: document admin attendance operations"
```

If no files changed, do not create an empty commit.

- [ ] **Step 6: Request code review**

Use the code-reviewer template with:

- base SHA: `31ef0cf`
- head SHA: `git rev-parse HEAD`
- requirements: `docs/superpowers/specs/2026-09-08-admin-attendance-roster-design.md`
- emphasis: authorization, exact time boundaries, financial/attendance distinction, privacy, pooled allocation, live/local parity, and migration safety.

Fix all Critical and Important findings, rerun Step 2, and commit fixes before offering integration.
