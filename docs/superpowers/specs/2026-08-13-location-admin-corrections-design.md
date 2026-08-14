# Location and Admin Corrections Design

**Date:** 2026-08-13
**Status:** Approved

## Goal

Correct the venue, weekly override, map-performance, Swimming-photo, and Admin information-architecture problems found during review of `feature/location-map` without expanding the prototype into a general production activity-management system.

## Confirmed Product Behavior

### Swimming

`ITC Swimming` has a recurring default venue of `TBC`. Its recurring `mapsQuery` is blank, so an unconfirmed future week shows neither an inline map nor a directions action.

An Admin may override one dated Swimming session with separate values such as:

- Display location: `Victoria Park Swimming Pool`
- Google Maps search: `Victoria Park Swimming Pool, Hong Kong`

The override applies only to that session ID. Later Swimming sessions continue to use the recurring TBC default. Resetting the dated override restores TBC for that occurrence.

### Midtown HYROX

The Saturday 11:00 HYROX recurring venue becomes:

- Display location: `Midtown28 Fitness`
- Map query: `Midtown28 Fitness, Hong Kong`

The correction applies to local activity configuration and live operational data. Existing future live Midtown session rows carrying the exact old venue are updated. Exact old booking-snapshot venue strings are migrated where the local state owns those snapshots. Unrelated or independently edited values are preserved.

### Activity photos

Saving an existing activity preserves its current photo instead of assigning the generic `main.webp` image. The known Swimming record corrupted by that behavior is repaired to `../assets/itc/water.webp`. New activities may continue to start with the generic image.

## Root Causes

1. Weekly venue forms use `data-action="form-week-venue"`, while delegated submit routing switches only on `form.id`. The weekly save handler therefore never runs.
2. The activity submit payload always assigns `../assets/itc/main.webp`, replacing the correct image whenever any existing activity is edited.
3. The map module awaits geocoding before beginning the Leaflet asset load, creating two sequential network waits.
4. Live paid sessions derive from Supabase operational templates/session rows, so a local Activity edit cannot change the live Midtown venue.
5. Swimming is seeded with Victoria Park as its recurring venue, which conflicts with the required TBC-each-week workflow.
6. Weekly free-event controls were placed in the payment/HYROX operations area, obscuring the distinction between recurring defaults and dated exceptions.

## Admin Information Architecture

The Admin navigation becomes:

`Approvals · Members · Activities · Giving · HYROX`

`Payments / Ops` is renamed `HYROX`. This tab retains:

- payment duty and payout details;
- pending-payment confirmation;
- HYROX booking and queue operations;
- gym confirmation;
- paid-session weekly controls.

Free-event weekly venue controls move to `Activities`.

The Activities page contains two explicit sections:

1. **Recurring Activity Defaults** — the existing activity list/editor. Copy explains that these settings affect all future weeks unless a dated override exists.
2. **Weekly Venue Overrides** — upcoming free sessions only. Each card displays the activity, date, time, current venue, and recurring default, and is marked **Only this session**.

Each weekly form contains:

- `Display location`
- `Google Maps search`
- `Save Weekly Venue`
- `Reset to Recurring Default`

The wording deliberately avoids “Geocode query” and makes scope visible at the point of action. Paid HYROX sessions never render in the weekly free-event override section.

## Data and Migration Design

### Local state v14

Bump `STATE_VERSION` from 13 to 14 and add an exact-match migration.

The migration:

- changes `water.location` from the known old Swimming defaults (`Victoria Park` or `Victoria Park Swimming Pool`) to `TBC` and clears the corresponding known old map query;
- clears `water.mapsQuery` when it is the form-generated value `TBC`, covering devices where an Admin already changed the display location to TBC;
- repairs the `water` photo from the form-corruption value `../assets/itc/main.webp` to `../assets/itc/water.webp`;
- changes `hyrox-midtown.location` from `Midtown 28` to `Midtown28 Fitness` and its exact old query to `Midtown28 Fitness, Hong Kong`;
- changes exact local booking-snapshot locations from `Midtown 28` to `Midtown28 Fitness`;
- leaves unrelated Admin-edited values untouched.

Fresh seed data uses the corrected Swimming and Midtown values.

Existing `sessionOverrides` remain additive. No override keys are deleted. `venueMemberNotifiedAt` remains intact across reset so notification deduplication behavior is unchanged.

