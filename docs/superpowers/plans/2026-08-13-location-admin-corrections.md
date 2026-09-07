# Location and Admin Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Swimming TBC by default with reliable dated venue overrides, correct Midtown directions and Swimming photography, reorganize Admin controls, and reduce first-load inline-map latency.

**Architecture:** Keep recurring defaults in activity seed/local state, dated free-event exceptions in the existing `sessionOverrides`/Supabase venue-override seam, and paid HYROX venue data in the operational backend. Repair exact historical values through additive local v14 and SQL migrations; preserve the isolated map module while starting its independent dependencies concurrently.

**Tech Stack:** Vanilla ES modules, delegated DOM events, localStorage migrations, Supabase/PostgreSQL migrations and RPC-backed operations, Leaflet 1.9.4, Nominatim, Node smoke scripts.

## Global Constraints

- Work only in the existing `feature/location-map` worktree; this is non-Shop work and must not touch `feature/shop-page`.
- Do not add npm dependencies, a build step, framework code, service worker, Google API key, map proxy, or photo-upload system.
- `app/js/store.js` remains the only localStorage seam.
- Bump local persisted state from v13 to v14 and migrate exact sentinels; never delete persisted state keys.
- Swimming recurring defaults are exactly `location: "TBC"`, `mapsQuery: ""`, and `photo: "../assets/itc/water.webp"`.
- Midtown values are exactly `location: "Midtown28 Fitness"` and `mapsQuery: "Midtown28 Fitness, Hong Kong"`.
- The Admin navigation is exactly `Approvals · Members · Activities · Giving · HYROX` and must remain a single row at the existing mobile breakpoint.
- Weekly free-event controls belong under Activities and must visibly say `Only this session`; they must not appear under HYROX.
- Existing notification fan-out and `venueMemberNotifiedAt`/`member_notified_at` deduplication behavior must remain unchanged.
- Write each regression test first and run it to observe the expected failure before editing production code.

---

## File Structure

### Modified application files

- `app/js/data.js` — corrected fresh activity defaults and pure session generation.
- `app/js/store.js` — v14 exact-sentinel migration, photo-preserving activity saves, and decorated free-session lists.
- `app/js/app.js` — repeated-form submit dispatch via `data-action`.
- `app/js/views.js` — Admin tab naming and Activities/HYROX section placement/copy.
- `app/js/map.js` — concurrent geocode and Leaflet startup while retaining cache/fallback behavior.
- `app/smoke.mjs` — local data, migration, view, photo, and map regressions.
- `app/live-auth-smoke.mjs` — delegated weekly form and live override integration regressions.
- `app/styles.css` — only if the existing single-row Admin tab rule needs a minimal label-width adjustment after changing the label.

### New/modified database files

- Create `supabase/migrations/20260813000002_midtown28_fitness.sql` — exact old-value updates for live Midtown template, sessions, and booking snapshots.
- Modify `supabase/tests/operational_backend_integration.sql` — corrected seed expectation plus exact-match migration-preservation assertions. The existing verifier discovers migrations lexically, so its script does not change.

### Modified documentation

- `README.md` — persisted state v14 and Admin tab list.
- `docs/runbooks/live-auth.md` — `HYROX` tab name and new migration/reload deployment order.

---

### Task 1: Correct Fresh Defaults and Local v14 Migration

**Files:**
- Modify: `app/js/data.js:49-79`
- Modify: `app/js/store.js:20-225`
- Modify: `app/smoke.mjs:920-955, 1320-1455`
- Modify: `README.md:36-48`

**Interfaces:**
- Consumes: existing `SEED_ACTIVITIES`, `store.load()`, and versioned `migrate()`.
- Produces: v14 state where `water` defaults to TBC/blank query/correct photo and `hyrox-midtown` uses `Midtown28 Fitness`; existing exact old booking snapshots are repaired.

- [ ] **Step 1: Add failing fresh-state and migration assertions**

Add focused assertions near the existing HYROX capacity and migration blocks in `app/smoke.mjs`:

```js
const correctedWater = store.activities().find((activity) => activity.id === "water");
if (correctedWater.location !== "TBC" || correctedWater.mapsQuery !== ""
    || correctedWater.photo !== "../assets/itc/water.webp") {
  throw new Error("Swimming must start TBC with its water photo");
}
const correctedMidtown = store.activities().find((activity) => activity.id === "hyrox-midtown");
if (correctedMidtown.location !== "Midtown28 Fitness"
    || correctedMidtown.mapsQuery !== "Midtown28 Fitness, Hong Kong") {
  throw new Error("Midtown HYROX must use the precise Fitness venue");
}
```

