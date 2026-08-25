# WNT Venue-Specific Images and Meeting-Point Pins Design

**Date:** 2026-08-25
**Status:** Approved for specification review

## Goal

Make the dated Wednesday Night Training Activity Details page show venue-specific guidance:

- `Island ECC 11/F` shows the supplied 11/F wayfinding image.
- `Island ECC 9/F` shows the supplied 9/F wayfinding image.
- `Tamar Park` shows an interactive map pinned to the meeting point selected by an Admin for that dated session.
- Other free-event locations retain the existing geocoded inline map.

The meeting-point pin belongs only to one dated WNT occurrence. It does not alter later WNT sessions or the recurring activity default.

## Scope

This design covers:

- A pure venue-presentation resolver for the two ECC floors, Tamar Park, and generic locations.
- Repository-managed copies of the supplied ECC wayfinding images.
- Optional per-session meeting-point coordinates in local and Supabase venue overrides.
- An Admin map picker inside the existing Weekly Venue Overrides form.
- Venue-specific presentation on the dated Activity Details page.
- Exact-coordinate Tamar directions and existing geocoded directions for other venues.
- Additive database migration, RPC compatibility, validation, error handling, and regression coverage.

It does not add images to Schedule rows, make meeting points recurring, add a general media manager, or change paid HYROX venue administration.

## Approved User Experience

### Admin — Weekly Venue Overrides

The existing dated form keeps its Display Location and Google Maps Search fields.

When the Display Location resolves to Tamar Park:

1. A compact interactive map appears below the fields.
2. Its label is **Meeting point · Only this session**.
3. A session without saved coordinates starts at the approved Tamar Park place pin:
   - latitude: `22.2816182`
   - longitude: `114.1655613`
4. Clicking the map moves the marker.
5. Dragging the marker moves it.
6. Hidden form fields track the selected latitude and longitude.
7. Save persists the location, map query, and meeting point atomically for that dated session.

Changing the Display Location away from Tamar Park hides the picker and clears the meeting-point coordinates submitted for that override. Reset to Recurring Default clears location, map query, and coordinates together.

The map picker is not shown for ECC or generic venues. ECC presentation is selected automatically from the normalized display location, so Admins do not need a separate image selector.

### Dated Activity Details

The venue area immediately above the existing action row resolves as follows:

| Effective display location | Presentation |
| --- | --- |
| `Island ECC 11/F` | Responsive 11/F wayfinding image with caption **The Well · 11/F Island ECC** |
| `Island ECC 9/F` | Responsive 9/F wayfinding image with caption **Kid’s Club Hall · 9/F Island ECC** |
| Tamar Park alias | Interactive map centred on the dated meeting-point coordinates |
| Any other free venue with a map query | Existing Nominatim-geocoded inline map |
| No usable map query or coordinates | No venue visual; existing location text remains |

The ECC images replace the inline map rather than appearing alongside it. Schedule continues to show the decorated venue text only.

The existing Get directions action remains available:

- Tamar Park uses the exact dated meeting-point coordinates when available.
- Tamar Park without custom coordinates uses the approved default coordinates.
- ECC and generic venues continue to use the effective `mapsQuery`.

## Architecture

The change has four bounded components.

### 1. Pure venue presentation resolver

Create `app/js/venue.js`. It has no DOM, store, Supabase, Leaflet, or network dependency. It exports:

- `TAMAR_DEFAULT_MEETING_POINT`
- `normalizeVenueLocation(location)`
- `normalizeMeetingPoint(lat, lng)`
- `venuePresentationFor(session)`

`venuePresentationFor(session)` returns one of these explicit shapes:

```js
{ kind: "image", src, alt, caption, fallbackQuery }
{ kind: "coordinates", lat, lng, markerLabel }
{ kind: "geocode", query, markerLabel }
{ kind: "none" }
```

This keeps venue matching out of `views.js`, map loading out of the store, and persistence rules out of `map.js`.

### 2. Dated override persistence

Extend the existing dated override with optional coordinates:

```js
state.sessionOverrides[sessionId] = {
  // existing fields
  location,
  mapsQuery,
  venueMemberNotifiedAt,

  // new fields
  meetingLat,
  meetingLng,
};
```

The keys are additive, so localStorage `STATE_VERSION` does not need to change. `decorateFreeSession()` applies a valid coordinate pair from the effective dated override. A partial or invalid pair is ignored.

Live mode adds nullable `meeting_lat` and `meeting_lng` columns to `operational_session_venue_overrides`. Both must be null or both non-null. Database checks enforce latitude from -90 to 90 and longitude from -180 to 180.

### 3. Map module extensions

