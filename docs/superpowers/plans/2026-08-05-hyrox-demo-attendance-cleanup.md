# HYROX Demo Attendance Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all simulated HYROX attendance (fake attendee names, `baseBooked` counters, seeded bookings/receipts) so the app reflects reality: one user, zero sign-ups.

**Architecture:** Vanilla ES modules, no build. Seeds live in `app/js/data.js`; all state mutations and the localStorage seam live in `app/js/store.js`; view templates in `app/js/views.js`. Persisted state is versioned — cleaning browsers that already loaded the app requires bumping `STATE_VERSION` to 10 with a migration step in `migrate()`.

**Tech Stack:** Node (headless smoke tests via `node app/smoke.mjs`), browser localStorage.

Spec: `docs/superpowers/specs/2026-08-05-hyrox-demo-attendance-cleanup-design.md`

## Global Constraints

- No npm dependencies, no build step. Plain ES modules.
- The smoke suite is the contract: behavior changes and test changes land in the same commit. `node app/smoke.mjs` must pass at the end of every task.
- Never delete persisted `state` keys without a migration — bump `STATE_VERSION` and add a step in `migrate()` (established pattern, see v2/v4/v9 steps in `app/js/store.js`).
- Non-Shop work on a non-Shop branch: do not touch Shop/Giving/merchandise code.
- Only HYROX sessions change. Wednesday Night Training and other activities are untouched.
- The admin "Simulated existing bookings" field (`app/js/views.js` activity form, `saveActivity()` in `app/js/store.js`) stays — it is a deliberate prototype affordance. With the fake name pool gone it only affects "spots left".
- Branch: commit on the current branch (`feature/auth-identity`).

---

### Task 1: Remove simulated attendance from seeds, store, and views

**Files:**
- Modify: `app/js/data.js` — HYROX activities (~lines 65-100); `seedBookings()`/`seedReceipts()`/`sessionSnapshot()` (~lines 185-260); `saturdayOnOrBefore()` (~line 360)
- Modify: `app/js/store.js` — imports (lines 11-12), `freshState()` (~lines 53-54), v2 migration step (~lines 85-96), `attendeesFor()` (lines 723-736)
- Modify: `app/js/views.js` — attendee chips block in `viewActivity()` (~lines 389-395)
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: existing exports `store.attendeesFor(session)`, `store.spotsLeft(session)`, `store.bookingsForUser(userId)`, `store.upcomingSessions(days)`, `data.SEED_ACTIVITIES`, `data.sessionStarted(session)` — all unchanged in signature.
- Produces: `attendeesFor(session)` still returns `string[]` (now real bookings only, possibly empty). `seedBookings`/`seedReceipts` no longer exist — nothing outside `data.js`/`store.js` may reference them after this task.

- [ ] **Step 1: Write the failing tests**

In `app/smoke.mjs`, make three edits.

Edit A — immediately after the line `if (!paid || !free) throw new Error("expected both paid and free sessions in window");`, insert:

```js
// --- HYROX demo attendance cleanup: no simulated strangers ---
// The club has one real member and no sign-ups yet, so HYROX sessions must
// show full capacity and an empty attendee list in fresh state.
for (const a of data.SEED_ACTIVITIES.filter((x) => x.category === "HYROX")) {
  if ("baseBooked" in a) {
    failures++;
    console.error(`FAIL seed activity ${a.id} still simulates demand (baseBooked)`);
  }
}
console.log("ok  HYROX seeds carry no simulated bookings");
const hyroxUpcoming = allUpcoming.find((s) => s.category === "HYROX" && !data.sessionStarted(s));
if (!hyroxUpcoming) throw new Error("expected an upcoming HYROX session");
if (store.attendeesFor(hyroxUpcoming).length !== 0) {
  failures++;
  console.error("FAIL fresh state should have no HYROX attendees");
} else console.log("ok  fresh state has no HYROX attendees");
if (store.spotsLeft(hyroxUpcoming) !== hyroxUpcoming.capacity) {
  failures++;
  console.error("FAIL HYROX spots should equal capacity with no bookings");
} else console.log("ok  HYROX spots equal capacity with no bookings");
if (store.bookingsForUser("u-member").length !== 0) {
  failures++;
  console.error("FAIL seeded member should have no bookings after cleanup");
} else console.log("ok  seeded member has no bookings");
```