Create a v13 fixture containing:

```js
const locationV13 = {
  version: 13,
  sessionUserId: null,
  activities: structuredClone(data.SEED_ACTIVITIES),
  users: [],
  bookings: [{
    id: "old-midtown-booking",
    snapshot: { location: "Midtown 28" },
  }],
  receipts: [],
  campaigns: [],
  donations: [],
  prayers: [],
  notifications: [],
  sessionOverrides: {},
  queues: {},
  duty: {},
  paymentPayouts: {},
};
const oldWater = locationV13.activities.find((activity) => activity.id === "water");
Object.assign(oldWater, {
  location: "TBC",
  mapsQuery: "TBC",
  photo: "../assets/itc/main.webp",
});
const oldMidtown = locationV13.activities.find((activity) => activity.id === "hyrox-midtown");
Object.assign(oldMidtown, {
  location: "Midtown 28",
  mapsQuery: "Midtown 28, Hong Kong",
});
```

Load it and assert version 14, blank Swimming query, repaired photo, corrected Midtown fields, and corrected exact booking snapshot. Add a second custom-value fixture and assert `Custom Pool`, `custom-pool.webp`, and `Custom Midtown Venue` are not overwritten.

- [ ] **Step 2: Run the smoke suite and verify the new assertions fail**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL because fresh Swimming still says `Victoria Park`, Midtown still says `Midtown 28`, and migrated state remains v13.

- [ ] **Step 3: Correct seed defaults**

In `app/js/data.js`, make the seed records contain:

```js
{
  id: "water",
  // unchanged fields omitted
  location: "TBC",
  mapsQuery: "",
  photo: PH + "water.webp",
},
{
  id: "hyrox-midtown",
  // unchanged fields omitted
  location: "Midtown28 Fitness",
  mapsQuery: "Midtown28 Fitness, Hong Kong",
  photo: PH + "hyrox.webp",
},
```

Do not rename activity IDs or alter weekdays, times, price, capacity, or booking rules.

- [ ] **Step 4: Add the v14 exact-sentinel migration**

In `app/js/store.js`, change:

```js
const STATE_VERSION = 14;
```

Add a `if (v < 14)` migration after the current v13 block:

```js
if (v < 14) {
  const water = state.activities.find((activity) => activity.id === "water");
  if (water) {
    if (["Victoria Park", "Victoria Park Swimming Pool"].includes(water.location)) {
      water.location = "TBC";
    }
    if (["Victoria Park, Hong Kong", "Victoria Park Swimming Pool, Hong Kong", "TBC"].includes(water.mapsQuery)) {
      water.mapsQuery = "";
    }
    if (water.photo === "../assets/itc/main.webp") {
      water.photo = "../assets/itc/water.webp";
    }
  }

  const midtown = state.activities.find((activity) => activity.id === "hyrox-midtown");
  if (midtown?.location === "Midtown 28") midtown.location = "Midtown28 Fitness";
  if (midtown?.mapsQuery === "Midtown 28, Hong Kong") {
    midtown.mapsQuery = "Midtown28 Fitness, Hong Kong";
  }
  for (const booking of state.bookings) {
    if (booking.snapshot?.location === "Midtown 28") {
      booking.snapshot.location = "Midtown28 Fitness";
    }
  }
}
```

Keep the existing final `state.version = STATE_VERSION` path. Update smoke fixtures/comments that intentionally assert the current version from 13 to 14, while retaining explicit v13 migration fixtures.

- [ ] **Step 5: Run the smoke suite and verify the migration tests pass**

Run:

```bash
node app/smoke.mjs
```

Expected: PASS, including fresh-state, v13→v14, and custom-value preservation assertions.

- [ ] **Step 6: Update the README state-version statement**

Change the prototype convention from persisted state v13 to v14 and state that v9–v13 snapshots migrate without discarding genuine records.

- [ ] **Step 7: Commit the local data correction**

```bash
git add app/js/data.js app/js/store.js app/smoke.mjs README.md
git commit -m "fix(activities): correct swimming and Midtown defaults"
```

---

### Task 2: Preserve Existing Activity Photos

**Files:**
- Modify: `app/js/store.js:601-630`
- Modify: `app/smoke.mjs:500-610`

