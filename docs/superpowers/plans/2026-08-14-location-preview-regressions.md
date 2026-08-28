# Location Preview Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make location-only weekly overrides work from Admin Activities and ensure live HYROX details consistently show the corrected Midtown venue and valid HYROX photos.

**Architecture:** Normalize Admin form input before the existing store/RPC seam, and enrich live paid-session rows once inside `operations.js` rather than adding view-specific fallbacks. Preserve shared Supabase persistence, custom operational venues, and existing error/rerender boundaries.

**Tech Stack:** Vanilla ES modules, delegated DOM events, Supabase RPC-backed live operations, Node smoke scripts.

## Global Constraints

- Work only on `feature/location-map`; do not touch Shop, Giving, merchandise, or donation code.
- Do not add dependencies, frameworks, build steps, service workers, photo upload, or local live-mode fallback persistence.
- Location-only weekly save uses the trimmed display location as `mapsQuery` only when the map input is blank.
- Both blank fields retain reset behavior; a map-query-only entry remains partial.
- RPC failures do not rerender or clear entered controls and must show an error toast.
- Exact legacy Midtown normalization applies only to `activity_id === "hyrox-midtown"` with `venue === "Midtown 28"`.
- Custom operational venue strings remain unchanged.
- Both live HYROX sessions use `../assets/itc/hyrox.webp`.
- Existing notification, booking, payment, queue, map, and v14 migration behavior remains unchanged.
- Add tests first and observe the expected failure before production edits.

---

### Task 1: Make Location-Only Weekly Saves Complete

**Files:**
- Modify: `app/js/app.js:1070-1090`
- Modify: `app/live-auth-smoke.mjs:2150-2220`

**Interfaces:**
- Consumes: repeated form `data-action="form-week-venue"`, `store.setWeekVenue(sessionId, { location, mapsQuery })`, `withBusyControl()`, and `renderWithFeedback()`.
- Produces: a location-only form submission sends the same trimmed location in both fields; existing explicit map input and blank reset semantics are preserved.

- [ ] **Step 1: Add a failing delegated location-only regression**

Extend the existing repeated weekly form test in `app/live-auth-smoke.mjs` so its fields are:

```js
weeklyVenueForm.fields = {
  location: "  Victoria Park Swimming Pool  ",
  mapsQuery: "",
};
```

After dispatch, assert the latest RPC call contains:

```js
assert.equal(weeklyVenueCall.args.p_location, "Victoria Park Swimming Pool");
assert.equal(weeklyVenueCall.args.p_maps_query, "Victoria Park Swimming Pool");
```

Also assert `store.getSession(swimmingSession.id)` immediately has:

```js
assert.equal(savedSwimming.location, "Victoria Park Swimming Pool");
assert.equal(savedSwimming.mapsQuery, "Victoria Park Swimming Pool");
```

- [ ] **Step 2: Run live smoke and verify RED**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because `p_maps_query` is currently null/blank.

- [ ] **Step 3: Normalize form values at the delegated boundary**

In `case "form-week-venue"`, derive values before entering `withBusyControl()`:

```js
const location = String(fd.get("location") || "").trim();
const enteredMapsQuery = String(fd.get("mapsQuery") || "").trim();
const mapsQuery = enteredMapsQuery || location;
```

Pass `location` and `mapsQuery` to `store.setWeekVenue()`. This preserves:

- explicit map-query values;
- map-query-only partial saves (`location === ""`, `mapsQuery !== ""`);
- reset when both are blank.

- [ ] **Step 4: Add failure-path coverage**

Use the live Supabase mock's RPC error seam to make the next `set_session_venue` call reject with `Venue override setup unavailable`. Capture the committed page before dispatch and assert:

```js
const htmlBeforeVenueFailure = viewEl.innerHTML;
await domListeners.get("submit")({ target: weeklyVenueForm, preventDefault() {} });
assert.equal(viewEl.innerHTML, htmlBeforeVenueFailure);
assert.equal(weeklyVenueForm.fields.location, "Victoria Park Swimming Pool");
assert.equal(weeklySubmit.disabled, false);
assert.ok(toastStack.children.some((item) =>
  item.textContent === "Venue override setup unavailable"
));
```

This tests the real no-rerender behavior without adding production instrumentation.

- [ ] **Step 5: Run both suites and verify GREEN**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: both PASS, including location-only RPC payload, immediate decorated session, and failure preservation.

- [ ] **Step 6: Commit**

```bash
git add app/js/app.js app/live-auth-smoke.mjs
git commit -m "fix(admin): complete location-only venue saves"
```

---

### Task 2: Normalize Live HYROX Venue Metadata and Photos

**Files:**
- Modify: `app/js/operations.js:10-95`
- Modify: `app/live-auth-smoke.mjs:150-180, 500-600, location-map assertions near the end`

