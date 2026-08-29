# Live Lunch Venue Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dated live RSVP lunch venue save, render, and reset exactly like the existing weekday free-event venue overrides.

**Architecture:** Keep `store.setWeekVenue()` as the only UI-to-backend seam and keep the client’s six named RPC arguments so WNT meeting coordinates continue to work. Add a forward-only migration that makes the six-argument `set_session_venue` implementation authoritative for `wnt`, `run`, `water`, and `lunch`, then restore the four-argument overload as a compatibility wrapper.

**Tech Stack:** Vanilla ES modules, localStorage prototype state, Supabase RPC/migrations, Node smoke tests.

## Global Constraints

- Implement on `feature/rsvp-events` only.
- Preserve the override allow-list: `wnt`, `run`, `water`, and `lunch`.
- Do not change lunch RSVP, capacity, payment, cancellation, or recurring-default behavior.
- Do not change the localStorage schema.
- Do not edit previously shipped migration `20260829000003_lunch_venue_overrides.sql`; add only `20260829000006_lunch_venue_meeting_point_rpc.sql` for the proven overload defect.
- Preserve WNT Tamar Park meeting-coordinate validation and persistence; lunch must always store null meeting coordinates.
- Keep the four-argument RPC as a wrapper around the authoritative six-argument RPC.
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

---

### Task 4: Repair the six-argument lunch venue RPC

**Files:**
- Create: `supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql`
- Modify: `supabase/tests/operational_backend_integration.sql` in the venue-override transaction
- Modify: `app/smoke.mjs` near migration/source contract checks
- Verify: `app/js/operations.js` in `liveSetWeekVenue()`

**Interfaces:**
- Consumes: the six named arguments emitted by `liveSetWeekVenue()`: `p_session_id`, `p_location`, `p_maps_query`, `p_was_tbc`, `p_meeting_lat`, and `p_meeting_lng`.
- Produces: authoritative `public.set_session_venue(text, text, text, boolean, double precision, double precision)` supporting `wnt`, `run`, `water`, and `lunch`.
- Preserves: four-argument compatibility overload, Admin authorization, notification fan-out/deduplication, advisory locking, WNT coordinate behavior, grants, and cache result shape.

- [ ] **Step 1: Add a failing migration contract test**

In `app/smoke.mjs`, load the new migration:

```js
const lunchMeetingRpcMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql"),
  "utf8"
);
```

Extract the six-argument implementation and assert that it contains the six-argument signature, the complete allow-list, WNT-only coordinate logic, and lunch notification label. Also assert that the four-argument overload forwards null coordinates:

```js
assert.match(lunchMeetingRpcMigrationSource,
  /set_session_venue\([\s\S]*?p_meeting_lat double precision,[\s\S]*?p_meeting_lng double precision/);
assert.match(lunchMeetingRpcMigrationSource,
  /v_activity_id not in \('wnt', 'run', 'water', 'lunch'\)/);
assert.match(lunchMeetingRpcMigrationSource,
  /v_is_wnt_tamar := v_activity_id = 'wnt'/);
assert.match(lunchMeetingRpcMigrationSource,
  /when 'lunch' then 'Post-Training Lunch'/);
assert.match(lunchMeetingRpcMigrationSource,
  /select public\.set_session_venue\([\s\S]*?p_was_tbc, null, null[\s\S]*?\);/);
```

- [ ] **Step 2: Run the local smoke suite and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL with `ENOENT` because migration `00006` does not exist.

- [ ] **Step 3: Add SQL integration coverage before the migration implementation**

In the existing venue-override transaction in `supabase/tests/operational_backend_integration.sql`, authenticate as the Admin fixture and call the six-argument function for `lunch-2026-08-22`:

```sql
perform public.set_session_venue(
  'lunch-2026-08-22', 'Cafe Deco, Central', 'Cafe Deco, Central', true,
  null, null
);
perform pg_temp.op_assert(
  exists (
    select 1 from public.operational_session_venue_overrides
     where session_id = 'lunch-2026-08-22'
       and activity_id = 'lunch'
       and location = 'Cafe Deco, Central'
       and maps_query = 'Cafe Deco, Central'
       and meeting_lat is null
       and meeting_lng is null
  ),
  'six-argument lunch venue save persists without meeting coordinates'
);
```

Then call the four-argument overload with null location/map values and assert the row is reset without an authorization or fixed-venue error. Keep the existing WNT coordinate assertions unchanged so the same integration suite protects both behaviors.

- [ ] **Step 4: Create the forward-only migration**

Start from the complete six-argument implementation in `20260825000001_wnt_meeting_points.sql`, preserving its validation, locking, persistence, notification, and coordinate logic. In the new migration, make these exact semantic changes:

```sql
if v_activity_id not in ('wnt', 'run', 'water', 'lunch') then
  raise exception 'Activity venue is fixed.' using errcode = '42501';
end if;
```

Keep meeting coordinates WNT-only:

```sql
v_is_wnt_tamar := v_activity_id = 'wnt'
  and v_normalized_location in ('tamar park', 'tamar park, admiralty');
```

Add the lunch label:

```sql
when 'lunch' then 'Post-Training Lunch'
```

After the authoritative six-argument function, replace the four-argument overload with this compatibility wrapper:

```sql
create or replace function public.set_session_venue(
  p_session_id text,
  p_location text,
  p_maps_query text,
  p_was_tbc boolean
)
returns public.operational_session_venue_overrides
language sql
security definer
set search_path = public
as $$
  select public.set_session_venue(
    p_session_id, p_location, p_maps_query, p_was_tbc, null, null
  );
$$;
```

Revoke execution from `public` and `anon` and grant it to `authenticated` for both overload signatures. End with:

```sql
notify pgrst, 'reload schema';
```

Do not change `app/js/operations.js`; retaining all six named arguments is required.

- [ ] **Step 5: Run local and live-auth suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

Expected: both Node suites pass, the safety harness passes, and whitespace is clean.

If `ITC_OPERATIONS_TEST_DATABASE_URL` and `ITC_ALLOW_DATABASE_RESET=1` are available, also run:

```bash
bash supabase/tests/verify_operational_backend.sh
```

Otherwise report that PostgreSQL integration was not run; do not claim the migration is deployed or the live issue fixed.

- [ ] **Step 6: Commit the RPC overload repair**

```bash
git add docs/superpowers/plans/2026-08-29-live-lunch-venue-override.md \
  supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql \
  supabase/tests/operational_backend_integration.sql app/smoke.mjs
git commit -m "fix(events): admit lunch in venue RPC"
```

---

### Task 5: Count live RSVP bookings independently of identities

**Files:**
- Modify: `app/js/store.js` near `attendeesFor()`
- Modify: `app/js/views.js` RSVP count surfaces
- Test: `app/smoke.mjs` near RSVP rendering coverage
- Test: `app/live-auth-smoke.mjs` near live lunch join/withdraw coverage

**Interfaces:**
- Produces: `export function attendeeCountFor(session)` returning the number of confirmed bookings for `session.id`.
- Consumes: existing `activeBookingsForSession(sessionId)`, whose live path reads the operational booking cache and whose local path reads prototype bookings.
- Preserves: `attendeesFor(session)` as identity/name formatting only; no synthetic users or local identity persistence.

- [ ] **Step 1: Write failing count-contract tests**

In `app/smoke.mjs`, assert `store.attendeeCountFor` exists and that every RSVP count surface in `views.js` calls it rather than `attendeesFor(s).length`. Keep attendee-name assertions separate.

In `app/live-auth-smoke.mjs`, record the lunch count before joining, then assert exact deltas:

```js
const countBeforeRsvp = store.attendeeCountFor(lunchSession);
const rsvpBooking = await store.rsvpSession(authUser.id, lunchSession.id);
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp + 1,
  "Count me in must increase the RSVP count by exactly one");
const goingHtml = views.viewActivity(lunchSession.id);
assert.ok(goingHtml.includes(`${countBeforeRsvp + 1} going`));
await store.withdrawRsvp(rsvpBooking.id);
assert.equal(store.attendeeCountFor(lunchSession), countBeforeRsvp,
  "withdrawal must decrease the RSVP count by exactly one");
```

Also assert the live prototype state still contains no copied identity rows.

- [ ] **Step 2: Run RED**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: FAIL because `attendeeCountFor` does not exist and live `attendeesFor()` filters out bookings whose owners are absent from local `state.users`.

- [ ] **Step 3: Implement the count seam**

Add near `attendeesFor()`:

```js
export function attendeeCountFor(session) {
  if (!session?.id) return 0;
  return activeBookingsForSession(session.id).length;
}
```

Replace only count expressions in Schedule rows, RSVP Activity Details, and Admin Free & RSVP controls with `store.attendeeCountFor(s)`. Do not change `attendeesFor()` or create placeholder identities.

- [ ] **Step 4: Verify exact transitions and regressions**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: both suites pass; join is exactly `+1`, withdrawal exactly `-1`, and every count surface uses confirmed bookings.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-08-29-live-lunch-venue-override.md \
  app/js/store.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(events): count live lunch RSVPs"
```

---

### Task 6: Publish exact RSVP totals and enforce RSVP integrity

**Files:**
- Create: `supabase/migrations/20260829000008_rsvp_integrity.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `app/js/operations.js` operational cache/hydration readers
- Modify: `app/js/store.js` live count and date horizon
- Test: `app/smoke.mjs`
- Test: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces: `public.get_operational_rsvp_counts()` returning `table(session_id text, going_count bigint)` with no identity columns.
- Produces: `liveOps.liveRsvpCountFor(sessionId)` returning an exact hydrated integer or null when count enrichment is degraded.
- Preserves: `store.attendeeCountFor(session)` public API, paid reservation behavior, uncapped lunch, and optional non-fatal enrichment semantics.

- [ ] **Step 1: Write failing migration and source contracts**

In `app/smoke.mjs`, load `20260829000008_rsvp_integrity.sql` and assert:

```js
for (const marker of [
  "get_operational_rsvp_counts",
  "requires_rsvp",
  "status = 'confirmed'",
  "at time zone 'Asia/Hong_Kong'",
  "reserve_operational_session",
  "withdraw_operational_rsvp",
  "grant execute on function public.get_operational_rsvp_counts() to anon, authenticated",
]) assert.ok(rsvpIntegrityMigrationSource.includes(marker));
```

Assert the aggregate return declaration contains only `session_id` and `going_count`, and the migration does not grant direct booking-table access.

Add a source assertion that live `upcomingSessions(days)` computes and applies an inclusive upper date bound rather than returning every hydrated future session.

- [ ] **Step 2: Run RED**

Run: `node app/smoke.mjs`

Expected: FAIL with `ENOENT` because migration `00008` does not exist.

- [ ] **Step 3: Add SQL integration scenarios before implementation**

Extend `supabase/tests/operational_backend_integration.sql` with rollback-safe assertions:

1. Create two confirmed lunch bookings for different approved members plus reserved/cancelled/deferred noise; assert the aggregate returns exactly `2` for that lunch and no identity columns are exposed.
2. Call `reserve_operational_session()` directly for a zero-price one-off/free template with `requires_rsvp = false`; assert rejection and no booking row.
3. Call `withdraw_operational_rsvp()` for an ordinary free-event row; assert rejection/no mutation.
4. Set a lunch date/time around a Hong Kong boundary and use transaction-local clock controls or direct resolver conditions to prove the RPC rejects at/after Hong Kong start while preserving pre-start behavior.
5. Assert paid HYROX reservation and uncapped lunch RSVP still work.
6. Assert `anon` and `authenticated` can execute only the count aggregate while direct booking RLS remains unchanged.

- [ ] **Step 4: Create migration `00008`**

Add a `STABLE`, `SECURITY DEFINER`, fixed-search-path count function:

```sql
create or replace function public.get_operational_rsvp_counts()
returns table(session_id text, going_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.session_id, count(*)::bigint
    from public.operational_bookings b
    join public.operational_sessions s on s.id = b.session_id
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where t.requires_rsvp
     and b.status = 'confirmed'
   group by b.session_id;
$$;
```

Revoke from `public`, then grant execution to `anon, authenticated`. Do not expose profile IDs.

Replace the final reserve and withdraw functions from migrations `00004`/`00002`. Resolve `requires_rsvp` from the session’s activity template. Define RSVP as `price_hkd = 0 AND requires_rsvp`; reject zero-price non-RSVP reserve/withdraw attempts. Use this exact start comparison in both functions:

```sql
if (v_session.session_date + v_session.start_time)
     at time zone 'Asia/Hong_Kong' <= now() then
  raise exception 'Session has already started.' using errcode = '23514';
end if;
```

Preserve existing paid capacity/payment deadline behavior, nullable RSVP capacity behavior, notification kinds/copy, authorization, return rows, and grants. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 5: Add count enrichment to operational hydration**

Add `rsvpCounts: new Map()` and optional `rsvpCountError` to `liveCache`. Fetch `get_operational_rsvp_counts` through an always-settling helper so a missing/unauthorized aggregate never aborts core hydration. Replace the count map on every hydration and expose:

```js
export function liveRsvpCountFor(sessionId) {
  return liveCache.rsvpCounts.has(sessionId)
    ? liveCache.rsvpCounts.get(sessionId)
    : null;
}
```

Expose degraded status through `operationalStateStatus()`. Realtime booking refresh already reloads the aggregate; do not add another subscription.

In `store.attendeeCountFor(session)`, use the exact live aggregate when non-null, otherwise fall back to caller-visible confirmed bookings. Local behavior remains unchanged.

- [ ] **Step 6: Restore the live date horizon**

In live `upcomingSessions(days)`, compute today and an inclusive end date `days - 1` calendar days later using local date arithmetic. Filter `s.dateISO >= todayISO && s.dateISO <= endISO` before sorting/decorating. Add date-stable tests proving 14-day callers exclude day 15 while the rolling Social preview still uses event start time.

- [ ] **Step 7: Add behavioral live-auth coverage**

Make the fake direct booking table enforce member RLS, while `get_operational_rsvp_counts` aggregates all confirmed RSVP bookings. Seed another member’s confirmed lunch booking and excluded-status rows. Assert an ordinary member sees that baseline total, then exact `+1` after join and exact `-1` after withdrawal without receiving the other member’s booking/profile row.

Assert Schedule, Activity Details, and Admin render the same total. Add a rejected count-RPC hydration showing core sessions remain visible and count status degrades safely.

- [ ] **Step 8: Run verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

If disposable database credentials exist, also run `bash supabase/tests/verify_operational_backend.sh`. Otherwise report PostgreSQL runtime and deployment unverified.

- [ ] **Step 9: Commit**

```bash
git add docs/superpowers/specs/2026-08-29-live-lunch-venue-override-design.md \
  docs/superpowers/plans/2026-08-29-live-lunch-venue-override.md \
  supabase/migrations/20260829000008_rsvp_integrity.sql \
  supabase/tests/operational_backend_integration.sql \
  app/js/operations.js app/js/store.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(events): publish exact RSVP totals"
```
