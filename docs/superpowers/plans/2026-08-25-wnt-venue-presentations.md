# WNT Venue-Specific Images and Meeting-Point Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the correct Island ECC floor guide or exact Tamar meeting-point map on dated WNT Activity Details pages, with a per-session pin selected in Admin Weekly Venue Overrides.

**Architecture:** A pure `venue.js` resolver canonicalizes WNT venue names and chooses image, coordinate-map, generic-map, or no presentation. Optional meeting coordinates travel through the existing dated override seam in local state and Supabase; `map.js` owns both exact-coordinate display and the interactive Admin picker, while `views.js` renders declarative hosts and `app.js` mounts them after route commit.

**Tech Stack:** Vanilla ES modules, hand-rendered HTML/CSS, Leaflet 1.9.4, localStorage, Supabase/PostgreSQL SECURITY DEFINER RPCs, Node smoke scripts, shell/psql disposable-database verifier.

## Global Constraints

- Work only in the existing `feature/location-map` worktree and branch; do not merge Shop code or change long-lived branch structure.
- No npm dependencies, bundler, framework, transpilation, or build step.
- The ECC source images are `/Users/selesli/projects/island-training-club-app/Island ECC 11.jpeg` and `/Users/selesli/projects/island-training-club-app/Island ECC 9.jpeg`.
- Commit them as `assets/itc/venues/island-ecc-11.jpg` and `assets/itc/venues/island-ecc-9.jpg`; preserve full aspect ratio and wayfinding content.
- Specialized ECC/Tamar behavior applies only to dated WNT sessions. Other activities retain generic map behavior.
- Tamar’s approved default point is latitude `22.2816182`, longitude `114.1655613`.
- A custom meeting point belongs only to one dated session ID; it must never become a recurring default.
- For non-WNT or non-Tamar saves, persisted meeting coordinates are null.
- Keep the old four-argument `set_session_venue(text,text,text,boolean)` RPC working during deployment; add the six-argument overload for coordinates.
- Preserve venue-notification deduplication: a coordinate-only edit creates Admin audit fan-out but never repeats member confirmation fan-out.
- Never remove or rename localStorage state keys without a versioned migration. This feature only adds optional nested keys, so `STATE_VERSION` remains unchanged.
- Every production behavior follows red-green TDD. Run the named failing test before each implementation step, then run both JS smoke suites after each task.
- Use repo author configuration `syseles <syselesli@gmail.com>` without command-line author overrides.

## File Structure

**Create**

- `app/js/venue.js` — pure venue normalization, coordinate validation, and presentation resolution.
- `assets/itc/venues/island-ecc-11.jpg` — supplied 11/F wayfinding image.
- `assets/itc/venues/island-ecc-9.jpg` — supplied 9/F wayfinding image.
- `supabase/migrations/20260825000001_wnt_meeting_points.sql` — additive coordinates, six-argument RPC, compatibility wrapper/grants, PostgREST reload.

**Modify**

- `app/js/store.js` — validate, persist, clear, and decorate dated meeting coordinates.
- `app/js/operations.js` — hydrate coordinates and send them through the live RPC.
- `app/js/views.js` — render ECC figures, exact/generic map hosts, exact directions, and Admin picker hosts/hidden fields.
- `app/js/map.js` — exact-coordinate mounting plus clickable/draggable Admin picker.
- `app/js/app.js` — mount venue presentations/pickers, synchronize Tamar input changes, submit/reset coordinates, image-error fallback.
- `app/styles.css` — responsive guide figure and Admin picker styling.
- `app/smoke.mjs` — pure resolver, local store, Activity Details, directions, exact-map, reset, and asset contracts.
- `app/live-auth-smoke.mjs` — picker interaction, six-argument live RPC, hydration, route safety, failure preservation, image fallback.
- `supabase/tests/operational_backend_integration.sql` — schema, grants, compatibility, coordinate validation, persistence, reset, and notification assertions.

---

### Task 1: Pure Venue Resolver and ECC Assets

**Files:**
- Create: `app/js/venue.js`
- Create: `assets/itc/venues/island-ecc-11.jpg`
- Create: `assets/itc/venues/island-ecc-9.jpg`
- Modify: `app/smoke.mjs` near the inline-map tests around line 2399

**Interfaces:**
- Produces: `TAMAR_DEFAULT_MEETING_POINT: Readonly<{lat:number,lng:number}>`
- Produces: `normalizeVenueLocation(location: unknown): string`
- Produces: `normalizeMeetingPoint(lat: unknown, lng: unknown): {lat:number,lng:number}|null`
- Produces: `venuePresentationFor(session: object): ImagePresentation|CoordinatePresentation|GeocodePresentation|NonePresentation`
- `normalizeVenueLocation()` returns canonical `"island ecc 11/f"`, `"island ecc 9/f"`, or `"tamar park"` for recognized formatting/aliases; unrelated normalized text remains unchanged.

- [ ] **Step 1: Add failing resolver tests**

Add a block before the current `const map = await import("./js/map.js")` line in `app/smoke.mjs`:

```js
const venue = await import("./js/venue.js");
const same = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)}`);
  }
};

if (venue.normalizeVenueLocation("  ISLAND ECC 11 / F ") !== "island ecc 11/f") {
  throw new Error("11/F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Island ECC 9F") !== "island ecc 9/f") {
  throw new Error("9F venue formatting must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Park, Admiralty") !== "tamar park") {
  throw new Error("Tamar alias must canonicalize");
}
if (venue.normalizeVenueLocation("Tamar Street") === "tamar park") {
  throw new Error("unrelated Tamar text must not specialize");
}
same(
  venue.normalizeMeetingPoint("22.2816182", "114.1655613"),
  { lat: 22.2816182, lng: 114.1655613 },
  "valid meeting point"
);
for (const [lat, lng] of [[null, 114], [91, 114], [22, -181], ["x", 114]]) {
  if (venue.normalizeMeetingPoint(lat, lng) !== null) {
    throw new Error(`invalid meeting point accepted: ${lat},${lng}`);
  }
}