**Interfaces:**
- Consumes: `store.saveActivity(draft)` and the existing activity identified by `draft.id`.
- Produces: `saveActivity()` preserves `existing.photo` for updates and uses `draft.photo || "../assets/itc/main.webp"` only for creation.

- [ ] **Step 1: Add a failing photo-preservation regression**

In `app/smoke.mjs`, while an Admin fixture is signed in, add:

```js
const swimmingBeforeEdit = structuredClone(store.getActivity("water"));
store.saveActivity({
  ...swimmingBeforeEdit,
  location: "TBC",
  mapsQuery: "",
  photo: "../assets/itc/main.webp",
});
if (store.getActivity("water").photo !== "../assets/itc/water.webp") {
  throw new Error("editing Swimming must preserve its existing photo");
}
```

Also create a new activity with `photo: "../assets/itc/main.webp"` and assert its generic image remains accepted.

- [ ] **Step 2: Run the smoke suite and verify the update test fails**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL with `editing Swimming must preserve its existing photo` because the submitted generic photo overwrites the existing value.

- [ ] **Step 3: Preserve the existing photo inside the store seam**

Build `record` in `saveActivity()` so the authoritative photo field is assigned after spreading the draft:

```js
const record = {
  ...draft,
  photo: existing?.photo || draft.photo || "../assets/itc/main.webp",
  price: draft.kind === "paid" ? Number(draft.price) || 0 : undefined,
  capacity: draft.kind === "paid" ? Number(draft.capacity) || 0 : undefined,
  durationMin: Number(draft.durationMin) || 60,
  weekday: Number(draft.weekday),
};
```

Do not add photo upload or selection controls.

- [ ] **Step 4: Run the smoke suite and verify both update/create cases pass**

Run:

```bash
node app/smoke.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the photo fix**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "fix(activities): preserve photos during edits"
```

---

### Task 3: Make Repeated Weekly Venue Forms Submit Reliably

**Files:**
- Modify: `app/js/app.js:816-1060`
- Modify: `app/live-auth-smoke.mjs:705-770, 2090-2140`

**Interfaces:**
- Consumes: repeated forms with `data-action="form-week-venue"`, `store.setWeekVenue(sessionId, { location, mapsQuery })`, and `renderWithFeedback()`.
- Produces: delegated submit dispatch key `form.id || form.dataset.action`; no duplicate form IDs.

- [ ] **Step 1: Add a failing delegated-submit live regression**

After the existing gym delegated-submit test in `app/live-auth-smoke.mjs`, construct a repeated weekly form with no ID:

```js
const swimmingSession = store.upcomingSessions(21)
  .find((session) => session.activityId === "water" && !data.sessionStarted(session));
assert.ok(swimmingSession, "live smoke needs an upcoming Swimming session");

const weeklyVenueForm = new HTMLFormElement();
weeklyVenueForm.id = "";
weeklyVenueForm.dataset = {
  action: "form-week-venue",
  session: swimmingSession.id,
};
weeklyVenueForm.fields = {
  location: "Victoria Park Swimming Pool",
  mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
};
const weeklySubmit = makeElement();
weeklySubmit.type = "submit";
weeklyVenueForm.querySelector = (selector) => selector === '[type="submit"]' ? weeklySubmit : null;
weeklyVenueForm.querySelectorAll = () => [weeklySubmit];

await domListeners.get("submit")({ target: weeklyVenueForm, preventDefault() {} });
await new Promise(setImmediate);
const weeklyVenueCall = operationalRpcCalls
  .filter((call) => call.name === "set_session_venue")
  .at(-1);
assert.equal(weeklyVenueCall.args.p_session_id, swimmingSession.id);
assert.equal(weeklyVenueCall.args.p_location, "Victoria Park Swimming Pool");
assert.equal(weeklyVenueCall.args.p_maps_query, "Victoria Park Swimming Pool, Hong Kong");
```

- [ ] **Step 2: Run live smoke and verify the delegated form fails to dispatch**

Run:

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because `form.id` is blank and the switch never reaches `form-week-venue`.

- [ ] **Step 3: Dispatch repeated forms by ID or data action**

Immediately before the submit switch in `app/js/app.js`, add:

```js
const formAction = form.id || form.dataset.action;
```

Change:

```js
switch (form.id) {
```

to:

```js
switch (formAction) {
```

