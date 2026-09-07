# Free-Event Venue Overrides, Inline Map, and HYROX Directions Design

**Date:** 2026-08-13
**Status:** Approved

## Goal

Let an Admin set the venue for an individual upcoming free-event session, show that venue on every relevant client, notify members and other Admins when a TBC venue is first confirmed, and render an inline map on the free-event activity page. Also expose the existing Google Maps directions action for HYROX sessions.

The feature remains a prototype affordance: it does not add real outbound email, push notifications, or a production mapping backend.

## Scope

This design covers:

- Per-week `location` and `mapsQuery` overrides for free activities (`wnt`, `run`, and `water`).
- Shared live-mode venue overrides and in-app notification fan-out through Supabase.
- Device-local fallback behavior through the existing `state.sessionOverrides` seam.
- A lazy-loaded Leaflet map on free-event activity detail pages.
- Nominatim geocoding with a browser-local cache.
- A directions link for every session that has a `mapsQuery`, including paid HYROX sessions.

It does not allow per-week HYROX venue edits. HYROX continues to use its fixed activity-template venue.

## Architecture

The feature has four bounded pieces:

1. **Per-week venue data.** A session ID already includes its occurrence date, such as `wnt-2026-08-13`, so it is the stable key for one weekly override. Local mode stores the new fields in `state.sessionOverrides[sessionId]`. Live mode stores them in a new Supabase table and hydrates an in-memory override map before rendering venue-dependent routes.
2. **Admin venue controls.** `#/admin/ops` gains a separate upcoming-free-events section. Each session row can save or reset its display location and geocoding query.
3. **Map presentation.** `app/js/map.js` owns Leaflet loading, Nominatim lookup/cache, map mounting, and graceful fallback. Views only render the map host and data needed to mount it.
4. **Notifications.** A trusted Supabase RPC atomically changes the live override and creates in-app notifications. Local mode mirrors the same transition and deduplication rules in `store.setWeekVenue`.

The initial client-only proposal is superseded by the approved notification requirement: members on other devices must see both the updated venue and its notification, so live mode requires a small Supabase migration. There are no changes to the activity-template schema or payment data.

## Session Override Model

### Local mode

Extend the existing per-session object without changing or deleting any existing keys:

```js
state.sessionOverrides[s.id] = {
  // Existing fields
  time?: string,
  notice?: string,
  venueTBC?: boolean,
  midtownOpen?: boolean,
  gymConfirmedAt?: number,
  gymNote?: string,
  cancelled?: string,

  // New fields
  location?: string,
  mapsQuery?: string,
  venueMemberNotifiedAt?: number,
};
```

`location` is member-facing display text. `mapsQuery` is the stable, geocodable address used for both the external directions URL and the inline map.

`decorateSession(s)` merges non-empty override values onto the generated session after applying existing fields:

```js
if (o.location) out.location = o.location;
if (o.mapsQuery) out.mapsQuery = o.mapsQuery;
```

Saving a real location clears `venueTBC` for that occurrence. Reset removes `location` and `mapsQuery` from the override and restores the activity-template values; it does not delete `venueMemberNotifiedAt`, because member notification is deduplicated for the lifetime of that session ID.

These are additive keys in an already-normalized object, so no local-state version bump is needed. Existing persisted snapshots remain valid.

### Live mode

Add `public.operational_session_venue_overrides`:

```text
session_id                 text primary key
activity_id                text not null
location                   text
maps_query                 text
set_by                     uuid references public.profiles(id)
set_at                     timestamptz
member_notified_at         timestamptz
```

Rows are retained when an override is reset so `member_notified_at` survives and prevents repeat member fan-out. A reset sets `location` and `maps_query` to `null`, records the resetting actor and time in `set_by` and `set_at`, and preserves the deduplication timestamp.

RLS and grants are:

- Anonymous and authenticated clients may select overrides, because free-event details are public.
- Clients cannot directly insert, update, or delete overrides.
- Authenticated Admins and Super Admins mutate them only through `public.set_session_venue(...)`.