same(venue.venuePresentationFor({
  id: "wnt-2026-09-02", activityId: "wnt", location: "Island ECC 11/F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 2 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-11.jpg",
  alt: "Route to The Well on 11/F at Island ECC",
  caption: "The Well · 11/F Island ECC",
  fallbackQuery: "Island ECC",
}, "11/F image presentation");
same(venue.venuePresentationFor({
  id: "wnt-2026-09-09", activityId: "wnt", location: "Island ECC 9F",
  mapsQuery: "Island ECC", markerLabel: "WNT · 9 Sep · 7:30 PM",
}), {
  kind: "image",
  src: "../assets/itc/venues/island-ecc-9.jpg",
  alt: "Route to Kid’s Club Hall on 9/F at Island ECC",
  caption: "Kid’s Club Hall · 9/F Island ECC",
  fallbackQuery: "Island ECC",
}, "9/F image presentation");
same(venue.venuePresentationFor({
  id: "wnt-2026-09-16", activityId: "wnt", location: "Tamar Park",
  mapsQuery: "Tamar Park", markerLabel: "WNT · 16 Sep · 7:30 PM",
}), {
  kind: "coordinates", lat: 22.2816182, lng: 114.1655613,
  markerLabel: "WNT · 16 Sep · 7:30 PM",
}, "default Tamar presentation");
same(venue.venuePresentationFor({
  id: "run-2026-09-14", activityId: "run", location: "Island ECC 9/F",
  mapsQuery: "Island ECC", markerLabel: "Run",
}), { kind: "geocode", query: "Island ECC", markerLabel: "Run" },
"non-WNT generic presentation");
console.log("ok  WNT venue resolver selects ECC images, Tamar point, and generic fallback");
```

Also add filesystem assertions near the existing asset checks:

```js
for (const path of [
  "../assets/itc/venues/island-ecc-11.jpg",
  "../assets/itc/venues/island-ecc-9.jpg",
]) {
  if (!existsSync(resolve(__dirnameSmoke, path))) throw new Error(`missing venue guide: ${path}`);
}
```

- [ ] **Step 2: Run smoke and verify RED**

Run:

```bash
cd app && node smoke.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/js/venue.js` before any asset assertion can pass.

- [ ] **Step 3: Create the resolver**

Create `app/js/venue.js` with this behavior:

```js
export const TAMAR_DEFAULT_MEETING_POINT = Object.freeze({
  lat: 22.2816182,
  lng: 114.1655613,
});

const ECC_PRESENTATIONS = new Map([
  ["island ecc 11/f", {
    src: "../assets/itc/venues/island-ecc-11.jpg",
    alt: "Route to The Well on 11/F at Island ECC",
    caption: "The Well · 11/F Island ECC",
  }],
  ["island ecc 9/f", {
    src: "../assets/itc/venues/island-ecc-9.jpg",
    alt: "Route to Kid’s Club Hall on 9/F at Island ECC",
    caption: "Kid’s Club Hall · 9/F Island ECC",
  }],
]);

export function normalizeVenueLocation(location) {
  let value = String(location || "").trim().toLocaleLowerCase();
  value = value.replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/");
  value = value.replace(/\b(9|11)\s*f\b/g, "$1/f");
  value = value.replace(/\s*,\s*/g, ", ");
  if (value === "tamar park" || value === "tamar park, admiralty") return "tamar park";
  return value;
}

export function normalizeMeetingPoint(lat, lng) {
  if (lat === null || lat === undefined || lat === ""
      || lng === null || lng === undefined || lng === "") return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    ? point
    : null;
}

export function venuePresentationFor(session = {}) {
  const query = String(session.mapsQuery || "").trim();
  const markerLabel = String(session.markerLabel || session.name || session.location || query);
  const isWnt = session.activityId === "wnt" || String(session.id || "").startsWith("wnt-");
  const venue = normalizeVenueLocation(session.location);
  if (isWnt && ECC_PRESENTATIONS.has(venue)) {
    return { kind: "image", ...ECC_PRESENTATIONS.get(venue), fallbackQuery: query };
  }
  if (isWnt && venue === "tamar park") {
    const point = normalizeMeetingPoint(session.meetingLat, session.meetingLng)
      || TAMAR_DEFAULT_MEETING_POINT;
    return { kind: "coordinates", ...point, markerLabel };
  }
  return query ? { kind: "geocode", query, markerLabel } : { kind: "none" };
}
```

- [ ] **Step 4: Copy assets into URL-safe repository paths**

Run:

```bash
mkdir -p assets/itc/venues
cp '/Users/selesli/projects/island-training-club-app/Island ECC 11.jpeg' \
  assets/itc/venues/island-ecc-11.jpg
cp '/Users/selesli/projects/island-training-club-app/Island ECC 9.jpeg' \
  assets/itc/venues/island-ecc-9.jpg
```

Do not resize, crop, recompress, or delete the source files.

- [ ] **Step 5: Run both JS smoke suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0; smoke prints the new resolver success line.

- [ ] **Step 6: Commit Task 1**

```bash
git add app/js/venue.js app/smoke.mjs assets/itc/venues/island-ecc-11.jpg assets/itc/venues/island-ecc-9.jpg
git commit -m "feat(venue): resolve WNT venue presentations"
```

---

### Task 2: Local Dated Meeting-Point Persistence

**Files:**
- Modify: `app/js/store.js:1167-1228,1544-1635`
- Modify: `app/smoke.mjs` in the weekly venue override section around line 1220 and the local fan-out tests around line 2270

**Interfaces:**
- Consumes: `normalizeVenueLocation()` and `normalizeMeetingPoint()` from `app/js/venue.js`
- Changes: `setWeekVenue(sessionId, {location, mapsQuery, meetingLat, meetingLng})`
- Changes: `weekVenueOverride(sessionId)` returns `{location,mapsQuery,meetingLat,meetingLng,...}`
- Produces on decorated session: optional finite `meetingLat` and `meetingLng`

- [ ] **Step 1: Add failing local store tests**

Extend the existing weekly venue override smoke block with a dated Tamar case:

```js
const tamarSession = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt" && !data.sessionStarted(s)
);
store.setWeekVenue(tamarSession.id, {
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: 22.2825,
  meetingLng: 114.1659,
});
let tamarDecorated = store.getSession(tamarSession.id);
if (tamarDecorated.meetingLat !== 22.2825 || tamarDecorated.meetingLng !== 114.1659) {
  throw new Error("dated Tamar point must decorate the session");
}
let tamarOverride = store.weekVenueOverride(tamarSession.id);
if (tamarOverride.meetingLat !== 22.2825 || tamarOverride.meetingLng !== 114.1659) {
  throw new Error("Admin override read must retain the dated Tamar point");
}
const otherWnt = store.upcomingSessions(21).find(
  (s) => s.activityId === "wnt" && s.id !== tamarSession.id && !data.sessionStarted(s)
);
if (!otherWnt || "meetingLat" in store.getSession(otherWnt.id)) {
  throw new Error("dated Tamar point must not leak into another WNT occurrence");
}