**Interfaces:**
- Consumes: `SEED_ACTIVITIES` keyed by `activity_id` and raw `operational_sessions` rows.
- Produces: `buildSessionRow(row)` returns a valid `photo` for both paid activities and exact-sentinel Midtown compatibility normalization while preserving custom venues.

- [ ] **Step 1: Add failing live hydration assertions**

Change the mocked Midtown template/session fixture back to the realistic legacy value:

```js
venue: "Midtown 28"
```

After live hydration, identify both paid sessions and assert:

```js
const hydratedBft = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox");
const hydratedMidtown = store.upcomingSessions(21)
  .find((session) => session.activityId === "hyrox-midtown");

assert.equal(hydratedBft.photo, "../assets/itc/hyrox.webp");
assert.equal(hydratedMidtown.photo, "../assets/itc/hyrox.webp");
assert.equal(hydratedMidtown.location, "Midtown28 Fitness");
assert.equal(hydratedMidtown.venue, "Midtown28 Fitness");
assert.equal(hydratedMidtown.mapsQuery, "Midtown28 Fitness, Hong Kong");
```

Render both activity details and assert each contains:

```js
assert.match(html, /class="detail-photo" src="\.\.\/assets\/itc\/hyrox\.webp"/);
```

- [ ] **Step 2: Add a failing custom-venue preservation assertion**

Temporarily change the mocked Midtown operational row to:

```js
venue: "Custom Midtown Venue"
```

Refresh operational state and assert:

```js
assert.equal(customMidtown.location, "Custom Midtown Venue");
assert.equal(customMidtown.venue, "Custom Midtown Venue");
assert.equal(customMidtown.mapsQuery, "Custom Midtown Venue");
assert.equal(customMidtown.photo, "../assets/itc/hyrox.webp");
```

Restore the fixture afterward so later smoke checks remain deterministic.

- [ ] **Step 3: Run live smoke and verify RED**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because live sessions currently have no photo and preserve `Midtown 28` verbatim.

- [ ] **Step 4: Enrich live rows at the operations boundary**

Import seed metadata:

```js
import { SEED_ACTIVITIES } from "./data.js";
```

Create a module-level lookup:

```js
const PAID_ACTIVITY_METADATA = new Map(
  SEED_ACTIVITIES
    .filter((activity) => activity.kind === "paid")
    .map((activity) => [activity.id, activity])
);
```

Inside `buildSessionRow(row)`, derive:

```js
const metadata = PAID_ACTIVITY_METADATA.get(row.activity_id);
const legacyMidtown = row.activity_id === "hyrox-midtown"
  && row.venue === "Midtown 28";
const venue = legacyMidtown ? metadata.location : row.venue;
const mapsQuery = legacyMidtown ? metadata.mapsQuery : row.venue;
```

Return:

```js
location: venue,
mapsQuery,
venue,
photo: metadata?.photo || "../assets/itc/hyrox.webp",
```

Do not normalize any nonexact venue value.

- [ ] **Step 5: Run both suites and verify GREEN**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: both PASS; both live Saturday activity details have valid photos, exact legacy Midtown aligns to Admin Activities, and custom Midtown remains untouched.

- [ ] **Step 6: Commit**

```bash
git add app/js/operations.js app/live-auth-smoke.mjs
git commit -m "fix(operations): enrich live HYROX session metadata"
```

---

### Task 3: Final Verification and PR Update

**Files:**
- Test only; no production file is expected unless verification reveals a regression.

**Interfaces:**
- Consumes: Tasks 1–2 commits.
- Produces: clean verified `feature/location-map` tip pushed to the existing PR.

- [ ] **Step 1: Run fresh verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check origin/feature/location-map...HEAD
git status --short --branch
```

Expected: both suites exit 0, no diff-check output, and no uncommitted files.

- [ ] **Step 2: Review branch scope**

```bash
git diff --name-only origin/feature/location-map...HEAD
```

Expected changed implementation files are limited to:

```text
app/js/app.js
app/js/operations.js
app/live-auth-smoke.mjs
```

plus the approved spec/plan documents. No Shop/Giving/merchandise files.

- [ ] **Step 3: Manual acceptance when browser access is available**

On the refreshed Vercel preview:

1. Save `Victoria Park Swimming Pool` with blank Google Maps search and confirm the dated Swimming page updates immediately.
2. Simulate/observe a failed venue mutation and confirm values remain in the form with an error.
3. Open both Saturday HYROX details and confirm the photo renders.
4. Confirm the 11:00 HYROX detail says `Midtown28 Fitness`.
5. Confirm a custom operational venue is not normalized.

If browser access is unavailable, report these checks as pending rather than passed.

- [ ] **Step 4: Push the existing branch**

```bash
git push origin feature/location-map
```

Verify the existing PR #6 updates rather than creating a new PR.