Keep the existing `case "form-week-venue"` implementation, async busy state, error preservation, and rerender-on-success behavior unchanged.

- [ ] **Step 4: Run both smoke suites**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: both PASS; the new call uses the dated Swimming ID and exact Victoria Park values.

- [ ] **Step 5: Commit the submit fix**

```bash
git add app/js/app.js app/live-auth-smoke.mjs
git commit -m "fix(admin): submit weekly venue overrides"
```

---

### Task 4: Move Weekly Venue Overrides to Activities and Rename HYROX Tab

**Files:**
- Modify: `app/js/views.js:1930-2070, 2140-2250`
- Modify: `app/js/store.js:1185-1235`
- Modify: `app/smoke.mjs:1250-1300, 2050-2110`
- Modify: `app/styles.css` only if needed after the required 375px inspection

**Interfaces:**
- Consumes: `store.upcomingSessions(21)`, `store.getSession(id)`, `store.weekVenueOverride(id)`, and existing Admin route/tab rendering.
- Produces: `adminFreeEventVenues()` rendered only by `adminActivities()`, and final Admin label `HYROX` for canonical route `#/admin/payments`.

- [ ] **Step 1: Replace old UI expectations with failing information-architecture assertions**

Update the location-map smoke block to assert:

```js
const activitiesHtml = await views.viewAdmin("activities");
const hyroxAdminHtml = await views.viewAdmin("payments");

if (!activitiesHtml.includes("Recurring Activity Defaults")
    || !activitiesHtml.includes("Weekly Venue Overrides")
    || !activitiesHtml.includes("Only this session")
    || !activitiesHtml.includes("Google Maps search")
    || !activitiesHtml.includes("Save Weekly Venue")
    || !activitiesHtml.includes("Reset to Recurring Default")) {
  throw new Error("Activities must separate recurring defaults from weekly overrides");
}
if (hyroxAdminHtml.includes("Weekly Venue Overrides")
    || hyroxAdminHtml.includes('data-action="form-week-venue"')) {
  throw new Error("HYROX must not contain free-event weekly venue controls");
}
if (!hyroxAdminHtml.includes(">HYROX</a>")
    || hyroxAdminHtml.includes("Payments / Ops")) {
  throw new Error("the final Admin tab must be HYROX");
}
```

For an overridden Swimming session, assert the Activities HTML displays `Current venue: Victoria Park Swimming Pool` and `Recurring default: TBC`.

- [ ] **Step 2: Run local smoke and verify the placement/copy assertions fail**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL because the section is still called `Free-event venues`, is rendered by HYROX/Payments Ops, and the tab still says `Payments / Ops`.

- [ ] **Step 3: Ensure upcoming free sessions are decorated before Admin rendering**

In the live branch of `store.upcomingSessions()`, map generated free sessions through the existing free-session decorator:

```js
const freeSessions = sessionsInRange(
  state.activities.filter((activity) => activity.kind === "free"),
  todayLocal(),
  days
).map((session) => {
  const decorated = decorateFreeSession(session);
  return {
    ...decorated,
    spots: spotsLeft(decorated),
    past: false,
  };
});
```

In local mode, decorate generated sessions equivalently with `decorateSession(session)` before returning them. This makes current override values visible in Admin lists while preserving `getSession()` as the dated detail source.

- [ ] **Step 4: Move and rewrite the Admin sections**

In `viewAdmin()`, change only the label while preserving the canonical route key:

```js
["payments", "HYROX"],
```

Remove `${adminFreeEventVenues()}` from `adminOps()`.

Make `adminActivities()` render:

```js
return `
  <div class="section-head"><h2>Recurring Activity Defaults</h2></div>
  <p class="muted small">Changes here affect all future weeks unless a dated override is set below.</p>
  <div class="session-list">${activityRows}</div>
  <a class="btn ghost mt16" href="#/admin/activity/new">+ New activity</a>
  ${adminFreeEventVenues()}`;
```

Rewrite the weekly section heading/copy and each card:

```html
<div class="section-head mt24"><h2>Weekly Venue Overrides</h2></div>
<p class="muted small">Set a venue for one dated free event. Later weeks keep the recurring default.</p>
<span class="badge neutral">Only this session</span>
<p class="muted small mt8">Current venue: <strong>...</strong></p>
<p class="muted small">Recurring default: <strong>...</strong></p>
```

Use the existing activity lookup to obtain the recurring default:

```js
const recurring = store.getActivity(s.activityId);
```

Change field/action copy to exactly `Google Maps search`, `Save Weekly Venue`, and `Reset to Recurring Default`. Keep `data-action="form-week-venue"`, `data-session`, field names, and reset action wiring unchanged.

- [ ] **Step 5: Run smoke suites and inspect narrow navigation**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/#/admin/activities` and `#/admin/payments` at 375px width. Expected: five tabs remain on one row; weekly forms appear only under Activities; current and recurring venues are distinct.

If and only if `HYROX` wraps, make the smallest token-consistent adjustment to the existing `.admin-tabs` gap/font/padding rule in `app/styles.css`; do not add horizontal scrolling or a second row.

- [ ] **Step 6: Commit the Admin reorganization**

```bash
git add app/js/views.js app/js/store.js app/smoke.mjs app/styles.css
git commit -m "fix(admin): separate recurring and weekly activities"
```

Omit `app/styles.css` from `git add` if no CSS change was necessary.

---

### Task 5: Start Map Dependencies Concurrently

**Files:**
- Modify: `app/js/map.js:90-225`
- Modify: `app/smoke.mjs:2120-2180`

**Interfaces:**
- Consumes: `mountActivityMap(host, { ownsGeneration, fetchImpl, timeoutMs, loadLeaflet })`, `geocodeQuery()`, and the memoized Leaflet loader.
- Produces: eligible map mounts start geocoding and Leaflet loading in the same turn; return/fallback contract remains boolean.

- [ ] **Step 1: Add a failing concurrency regression**

After the pure map helper tests in `app/smoke.mjs`, add:

```js
let releaseGeocode;
const geocodeGate = new Promise((resolve) => { releaseGeocode = resolve; });
const starts = [];
const concurrentHost = {
  id: "activity-map",
  dataset: {
    mapsQuery: "Victoria Park Swimming Pool, Hong Kong",
    markerLabel: "ITC Swimming",
  },
  isConnected: true,
  innerHTML: "<p>Loading map…</p>",
};
const concurrentMount = map.mountActivityMap(concurrentHost, {
  fetchImpl: async () => {
    starts.push("geocode");
    await geocodeGate;
    return { ok: true, json: async () => [] };
  },
  loadLeaflet: async () => { starts.push("leaflet"); },
});
await Promise.resolve();
assert.deepEqual(starts, ["geocode", "leaflet"],
  "geocoding and Leaflet must start concurrently");
releaseGeocode();
assert.equal(await concurrentMount, false);
```

Use a unique query not already present in `itc.geocode.v1`, or clear that exact cache entry first.

- [ ] **Step 2: Run local smoke and verify the concurrency assertion fails**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL because `starts` contains only `geocode` until lookup completes.

- [ ] **Step 3: Start independent work before awaiting either result**

In `mountActivityMap()`, replace the sequential lookup/load flow with:

```js
const leafletPromise = (loadLeaflet || defaultLoadLeaflet)({
  timeoutMs: timeoutMs || LEAFLET_TIMEOUT_MS,
});
const geocodePromise = geocodeQuery(query, { fetchImpl, timeoutMs });

let coords;
try {
  [coords] = await Promise.all([geocodePromise, leafletPromise]);
} catch (_err) {
  if (ownsGeneration() && host.isConnected) renderFallback(host);
  return false;
}
if (!coords) {
  if (ownsGeneration() && host.isConnected) renderFallback(host);
  return false;
}
```

Remove the later duplicate Leaflet await. Preserve ownership checks before DOM mutation, localStorage cache semantics, timeout values, marker construction, and fallback copy.

- [ ] **Step 4: Run both smoke suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: PASS, including concurrency, empty-result fallback, and stale-route checks.

- [ ] **Step 5: Commit the map optimization**

```bash
git add app/js/map.js app/smoke.mjs
git commit -m "perf(map): load map dependencies concurrently"
```

---

### Task 6: Migrate Live Midtown Operational Data

**Files:**
- Create: `supabase/migrations/20260813000002_midtown28_fitness.sql`
- Modify: `supabase/tests/operational_backend_integration.sql:70-90, before the final rollback at line 657`

**Interfaces:**
- Consumes: `public.operational_activity_templates`, `public.operational_sessions`, and JSONB `public.operational_bookings.snapshot`.
- Produces: exact old Midtown venue values become `Midtown28 Fitness`; custom values remain unchanged.