Edit B — replace the seeded-receipts assertion:

```js
if (!(await views.viewAccount("payments")).includes("ITC-2026-0048")) {
  failures++;
  console.error("FAIL seeded receipts missing from Payments sub-page");
} else console.log("ok  seeded receipts show on Payments sub-page");
```

with:

```js
if (!(await views.viewAccount("payments")).includes("No payments yet")) {
  failures++;
  console.error("FAIL seeded member Payments sub-page should be empty after cleanup");
} else console.log("ok  seeded member has no receipts");
```

Edit C — replace the seeded-member "My week" assertion:

```js
if (!memberHome.includes("BFT Causeway Bay") || memberHome.includes("Midtown 28")) {
  failures++;
  console.error('FAIL "My week" should show only the member\'s booked 11:15 HYROX');
} else console.log('ok  "My week" shows only the member\'s booked session');
```

with:

```js
if (!memberHome.includes("Nothing booked this week")) {
  failures++;
  console.error('FAIL "My week" should be empty for the seeded member after cleanup');
} else console.log('ok  "My week" is empty for the seeded member');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node app/smoke.mjs`
Expected: FAIL with "seed activity hyrox still simulates demand (baseBooked)", "fresh state should have no HYROX attendees", "HYROX spots should equal capacity with no bookings", "seeded member should have no bookings after cleanup", "seeded member Payments sub-page should be empty after cleanup", and "\"My week\" should be empty for the seeded member after cleanup".

- [ ] **Step 3: Delete simulated demand from `app/js/data.js`**

Edit A — in the `hyrox-midtown` seed activity, delete this line:

```js
    baseBooked: 9, // simulated demand from other members
```

Edit B — in the `hyrox` seed activity, delete this line:

```js
    baseBooked: 14, // simulated demand from other members
```

Edit C — delete the entire seed bookings/receipts section: the `// --- Seed bookings ---` comment header, `export function seedBookings()`, `export function seedReceipts()`, and the `function sessionSnapshot()` helper (it is used only by `seedBookings` — `payForSession()` in `store.js` builds its own snapshot inline). This is one contiguous block starting at the comment `// --- Seed bookings ---` and ending at the closing brace of `sessionSnapshot()`. Leave the functions that follow (`sessionsInRange` etc.) intact.

Edit D — delete the now-unused `saturdayOnOrBefore()` helper (~line 360; used only by the deleted seed functions — confirm with `grep -n "saturdayOnOrBefore" app/js/*.js` before deleting):

```js
function saturdayOnOrBefore(date) {
  const d = new Date(date.getTime());
  const offset = (d.getDay() + 1) % 7; // days since Saturday
  return addDays(d, -offset);
}
```

- [ ] **Step 4: Remove fake attendees and seed references from `app/js/store.js`**

Edit A — remove the two deleted functions from the import block:

```js
  seedBookings,
  seedReceipts,
```

Edit B — in `freshState()`, replace:

```js
    bookings: seedBookings(),
    receipts: seedReceipts(),
```

with:

```js
    bookings: [],
    receipts: [],
```

Edit C — in the v2 migration step (`if (v < 2) { ... }`), delete the seed booking/receipt replacement loop:

```js
    // Seed-owned bookings/receipts are replaced outright: their snapshots
    // describe the old session. User-created records are left untouched.
    for (const [key, seeded] of [
      ["bookings", seedBookings()],
      ["receipts", seedReceipts()],
    ]) {
      const ids = new Set(seeded.map((r) => r.id));
      state[key] = [...state[key].filter((r) => !ids.has(r.id)), ...seeded];
    }
```

(The activity-replacement lines of the v2 step stay. The Task 2 v10 step removes any lingering seed records by id, and v1-era persisted state is hypothetical anyway.)

Edit D — replace the whole `attendeesFor()` function:

```js
export function attendeesFor(session) {
  // Simulated member list: seed bookings plus any local bookings.
  const pool = [
    "Jason M.", "Natalie C.", "Marco S.", "Jenny W.", "Kelvin T.",
    "Chris P.", "Wing L.", "Sam H.", "Rachel N.", "Tom Y.",
    "Grace F.", "Ben K.", "Michelle O.", "Alex Z.",
  ];
  const names = pool.slice(0, Math.min(session.baseBooked || 0, pool.length));
  for (const b of activeBookingsForSession(session.id)) {
    const u = state.users.find((x) => x.id === b.userId);
    if (u) names.unshift(`${u.preferredName || u.fullName} ${u.fullName.split(" ").pop()[0]}.`);
  }
  return names;
}
```

