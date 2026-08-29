# Live Lunch Venue Override Design

## Goal

Make the dated Saturday RSVP lunch venue override behave like the existing Monday–Wednesday free-event overrides in live mode: an Admin can save or reset a venue, and the selected dated lunch immediately shows the result on Schedule and Activity Details.

## Root cause

The app already renders the lunch inside Weekly Venue Overrides and the current client allow-list includes the `lunch` activity. The deployed error, `Activity venue is fixed.`, comes from Supabase rather than the client.

Two overloaded `set_session_venue` functions exist. Migration `20260825000001_wnt_meeting_points.sql` made the six-argument overload authoritative so the client can send optional meeting coordinates, and retained a four-argument compatibility wrapper. Migration `20260829000003_lunch_venue_overrides.sql` admitted lunch only in the four-argument overload. The client always sends all six named arguments, so PostgreSQL selects the unchanged six-argument function, whose allow-list still contains only `wnt`, `run`, and `water`.

A new forward-only migration must replace the six-argument implementation so it admits `lunch` while preserving WNT meeting-point validation. It must also restore the four-argument function as a thin wrapper around the authoritative six-argument implementation. Editing migration `00003` is unsafe for databases where it has already run, and switching the client to four arguments would regress WNT coordinates.

The client also derives an override activity ID by parsing the session ID. That is safe for deterministic IDs such as `lunch-2026-09-05`, but the store should prefer the authoritative resolved session’s `activityId` so the check remains correct if a live session identifier changes shape.

## Behavior

For a dated lunch session, an Admin can:

- Enter a display location and Google Maps search.
- Save both values through the existing weekly venue form.
- See the updated venue immediately after the live RPC refreshes the operational cache.
- See the venue on Schedule and Activity Details for that dated lunch only.
- Reset the override to the recurring default (`TBC`) without changing later lunches.

The lunch remains an RSVP event. Venue editing does not change capacity, RSVP status, payment behavior, or recurring defaults.

## Application changes

In `store.setWeekVenue()`:

1. Resolve the session before the activity authorization check.
2. Prefer `session.activityId` as the authoritative override activity ID.
3. Retain deterministic session-ID parsing as a fallback for existing local free-event IDs.
4. Continue allowing only the existing recurring override activities: `wnt`, `run`, `water`, and `lunch`.
5. Preserve the existing live `set_session_venue` RPC call, cache refresh, notification, meeting-point, reset, and local fan-out behavior.

No new localStorage state or migration is needed.

## Supabase migration and deployment

Add `20260829000006_lunch_venue_meeting_point_rpc.sql`. The migration must:

1. Replace `public.set_session_venue(text, text, text, boolean, double precision, double precision)` with one authoritative implementation that allows `wnt`, `run`, `water`, and `lunch`.
2. Preserve coordinate validation and persistence only for WNT at Tamar Park; lunch coordinates remain `null`.
3. Add `Post-Training Lunch` to notification labels.
4. Replace the four-argument overload with a compatibility wrapper that forwards `null` coordinates to the six-argument function.
5. Preserve Admin authorization, advisory locking, notification deduplication, grants, and the PostgREST schema reload.

Apply the migrations in order to the live Supabase project:

1. `20260829000002_rsvp_events.sql`
2. `20260829000003_lunch_venue_overrides.sql`
3. `20260829000004_uncapped_rsvp.sql`
4. `20260829000006_lunch_venue_meeting_point_rpc.sql`

`00006` intentionally follows the Admin branch’s reserved `00005` migration number so the branches can later integrate without a filename collision. The implementation must not claim the live issue is fixed until `00006` is confirmed applied. If direct migration access is unavailable, report that deployment step explicitly.

## Testing

Update live-auth smoke coverage so the lunch session exercises the authoritative `activityId` path rather than relying only on an ID that begins with `lunch-`.

Verify:

- The client’s six named RPC arguments resolve to an implementation that admits lunch.
- Saving a complete lunch venue does not throw `Activity venue is fixed.`
- Lunch saves and resets persist `null` meeting coordinates.
- WNT Tamar Park coordinates still validate and persist through the same six-argument implementation.
- The four-argument compatibility overload forwards to the six-argument implementation.
- The live operational cache contains the updated venue and map query.
- Schedule and Activity Details show the dated override.
- Reset restores `TBC` only for the selected lunch.
- Existing weekday free-event venue overrides and WNT meeting points remain unchanged.
- `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` pass.