- [ ] **Step 1: Change the SQL integration expectation and add an explicit migration replay regression**

Change the schema-foundation expectation to:

```sql
if not exists (
  select 1 from public.operational_activity_templates
  where activity_id = 'hyrox-midtown'
    and capacity = 12
    and price_hkd = 180
    and venue = 'Midtown28 Fitness'
) then
  raise notice 'FAIL: corrected hyrox-midtown activity template seed missing';
  failures := failures + 1;
end if;
```

Before the existing final `rollback;`, use the transaction's existing member profile and generated sessions to recreate old/custom sentinels, then replay the idempotent migration:

```sql
update public.operational_activity_templates
   set venue = 'Midtown 28'
 where activity_id = 'hyrox-midtown';

update public.operational_sessions
   set venue = case id
     when 'hyrox-midtown-2026-08-22' then 'Midtown 28'
     when 'hyrox-midtown-2026-08-29' then 'Custom Midtown Venue'
   end
 where id in ('hyrox-midtown-2026-08-22', 'hyrox-midtown-2026-08-29');

insert into public.operational_bookings
  (profile_id, session_id, status, pay_deadline_at, snapshot)
values
  ('bb000000-0000-0000-0000-00000000b001',
   'hyrox-midtown-2026-08-22', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Midtown 28","price_hkd":180}'::jsonb),
  ('dd000000-0000-0000-0000-00000000d001',
   'hyrox-midtown-2026-08-29', 'reserved', now() + interval '1 day',
   '{"name":"hyrox-midtown","venue":"Custom Midtown Venue","price_hkd":180}'::jsonb);

\ir ../migrations/20260813000002_midtown28_fitness.sql

select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_activity_templates where activity_id = 'hyrox-midtown'),
  'migration must correct the exact old Midtown template venue'
);
select pg_temp.op_assert(
  (select venue = 'Midtown28 Fitness'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-22'),
  'migration must correct an exact old Midtown session venue'
);
select pg_temp.op_assert(
  (select venue = 'Custom Midtown Venue'
     from public.operational_sessions where id = 'hyrox-midtown-2026-08-29'),
  'migration must preserve a custom Midtown session venue'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Midtown28 Fitness'
     from public.operational_bookings
    where profile_id = 'bb000000-0000-0000-0000-00000000b001'
      and session_id = 'hyrox-midtown-2026-08-22'),
  'migration must correct an exact old Midtown booking snapshot'
);
select pg_temp.op_assert(
  (select snapshot ->> 'venue' = 'Custom Midtown Venue'
     from public.operational_bookings
    where profile_id = 'dd000000-0000-0000-0000-00000000d001'
      and session_id = 'hyrox-midtown-2026-08-29'),
  'migration must preserve a custom Midtown booking snapshot'
);
```

- [ ] **Step 2: Run the operational verifier and observe the corrected expectation fail**

Run the no-database safety contract first:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Then, when `ITC_OPERATIONS_TEST_DATABASE_URL` points to a disposable empty Supabase-compatible database:

```bash
bash supabase/tests/verify_operational_backend.sh
```

Expected: safety PASS; database verifier FAIL because the template still contains `Midtown 28`.

- [ ] **Step 3: Add the forward-only Midtown correction migration**

Create `supabase/migrations/20260813000002_midtown28_fitness.sql`:

```sql
-- Correct the exact historical Midtown venue without overwriting
-- independently administered operational values.

update public.operational_activity_templates
   set venue = 'Midtown28 Fitness'
 where activity_id = 'hyrox-midtown'
   and venue = 'Midtown 28';

update public.operational_sessions
   set venue = 'Midtown28 Fitness'
 where activity_id = 'hyrox-midtown'
   and venue = 'Midtown 28';

update public.operational_bookings as booking
   set snapshot = jsonb_set(
     booking.snapshot,
     '{venue}',
     to_jsonb('Midtown28 Fitness'::text),
     false
   )
 where booking.snapshot ->> 'venue' = 'Midtown 28'
   and exists (
     select 1
       from public.operational_sessions as session
      where session.id = booking.session_id
        and session.activity_id = 'hyrox-midtown'
   );
```

The live snapshot contract uses `venue`, not `location` or `activity_id`; constrain the update by joining `booking.session_id` to the Midtown operational session.

`verify_operational_backend.sh` already discovers `supabase/migrations/*.sql` in lexical order, so no verifier-script edit is required.