The RPC accepts a dated `session_id`, `location`, `maps_query`, and whether the previously decorated session was TBC. It derives and validates `activity_id` from the dated ID and accepts only `wnt`, `run`, or `water`. A HYROX ID fails with `Activity venue is fixed.` The function checks the caller’s current profile role instead of trusting client-supplied identity.

In live mode, `store.syncSessionVenueOverrides()` fetches the shared rows into memory before Home, Schedule, Activity, and Admin Ops render. A short cache avoids a request on every same-route render. A successful save updates the in-memory map immediately. A failed refresh retains the last in-memory result and lets the page render rather than replacing public content with an error.

## Admin Operations UI

`#/admin/ops` retains its existing payment and HYROX controls and adds a separate **Free-event venues** section. It lists non-past free sessions from the next 21 days. Paid sessions never render this form.

Each row displays the activity name, date, time, current decorated venue, and this form:

```html
<form class="mt8" data-action="form-week-venue" data-session="${s.id}">
  <div class="field-row">
    <div class="field">
      <label>Display location</label>
      <input
        name="location"
        value="${esc(override.location || '')}"
        placeholder="e.g. Central Harbourfront — 7pm sharp">
    </div>
    <div class="field">
      <label>Geocode query (for map)</label>
      <input
        name="mapsQuery"
        value="${esc(override.mapsQuery || '')}"
        placeholder="e.g. Central Harbourfront, Hong Kong">
    </div>
  </div>
  <div class="btn-row">
    <button class="btn ghost sm" type="submit">Save venue for this week</button>
    <button class="btn ghost sm" type="button"
      data-action="reset-week-venue" data-session="${s.id}">Reset</button>
  </div>
</form>
```

The labels intentionally separate polished display copy from a machine-geocodable query. Inputs are trimmed. Blank values mean no override for that field and fall back to the activity template. The dedicated Reset action clears both fields.

The delegated submit handler is asynchronous because live mode calls the RPC. It disables the active control while saving, calls `store.setWeekVenue(sessionId, { location, mapsQuery })`, shows a success or error toast, and rerenders only after success. Reset asks the same store action to clear both values.

## Venue Save and Notification Flow

### Successful save

1. The client reads the currently decorated session to determine whether its venue is TBC or has no usable `mapsQuery`.
2. Local mode validates that the actor is an Admin, updates `state.sessionOverrides`, creates eligible local notifications, and saves once.
3. Live mode calls `set_session_venue`. The security-definer RPC validates the actor and free-activity session ID, locks/upserts the override row, updates its audit fields, and performs notification fan-out in the same transaction.
4. The store updates its in-memory live override map.
5. Admin Ops rerenders and confirms the saved venue.

The save is not blocked on Nominatim. Geocoding happens only when a browser opens the activity page, so a geocode failure cannot roll back the venue or retract notifications already created by the trusted save.

### Notification kind and audience

Use the new kind `operational_session_venue_updated`, categorized as a **Club update** in the notification inbox. Notification destinations point to `#/activity/{sessionId}`.

Notification behavior is intentionally asymmetric:

- **Approved members:** Notify once per member and session, only on the first TBC/empty → real venue transition. The retained `member_notified_at` prevents another member fan-out if an Admin edits, resets, and reconfirms that occurrence.
- **Other Admins and Super Admins:** Notify on every actual save or reset for audit visibility. Exclude the acting Admin, who receives immediate form feedback instead. A no-op save does not create audit notifications.
- **Paid HYROX bookers:** No new venue notification in this scope because paid per-week venue editing is prohibited. HYROX only gains its previously hidden directions action.

Member copy:

- Title: `Venue confirmed`
- Body: `{session name} on {date} is at {location}. Check the activity page for details.`

Admin copy:

- Title: `Session venue updated`
- Body: `{actor} set the venue for {session ID} to {location}.`
- Reset body: `{actor} reset the venue for {session ID} to the activity default.`

In local mode, fan-out targets approved local member profiles and other approved Admin/Super Admin profiles. In live mode, the RPC inserts into `public.notifications` from `public.profiles`. Admin recipients receive only the audit notification, avoiding a duplicate member notification for the same event.