`app/js/map.js` retains ownership of lazy Leaflet loading. It gains two coordinate-aware operations:

- Display an exact-coordinate venue map without Nominatim.
- Mount an editable Admin venue picker with click and drag callbacks.

The map module receives a host and data/options. It does not import the store or mutate application state. The Admin callback writes coordinates into the form’s hidden inputs; the existing delegated submit handler remains the mutation boundary.

### 4. View and route integration

`views.js` calls the pure resolver and renders exactly one presentation host: image, coordinate map, geocoded map, or none.

After route HTML is committed, `app.js` mounts:

- the Activity Details map host, using coordinates directly or geocoding as resolved;
- any visible Admin Tamar picker hosts.

Existing render-generation ownership prevents stale async map work from modifying a newer route.

## Venue Matching Rules

Matching uses the member-facing `location`, not `mapsQuery`.

Normalization:

- trims leading/trailing whitespace;
- collapses repeated internal whitespace;
- compares case-insensitively;
- normalizes spaces around `/`;
- accepts `9F` as `9/F` and `11F` as `11/F`.

Recognized ECC values remain deliberately narrow:

- `Island ECC 11/F` and normalized formatting variants;
- `Island ECC 9/F` and normalized formatting variants.

Recognized Tamar aliases are:

- `Tamar Park`;
- `Tamar Park, Admiralty`.

Other strings containing words such as `Island`, `ECC`, or `Tamar` do not trigger a specialized presentation accidentally. They use the generic map path when a query exists.

## Image Assets

Copy the supplied files into repository-managed, URL-safe paths:

```text
assets/itc/venues/island-ecc-11.jpg
assets/itc/venues/island-ecc-9.jpg
```

Sources:

```text
/Users/selesli/projects/island-training-club-app/Island ECC 11.jpeg
/Users/selesli/projects/island-training-club-app/Island ECC 9.jpeg
```

The Activity Details image uses a semantic `<figure>` with responsive `<img>`, useful alt text, and a visible caption. It preserves the original image’s aspect ratio rather than cropping the wayfinding content.

If an image fails to load, `app.js` replaces that presentation with the generic geocoded map when `fallbackQuery` is usable. Otherwise it leaves the venue text and Get directions action intact; it never leaves a broken-image icon.

## Admin Picker Data Flow

1. Admin opens Admin → Activities → Weekly Venue Overrides.
2. Existing live hydration decorates each dated free session.
3. A Tamar display location reveals the picker.
4. Existing valid dated coordinates seed the marker; otherwise the approved Tamar default does.
5. Map click or marker drag updates hidden `meetingLat` and `meetingLng` fields.
6. Changing the location input reevaluates whether the picker should be visible.
7. Submit parses and validates the pair and calls:

```js
store.setWeekVenue(sessionId, {
  location,
  mapsQuery,
  meetingLat,
  meetingLng,
});
```

8. Local mode updates `state.sessionOverrides`. Live mode calls the trusted venue RPC.
9. Success updates the live cache and rerenders the Admin card with the persisted location and pin.
10. Activity Details resolves the same decorated session, ensuring Admin and member views use one source of truth.

Coordinates are discarded on save when the effective display location is not Tamar Park. The client does not retain a hidden stale Tamar pin behind an ECC or generic venue.

## Supabase Migration and RPC Compatibility

Add a forward-only migration after `20260813000002_midtown28_fitness.sql`.

The migration:

1. Adds nullable `meeting_lat double precision` and `meeting_lng double precision` columns.
2. Adds paired-null and coordinate-range checks.
3. Extends the venue RPC to validate and store coordinates only for a Tamar display location.
4. Returns the coordinate columns in the override row.
5. Retains existing notification and deduplication behavior.
6. Reloads the PostgREST schema cache.

To avoid breaking an older static client during deployment, preserve a four-argument `set_session_venue` overload that delegates to a six-argument implementation with null coordinates. The new client calls the six-argument overload; the old client continues to call the four-argument overload. Both retain authenticated-only execute grants and the existing trusted Admin assertion.

A changed coordinate pair counts as an actual Admin edit for audit-notification purposes. It does not repeat the one-time member venue-confirmation fan-out after `member_notified_at` has been set.

The live cache row gains:

```js
{
  meetingLat: row.meeting_lat,
  meetingLng: row.meeting_lng,
}
```

## Directions Behavior

For a coordinate presentation, the Get directions URL uses:

```text
https://www.google.com/maps/dir/?api=1&destination={lat},{lng}
```

The destination is the exact dated meeting point. It does not search for the broad Tamar Park place name.

For image and geocode presentations, directions continue to use the existing encoded `mapsQuery` behavior.