- [ ] **Step 4: Run SQL safety and disposable-database verification**

Run:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
bash supabase/tests/verify_operational_backend.sh
```

Expected: `All operational backend verifications passed.` The verifier must still refuse non-empty/non-disposable databases under its existing safety checks.

If no disposable database URL is available, record the database verifier as blocked rather than claiming it passed; the safety verifier is not a substitute.

- [ ] **Step 5: Commit the live migration**

```bash
git add supabase/migrations/20260813000002_midtown28_fitness.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "fix(operations): migrate Midtown28 Fitness venue"
```

---

### Task 7: Update Live Runbook and Complete Verification

**Files:**
- Modify: `docs/runbooks/live-auth.md:10-20, 105-165`
- Modify: `README.md` if any Admin label references remain after Task 1
- Test: all smoke and verification scripts

**Interfaces:**
- Consumes: completed application/data/SQL changes from Tasks 1–6.
- Produces: deployment instructions that apply both location migrations in order and reload PostgREST schema cache; verified feature branch ready for review.

- [ ] **Step 1: Add the exact deployment and Admin-copy documentation**

In `docs/runbooks/live-auth.md`:

- replace `Payments / Ops` with `HYROX`;
- state that free-event weekly overrides live under `Admin Tools → Activities → Weekly Venue Overrides`;
- list `20260813000001_free_event_venue_overrides.sql` followed by `20260813000002_midtown28_fitness.sql` in deployment order;
- retain the existing PostgREST schema-cache reload instruction;
- explain that recurring Swimming remains TBC and only dated overrides are shared through `set_session_venue`.

Search README/runbooks for stale labels:

```bash
rg -n "Payments / Ops|Free-event venues|Midtown 28|Victoria Park, Hong Kong|persisted.*v13" README.md docs app supabase
```

Update only product/docs/test expectations that should use the new behavior. Keep historical migration comments that intentionally describe old values.

- [ ] **Step 2: Run code-format and repository-diff checks**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors; only location/Admin feature files and approved docs changed; no Shop files.

- [ ] **Step 3: Run all JavaScript regressions**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0 with no FAIL lines or unhandled rejections.

- [ ] **Step 4: Run database verifier safety tests**

```bash
bash supabase/tests/verify_operational_backend_safety.sh
bash supabase/tests/verify_admin_notifications_safety.sh
bash supabase/tests/verify_giving_campaigns_safety.sh
```

Expected: all exit 0. These prove verifier safety behavior, not database correctness.

- [ ] **Step 5: Run the disposable operational database verifier when configured**

```bash
bash supabase/tests/verify_operational_backend.sh
```

Expected: `All operational backend verifications passed.` If `psql` or `ITC_OPERATIONS_TEST_DATABASE_URL` is unavailable, report the exact blocker and do not claim this check passed.

- [ ] **Step 6: Perform manual acceptance**

Start:

```bash
python3 -m http.server 4173
```

At `http://127.0.0.1:4173/app/`, verify:

1. Admin tabs fit one row at 375px and the final tab reads HYROX.
2. Activities distinguishes recurring defaults from weekly overrides.
3. An unmodified future Swimming week displays TBC with the Swimming image.
4. Set one Swimming occurrence to `Victoria Park Swimming Pool` / `Victoria Park Swimming Pool, Hong Kong`; confirm Schedule, Activity, inline map, and Get directions use it.
5. Confirm the next Swimming week remains TBC; reset the overridden week and confirm it returns to TBC.
6. Open the Saturday 11:00 Midtown activity and confirm `Midtown28 Fitness` plus a working Google Maps directions search.
7. Clear `localStorage.removeItem("itc.geocode.v1")`, load the Swimming activity, and confirm the directions link is immediately usable while the map loads.
8. Reload the same route and confirm cached coordinates shorten repeat loading.
9. Block Nominatim or Leaflet and confirm fallback appears within five seconds while venue text/directions remain usable.

- [ ] **Step 7: Commit documentation and any final expectation-only corrections**

```bash
git add docs/runbooks/live-auth.md README.md
git commit -m "docs: update activity and HYROX admin operations"
```

Skip the commit if Task 1 already covered README and no documentation file changed here.

- [ ] **Step 8: Capture final evidence before requesting review**

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
```

Expected: clean `feature/location-map` worktree, focused commits, and no diff-check output. Record exact test commands and outcomes in the completion message.
