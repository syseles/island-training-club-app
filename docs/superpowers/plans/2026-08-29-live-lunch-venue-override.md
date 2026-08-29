# Live Lunch Venue Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dated live RSVP lunch venue save, render, and reset exactly like the existing weekday free-event venue overrides.

**Architecture:** Keep `store.setWeekVenue()` as the only UI-to-backend seam, but resolve the authoritative session before deciding which activity may be overridden. Reuse the existing `set_session_venue` RPC and operational-cache refresh; the deployed Supabase project must have the existing lunch migrations applied in order.

**Tech Stack:** Vanilla ES modules, localStorage prototype state, Supabase RPC/migrations, Node smoke tests.

## Global Constraints

- Implement on `feature/rsvp-events` only.
- Preserve the override allow-list: `wnt`, `run`, `water`, and `lunch`.
- Do not change lunch RSVP, capacity, payment, cancellation, or recurring-default behavior.
- Do not change the localStorage schema.
- Reuse migration `20260829000003_lunch_venue_overrides.sql`; do not create a duplicate schema migration unless migration inspection proves the existing file is insufficient.
- Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before completion.

---

### Task 1: Resolve venue authorization from the session

**Files:**
- Modify: `app/js/store.js:1820-1855`
- Test: `app/smoke.mjs` near the weekly venue override assertions

**Interfaces:**
- Consumes: `getSession(sessionId)` returning a decorated session with `activityId` and `kind`.
- Produces: unchanged `setWeekVenue(sessionId, fields)` API, with authoritative activity resolution.

- [ ] **Step 1: Add a failing structural regression assertion**

Near the existing source-level checks in `app/smoke.mjs`, read `app/js/store.js` and assert that `setWeekVenue()` resolves `before` before calculating `overrideActivityId`, and prefers `before?.activityId`:

```js
const weekVenueSource = storeSource.match(
  /export function setWeekVenue[\s\S]*?\/\/ --- Giving/
)?.[0] || "";
if (!/const before = getSession\(sessionId\)/.test(weekVenueSource)
    || !/before\?\.activityId/.test(weekVenueSource)) {
  throw new Error("setWeekVenue should authorize from the resolved session activityId");
}
```

Use the existing `storeSource` variable if already available; otherwise load `js/store.js` with the smoke suite’s existing `readFileSync` helper.

- [ ] **Step 2: Run the local smoke suite and verify the test fails**

Run: `node app/smoke.mjs`

Expected: FAIL with `setWeekVenue should authorize from the resolved session activityId` because the current function parses the ID before resolving the session.

- [ ] **Step 3: Implement authoritative activity resolution**

At the beginning of `setWeekVenue()`, resolve the session before the allow-list check:

```js
const before = getSession(sessionId);
const fallbackActivityId = String(sessionId).replace(/-\d{4}-\d{2}-\d{2}$/, "");
const overrideActivityId = before?.activityId || fallbackActivityId;
if (!new Set(["wnt", "run", "water", "lunch"]).has(overrideActivityId)) {
  throw new Error("Activity venue is fixed.");
}
```

Remove the later duplicate `const before = getSession(sessionId);`. Preserve meeting-point validation, live RPC arguments, local authorization, notifications, and reset logic unchanged.

- [ ] **Step 4: Run the local smoke suite**

Run: `node app/smoke.mjs`

Expected: `All smoke tests passed.`

- [ ] **Step 5: Commit the store seam change**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "fix(events): resolve lunch venue override activity"
```

---

### Task 2: Cover live lunch save, rendering, and reset

**Files:**
- Modify: `app/live-auth-smoke.mjs` near the live RSVP lunch assertions
- Verify: `app/js/operations.js`
- Verify: `app/js/views.js`

**Interfaces:**
- Consumes: `store.setWeekVenue()`, `store.getSession()`, `views.viewSchedule()`, and `views.viewActivity()`.
- Produces: regression coverage for the complete live lunch venue lifecycle.

- [ ] **Step 1: Extend the live test after saving the lunch override**

After the existing `Cafe Deco, Central` cache assertion, select the lunch date in Schedule and verify both member surfaces:

```js
views.scheduleState.selected = lunchSession.dateISO;
const lunchScheduleHtml = views.viewSchedule();
const lunchDetailHtml = views.viewActivity(lunchSession.id);
if (!lunchScheduleHtml.includes("Cafe Deco, Central")
    || !lunchDetailHtml.includes("Cafe Deco, Central")) {
  throw new Error("live lunch venue override must appear on Schedule and Activity Details");
}
```

Then reset only that dated session and verify the recurring default is restored:

```js
await store.setWeekVenue(lunchSession.id, {
  location: null,
  mapsQuery: null,
  meetingLat: null,
  meetingLng: null,
});
const resetLunch = store.getSession(lunchSession.id);
if (resetLunch.location !== "TBC") {
  throw new Error("resetting a live lunch venue should restore its TBC recurring default");
}
```

- [ ] **Step 2: Run the live suite**

Run: `node app/live-auth-smoke.mjs`

Expected: PASS, including the new Schedule, Activity Details, and reset assertions.

- [ ] **Step 3: Commit the live regression coverage**

```bash
git add app/live-auth-smoke.mjs
git commit -m "test(events): cover live lunch venue lifecycle"
```

---

### Task 3: Verify Supabase migration state

**Files:**
- Verify: `supabase/migrations/20260829000002_rsvp_events.sql`
- Verify: `supabase/migrations/20260829000003_lunch_venue_overrides.sql`
- Verify: `supabase/migrations/20260829000004_uncapped_rsvp.sql`

**Interfaces:**
- Consumes: linked Supabase project access supplied by the environment.
- Produces: confirmed database support for `lunch` in `set_session_venue`, or an explicit deployment blocker report.

- [ ] **Step 1: Verify the migration SQL before deployment**

Run:

```bash
rg -n "v_activity_id not in \('wnt', 'run', 'water', 'lunch'\)" \
  supabase/migrations/20260829000003_lunch_venue_overrides.sql
```

Expected: one match in the replacement `set_session_venue` function.

- [ ] **Step 2: Check available Supabase deployment tooling**

Run:

```bash
command -v supabase || true
env | grep -E '^SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|PROJECT_REF)=' | sed 's/=.*/=<set>/'
```

Do not print secret values.

- [ ] **Step 3: Apply migrations when linked access is available**

If the Supabase CLI and linked credentials are available, run:

```bash
supabase migration list --linked
supabase db push --linked
supabase migration list --linked
```

Confirm migrations `20260829000002`, `20260829000003`, and `20260829000004` are listed as applied remotely. If tooling or credentials are unavailable, stop this deployment step and report exactly that these migrations remain to be applied; do not claim the live preview is fixed.

- [ ] **Step 4: Run final repository verification**

Run:

```bash
git diff --check
node app/smoke.mjs
node app/live-auth-smoke.mjs
git status --short --branch
```

Expected: both suites pass, the whitespace check is clean, and only intended committed work is present.
