# Free-Event Venue Overrides, Inline Map, and HYROX Directions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admins set a dated venue for free events, share it and its notifications through Supabase in live mode, show an inline Leaflet map on free-event details, and expose directions for HYROX.

**Architecture:** Local mode extends the existing `state.sessionOverrides` seam; live mode extends the existing `app/js/operations.js` cache with a public-read venue-override table and an Admin-only transactional RPC. `views.js` renders only declarative map/form markup, `map.js` owns third-party loading and geocoding, and `app.js` owns route-safe mounting and async mutations.

**Tech Stack:** Vanilla ES modules, `localStorage`, Supabase/Postgres RLS and security-definer RPCs, Leaflet 1.9.4 from pinned CDN assets, OpenStreetMap tiles, OSM Nominatim, Node smoke tests, plain-SQL integration tests.

## Global Constraints

- Work only on `feature/location-map`; do not update `main`, Shop, Giving, or merchandise behavior.
- Keep the prototype dependency-free: no npm dependency and no build step.
- Free activities remain open attendance with no booking, checkout, capacity, or payment UI.
- Per-week venue editing is allowed only for `wnt`, `run`, and `water`; HYROX venue mutation must fail with `Activity venue is fixed.`
- HYROX keeps fixed template queries: `BFT Causeway Bay, Hong Kong` and `Midtown 28, Hong Kong`.
- Keep local state at version 13; the new override keys are additive and require no migration.
- Notification kind is exactly `operational_session_venue_updated` and belongs to the `club` category.
- Member fan-out occurs once per member/session on the first TBC-or-empty to real-venue transition; other Admins receive an audit item on every actual save/reset; the actor receives no audit item; no-op saves notify nobody.
- Map hosts render only for non-cancelled, non-past free sessions with a non-empty `mapsQuery`.
- Leaflet assets, versions, integrity hashes, and `crossorigin="anonymous"` must exactly match the approved spec.
- Nominatim cache key is exactly `itc.geocode.v1`; successful stable coordinates do not expire.
- Geocoding never controls whether venue data or notifications save.
- Run `node app/smoke.mjs` after each JS behavior task and keep the existing contract passing.

---

## File Structure

- Create `supabase/migrations/20260813000001_free_event_venue_overrides.sql`: table, RLS/grants, notification destination column, and `set_session_venue` RPC.
- Modify `supabase/tests/operational_backend_integration.sql`: schema, permission, transition, notification, no-op, reset, and HYROX assertions.
- Modify `app/js/operations.js`: live override cache, hydration/realtime, and RPC adapter.
- Modify `app/js/store.js`: local override mutation/fan-out and live adapter seam.
- Modify `app/js/data.js`: notification category and destination fallback behavior.
- Modify `app/js/views.js`: activity map host, universal directions action, and Admin free-event venue forms.
- Create `app/js/map.js`: Leaflet loader, cache parsing, serialized geocoding, map mount, and fallback.
- Modify `app/js/app.js`: async venue form/reset handlers and route-generation-safe map mount.
- Modify `app/styles.css`: map host/fallback/Leaflet theme and free-event venue card styling.
- Modify `app/smoke.mjs`: local store, views, notifications, directions, and pure map helper tests.
- Modify `app/live-auth-smoke.mjs`: Supabase cache/RPC, notification destination, form failure, and stale map mount tests.
- Modify `docs/runbooks/live-auth.md`: migration order and browser-level map/privacy verification.

---

### Task 1: Add the Authoritative Venue Override Migration and SQL Contract

**Files:**
- Create: `supabase/migrations/20260813000001_free_event_venue_overrides.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`

**Interfaces:**
- Produces table: `public.operational_session_venue_overrides(session_id, activity_id, location, maps_query, set_by, set_at, member_notified_at)`.
- Produces notification field: `public.notifications.destination text`.
- Produces RPC: `public.set_session_venue(p_session_id text, p_location text, p_maps_query text, p_was_tbc boolean) returns public.operational_session_venue_overrides`.
- The RPC derives `activity_id` by stripping the final `-YYYY-MM-DD`, permits only `wnt`, `run`, and `water`, trims nullable values, retains rows on reset, and writes notifications atomically.