with:

```js
export function attendeesFor(session) {
  // Real bookings only — no simulated strangers. The list must reflect who
  // actually signed up.
  const names = [];
  for (const b of activeBookingsForSession(session.id)) {
    const u = state.users.find((x) => x.id === b.userId);
    if (u) names.unshift(`${u.preferredName || u.fullName} ${u.fullName.split(" ").pop()[0]}.`);
  }
  return names;
}
```

- [ ] **Step 5: Empty-state for the attendee list in `app/js/views.js`**

In `viewActivity()`, replace:

```js
      <div class="section-head"><h2>Who’s coming</h2></div>
      <div class="attendees">${store.attendeesFor(s).map((n) => `<span>${esc(n)}</span>`).join("")}</div>`
```

with:

```js
      <div class="section-head"><h2>Who’s coming</h2></div>
      ${store.attendeesFor(s).length
        ? `<div class="attendees">${store.attendeesFor(s).map((n) => `<span>${esc(n)}</span>`).join("")}</div>`
        : `<p class="muted small">No sign-ups yet — be the first.</p>`}`
```

(Rationale: with zero bookings the old template rendered an empty `<div class="attendees">` under the heading, which looks broken. The visitor branch below it — `memberOnlyNote(...)` — is unchanged.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `node app/smoke.mjs`
Expected: PASS — "All smoke tests passed." (The v7/v9 migration tests are unaffected: they only touch `state.users`.)

- [ ] **Step 7: Commit**

```bash
git add app/js/data.js app/js/store.js app/js/views.js app/smoke.mjs
git commit -m "Remove simulated HYROX attendance: fake attendee pool, baseBooked, seed bookings/receipts"
```

---

### Task 2: v10 migration — strip demo attendance from persisted state

**Files:**
- Modify: `app/js/store.js` — `STATE_VERSION` (line 26), tail of `migrate()` (after the `if (v < 9)` step, ~line 184)
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: `store.resetDemo()`, `store.load()`, `store.activities()`, `store.bookingsForUser(userId)` (all existing exports), plus the test-local `mem` localStorage shim and storage key `"itc.prototype.v1"` already used by the v7/v9 migration tests.
- Produces: `STATE_VERSION` becomes `10`; persisted v9-and-earlier state loads with no `baseBooked` on any activity and no seed-owned bookings (`b-seed-past`, `b-seed-next`) or receipts (`r-seed-past`, `r-seed-next`).

- [ ] **Step 1: Write the failing migration test**

In `app/smoke.mjs`, immediately after the closing brace of the v9 migration test block (the block ending with the "v9 migration SQL adds defaults, backfills age and clears DOB" check), insert:

```js
// --- v10 migration: HYROX demo attendance data stripped ---
store.resetDemo();
{
  const raw = JSON.parse(mem.get("itc.prototype.v1"));
  raw.version = 9;
  // simulate pre-cleanup persisted state: simulated demand counters plus
  // seed-owned and user-created bookings side by side
  raw.activities.find((a) => a.id === "hyrox").baseBooked = 14;
  raw.activities.find((a) => a.id === "hyrox-midtown").baseBooked = 9;
  const snap = (dateISO) => ({ name: "ITC HYROX", kind: "paid", dateISO, time: "11:15", durationMin: 75, location: "BFT Causeway Bay", price: 180 });
  raw.bookings.push(
    { id: "b-seed-past", userId: "u-member", sessionId: "hyrox-2026-07-25", status: "attended", createdAt: 1, snapshot: snap("2026-07-25") },
    { id: "b-seed-next", userId: "u-member", sessionId: "hyrox-2026-08-08", status: "confirmed", createdAt: 2, snapshot: snap("2026-08-08") },
    { id: "b-user-1", userId: "u-member", sessionId: "hyrox-2026-08-08", status: "confirmed", createdAt: 3, snapshot: snap("2026-08-08") }
  );
  raw.receipts.push(
    { id: "r-seed-past", bookingId: "b-seed-past", userId: "u-member", amount: 180, currency: "HKD", status: "paid", issuedAt: 1, line: "x" },
    { id: "r-seed-next", bookingId: "b-seed-next", userId: "u-member", amount: 180, currency: "HKD", status: "paid", issuedAt: 2, line: "x" }
  );
  mem.set("itc.prototype.v1", JSON.stringify(raw));
  store.load();
  if (store.activities().some((a) => "baseBooked" in a)) {
    failures++;
    console.error("FAIL v10 migration should strip baseBooked from activities");
  } else console.log("ok  v10 migration strips baseBooked");
  const migratedIds = store.bookingsForUser("u-member").map((b) => b.id);
  if (migratedIds.length !== 1 || migratedIds[0] !== "b-user-1") {
    failures++;
    console.error(`FAIL v10 migration should remove seed bookings only, got ${JSON.stringify(migratedIds)}`);
  } else console.log("ok  v10 migration removes seed bookings, keeps user bookings");
  const persisted = JSON.parse(mem.get("itc.prototype.v1"));
  if ((persisted.receipts || []).length !== 0) {
    failures++;
    console.error("FAIL v10 migration should remove seed receipts");
  } else console.log("ok  v10 migration removes seed receipts");
  if (persisted.version !== 10) {
    failures++;
    console.error(`FAIL state version should be 10 after migration, got ${persisted.version}`);
  } else console.log("ok  state version is 10");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node app/smoke.mjs`
Expected: FAIL with "v10 migration should strip baseBooked from activities", "v10 migration should remove seed bookings only", "state version should be 10 after migration, got 9".

- [ ] **Step 3: Implement the v10 migration in `app/js/store.js`**

Edit A — change:

```js
const STATE_VERSION = 9;
```

to:

```js
const STATE_VERSION = 10;
```

Edit B — in `migrate()`, immediately after the `if (v < 9) state.users.forEach(backfillProfilePreferences);` line (and before `state.version = STATE_VERSION;`), insert:

```js
  if (v < 10) {
    // v10: HYROX demo attendance cleanup — the club no longer simulates
    // demand. Strip the seeded baseBooked counters and remove the old
    // seed-owned bookings/receipts so "Who's coming" and spots left reflect
    // real sign-ups only. User-created records are untouched.
    for (const a of state.activities) {
      if (a.id === "hyrox" || a.id === "hyrox-midtown") delete a.baseBooked;
    }
    const seedBookingIds = new Set(["b-seed-past", "b-seed-next"]);
    const seedReceiptIds = new Set(["r-seed-past", "r-seed-next"]);
    state.bookings = state.bookings.filter((b) => !seedBookingIds.has(b.id));
    state.receipts = state.receipts.filter((r) => !seedReceiptIds.has(r.id));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node app/smoke.mjs`
Expected: PASS — "All smoke tests passed."

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "Add v10 migration stripping HYROX demo attendance from persisted state"
```

---

### Task 3: Manual verification against the real browser flow

**Files:** none (verification only)

**Interfaces:**
- Consumes: the committed Tasks 1-2.

- [ ] **Step 1: Fresh-visitor check**

Run: `python3 -m http.server 4173` (repo root), then open `http://127.0.0.1:4173/app/` in a private/incognito window (guarantees no pre-existing localStorage).
Expected: navigate to Schedule → this Saturday's ITC HYROX (BFT Causeway Bay). "Places" reads "18 of 18 left". Signed-in as an approved member (demo profile), "Who's coming" reads "No sign-ups yet — be the first." with no name chips.

- [ ] **Step 2: Migration check**

In a non-private window that has visited the app before (old v9 localStorage), reload the app.
Expected: in DevTools console, `JSON.parse(localStorage.getItem("itc.prototype.v1")).version` is `10`; the same HYROX session page shows "18 of 18 left" and no attendee names.

- [ ] **Step 3: Full booking loop still works**

Book the HYROX session as the demo member, view the receipt, then cancel.
Expected: booking succeeds, "Who's coming" then shows the member's own name chip, receipt renders, cancellation refunds and frees the place. (Covered by smoke, this is the belt-and-braces UI pass.)

- [ ] **Step 4: Report results**

Report manual check outcomes to the user. No commit — if anything fails, fix forward with a new failing smoke assertion first.