## Validation and Failure Handling

### Coordinates

- Client accepts only finite numeric latitude/longitude values in range.
- A missing half of a pair is treated as invalid.
- Supabase repeats paired-null and range validation independently.
- Tamar without valid saved coordinates uses the approved default pin.
- Non-Tamar saves persist null coordinates.

### Save failure

The existing busy-control boundary remains authoritative:

- keep entered location, map query, and selected marker visible;
- re-enable controls;
- show the RPC/store error;
- do not rerender or claim success.

### Map failure

Leaflet load or map-mount failure uses the existing fallback copy and preserves Get directions. Exact coordinates do not require Nominatim, so Tamar meeting-point display remains independent of geocoding availability.

### Image failure

A failed ECC image attempts the existing geocoded map through `fallbackQuery`. If map setup also fails, existing fallback copy and Get directions remain available.

### Reset

Reset clears location, map query, and meeting coordinates together while preserving the existing member-notification deduplication timestamp.

## Testing

Follow test-driven development and observe each regression fail before production edits.

### `app/smoke.mjs`

Prove pure and local behavior:

- venue normalization recognizes both ECC floors and formatting variants;
- unrelated strings do not trigger a specialized presentation;
- each ECC floor resolves to the correct repository asset, caption, and alt text;
- ECC Activity Details renders the image instead of an inline map;
- Tamar without saved coordinates resolves to the approved default;
- Tamar with dated coordinates resolves to that exact pair;
- generic venues retain the geocoded map host;
- non-Tamar saves clear coordinates;
- the session decorator ignores legacy invalid/partial pairs, while `setWeekVenue` rejects an invalid Tamar pair before persistence;
- local dated overrides decorate Schedule and Activity Details consistently;
- reset clears meeting coordinates and restores recurring defaults;
- coordinate directions use the exact `destination=lat,lng` value;
- ECC and generic directions retain map-query behavior;
- the supplied images exist at their committed asset paths.

### `app/live-auth-smoke.mjs`

Prove live client behavior:

- hydration maps `meeting_lat` and `meeting_lng` into the live override cache;
- the Admin picker defaults to the approved Tamar coordinate pair;
- click and drag update the form’s hidden coordinate fields;
- changing away from Tamar clears submitted coordinates;
- delegated weekly venue submit calls the six-argument RPC with the selected pair;
- successful RPC application immediately decorates the dated session;
- failed save keeps the location fields and selected pin;
- Activity Details mounts exact coordinates without a Nominatim request;
- stale route-generation work cannot mount a picker or display map into a newer route;
- ECC image failure takes the generic map fallback path.

### Supabase integration

Extend the operational integration test to prove:

- old four-argument RPC calls remain valid;
- new six-argument Admin and Super Admin calls persist valid coordinates;
- member and anonymous calls remain denied;
- invalid, partial, and out-of-range pairs fail;
- non-Tamar saves persist null coordinates even if stale coordinate arguments are supplied;
- reset clears coordinates while retaining `member_notified_at`;
- a coordinate-only change emits Admin audit fan-out but not repeat member fan-out;
- public venue-override hydration exposes the saved coordinate pair.

### Manual acceptance

1. Deploy the migration and reload PostgREST schema.
2. Save one WNT occurrence as `Island ECC 11/F`; open Activity Details and confirm the 11/F image and caption.
3. Save another as `Island ECC 9/F`; confirm the 9/F image and caption.
4. Save a third as `Tamar Park`; move the Admin marker away from the default and save.
5. Open that dated Activity Details page as a visitor/member and confirm the exact selected marker.
6. Open Get directions and confirm the exact coordinate destination.
7. Confirm Schedule displays the effective venue text for all three sessions.
8. Reset the Tamar occurrence and confirm its custom pin is removed without changing another week.
9. Enter an unknown venue and confirm the existing geocoded map still renders.
10. Block Leaflet, Nominatim, and an ECC image separately and confirm each documented fallback.
11. Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, the Supabase integration verifier, and `git diff --check`.

## Deployment Order

1. Apply and verify the additive Supabase migration.
2. Reload PostgREST schema and verify both RPC signatures.
3. Deploy the static client.
4. Perform the three venue manual-acceptance cases on the preview.

The compatibility overload prevents the currently deployed client from breaking between steps 1 and 3.

## Out of Scope

- Venue-specific imagery on Schedule rows.
- Recurring or cross-session meeting-point pins.
- Admin upload/replacement of ECC images.
- Specialized images for arbitrary future venues.
- Paid HYROX meeting-point overrides.
- Editing OpenStreetMap data or operating a geocoding proxy.
- Real-time collaborative marker movement before Admin save.