- [ ] **Step 1: Add failing schema and behavior assertions**

Add `operational_session_venue_overrides` to the schema-foundation block, then add a transaction after the existing operational scenarios. Use distinct Admin fixtures so actor exclusion is measurable:

```sql
if to_regclass('public.operational_session_venue_overrides') is null then
  raise notice 'FAIL: operational_session_venue_overrides missing';
  failures := failures + 1;
end if;
if not exists (
  select 1 from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notifications'
     and column_name = 'destination'
) then
  raise notice 'FAIL: notifications.destination missing';
  failures := failures + 1;
end if;
```

The venue transaction must insert `admin`, `super_admin`, two `member` profiles, and one `pending` profile, then assert:

```sql
perform set_config('request.jwt.claim.sub', v_admin::text, true);
set local role authenticated;
perform public.set_session_venue(
  'wnt-2026-08-19',
  'Central Harbourfront — 7pm sharp',
  'Central Harbourfront, Hong Kong',
  true
);
reset role;

perform pg_temp.op_assert(
  (select location from public.operational_session_venue_overrides
    where session_id = 'wnt-2026-08-19') = 'Central Harbourfront — 7pm sharp',
  'dated free-event venue stored'
);
perform pg_temp.op_assert(
  (select count(*) from public.notifications
    where kind = 'operational_session_venue_updated'
      and profile_id in (v_member_one, v_member_two)) = 2,
  'first confirmation notifies approved members once'
);
perform pg_temp.op_assert(
  (select count(*) from public.notifications
    where kind = 'operational_session_venue_updated'
      and profile_id = v_super_admin) = 1,
  'other admins receive audit notification'
);
perform pg_temp.op_assert(
  not exists (select 1 from public.notifications
    where kind = 'operational_session_venue_updated'
      and profile_id in (v_admin, v_pending)),
  'actor and pending profiles are excluded'
);
```

Continue the same transaction with an edit, identical no-op save, reset, and reconfirmation. Assert member count stays `2`, Admin audit count rises only for actual mutations, `member_notified_at` survives reset, and every new notification has `destination = '#/activity/wnt-2026-08-19'`. Add exception assertions for ordinary member/anonymous calls and for `hyrox-2026-08-22` returning `Activity venue is fixed.` Also update a cancellation-related local test row before saving a free override to prove the two tables are independent.

- [ ] **Step 2: Run the SQL integration suite to verify the new contract fails**

Run against an acknowledged disposable Supabase-compatible database:

```bash
ITC_OPERATIONS_TEST_DATABASE_URL="$DISPOSABLE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL because `operational_session_venue_overrides`, `notifications.destination`, or `set_session_venue` does not exist.

If no disposable URL is available, run the non-destructive gate and record that full SQL execution remains pending:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: PASS for repository safety checks; this does not substitute for the disposable-database run.

- [ ] **Step 3: Implement the table, privileges, and RPC**

Create the migration with these foundations:

```sql
alter table public.notifications
  add column if not exists destination text;