### Live operational data

Add a new forward-only Supabase migration that:

- updates the `hyrox-midtown` operational activity template from the exact old venue to `Midtown28 Fitness`;
- updates all Midtown operational session rows carrying the exact old venue;
- updates exact old Midtown booking snapshot venue values only where the JSON snapshot structure contains that value;
- does not alter free-event override schema or notification history.

Free-event recurring defaults remain client seed data in the current prototype architecture. Dated free-event overrides continue to use `operational_session_venue_overrides` and `set_session_venue(...)` in live mode.

## Submit and Override Flow

Delegated submit routing recognizes both stable unique form IDs and `data-action` for repeated forms. The weekly venue form dispatches through its `data-action`, avoiding duplicate HTML IDs.

On save:

1. Read and trim the display location and maps query.
2. Call `store.setWeekVenue(sessionId, values)`.
3. In local mode, write to `state.sessionOverrides`; in live mode, call the trusted RPC.
4. Rerender only after successful persistence.
5. Preserve entered values and show an error toast on failure.

The decorated dated session remains the source of truth for Schedule and Activity views. The Admin weekly list also uses the decorated session when presenting its current venue, so successful overrides are immediately visible there.

## Map Performance

Keep the inline map and external Google Maps directions action.

When mounting an eligible free-event map:

1. Read the coordinate cache immediately.
2. Begin Leaflet CSS/JS loading and geocoding concurrently.
3. Await both results before creating the Leaflet map.
4. Reuse the existing memoized Leaflet loader and exact-query coordinate cache.
5. Keep the Get directions action rendered and usable throughout loading.

If geocoding or Leaflet fails or times out, show the existing short fallback and retain venue text plus Get directions. Route-generation ownership continues to prevent a stale asynchronous result from mutating a newer page.

No Google API key, service worker, geocoding proxy, or production mapping backend is added.

## Error Handling

- Unauthorized venue mutation continues to fail through local role checks and live RPC authorization.
- Paid-session IDs continue to return `Activity venue is fixed.` from the free-event venue RPC.
- A failed weekly save does not rerender or clear form input.
- Invalid map queries settle to fallback within the existing timeout.
- Storage/cache failures do not block the map attempt or directions link.
- Migrations use exact sentinels so unrelated user data is not overwritten.

## Testing

Follow test-driven development: add each regression assertion and observe its expected failure before changing production code.

### Local smoke coverage

Verify:

- repeated weekly venue forms dispatch through `data-action`;
- a dated Swimming override decorates only the selected session;
- reset restores the recurring TBC default;
- fresh and migrated Swimming activities use TBC and `water.webp`;
- editing Swimming preserves `water.webp`;
- fresh and migrated Midtown activity/session data uses `Midtown28 Fitness` and its precise map query;
- exact old booking snapshots migrate while unrelated values remain unchanged;
- weekly free-event controls render under Activities and not HYROX;
- cards include `Only this session`, recurring-default context, and the revised field/action labels;
- Admin navigation contains `HYROX`, not `Payments / Ops`, with one active tab;
- map loading begins Leaflet and geocoding without awaiting one before starting the other;
- cache, failure fallback, and route-generation behavior remain valid.

### Live and Supabase coverage

Verify:

- the weekly Swimming RPC save persists and hydrates the exact dated override;
- reset restores the TBC client default;
- the new migration updates exact old Midtown templates and future session data;
- unrelated live venue values remain unchanged;
- notification fan-out/deduplication remains unchanged;
- operational integration expectations use the new Midtown venue.

### Required verification

Run:

- `node app/smoke.mjs`
- `node app/live-auth-smoke.mjs`
- the repository's operational Supabase integration verifier documented in `docs/runbooks/live-auth.md`

Manual review covers the Admin tabs at narrow mobile width, weekly Swimming save/reset, both Midtown directions links, Swimming photography, first-load map timing, repeat-load cache behavior, and blocked-network fallback.

## Out of Scope

- General Supabase-backed editing for all recurring free-activity fields.
- Photo upload or media-library management.
- Per-week HYROX venue editing.
- A paid map provider, Google Maps embed API, or API key.
- Email, SMS, WhatsApp, or push notifications.
- A service worker or offline map package.
