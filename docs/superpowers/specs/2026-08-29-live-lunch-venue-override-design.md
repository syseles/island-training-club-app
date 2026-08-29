# Live Lunch Venue Override Design

## Goal

Make the dated Saturday RSVP lunch venue override behave like the existing Monday–Wednesday free-event overrides in live mode: an Admin can save or reset a venue, and the selected dated lunch immediately shows the result on Schedule and Activity Details.

## Root cause

The app already renders the lunch inside Weekly Venue Overrides and the current client allow-list includes the `lunch` activity. The deployed error, `Activity venue is fixed.`, is also emitted by the older Supabase `set_session_venue` RPC. Migration `20260829000003_lunch_venue_overrides.sql` replaces that RPC and admits lunch sessions. The preview therefore indicates that application code and database migration state are out of sync.

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

## Supabase deployment

Apply the existing migrations in order to the live Supabase project:

1. `20260829000002_rsvp_events.sql`
2. `20260829000003_lunch_venue_overrides.sql`
3. `20260829000004_uncapped_rsvp.sql`

The implementation must not claim the production issue is fixed until migration status confirms `20260829000003_lunch_venue_overrides.sql` is applied. If direct migration access is unavailable, report that deployment step explicitly.

## Testing

Update live-auth smoke coverage so the lunch session exercises the authoritative `activityId` path rather than relying only on an ID that begins with `lunch-`.

Verify:

- Saving a complete lunch venue does not throw `Activity venue is fixed.`
- The live operational cache contains the updated venue and map query.
- Schedule and Activity Details show the dated override.
- Reset restores `TBC` only for the selected lunch.
- Existing weekday free-event venue overrides and WNT meeting points remain unchanged.
- `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` pass.