## Activity Detail and Directions

`viewActivity(sessionId)` keeps the existing free-event rule: no booking, capacity, or checkout UI.

When `s.kind === "free" && s.mapsQuery` is true, render this section immediately above the Add to Calendar/Get directions row:

```html
<section class="activity-map-section" aria-label="Venue map">
  <div
    class="activity-map"
    id="activity-map"
    data-maps-query="..."
    data-marker-label="...">
    <p class="muted small" role="status">Loading map…</p>
  </div>
</section>
```

Only escaped text enters the template. The marker label combines the session name, date, and formatted time.

The action row is no longer responsible for deciding whether paid sessions may have directions. A Get directions link renders for **any** non-cancelled, non-past session with a non-empty `mapsQuery`:

```js
const directions = s.mapsQuery
  ? `<a class="btn ghost" href="${mapsHref(s)}" target="_blank" rel="noopener">Get directions</a>`
  : "";
```

For free events it remains beside Add to Calendar. For paid HYROX it appears alongside the applicable booking/manage/gate action without changing booking eligibility. Existing HYROX template queries—`BFT Causeway Bay, Hong Kong` and `Midtown 28, Hong Kong`—therefore work without data changes.

Cancelled and past-session presentation remains authoritative; those states do not mount a map or promote directions actions.

## Map Module

Create `app/js/map.js` with one public mounting function. It depends only on browser APIs and the map host element; it does not import store or view code.

After route HTML is committed, `app.js` calls the mounting function when the current Activity route contains `#activity-map`. The route-generation check prevents an old geocode response from modifying a newer route. Replacing route HTML naturally discards the old host and Leaflet instance.

### Leaflet loading

Leaflet loads lazily on the first eligible activity page and is reused for the browser session.

Pinned assets:

- CSS: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css`
- CSS integrity: `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`
- JS: `https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`
- JS integrity: `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`
- Both tags use `crossorigin="anonymous"`.

The loader memoizes its promise. Script error or a five-second timeout rejects the load. A rejection is remembered for the current page session so rerenders do not repeatedly contact the blocked CDN.

### Geocoding and cache

Nominatim request:

```text
https://nominatim.openstreetmap.org/search?format=json&limit=1&q={encoded mapsQuery}
```

Results are cached in `localStorage` under `itc.geocode.v1` as a JSON object keyed by the exact trimmed query. Each successful entry contains finite numeric `lat` and `lon` values. Stable venue results do not expire.

The module:

- Uses a cached result before making a request.
- Deduplicates concurrent requests for the same query.
- Makes at most one active Nominatim request at a time.
- Treats invalid cache JSON, malformed coordinates, an empty result, non-2xx responses, timeout, and network errors as lookup failures.
- Never writes geocoding data into the main prototype state.

Nominatim receives the venue query and browser IP. This is comparable to opening the existing Google Maps directions link. The cache is device-local and contains venue coordinates only.

### Map rendering

On success, initialize Leaflet on the host, center on the result at a neighborhood-level zoom, and add:

- One marker at the geocoded coordinates.
- A popup containing escaped session name/date/time text.
- OpenStreetMap standard tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- The required `© OpenStreetMap contributors` attribution link.

The map has a fixed responsive height, rounded card border, visible keyboard focus, and enough contrast in both marker popup and fallback copy. Leaflet’s built-in pan and zoom controls remain available.

## Failure Handling

### Leaflet or geocoding failure

Replace the loading placeholder with:

> Couldn’t find the venue on the map — tap Get directions instead.

The external Get directions action remains rendered below the section. Do not leave an indefinite loading state or expose raw network errors to the user.

### Storage failure

If geocode-cache parsing or writing fails, continue without the cache. A storage quota/private-mode error must not prevent map display.

### Admin save failure

Keep the entered form values visible, re-enable controls, and show the server/store error. Do not rerender a failed mutation. The RPC transaction guarantees that override and notifications either both commit or neither commits.

### Invalid or stale query

The prototype does not promise address validation. A saved query that Nominatim cannot resolve still powers the external Google Maps search link and shows the inline fallback. A stale cached result is an accepted prototype limitation; clearing `itc.geocode.v1` forces a new lookup.

### Unauthorized or paid-session mutation

Local mode enforces the existing Admin actor guard. Live mode independently enforces role and session-prefix checks in the RPC. HYROX returns `Activity venue is fixed.` even if a caller bypasses the hidden UI.

## Testing

### Local JS smoke: `app/smoke.mjs`

Add coverage proving:

- `store.setWeekVenue(sessionId, { location, mapsQuery })` writes the dated override.
- `store.getSession(id)` applies `location` and `mapsQuery` through `decorateSession`.
- Reset restores template values but retains the member-notification dedup marker.
- A non-Admin cannot set a weekly venue.
- First TBC → set creates one notification for each approved member and one audit notification for each other Admin.
- Repeated edits, reset, and reconfirmation do not fan out to members again; actual edits still notify other Admins and no-op saves do not.
- `viewActivity` renders the map host only for a free session with `mapsQuery`.
- Free sessions without `mapsQuery`, paid HYROX sessions, past sessions, and cancelled sessions do not render the inline map.
- Both HYROX activity pages render Get directions.
- `viewAdmin("ops")` renders weekly venue forms for upcoming free sessions and not paid sessions.
- Existing free-event no-booking and paid HYROX booking contracts remain intact.

The map module’s pure cache parsing and geocode-result normalization helpers should be exported for smoke coverage without requiring Leaflet or a real network request.

### Live JS smoke: `app/live-auth-smoke.mjs`

Extend the Supabase mock to cover:

- Hydrating shared live overrides before venue-dependent views.
- Calling `set_session_venue` with the session ID and trimmed fields.
- Updating the in-memory override after a successful RPC.
- Preserving the form and surfacing feedback on RPC failure.
- Categorizing `operational_session_venue_updated` under Club updates and linking it to the activity route.
- Route-generation safety when map setup resolves after navigation.

### Supabase integration

Add the migration to the disposable verifier migration chain and add integration assertions for:

- Public select access to venue overrides.
- Direct client insert/update/delete denial.
- Admin and Super Admin RPC success.
- Ordinary member and anonymous RPC denial.
- HYROX rejection with `Activity venue is fixed.`
- Atomic override upsert and notification creation.
- One member fan-out for the first TBC → set transition only.
- Admin audit fan-out on later actual edits and reset, excluding the actor.
- No notifications for a no-op save.
- Reset preserving `member_notified_at`.
- Venue overrides remaining independent of session cancellation state.

The repository currently has no `operational_backend_integration.sql`; the implementation may either add a focused venue-override integration file and verifier or extend the existing Admin notification integration/verifier. It must not reference a nonexistent test harness.

### Manual acceptance

1. Clear `localStorage.removeItem("itc.geocode.v1")`.
2. As an Admin, set a dated WNT venue and geocode query in Admin Ops.
3. Open that activity as a visitor and confirm the display location, loading state, map marker, attribution, and external directions link.
4. Open the same activity as an approved member and confirm the venue notification links to it.
5. Confirm another Admin receives the audit notification and the actor does not receive a duplicate bell item.
6. Edit and then reset the venue; verify members are not notified again.
7. Block the Leaflet CDN and Nominatim separately; each failure must settle within the timeout and preserve Get directions.
8. Open both HYROX activity pages and confirm Get directions appears without exposing a weekly venue-edit form.
9. Run `node app/smoke.mjs` and the live/Supabase verification commands selected by the implementation plan.

## Out of Scope

- Per-week paid HYROX venue overrides.
- Notifications to paid HYROX bookers for venue moves.
- Email, SMS, WhatsApp, or web-push delivery.
- A geocoding proxy, paid map provider, API key, or custom map tiles.
- Admin map previews or pre-save address validation.
- Tracking which members intend to attend a free event.
- A service worker or offline map cache.
- Production legal/privacy copy for third-party mapping services.