create table public.operational_session_venue_overrides (
  session_id          text primary key
    check (session_id ~ '^(wnt|run|water)-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  activity_id         text not null check (activity_id in ('wnt', 'run', 'water')),
  location            text,
  maps_query          text,
  set_by              uuid references public.profiles(id),
  set_at              timestamptz,
  member_notified_at  timestamptz,
  check (activity_id = regexp_replace(session_id, '-[0-9]{4}-[0-9]{2}-[0-9]{2}$', ''))
);

alter table public.operational_session_venue_overrides enable row level security;
create policy "public read session venue overrides"
  on public.operational_session_venue_overrides for select using (true);

revoke all on table public.operational_session_venue_overrides from anon, authenticated;
grant select on table public.operational_session_venue_overrides to anon, authenticated;
```

Implement `set_session_venue` as `security definer set search_path = public`. It must:

1. Call `operational_assert_admin('set_session_venue')`.
2. Normalize `nullif(trim(...), '')` and reject any activity outside the three free IDs before touching data.
3. Lock an existing row with `for update`; compare normalized old/new values and return immediately on a no-op.
4. Upsert the new values, actor, and timestamp while retaining `member_notified_at`.
5. On `p_was_tbc and new location/maps query are both non-null and member_notified_at is null`, insert one member notification for each `profiles.role = 'member'`, excluding Admin roles, then set `member_notified_at = now()`.
6. Insert one audit notification for every `admin`/`super_admin` except `auth.uid()` on each actual save/reset.
7. Set `destination` to `#/activity/` plus the validated session ID for both audiences.

Use exact member/admin copy from the spec. Revoke function execution from `public` and `anon`; grant it only to `authenticated`.

- [ ] **Step 4: Run SQL verification and syntax checks**

```bash
ITC_OPERATIONS_TEST_DATABASE_URL="$DISPOSABLE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_operational_backend.sh
bash -n supabase/tests/verify_operational_backend.sh
bash -n supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

Expected: all SQL assertions pass, including existing HYROX operational assertions; shell and whitespace checks exit 0.

- [ ] **Step 5: Commit the database contract**

```bash
git add \
  supabase/migrations/20260813000001_free_event_venue_overrides.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat: add shared free-event venue overrides"
```

---

### Task 2: Hydrate and Mutate Live Venue Overrides

**Files:**
- Modify: `app/js/operations.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces `getLiveVenueOverride(sessionId): { sessionId, activityId, location, mapsQuery, setBy, setAt, memberNotifiedAt } | null`.
- Produces `liveSetWeekVenue(sessionId, { location, mapsQuery, wasTBC }): Promise<object>`.
- Extends `hydrateOperationalState()` and Realtime refresh to include `operational_session_venue_overrides`.
- `runOperationalRpc()` remains the only live mutation transport.

- [ ] **Step 1: Extend the fake Supabase and write failing live-cache assertions**

Add the table to `operationalTableRows`:

```js
operational_session_venue_overrides: [{
  session_id: "wnt-2026-08-05",
  activity_id: "wnt",
  location: "Central Harbourfront",
  maps_query: "Central Harbourfront, Hong Kong",
  set_by: "admin-id",
  set_at: fixedIso,
  member_notified_at: fixedIso,
}],
```

Teach the existing generic table query mock to return it. After `hydrateOperationalState()`, assert:

```js
assert.deepEqual(operations.getLiveVenueOverride("wnt-2026-08-05"), {
  sessionId: "wnt-2026-08-05",
  activityId: "wnt",
  location: "Central Harbourfront",
  mapsQuery: "Central Harbourfront, Hong Kong",
  setBy: "admin-id",
  setAt: Date.parse(fixedIso),
  memberNotifiedAt: Date.parse(fixedIso),
});
```

Add an RPC assertion:

```js
await operations.liveSetWeekVenue("wnt-2026-08-05", {
  location: "Wan Chai Promenade",
  mapsQuery: "Wan Chai Promenade, Hong Kong",
  wasTBC: false,
});
assert.deepEqual(operationalRpcCalls.at(-1), {
  name: "set_session_venue",
  args: {
    p_session_id: "wnt-2026-08-05",
    p_location: "Wan Chai Promenade",
    p_maps_query: "Wan Chai Promenade, Hong Kong",
    p_was_tbc: false,
  },
});
```

Also assert that a Realtime subscription is registered for the new table and `Activity venue is fixed.` is preserved as a user-facing `Error` message.

- [ ] **Step 2: Run live smoke to verify failure**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because the override table/cache and adapter exports do not exist.

- [ ] **Step 3: Extend the operational cache**

Add the table to `LIVE_TABLES`, a `venueOverrides: new Map()` member to `liveCache`, and this row builder:

```js
function buildVenueOverrideRow(row) {
  return {
    sessionId: row.session_id,
    activityId: row.activity_id,
    location: row.location || null,
    mapsQuery: row.maps_query || null,
    setBy: row.set_by || null,
    setAt: row.set_at ? Date.parse(row.set_at) : null,
    memberNotifiedAt: row.member_notified_at ? Date.parse(row.member_notified_at) : null,
  };
}
```

Fetch the table in the existing `Promise.all`, build a session-ID map in `replaceState`, add it to the Realtime channel, and export:

```js
export function getLiveVenueOverride(sessionId) {
  return liveCache.venueOverrides.get(sessionId) || null;
}

export async function liveSetWeekVenue(sessionId, { location, mapsQuery, wasTBC }) {
  return runOperationalRpc("set_session_venue", {
    p_session_id: sessionId,
    p_location: String(location || "").trim() || null,
    p_maps_query: String(mapsQuery || "").trim() || null,
    p_was_tbc: !!wasTBC,
  });
}
```

Add `Activity venue is fixed.` to `operationalProblem()` without changing its wording.

- [ ] **Step 4: Run live smoke and core smoke**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
git diff --check
```

Expected: both smoke suites and whitespace check pass.

- [ ] **Step 5: Commit the live adapter**

```bash
git add app/js/operations.js app/live-auth-smoke.mjs
git commit -m "feat: hydrate live venue overrides"
```

---

### Task 3: Implement the Store Seam and Notification Semantics

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/data.js`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces `setWeekVenue(sessionId, { location, mapsQuery }): object | Promise<object>`.
- Produces `weekVenueOverride(sessionId): { location: string, mapsQuery: string, venueMemberNotifiedAt?: number }` for Admin form values.
- `getSession(sessionId)` returns free sessions decorated with local or live overrides.
- Local override object retains `venueMemberNotifiedAt` after reset.
- `notificationDestination(kind, destination = null)` returns a row-specific destination first, then existing kind fallback.

- [ ] **Step 1: Write failing local store tests**

Create a fixture with one acting Admin, one other Admin, two approved members, and one pending user. Select a future WNT session and assert:

```js
store.signIn("admin@example.test");
const wnt = store.upcomingSessions(21).find((s) => s.activityId === "wnt");
store.setWeekVenue(wnt.id, {
  location: "Central Harbourfront — 7pm sharp",
  mapsQuery: "Central Harbourfront, Hong Kong",
});
const decorated = store.getSession(wnt.id);
if (decorated.location !== "Central Harbourfront — 7pm sharp"
    || decorated.mapsQuery !== "Central Harbourfront, Hong Kong"
    || decorated.venueTBC) {
  throw new Error("weekly venue must decorate the dated free session");
}
```

Count `operational_session_venue_updated` rows by recipient. Edit, repeat a no-op, reset with `{ location: null, mapsQuery: null }`, and reconfirm. Assert:

- Members each stay at one notification.
- The other Admin gets one notification per actual mutation only.
- The actor and pending user get none.
- Every local notification links to `#/activity/${wnt.id}`.
- Reset restores the template’s `location/mapsQuery` and leaves `venueMemberNotifiedAt` in the raw snapshot.
- Calling as a member throws the existing Admin authorization error.
- Calling with a HYROX ID throws `Activity venue is fixed.`.

Add live-store assertions that `setWeekVenue` delegates to `operations.liveSetWeekVenue` and `getSession` applies `getLiveVenueOverride` to a generated free session.

- [ ] **Step 2: Run both smoke suites to verify failure**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: FAIL because `setWeekVenue` and live decoration are absent.

- [ ] **Step 3: Implement local/live decoration and mutation**

Refactor `decorateSession` to accept an explicit override while retaining existing callers:

```js
function decorateSession(s, override = state.sessionOverrides[s.id]) {
  if (!override) return s;
  const out = { ...s };
  // existing time/cancel/TBC/notice/gym fields
  if (override.location) out.location = override.location;
  if (override.mapsQuery) out.mapsQuery = override.mapsQuery;
  if (override.location || override.mapsQuery) out.venueTBC = false;
  return out;
}
```

In live mode, free sessions use `liveOps.getLiveVenueOverride(sessionId)`; paid sessions continue using `getLiveSession`. Update live `upcomingSessions()` so generated free sessions pass through `getSession(s.id)` before Home/Admin rendering.

Implement `setWeekVenue` with these exact guards and transition rules:

```js
export function setWeekVenue(sessionId, { location, mapsQuery }) {
  const activityId = String(sessionId).replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (!new Set(["wnt", "run", "water"]).has(activityId)) {
    throw new Error("Activity venue is fixed.");
  }
  const before = getSession(sessionId);
  if (!before || before.kind !== "free") throw new Error("Session not found.");
  const cleanLocation = String(location || "").trim();
  const cleanMapsQuery = String(mapsQuery || "").trim();
  const wasTBC = before.location === "TBC" || !before.mapsQuery;
  if (isLive()) {
    return liveOps.liveSetWeekVenue(sessionId, {
      location: cleanLocation,
      mapsQuery: cleanMapsQuery,
      wasTBC,
    });
  }
  requirePaymentAdminActor();
  // compare, mutate, fan out, save once
}
```

For local no-op comparison, compare the requested override values—not decorated template values—so Reset can clear an existing override. On first confirmation, notify approved `member` roles and set `venueMemberNotifiedAt = Date.now()`. On every actual mutation, notify other approved Admin/Super Admin roles. Do not route Admins through member fan-out.

Add `operational_session_venue_updated` to `NOTIFICATION_CATEGORIES` as `club`. Change destination selection to:

```js
export function notificationDestination(kind, destination = null) {
  if (typeof destination === "string" && destination.startsWith("#/")) return destination;
  // existing kind fallbacks
}
```

Later view code will pass `notification.destination` into this helper. Also export the raw-form accessor without exposing mutable state:

```js
export function weekVenueOverride(sessionId) {
  const value = isLive()
    ? liveOps.getLiveVenueOverride(sessionId)
    : state.sessionOverrides[sessionId];
  const notifiedAt = isLive()
    ? value?.memberNotifiedAt
    : value?.venueMemberNotifiedAt;
  return {
    location: value?.location || "",
    mapsQuery: value?.mapsQuery || "",
    ...(notifiedAt ? { venueMemberNotifiedAt: notifiedAt } : {}),
  };
}
```

- [ ] **Step 4: Run store and live regressions**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/store.js
node --check app/js/data.js
git diff --check
```

Expected: new local/live venue tests and all existing tests pass.

- [ ] **Step 5: Commit the store seam**

```bash
git add app/js/store.js app/js/data.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat: add weekly free-event venue state"
```

---

### Task 4: Render Admin Venue Forms and Universal Directions

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- `viewActivity(sessionId)` emits `#activity-map` only for eligible free sessions.
- `viewActivity(sessionId)` emits Get directions for all eligible free and paid sessions.
- `viewAdmin("ops")`/`viewAdmin("payments")` emits `form[data-action="form-week-venue"]` for upcoming free sessions only.
- Notification rows use `notification.destination` when supplied.

- [ ] **Step 1: Add failing view assertions**

In `app/smoke.mjs`, set a WNT override and assert:

```js
const freeDetail = views.viewActivity(wnt.id);
if (!freeDetail.includes('id="activity-map"')
    || !freeDetail.includes('data-maps-query="Central Harbourfront, Hong Kong"')
    || !freeDetail.includes("Loading map…")) {
  throw new Error("mapped free event must render the inline map host");
}
```

Also assert:

- A free event without `mapsQuery` has no map host.
- A paid HYROX detail has `Get directions` but no map host.
- Cancelled and past mapped sessions have neither map nor directions promotion.
- Both `hyrox-*` and `hyrox-midtown-*` details contain Google Maps links.
- Admin Ops contains `Free-event venues`, one form per upcoming free event, separate `location`/`mapsQuery` inputs, and no form whose `data-session` starts with `hyrox`.
- A notification row with `destination: '#/activity/wnt-2026-08-19'` emits that exact `data-destination`.

Mirror the Admin and notification checks in `app/live-auth-smoke.mjs` using hydrated live overrides.

- [ ] **Step 2: Run smoke suites to verify failure**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: FAIL because map hosts, paid directions, free-event forms, and row-specific destinations are not rendered.

- [ ] **Step 3: Refactor activity actions and render the map host**

Build reusable strings only after cancelled/past checks:

```js
const directions = s.mapsQuery
  ? `<a class="btn ghost" href="${mapsHref(s)}" target="_blank" rel="noopener">Get directions</a>`
  : "";
const mapSection = s.kind === "free" && s.mapsQuery
  ? `<section class="activity-map-section" aria-label="Venue map">
      <div class="activity-map" id="activity-map"
        data-maps-query="${esc(s.mapsQuery)}"
        data-marker-label="${esc(`${s.name} · ${fmtDate(s.date)} · ${fmtTime(s.time)}`)}">
        <p class="muted small" role="status">Loading map…</p>
      </div>
    </section>`
  : "";
```

Place `mapSection` immediately before the free-event action row. Append `directions` beside Add to Calendar for free events and in a `.btn-row` adjacent to the applicable paid action (manage booking, book/pay, member gate, closed Midtown, or full state). Do not render either string in cancelled/past branches.

- [ ] **Step 4: Render the Admin free-event section and notification destination**

Inside `adminOps`, derive:

```js
const freeSessions = store.upcomingSessions(21)
  .filter((s) => s.kind === "free" && !sessionStarted(s));
```

Render one card/form per session using unique input IDs based on escaped session IDs, the exact labels/placeholders/copy from the spec, `data-action="form-week-venue"`, and a `data-action="reset-week-venue"` button. Display override inputs from `store.weekVenueOverride(sessionId)` so template defaults do not masquerade as overrides.

Update notification rendering:

```js
data-destination="${esc(notificationDestination(kind, notification?.destination))}"
```

Add small layout rules for `.free-event-venue-card` and make its `.field-row` collapse to one column below 560px. Do not style the map in this task.

- [ ] **Step 5: Run view regressions**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/views.js
git diff --check
```

Expected: all assertions pass and free-event no-booking behavior remains unchanged.

- [ ] **Step 6: Commit the views**

```bash
git add app/js/views.js app/js/store.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat: render weekly venues and session directions"
```

---

### Task 5: Build the Leaflet and Nominatim Map Module

**Files:**
- Create: `app/js/map.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces `parseGeocodeCache(raw): Record<string, {lat:number, lon:number}>`.
- Produces `normalizeGeocodeResult(rows): {lat:number, lon:number} | null`.
- Produces `mountActivityMap(host, { ownsGeneration, fetchImpl, timeoutMs, loadLeaflet } = {}): Promise<boolean>`; returns `true` when a map mounts and `false` after rendering fallback. `loadLeaflet` defaults to the pinned CDN loader and exists as a test seam only.
- The module has no store/view imports and performs no DOM access at import time.

- [ ] **Step 1: Write failing pure-helper tests**

Dynamically import `map.js` in `app/smoke.mjs` and assert:

```js
assert.deepEqual(parseGeocodeCache('{"Central":{"lat":22.28,"lon":114.16}}'), {
  Central: { lat: 22.28, lon: 114.16 },
});
assert.deepEqual(parseGeocodeCache("not-json"), {});
assert.deepEqual(parseGeocodeCache('{"Bad":{"lat":"NaN","lon":114}}'), {});
assert.deepEqual(normalizeGeocodeResult([{ lat: "22.281", lon: "114.159" }]), {
  lat: 22.281,
  lon: 114.159,
});
assert.equal(normalizeGeocodeResult([]), null);
assert.equal(normalizeGeocodeResult([{ lat: "x", lon: "114" }]), null);
```

Add a small fake host and fake `fetchImpl` test proving empty results settle to `false` and replace `Loading map…` with `Couldn’t find the venue on the map — tap Get directions instead.` Pass `loadLeaflet: async () => { throw new Error("must not load for an unresolved venue"); }` and implement geocoding before Leaflet loading so this test requires neither a browser DOM nor network access.

- [ ] **Step 2: Run smoke to verify module absence**

```bash
node app/smoke.mjs
```

Expected: FAIL with module-not-found or missing export errors for `app/js/map.js`.

- [ ] **Step 3: Implement cache parsing and serialized geocoding**

Use these constants exactly:

```js
const CACHE_KEY = "itc.geocode.v1";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
const FALLBACK_COPY = "Couldn’t find the venue on the map — tap Get directions instead.";
```

`parseGeocodeCache` must return only entries whose numeric `lat` and `lon` are finite. `normalizeGeocodeResult` accepts the first valid Nominatim row and converts strings to numbers. Wrap every localStorage read/write in `try/catch`.

Use a module-level promise chain to serialize uncached Nominatim requests and a `Map` to deduplicate requests by exact trimmed query. Request:

```js
const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
```

Abort or reject after `timeoutMs` (default 5000), reject non-2xx responses, and cache successful finite coordinates forever.

- [ ] **Step 4: Implement pinned Leaflet loading and mount behavior**

Memoize one Leaflet loader promise. Inject CSS/JS tags with exact URL, integrity, and `crossOrigin = "anonymous"`; reject on script error or five-second timeout and preserve the rejected promise for the page session.

In `mountActivityMap`:

1. Read and trim `host.dataset.mapsQuery` and `host.dataset.markerLabel`.
2. Resolve geocoding first; if it fails, call `renderFallback(host)` and return `false` without loading Leaflet.
3. Call the injected `loadLeaflet` option or the default pinned loader; on failure, render fallback and return `false`.
4. Before every DOM write and before `L.map`, require `ownsGeneration()` and `host.isConnected`; otherwise return `false` without fallback.
5. Mount at zoom 15, add OSM standard tiles, required attribution, one marker, and a popup using `textContent`/Leaflet DOM nodes rather than interpolated HTML.
6. Return `true`.

- [ ] **Step 5: Add responsive map styling**

Add:

```css
.activity-map-section { margin-top: 16px; }
.activity-map {
  min-height: 260px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface-3);
}
.activity-map > [role="status"],
.activity-map-fallback {
  min-height: 260px;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 24px;
  text-align: center;
}
.activity-map:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.activity-map .leaflet-control-attribution { color: #111; }
.activity-map .leaflet-popup-content { color: #111; }
```

Keep Leaflet controls usable and do not globally override `.leaflet-*` outside `.activity-map`.

- [ ] **Step 6: Run helper tests and syntax checks**

```bash
node app/smoke.mjs
node --check app/js/map.js
git diff --check
```

Expected: pure cache/geocode/fallback tests and all existing smoke checks pass without a network call.

- [ ] **Step 7: Commit the map module**

```bash
git add app/js/map.js app/styles.css app/smoke.mjs
git commit -m "feat: add lazy free-event venue maps"
```

---

### Task 6: Wire Async Admin Mutations and Route-Safe Map Mounting

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `docs/runbooks/live-auth.md`

**Interfaces:**
- `app.js` imports `mountActivityMap` from `./map.js`.
- Venue form and Reset call `await store.setWeekVenue(...)` through `withBusyControl`.
- Map mounting receives `ownsGeneration: () => generation === renderGeneration`.

- [ ] **Step 1: Add failing delegated-handler and stale-generation tests**

Extend the fake DOM setup with a weekly venue form, its two inputs, Save/Reset controls, and a map host. Dispatch Save and assert:

```js
assert.deepEqual(operationalRpcCalls.at(-1).args, {
  p_session_id: "wnt-2026-08-05",
  p_location: "Central Harbourfront — 7pm sharp",
  p_maps_query: "Central Harbourfront, Hong Kong",
  p_was_tbc: true,
});
```

Simulate RPC rejection and assert the controls re-enable, entered values remain, the current Admin route is not replaced, and an error toast is emitted. Dispatch Reset and assert null/empty payload fields are sent.

For route safety, hold the map fetch/Leaflet promise, navigate to `#/home`, then release it. Assert the detached activity host is not modified and no Leaflet map is created for the old generation.

- [ ] **Step 2: Run live smoke to verify failure**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because handlers and map mounting are not wired.

- [ ] **Step 3: Add async Save and Reset handlers**

In submit delegation:

```js
case "form-week-venue": {
  e.preventDefault();
  const control = form.querySelector('[type="submit"]');
  const controls = [...form.querySelectorAll("input, button")];
  const fd = new FormData(form);
  await withBusyControl(control, "Saving…", async () => {
    try {
      await store.setWeekVenue(form.dataset.session, {
        location: fd.get("location"),
        mapsQuery: fd.get("mapsQuery"),
      });
      toast("Venue saved for this week");
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to save venue", true);
    }
  }, { busyKey: form, controls });
  break;
}
```

In click delegation, handle `reset-week-venue` with the same busy/error discipline, calling `{ location: null, mapsQuery: null }`. Do not rerender after failure, so typed values remain. Do not geocode from either handler.

- [ ] **Step 4: Mount the map after the route HTML commit**

Import `mountActivityMap`. Immediately after `viewEl.innerHTML = out`, locate the host only for the current Activity route:

```js
const mapHost = page === "activity" ? viewEl.querySelector("#activity-map") : null;
if (mapHost) {
  void mountActivityMap(mapHost, {
    ownsGeneration: () => generation === renderGeneration,
  });
}
```

Do not await mounting; Activity content and external directions must remain responsive while CDN/geocoding work proceeds. The module owns its visible fallback and catches its own expected network failures.

- [ ] **Step 5: Document live migration and manual verification**

Add `20260813000001_free_event_venue_overrides.sql` after the operational migrations in `docs/runbooks/live-auth.md`. Document:

```text
1. Apply the ordered migration to live Supabase.
2. In Admin → Payments / Ops, save a dated free-event display location and geocode query.
3. Open its Activity page with itc.geocode.v1 cleared and verify marker + OSM attribution.
4. Verify an approved member receives Venue confirmed and another Admin receives Session venue updated.
5. Block unpkg.com and nominatim.openstreetmap.org separately; fallback copy and Get directions must remain usable.
6. Confirm HYROX shows Get directions but no weekly venue form.
```

Include the privacy note that Nominatim receives venue text and browser IP and that only venue coordinates are cached locally.

- [ ] **Step 6: Run full automated verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for file in app/js/*.js app/*.mjs; do node --check "$file"; done
bash supabase/tests/verify_admin_notifications_safety.sh
bash supabase/tests/verify_giving_campaigns_safety.sh
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

Expected: every command exits 0.

When a disposable database is available, also run:

```bash
ITC_OPERATIONS_TEST_DATABASE_URL="$DISPOSABLE_URL" \
ITC_ALLOW_DATABASE_RESET=1 \
bash supabase/tests/verify_operational_backend.sh
```

Expected: `All operational backend verifications passed.`

- [ ] **Step 7: Perform browser acceptance**

Run:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/` and execute all nine manual acceptance checks from `docs/superpowers/specs/2026-08-13-location-map-design.md`, including cache-cleared map load, member/Admin notification audiences, repeated edit/reset dedupe, both network failures, and both HYROX directions links.

- [ ] **Step 8: Commit application wiring and runbook**

```bash
git add app/js/app.js app/live-auth-smoke.mjs docs/runbooks/live-auth.md
git commit -m "feat: wire venue admin and map lifecycle"
```

- [ ] **Step 9: Review final branch diff**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree; only location-map spec/plan, venue migration/tests, map/runtime files, smoke tests, styles, and the live-auth runbook differ from `origin/main`.
