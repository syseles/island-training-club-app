# Location Preview Regressions Design

**Date:** 2026-08-14
**Status:** Approved

## Goal

Fix three regressions observed on the `feature/location-map` Vercel preview:

1. Saving a real weekly free-event venue from Admin Activities appears not to work.
2. A live HYROX activity detail can show the legacy `Midtown 28` venue instead of the value shown under Admin Activities.
3. Both Saturday live HYROX activity details render a broken/missing photo.

The correction must remain compatible with an operational database that still contains exact legacy Midtown rows, while preserving independently administered venue values.

## Root Causes

### Weekly free-event save

The Admin form presents `Display location` and `Google Maps search` as independent fields. The confirmation path considers a dated venue complete only when both effective values are usable. When an Admin supplies a real display location but leaves the map field blank, the save can remain a partial override and appear ineffective.

Static Vercel deployment also does not apply Supabase migrations. A missing or stale `set_session_venue` RPC must therefore surface an honest save/setup error rather than imply that the shared change succeeded.

### Live Midtown mismatch

Paid HYROX sessions are hydrated from Supabase operational rows. `buildSessionRow()` currently trusts `row.venue` verbatim, so a legacy `Midtown 28` row can disagree with the corrected activity data shown elsewhere.

### Missing HYROX photo

`buildSessionRow()` does not assign `photo`. `viewActivity()` always renders `s.photo`, so live paid sessions produce an invalid image URL even though `../assets/itc/hyrox.webp` exists.

## Approved Behavior

### Location-only weekly save

`Display location` remains the primary Admin input.

When saving a weekly venue:

- If `Display location` is nonblank and `Google Maps search` is blank, submit the trimmed display location as both `location` and `mapsQuery`.
- If both values are nonblank, preserve them independently.
- If both are blank, retain the existing reset-to-recurring-default behavior.
- A map-query-only entry remains incomplete because it lacks member-facing display text.

A successful save immediately updates the live override cache and rerenders the dated session with the new display location. It may notify members only under the existing first-confirmation/deduplication rules.

A failed RPC or missing schema/function:

- does not rerender;
- keeps the entered form values in place;
- re-enables controls;
- shows a clear error toast. Raw database error details are not rendered into the page.

The Supabase location migrations remain required for shared cross-device behavior; the client does not silently replace shared live persistence with a device-local fallback.

### Live HYROX metadata enrichment

Live operational session conversion enriches paid rows from stable activity metadata keyed by `activity_id`.

For both `hyrox` and `hyrox-midtown`:

- `photo` is `../assets/itc/hyrox.webp`;
- the activity name/category/kind remain unchanged;
- custom live venue values remain authoritative.

Apply an exact legacy compatibility normalization only when:

- `activity_id === "hyrox-midtown"`; and
- `row.venue === "Midtown 28"`.

That exact row becomes:

- `location: "Midtown28 Fitness"`
- `venue: "Midtown28 Fitness"`
- `mapsQuery: "Midtown28 Fitness, Hong Kong"`

For a nonlegacy Midtown venue, preserve the custom venue for `location`, `venue`, and `mapsQuery`. BFT behavior remains unchanged except for receiving the HYROX photo.

This client normalization is defense in depth. The forward-only `20260813000002_midtown28_fitness.sql` migration remains the source-of-truth database correction.

## Components and Data Flow

### `app/js/app.js`

The delegated `form-week-venue` handler trims both form values and derives the effective map query:

```js
const location = String(fd.get("location") || "").trim();
const mapsQuery = String(fd.get("mapsQuery") || "").trim() || location;
```

It passes those values to `store.setWeekVenue()`. The existing busy state, catch path, and rerender-on-success boundary remain intact.

### `app/js/operations.js`

`buildSessionRow(row)` becomes the sole live-row normalization boundary for paid-session presentation. A small pure helper resolves:

- exact legacy Midtown venue normalization;
- normal/custom venue preservation;
- stable paid activity photo metadata.

No view-specific Midtown or photo workaround is added.

### `app/js/store.js`

The store continues to own dated venue mutation. No new localStorage keys or state-version change is required. Existing live RPC-result cache application remains authoritative after successful saves.

### `app/js/views.js`

No special HYROX fallback belongs in `viewActivity()`. It continues to render the normalized session object supplied by the store/operations seam.

## Error Handling

- Blank display and blank map values use reset behavior.
- A map-query-only value is stored as partial but does not confirm the venue.
- Location-only form submission is promoted to a complete pair before reaching the store.
- RPC failure preserves the form and reports failure through the existing toast path.
- Exact legacy Midtown normalization never rewrites custom venue strings.
- Missing live paid metadata no longer creates an invalid photo source.

## Testing

Follow test-driven development and observe each new regression fail before production edits.

### `app/live-auth-smoke.mjs`

Prove:

- a repeated weekly form with a real display location and blank map query calls `set_session_venue` with the display location in both RPC fields;
- successful save immediately decorates the dated session with the real venue;
- RPC failure does not rerender and preserves entered form values/control state;
- both hydrated paid session IDs have `photo === "../assets/itc/hyrox.webp"`;
- exact live `Midtown 28` normalizes to `Midtown28 Fitness` and the precise map query;
- a custom Midtown venue remains unchanged.

### `app/smoke.mjs`

Prove the existing local weekly override, reset, photo preservation, map fallback, and migration contracts remain green. Add pure live-row-helper assertions here only if the helper can be exported without coupling the smoke test to Supabase mocks; otherwise keep live hydration assertions in `live-auth-smoke.mjs`.

### Required verification

Run:

- `node app/smoke.mjs`
- `node app/live-auth-smoke.mjs`
- `git diff --check`

Manual preview acceptance:

1. Under Admin Activities, enter `Victoria Park Swimming Pool` as the display location for one Swimming week and leave Google Maps search blank.
2. Save and verify that occurrence immediately displays `Victoria Park Swimming Pool`, with a working map/directions query.
3. Open both Saturday HYROX details and verify their photos render.
4. Verify the 11:00 session displays `Midtown28 Fitness`, matching Admin Activities.
5. Confirm a deliberately custom operational venue is not rewritten.

## Out of Scope

- Automatic Supabase migration deployment from Vercel.
- Device-local fallback for failed shared live mutations.
- Photo upload or activity media administration.
- General normalization of arbitrary venue strings.
- Changes to paid booking/payment behavior.
- Shop, Giving, merchandise, or donation changes.