store.setWeekVenue(tamarSession.id, {
  location: "Island ECC 9/F",
  mapsQuery: "Island ECC",
  meetingLat: 22.2825,
  meetingLng: 114.1659,
});
tamarDecorated = store.getSession(tamarSession.id);
if ("meetingLat" in tamarDecorated || "meetingLng" in tamarDecorated) {
  throw new Error("non-Tamar save must clear stale meeting coordinates");
}

for (const point of [
  { meetingLat: 22.28, meetingLng: null },
  { meetingLat: 91, meetingLng: 114.16 },
]) {
  try {
    store.setWeekVenue(tamarSession.id, {
      location: "Tamar Park", mapsQuery: "Tamar Park", ...point,
    });
    throw new Error("invalid Tamar point must fail");
  } catch (err) {
    if (err.message !== "Choose a valid meeting point.") throw err;
  }
}

store.setWeekVenue(tamarSession.id, { location: null, mapsQuery: null,
  meetingLat: null, meetingLng: null });
if ("meetingLat" in store.getSession(tamarSession.id)) {
  throw new Error("venue reset must remove the dated meeting point");
}
console.log("ok  local WNT override persists, clears, validates, and resets meeting coordinates");
```

In the existing fan-out block, reuse `venueNotesFor` and add the coordinate-only audit assertion:

```js
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
const memberBeforeMove = venueNotesFor("fixture-member", wntSession.id).length;
const adminBeforeMove = venueNotesFor("fixture-other-admin", wntSession.id).length;
store.setWeekVenue(wntSession.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2827, meetingLng: 114.1661,
});
if (venueNotesFor("fixture-member", wntSession.id).length !== memberBeforeMove) {
  throw new Error("coordinate-only edit must not repeat member fan-out");
}
if (venueNotesFor("fixture-other-admin", wntSession.id).length !== adminBeforeMove + 1) {
  throw new Error("coordinate-only edit must create one Admin audit notification");
}
```

- [ ] **Step 2: Run smoke and verify RED**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL at `dated Tamar point must decorate the session`; current `setWeekVenue` discards coordinate arguments.

- [ ] **Step 3: Add coordinate normalization at the store boundary**

Import from `venue.js`:

```js
import { normalizeMeetingPoint, normalizeVenueLocation } from "./venue.js";
```

Change the signature and derive the persisted pair before the live/local split:

```js
export function setWeekVenue(sessionId, {
  location, mapsQuery, meetingLat = null, meetingLng = null,
} = {}) {
  const cleanLocation = String(location || "").trim();
  const cleanMapsQuery = String(mapsQuery || "").trim();
  const overrideActivityId = String(sessionId).replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const rawPointProvided = ![meetingLat, meetingLng].every(
    (value) => value === null || value === undefined || value === ""
  );
  const normalizedPoint = normalizeMeetingPoint(meetingLat, meetingLng);
  const acceptsPoint = overrideActivityId === "wnt"
    && normalizeVenueLocation(cleanLocation) === "tamar park";
  if (acceptsPoint && rawPointProvided && !normalizedPoint) {
    throw new Error("Choose a valid meeting point.");
  }
  const meetingPoint = acceptsPoint ? normalizedPoint : null;
```

Pass `meetingPoint?.lat ?? null` and `meetingPoint?.lng ?? null` to `liveSetWeekVenue`.

- [ ] **Step 4: Persist and detect local coordinate changes**

In the local branch:

```js
const previousPoint = normalizeMeetingPoint(override.meetingLat, override.meetingLng);
const pointChanged = (previousPoint?.lat ?? null) !== (meetingPoint?.lat ?? null)
  || (previousPoint?.lng ?? null) !== (meetingPoint?.lng ?? null);
const changed = previousLocation !== cleanLocation
  || previousMapsQuery !== cleanMapsQuery
  || Boolean(override.venueTBC) !== nextVenueTBC
  || pointChanged;
```

When applying the override:

```js
if (meetingPoint) {
  override.meetingLat = meetingPoint.lat;
  override.meetingLng = meetingPoint.lng;
} else {
  delete override.meetingLat;
  delete override.meetingLng;
}
```

Keep the existing no-op, member dedupe, Admin audit, and single `save()` boundaries. A coordinate-only change follows the existing Admin audit path because `changed` is true, while member fan-out remains gated by `venueMemberNotifiedAt`.

- [ ] **Step 5: Decorate and expose only valid pairs**

In both `decorateSession()` and `decorateFreeSession()`:

```js
const point = normalizeMeetingPoint(o.meetingLat, o.meetingLng);
if (point) Object.assign(out, { meetingLat: point.lat, meetingLng: point.lng });
```

In `weekVenueOverride()`, change the no-value return first:

```js
if (!value) return { location: "", mapsQuery: "", meetingLat: "", meetingLng: "" };
```

Then return normalized values for a retained override:

```js
const point = normalizeMeetingPoint(value.meetingLat, value.meetingLng);
return {
  location: value.location || "",
  mapsQuery: value.mapsQuery || "",
  meetingLat: point?.lat ?? "",
  meetingLng: point?.lng ?? "",
  ...(notifiedAt ? { venueMemberNotifiedAt: notifiedAt } : {}),
};
```

- [ ] **Step 6: Run both JS smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0; the new local persistence line prints.

- [ ] **Step 7: Commit Task 2**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "feat(venue): persist dated WNT meeting points"
```

---

### Task 3: Venue-Specific Activity Details and Exact-Coordinate Map

**Files:**
- Modify: `app/js/views.js:399-556`
- Modify: `app/js/map.js:188-230`
- Modify: `app/js/app.js:1-32,259-370`
- Modify: `app/styles.css:1456-1478`
- Modify: `app/smoke.mjs` near the Task 1 resolver and inline-map blocks
- Modify: `app/live-auth-smoke.mjs` near the existing activity map route tests

**Interfaces:**
- Consumes: `venuePresentationFor(session)` and `normalizeMeetingPoint()`
- Changes: `mountActivityMap(host, options)` accepts either `data-map-lat`/`data-map-lng` or `data-maps-query`
- Produces: `mountVenueImageFallback(image, options): boolean` in `app.js`

- [ ] **Step 1: Add failing Activity Details tests**

In `app/smoke.mjs`, save dated WNT overrides and render `viewActivity()`:

```js
store.setWeekVenue(wnt.id, { location: "Island ECC 11/F", mapsQuery: "Island ECC" });
let detail = views.viewActivity(wnt.id);
if (!detail.includes("island-ecc-11.jpg")
    || !detail.includes("The Well · 11/F Island ECC")
    || detail.includes('id="activity-map"')) {
  throw new Error("11/F WNT detail must render only the 11/F guide");
}
store.setWeekVenue(wnt.id, { location: "Island ECC 9/F", mapsQuery: "Island ECC" });
detail = views.viewActivity(wnt.id);
if (!detail.includes("island-ecc-9.jpg")
    || !detail.includes("Kid’s Club Hall · 9/F Island ECC")
    || detail.includes('id="activity-map"')) {
  throw new Error("9/F WNT detail must render only the 9/F guide");
}
store.setWeekVenue(wnt.id, {
  location: "Tamar Park", mapsQuery: "Tamar Park",
  meetingLat: 22.2825, meetingLng: 114.1659,
});
detail = views.viewActivity(wnt.id);
if (!detail.includes('data-map-lat="22.2825"')
    || !detail.includes('data-map-lng="114.1659"')
    || !detail.includes("destination=22.2825%2C114.1659")) {
  throw new Error("Tamar detail and directions must use the exact dated point");
}
```

The expected href fragment is hand-derived from the comma-encoded destination value; do not call `mapsHref` to build the assertion.

Add an exact-map test that installs a fake Leaflet global, passes a `fetchImpl` that throws if called, mounts a host with coordinate dataset values, and asserts `setView([22.2825,114.1659], 15)` and one marker call.

- [ ] **Step 2: Run smoke and verify RED**

```bash
node app/smoke.mjs
```

Expected: FAIL because ECC still renders `#activity-map` and no image path.

- [ ] **Step 3: Render one resolved venue presentation**

Import `venuePresentationFor` in `views.js`. Build a marker label once:

```js
const markerLabel = `${s.name} · ${fmtDate(s.date)} · ${fmtTime(s.time)}`;
const venuePresentation = venuePresentationFor({ ...s, markerLabel });
```

Set directions eligibility from either an exact point or the existing query:

```js
const showDirections = !s.cancelled && !past
  && (venuePresentation.kind === "coordinates" || Boolean(s.mapsQuery));
```

Replace `mapHost` with a helper that emits:

```js
function venuePresentationHTML(presentation) {
  if (presentation.kind === "image") return `
    <figure class="venue-guide activity-map-section">
      <img class="venue-guide-image" src="${esc(presentation.src)}"
        alt="${esc(presentation.alt)}" data-venue-image
        data-fallback-query="${esc(presentation.fallbackQuery)}">
      <figcaption>${esc(presentation.caption)}</figcaption>
    </figure>`;
  if (presentation.kind === "coordinates") return `
    <section class="activity-map-section" aria-label="Venue map">
      <div class="activity-map" id="activity-map"
        data-map-lat="${presentation.lat}" data-map-lng="${presentation.lng}"
        data-marker-label="${esc(presentation.markerLabel)}">
        <p class="muted small" role="status">Loading map…</p>
      </div>
    </section>`;
  if (presentation.kind === "geocode") return `
    <section class="activity-map-section" aria-label="Venue map">
      <div class="activity-map" id="activity-map"
        data-maps-query="${esc(presentation.query)}"
        data-marker-label="${esc(presentation.markerLabel)}">
        <p class="muted small" role="status">Loading map…</p>
      </div>
    </section>`;
  return "";
}
```

Render it only for non-cancelled, non-past free sessions. Preserve paid-session behavior and every free no-booking rule.

Change `mapsHref(s)` to resolve the session presentation. For `kind === "coordinates"`, return:

```js
return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
```

For all other kinds, retain the current Google Maps search URL.

- [ ] **Step 4: Mount exact coordinates without geocoding**

Import `normalizeMeetingPoint` in `map.js`. In `mountActivityMap`:

```js
const exactPoint = normalizeMeetingPoint(host.dataset.mapLat, host.dataset.mapLng);
const query = String(host.dataset.mapsQuery || "").trim();
if (!exactPoint && !query) return false;
const coordsPromise = exactPoint
  ? Promise.resolve(exactPoint)
  : geocodeQuery(query, { fetchImpl, timeoutMs });
```

Keep Leaflet loading concurrent with either coordinate resolution path. Extract the existing `L.map`/tile/marker block into a private `renderLeafletMap(host, coords, label, options)` helper so Task 4 can reuse it. Exact coordinates must never call `fetchImpl` or read/write the geocode cache.

- [ ] **Step 5: Add image-error fallback after route commit**

Export this behavior from `app.js` for live smoke coverage:

```js
export function mountVenueImageFallback(image, options = {}) {
  const {
    ownsGeneration = () => true,
    mountMap = mountCommittedActivityMap,
  } = options;
  if (!image || !ownsGeneration()) return false;
  const query = String(image.dataset.fallbackQuery || "").trim();
  if (!query) return false;
  image.addEventListener("error", () => {
    if (!ownsGeneration() || !image.isConnected) return;
    const figure = image.closest("figure");
    if (!figure) return;
    const section = document.createElement("section");
    section.className = "activity-map-section";
    section.setAttribute("aria-label", "Venue map");
    const host = document.createElement("div");
    host.className = "activity-map";
    host.id = "activity-map";
    host.dataset.mapsQuery = query;
    const status = document.createElement("p");
    status.className = "muted small";
    status.setAttribute("role", "status");
    status.textContent = "Loading map…";
    host.appendChild(status);
    section.appendChild(host);
    figure.replaceWith(section);
    void mountMap(host, { ownsGeneration });
  }, { once: true });
  return true;
}
```

This DOM-only construction keeps the query out of an HTML string and follows the existing DOM-safe popup pattern.

After Activity HTML commits, register this handler on `[data-venue-image]` in parallel with the existing `#activity-map` mounting logic. Route-generation ownership must gate both replacement and mount.

- [ ] **Step 6: Add responsive guide styles**

Append near `.activity-map-section`:

```css
.venue-guide { margin: 16px 0 0; }
.venue-guide-image {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  background: #fff;
}
.venue-guide figcaption {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}
```

- [ ] **Step 7: Add live image-fallback and route-safety tests**

In `app/live-auth-smoke.mjs`, create a connected fake image whose `addEventListener("error", handler)` captures the handler, a fake figure with `replaceWith`, and an injected `loadModule` returning a fake successful `mountActivityMap`. Assert:

- no replacement before `error`;
- one replacement/mount after `error` while generation is owned;
- no replacement after ownership changes;
- the fallback host receives the exact `data-fallback-query` value.

- [ ] **Step 8: Run both smoke suites and diff check**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: all exit 0.

- [ ] **Step 9: Commit Task 3**

```bash
git add app/js/views.js app/js/map.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(venue): show WNT guides and exact Tamar map"
```

---

### Task 4: Interactive Admin Tamar Meeting-Point Picker

**Files:**
- Modify: `app/js/map.js`
- Modify: `app/js/views.js:2013-2052`
- Modify: `app/js/app.js:259-382,1059-1079`
- Modify: `app/styles.css:1456-1480`
- Modify: `app/live-auth-smoke.mjs` near the weekly venue submit tests around line 2210

**Interfaces:**
- Produces: `mountVenuePicker(host, {initialPoint,onChange,ownsGeneration,loadLeaflet}): Promise<{destroy():void}|false>`
- Produces: `syncWeekVenuePicker(form, options): Promise<boolean>` exported from `app.js`
- Consumes: `normalizeVenueLocation()`, `normalizeMeetingPoint()`, and `TAMAR_DEFAULT_MEETING_POINT`

- [ ] **Step 1: Add failing picker interaction tests**

Create a fake Leaflet implementation in `app/live-auth-smoke.mjs` that records:

- `map.setView()` arguments;
- the map `click` callback;
- marker `dragend` callback;
- marker `setLatLng()` calls;
- `map.remove()` calls.

Call `mountVenuePicker()` with the approved default, then assert:

```js
assert.deepEqual(setViewArgs, [[22.2816182, 114.1655613], 17]);
mapClick({ latlng: { lat: 22.2825, lng: 114.1659 } });
assert.deepEqual(changes.at(-1), { lat: 22.2825, lng: 114.1659 });
markerPoint = { lat: 22.2827, lng: 114.1661 };
markerDragEnd();
assert.deepEqual(changes.at(-1), { lat: 22.2827, lng: 114.1661 });
controller.destroy();
assert.equal(removeCalls, 1);
```

Add a form-sync test with a fake WNT venue form. Assert Tamar reveals the shell and seeds hidden values; changing location to `Island ECC 9/F` hides the shell, clears both hidden fields, and destroys the picker.

- [ ] **Step 2: Run live smoke and verify RED**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because `mountVenuePicker` is not exported.

- [ ] **Step 3: Implement the reusable Leaflet picker**

In `map.js`, reuse `defaultLoadLeaflet`, tile attribution, route checks, and coordinate validation:

```js
export async function mountVenuePicker(host, options = {}) {
  const {
    initialPoint, onChange = () => {}, ownsGeneration = () => true,
    loadLeaflet = defaultLoadLeaflet,
  } = options;
  const point = normalizeMeetingPoint(initialPoint?.lat, initialPoint?.lng);
  if (!host || !point || !ownsGeneration() || !host.isConnected) return false;
  try {
    await loadLeaflet({ timeoutMs: options.timeoutMs || LEAFLET_TIMEOUT_MS });
    if (!ownsGeneration() || !host.isConnected) return false;
    host.innerHTML = "";
    const leafletMap = globalThis.L.map(host, { scrollWheelZoom: false });
    leafletMap.setView([point.lat, point.lng], 17);
    addOsmTiles(leafletMap);
    const marker = globalThis.L.marker([point.lat, point.lng], { draggable: true }).addTo(leafletMap);
    const update = (candidate) => {
      const next = normalizeMeetingPoint(candidate?.lat, candidate?.lng);
      if (!next || !ownsGeneration() || !host.isConnected) return;
      marker.setLatLng([next.lat, next.lng]);
      onChange(next);
    };
    leafletMap.on("click", (event) => update(event.latlng));
    marker.on("dragend", () => update(marker.getLatLng()));
    return { destroy() { leafletMap.remove(); } };
  } catch (_err) {
    if (ownsGeneration() && host.isConnected) renderFallback(host);
    return false;
  }
}
```

Extract `addOsmTiles(map)` from the Activity map implementation so attribution stays identical.

- [ ] **Step 4: Render WNT picker shells and hidden fields**

In `adminFreeEventVenues()`, only WNT cards receive this block inside the form after `.field-row`:

```js
const point = normalizeMeetingPoint(override.meetingLat, override.meetingLng);
const isTamar = normalizeVenueLocation(override.location || s.location) === "tamar park";
```

```html
<input type="hidden" name="meetingLat" value="${point?.lat ?? ""}">
<input type="hidden" name="meetingLng" value="${point?.lng ?? ""}">
<div class="venue-picker-shell ${isTamar ? "" : "hidden"}" data-venue-picker-shell>
  <p class="kicker dim">Meeting point · Only this session</p>
  <div class="venue-picker" data-venue-picker data-session="${safeId}">
    <p class="muted small" role="status">Loading map…</p>
  </div>
</div>
```

Import resolver helpers in `views.js`. Run location/map values through existing `esc()` and numeric normalization before interpolation.

- [ ] **Step 5: Synchronize picker visibility and lifecycle in `app.js`**

Import resolver helpers. Add:

```js
const venuePickerControllers = new WeakMap();

export async function syncWeekVenuePicker(form, options = {}) {
  const ownsGeneration = options.ownsGeneration || (() => true);
  if (!(form instanceof HTMLFormElement) || !String(form.dataset.session || "").startsWith("wnt-")) {
    return false;
  }
  const locationField = form.querySelector('[name="location"]');
  const latField = form.querySelector('[name="meetingLat"]');
  const lngField = form.querySelector('[name="meetingLng"]');
  const shell = form.querySelector("[data-venue-picker-shell]");
  const host = form.querySelector("[data-venue-picker]");
  if (!locationField || !latField || !lngField || !shell || !host) return false;
  const isTamar = normalizeVenueLocation(locationField.value) === "tamar park";
  shell.classList.toggle("hidden", !isTamar);
  if (!isTamar) {
    latField.value = "";
    lngField.value = "";
    venuePickerControllers.get(form)?.destroy();
    venuePickerControllers.delete(form);
    return false;
  }
  const initialPoint = normalizeMeetingPoint(latField.value, lngField.value)
    || TAMAR_DEFAULT_MEETING_POINT;
  latField.value = String(initialPoint.lat);
  lngField.value = String(initialPoint.lng);
  if (venuePickerControllers.has(form)) return true;
  const { mountVenuePicker } = await (options.loadModule || loadActivityMapModule)();
  const controller = await mountVenuePicker(host, {
    initialPoint,
    ownsGeneration,
    onChange(point) {
      latField.value = String(point.lat);
      lngField.value = String(point.lng);
    },
  });
  const stillTamar = normalizeVenueLocation(locationField.value) === "tamar park";
  if (!controller || !ownsGeneration() || !stillTamar) {
    controller?.destroy();
    return false;
  }
  venuePickerControllers.set(form, controller);
  return true;
}
```

After committing an Admin Activities render, call it for every `form[data-action="form-week-venue"]` with WNT session ID. In the existing document `input` listener, when `[name="location"]` belongs to such a form, call it again without rerendering the page.

- [ ] **Step 6: Submit and reset coordinates**

In `form-week-venue`:

```js
const meetingLat = fd.get("meetingLat");
const meetingLng = fd.get("meetingLng");
await store.setWeekVenue(form.dataset.session, {
  location, mapsQuery, meetingLat, meetingLng,
});
```

In `reset-week-venue`, pass `meetingLat: null, meetingLng: null` explicitly.

- [ ] **Step 7: Style the picker**

```css
.venue-picker-shell { margin-top: 14px; }
.venue-picker {
  height: 240px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--surface-2);
}
.venue-picker:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Use the existing palette token names actually defined in `styles.css`; do not add duplicate primitive colors.

- [ ] **Step 8: Extend delegated submit tests**

Update the existing `weeklyVenueForm.fields` fixture to include selected coordinate strings. In this task, assert picker synchronization preserves those hidden strings for WNT, while `store.getSession(swimmingSession.id)` does not gain coordinates because Swimming is not WNT. Task 6 adds the six-argument RPC assertion after the live client understands the new fields.

- [ ] **Step 9: Run both smoke suites and diff check**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: all exit 0.

- [ ] **Step 10: Commit Task 4**

```bash
git add app/js/map.js app/js/views.js app/js/app.js app/styles.css app/live-auth-smoke.mjs
git commit -m "feat(admin): add dated Tamar meeting-point picker"
```

---

### Task 5: Supabase Meeting-Point Migration and Integration Contract

**Files:**
- Create: `supabase/migrations/20260825000001_wnt_meeting_points.sql`
- Modify: `supabase/tests/operational_backend_integration.sql:90-110,439-825`

**Interfaces:**
- Preserves: `set_session_venue(text,text,text,boolean)`
- Produces: `set_session_venue(text,text,text,boolean,double precision,double precision)`
- Adds row columns: `meeting_lat double precision`, `meeting_lng double precision`

- [ ] **Step 1: Add failing schema/grant/integration assertions**

Before creating the migration, update `operational_backend_integration.sql`:

```sql
select pg_temp.op_assert(
  to_regprocedure('public.set_session_venue(text,text,text,boolean,double precision,double precision)') is not null,
  'six-argument meeting-point RPC exists'
);
select pg_temp.op_assert(
  has_function_privilege(
    'authenticated',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ),
  'authenticated can execute meeting-point RPC'
);
select pg_temp.op_assert(
  not has_function_privilege(
    'anon',
    'public.set_session_venue(text,text,text,boolean,double precision,double precision)',
    'execute'
  ),
  'anon cannot execute meeting-point RPC'
);
```

In the venue block, add a WNT Tamar six-argument save and literal assertions:

```sql
perform public.set_session_venue(
  v_other_session, 'Tamar Park', 'Tamar Park', true,
  22.2825, 114.1659
);
perform pg_temp.op_assert(
  (select meeting_lat = 22.2825 and meeting_lng = 114.1659
     from public.operational_session_venue_overrides
    where session_id = v_other_session),
  'dated WNT meeting point is stored'
);
```

Add these declarations to the venue block, then prove coordinate-only audit behavior:

```sql
v_member_before_point integer;
v_admin_before_point integer;
v_retained_notified_at timestamptz;
```

```sql
select count(*) into v_member_before_point
  from public.notifications
 where kind = 'operational_session_venue_updated'
   and destination = '#/activity/' || v_other_session
   and profile_id in (v_member_a, v_member_b, v_member_c);
select count(*) into v_admin_before_point
  from public.notifications
 where kind = 'operational_session_venue_updated'
   and destination = '#/activity/' || v_other_session
   and profile_id = v_super;

perform public.set_session_venue(
  v_other_session, 'Tamar Park', 'Tamar Park', false,
  22.2827, 114.1661
);
perform pg_temp.op_assert(
  (select count(*) from public.notifications
    where kind = 'operational_session_venue_updated'
      and destination = '#/activity/' || v_other_session
      and profile_id in (v_member_a, v_member_b, v_member_c)) = v_member_before_point,
  'coordinate-only edit does not repeat member fan-out'
);
perform pg_temp.op_assert(
  (select count(*) from public.notifications
    where kind = 'operational_session_venue_updated'
      and destination = '#/activity/' || v_other_session
      and profile_id = v_super) = v_admin_before_point + 1,
  'coordinate-only edit creates one Admin audit notification'
);
```

Add three explicit rejection blocks:

```sql
begin
  perform public.set_session_venue(
    'wnt-2026-09-02', 'Tamar Park', 'Tamar Park', true,
    22.28, null
  );
  raise exception 'partial point should fail';
exception when others then
  if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
end;
begin
  perform public.set_session_venue(
    'wnt-2026-09-02', 'Tamar Park', 'Tamar Park', true,
    91, 114.16
  );
  raise exception 'latitude should fail';
exception when others then
  if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
end;
begin
  perform public.set_session_venue(
    'wnt-2026-09-02', 'Tamar Park', 'Tamar Park', true,
    22.28, -181
  );
  raise exception 'longitude should fail';
exception when others then
  if sqlerrm not like '%Meeting point must include valid latitude and longitude.%' then raise; end if;
end;
```

Prove non-WNT/non-Tamar clearing and old-RPC reset compatibility:

```sql
perform public.set_session_venue(
  'run-2026-09-07', 'Tamar Park', 'Tamar Park', true,
  22.2825, 114.1659
);
perform pg_temp.op_assert(
  (select meeting_lat is null and meeting_lng is null
     from public.operational_session_venue_overrides
    where session_id = 'run-2026-09-07'),
  'non-WNT save clears stale coordinates'
);
perform public.set_session_venue(
  v_session, 'Island ECC 9/F', 'Island ECC', false,
  22.2825, 114.1659
);
perform pg_temp.op_assert(
  (select meeting_lat is null and meeting_lng is null
     from public.operational_session_venue_overrides
    where session_id = v_session),
  'non-Tamar save clears stale coordinates'
);
select member_notified_at into v_retained_notified_at
  from public.operational_session_venue_overrides
 where session_id = v_other_session;
perform public.set_session_venue(v_other_session, null, null, false);
perform pg_temp.op_assert(
  (select meeting_lat is null and meeting_lng is null
      and member_notified_at = v_retained_notified_at
     from public.operational_session_venue_overrides
    where session_id = v_other_session),
  'four-argument reset clears point and retains member dedupe'
);
```

- [ ] **Step 2: Run the disposable verifier and verify RED**

Run:

```bash
ITC_ALLOW_DATABASE_RESET=1 \
ITC_OPERATIONS_TEST_DATABASE_URL="$ITC_OPERATIONS_TEST_DATABASE_URL" \
bash supabase/tests/verify_operational_backend.sh
```

Expected: FAIL because the six-argument function and coordinate columns do not exist. If the environment variable is unavailable, do not substitute a live database; record the verifier as blocked and still run `bash supabase/tests/verify_operational_backend_safety.sh`.

- [ ] **Step 3: Add columns and constraints**

Create `20260825000001_wnt_meeting_points.sql` beginning with:

```sql
alter table public.operational_session_venue_overrides
  add column meeting_lat double precision,
  add column meeting_lng double precision;

alter table public.operational_session_venue_overrides
  add constraint operational_session_venue_overrides_meeting_pair_check
    check ((meeting_lat is null) = (meeting_lng is null)),
  add constraint operational_session_venue_overrides_meeting_lat_check
    check (meeting_lat is null or meeting_lat between -90 and 90),
  add constraint operational_session_venue_overrides_meeting_lng_check
    check (meeting_lng is null or meeting_lng between -180 and 180);
```

The migration is forward-only; do not edit `20260813000001_free_event_venue_overrides.sql`.

- [ ] **Step 4: Create the six-argument implementation**

Copy the existing four-argument function body from `20260813000001_free_event_venue_overrides.sql` into this migration as the six-argument overload and make these exact changes:

```sql
create or replace function public.set_session_venue(
  p_session_id text,
  p_location text,
  p_maps_query text,
  p_was_tbc boolean,
  p_meeting_lat double precision,
  p_meeting_lng double precision
)
returns public.operational_session_venue_overrides
```

Add declarations:

```sql
v_meeting_lat double precision;
v_meeting_lng double precision;
v_normalized_location text;
v_is_wnt_tamar boolean := false;
```

After trimming location/query and deriving `v_activity_id`:

```sql
v_normalized_location := regexp_replace(
  lower(coalesce(v_location, '')), '\s+', ' ', 'g'
);
v_normalized_location := regexp_replace(
  v_normalized_location, '\s*,\s*', ', ', 'g'
);
v_is_wnt_tamar := v_activity_id = 'wnt'
  and v_normalized_location in ('tamar park', 'tamar park, admiralty');

if v_is_wnt_tamar then
  if (p_meeting_lat is null) <> (p_meeting_lng is null)
     or (p_meeting_lat is not null and (
       p_meeting_lat not between -90 and 90
       or p_meeting_lng not between -180 and 180
     )) then
    raise exception 'Meeting point must include valid latitude and longitude.'
      using errcode = '22023';
  end if;
  v_meeting_lat := p_meeting_lat;
  v_meeting_lng := p_meeting_lng;
else
  v_meeting_lat := null;
  v_meeting_lng := null;
end if;
```

Extend the first blank-reset condition, `v_changed`, INSERT columns/values, and conflict update:

```sql
if v_existing.session_id is null
   and v_location is null and v_maps_query is null
   and v_meeting_lat is null and v_meeting_lng is null then
  return v_existing;
end if;

v_changed := (v_existing.location is distinct from v_location)
  or (v_existing.maps_query is distinct from v_maps_query)
  or (v_existing.meeting_lat is distinct from v_meeting_lat)
  or (v_existing.meeting_lng is distinct from v_meeting_lng);
```

```sql
insert into public.operational_session_venue_overrides
  (session_id, activity_id, location, maps_query, meeting_lat, meeting_lng,
   set_by, set_at, member_notified_at)
values
  (v_session_id, v_activity_id, v_location, v_maps_query,
   v_meeting_lat, v_meeting_lng, v_actor, now(), v_existing.member_notified_at)
on conflict (session_id) do update
  set location = excluded.location,
      maps_query = excluded.maps_query,
      meeting_lat = excluded.meeting_lat,
      meeting_lng = excluded.meeting_lng,
      set_by = excluded.set_by,
      set_at = excluded.set_at,
      member_notified_at = excluded.member_notified_at
returning * into v_saved;
```

Leave the existing member-confirmation condition unchanged. Because `v_changed` now includes coordinates, a coordinate-only edit reaches the existing Admin audit insert exactly once.

- [ ] **Step 5: Replace the four-argument body with a compatibility wrapper**

After the six-argument function:

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

revoke execute on function public.set_session_venue(
  text, text, text, boolean, double precision, double precision
) from public, anon;
grant execute on function public.set_session_venue(
  text, text, text, boolean, double precision, double precision
) to authenticated;

revoke execute on function public.set_session_venue(
  text, text, text, boolean
) from public, anon;
grant execute on function public.set_session_venue(
  text, text, text, boolean
) to authenticated;

notify pgrst, 'reload schema';
```

`create or replace` keeps the existing four-argument identity while replacing its body; both wrappers still enforce Admin access through the six-argument implementation.

- [ ] **Step 6: Run SQL and JS verification**

```bash
ITC_ALLOW_DATABASE_RESET=1 \
ITC_OPERATIONS_TEST_DATABASE_URL="$ITC_OPERATIONS_TEST_DATABASE_URL" \
bash supabase/tests/verify_operational_backend.sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: all available commands exit 0. Never point the destructive verifier at the shared project.

- [ ] **Step 7: Commit Task 5**

```bash
git add supabase/migrations/20260825000001_wnt_meeting_points.sql \
  supabase/tests/operational_backend_integration.sql
git commit -m "feat(db): persist dated WNT meeting points"
```

---

### Task 6: Live Hydration, Six-Argument Save, and End-to-End Verification

**Files:**
- Modify: `app/js/operations.js:197-207,592-605`
- Modify: `app/js/store.js:1205-1228,1544-1568` if Task 2 deferred live arguments
- Modify: `app/js/app.js:1059-1079`
- Modify: `app/live-auth-smoke.mjs` mock rows/RPC handler and weekly venue tests around line 2210

**Interfaces:**
- Changes: `buildVenueOverrideRow(row)` returns `meetingLat`/`meetingLng`
- Changes: `liveSetWeekVenue(sessionId, {location,mapsQuery,wasTBC,meetingLat,meetingLng})`
- Sends RPC keys: `p_meeting_lat`, `p_meeting_lng`

- [ ] **Step 1: Add failing live hydration and mutation tests**

Extend the fake Supabase venue row with:

```js
meeting_lat: 22.2825,
meeting_lng: 114.1659,
```

After hydration, assert:

```js
const hydratedWnt = store.getSession("wnt-2026-08-26");
assert.equal(hydratedWnt.meetingLat, 22.2825);
assert.equal(hydratedWnt.meetingLng, 114.1659);
```

Change the WNT weekly submit fixture to fields:

```js
{
  location: "Tamar Park",
  mapsQuery: "Tamar Park",
  meetingLat: "22.2827",
  meetingLng: "114.1661",
}
```

Assert literal RPC arguments:

```js
assert.deepEqual({
  p_session_id: weeklyVenueCall.args.p_session_id,
  p_location: weeklyVenueCall.args.p_location,
  p_maps_query: weeklyVenueCall.args.p_maps_query,
  p_meeting_lat: weeklyVenueCall.args.p_meeting_lat,
  p_meeting_lng: weeklyVenueCall.args.p_meeting_lng,
}, {
  p_session_id: wntSession.id,
  p_location: "Tamar Park",
  p_maps_query: "Tamar Park",
  p_meeting_lat: 22.2827,
  p_meeting_lng: 114.1661,
});
```

Assert immediate `store.getSession(wntSession.id)` decoration. Add a failed six-argument RPC case and assert hidden fields retain both selected strings after controls re-enable.

- [ ] **Step 2: Run live smoke and verify RED**

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because hydration omits coordinates or RPC args are absent.

- [ ] **Step 3: Map live override rows safely**

Import `normalizeMeetingPoint` into `operations.js`. In `buildVenueOverrideRow`:

```js
const point = normalizeMeetingPoint(row.meeting_lat, row.meeting_lng);
return {
  sessionId: row.session_id,
  activityId: row.activity_id,
  location: row.location || null,
  mapsQuery: row.maps_query || null,
  meetingLat: point?.lat ?? null,
  meetingLng: point?.lng ?? null,
  setBy: row.set_by || null,
  setAt: row.set_at ? Date.parse(row.set_at) : null,
  memberNotifiedAt: row.member_notified_at ? Date.parse(row.member_notified_at) : null,
};
```

This intentionally tolerates old/null rows and refuses malformed coordinate pairs.

- [ ] **Step 4: Call the six-argument RPC**

Change `liveSetWeekVenue`:

```js
export async function liveSetWeekVenue(sessionId, {
  location, mapsQuery, wasTBC, meetingLat = null, meetingLng = null,
}) {
  const point = normalizeMeetingPoint(meetingLat, meetingLng);
  return runOperationalRpc("set_session_venue", {
    p_session_id: sessionId,
    p_location: String(location || "").trim() || null,
    p_maps_query: String(mapsQuery || "").trim() || null,
    p_was_tbc: !!wasTBC,
    p_meeting_lat: point?.lat ?? null,
    p_meeting_lng: point?.lng ?? null,
  }, { /* retain current applyResult unchanged */ });
}
```

Ensure Task 2’s live call and Task 4’s form submit pass the normalized pair. Reset passes both nulls.

- [ ] **Step 5: Update the fake RPC response completely**

The live smoke fake for `set_session_venue` must return the complete real row shape, including `meeting_lat`, `meeting_lng`, `set_by`, `set_at`, and `member_notified_at`. It must store the row in its fake venue table so the post-RPC forced refresh returns the same pair; do not only make `applyResult` pass while hydration remains wrong.

- [ ] **Step 6: Run all automated verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
git status --short
```

If disposable DB credentials are available, also run:

```bash
ITC_ALLOW_DATABASE_RESET=1 \
ITC_OPERATIONS_TEST_DATABASE_URL="$ITC_OPERATIONS_TEST_DATABASE_URL" \
bash supabase/tests/verify_operational_backend.sh
```

Expected: all available commands exit 0; only intended Task 6 files are modified before commit.

- [ ] **Step 7: Commit Task 6**

```bash
git add app/js/operations.js app/js/store.js app/js/app.js app/live-auth-smoke.mjs
git commit -m "feat(operations): sync dated WNT meeting points"
```

- [ ] **Step 8: Perform branch-level review**

Review from the design commit through Task 6:

```bash
git diff 5bdc125..HEAD --stat
git diff 5bdc125..HEAD --check
git log --format='%h %an <%ae> %s' 5bdc125..HEAD
```

Verify:

- exactly one venue visual renders on Activity Details;
- ECC selection uses `location`, not `mapsQuery`;
- Tamar exact coordinates bypass Nominatim;
- run/water/HYROX never receive specialized WNT presentation or stored points;
- reset clears points;
- old and new RPC signatures remain granted only as designed;
- no Shop files, dependencies, build steps, or state-version changes entered the diff.

- [ ] **Step 9: Apply migration and manually verify preview in deployment order**

Use the Supabase SQL workflow already documented for this project to apply only `20260825000001_wnt_meeting_points.sql`, confirm both overloads through `to_regprocedure`, and confirm PostgREST reload completed. Then push `feature/location-map` and wait for the Vercel preview to serve the new `venue.js` and image assets.

Manual cases:

1. Set one dated WNT to `Island ECC 11/F` / `Island ECC`; confirm Schedule text and 11/F Activity guide.
2. Set one dated WNT to `Island ECC 9/F` / `Island ECC`; confirm Schedule text and 9/F Activity guide.
3. Set one dated WNT to `Tamar Park`, move the marker, save, and confirm the card’s Current venue rerenders.
4. Open Activity Details as visitor/member; confirm the exact selected point and exact-coordinate Get directions URL.
5. Reset that WNT and confirm another week remains unchanged.
6. Enter an unknown free venue and confirm the existing geocoded map.
7. Force an ECC image error and Leaflet failure separately; confirm no broken image and preserved Get directions.

Record any unavailable live credential/manual step explicitly rather than claiming it passed.
