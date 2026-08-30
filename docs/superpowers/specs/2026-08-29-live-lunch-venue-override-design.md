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

## Live RSVP headcount

Every “X going” label must count confirmed bookings directly, not depend on whether the booking owner exists in the local prototype identity array. Live mode deliberately keeps `state.users` empty, so attendee-name resolution cannot be used as the count source.

Expose a dedicated count helper at the store seam and use it on Schedule, Activity Details, and Admin RSVP controls. Local mode may count confirmed prototype bookings directly. Live mode must use a count-only aggregate RPC because booking RLS exposes only a member’s own rows and Admins’ broader access must not determine what count members see. The aggregate returns session IDs and confirmed counts only—never profile IDs or names—and is readable by visitors and authenticated users because RSVP headcounts are already public UI data.

Store exact totals in `operational_rsvp_counts`, a public read-only table containing only `session_id`, nonnegative `going_count`, and `updated_at`. A security-definer booking trigger recalculates the affected RSVP session inside each insert/update/delete transaction and retains a zero row after the final withdrawal. Browser roles receive public SELECT through RLS but no writes or helper execution. Backfill all existing RSVP sessions when migration `00008` is applied.

Hydration stores these totals in a dedicated operational count map. Join/withdraw RPC completion refreshes the aggregate, and the client also subscribes directly to `operational_rsvp_counts` through Supabase Realtime. The count-table subscription is required: booking SELECT RLS suppresses another member’s `operational_bookings` event, so the booking subscription alone cannot keep public totals current. Failure or absence of the count RPC must not abort core Schedule hydration; it may temporarily fall back to the caller-visible confirmed count while reporting degraded count data.

The count must update as follows:

- Before joining: `0 going`.
- After one successful “Count me in”: `1 going` — exactly `+1`.
- After withdrawing that RSVP: `0 going` — exactly `-1`.
- Other confirmed members each contribute one; cancelled, deferred, and reserved/unconfirmed rows do not contribute.

Keep attendee-name formatting separate. No placeholder identity rows should be created or persisted merely to obtain a count.

## RSVP integrity and time boundaries

Only templates with `requires_rsvp = true` may use the zero-price reserve/withdraw flow. Ordinary free events remain show-up events even though their price is also zero; direct RPC calls must not create hidden confirmed bookings for them.

Session-start enforcement uses the session’s Hong Kong wall time:

```sql
(session_date + start_time) at time zone 'Asia/Hong_Kong'
```

Joining or withdrawing at or after that instant is rejected. This avoids treating a Hong Kong lunch time as UTC.

Live `upcomingSessions(days)` must honor the same date horizon as local mode: today through `days - 1` calendar days, inclusive. Social preview can still apply its rolling seven-day start-time filter, while Home and Admin callers do not receive months of generated sessions.

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

Add `20260829000008_rsvp_integrity.sql`. It must:

1. Add public read-only `operational_rsvp_counts(session_id PK/FK, going_count nonnegative, updated_at)` with public SELECT RLS, no browser writes, and no identity columns.
2. Add a security-definer booking trigger that transactionally recalculates insert/update/delete counts, preserves exact zero after withdrawal, backfills existing RSVP sessions, and is not executable by browser roles.
3. Make `get_operational_rsvp_counts()` read only that table and return only `session_id` and confirmed `going_count`.
4. Add `operational_rsvp_counts` to the `supabase_realtime` publication; the client must include it in `LIVE_TABLES` and subscribe directly.
5. Grant the aggregate to `anon` and `authenticated` without exposing booking/profile rows, while explicitly revoking `PUBLIC`/`anon` execution from reserve/withdraw before the authenticated grants.
6. Replace reserve/withdraw RPC implementations so zero-price behavior also requires `requires_rsvp = true`.
7. Reject ordinary free-event reserve/withdraw attempts.
8. Compare session start using `AT TIME ZONE 'Asia/Hong_Kong'`.
9. Preserve paid reservation/payment behavior, uncapped RSVP behavior, notifications, authorization, and grants.

Apply the migrations in order to the live Supabase project:

1. `20260829000002_rsvp_events.sql`
2. `20260829000003_lunch_venue_overrides.sql`
3. `20260829000004_uncapped_rsvp.sql`
4. `20260829000006_lunch_venue_meeting_point_rpc.sql`
5. `20260829000008_rsvp_integrity.sql`

`00006` follows the Admin branch’s reserved `00005`; `00008` follows Notification’s reserved `00007`. This avoids integration filename collisions. The implementation must not claim the live issue is fixed until `00006` and `00008` are confirmed applied. If direct migration access is unavailable, report that deployment step explicitly.

## Testing

Update live-auth smoke coverage so the lunch session exercises the authoritative `activityId` path rather than relying only on an ID that begins with `lunch-`.

Verify:

- A member sees other members’ confirmed RSVP total through the count-only aggregate despite booking-row RLS.
- A foreign member’s count-table Realtime event refreshes an ordinary member even though booking RLS suppresses the foreign booking event and row.
- A live RSVP changes the displayed aggregate by exactly `+1` after “Count me in” and exactly `-1` after withdrawal.
- A successful empty aggregate initializes each RSVP session to exact zero.
- Reserved, cancelled, deferred, and ordinary free-event rows do not contribute.
- Schedule, Activity Details, and Admin RSVP controls derive the same aggregate count.
- Ordinary free events reject reserve and withdraw RPC calls.
- RSVP start boundaries use Hong Kong time.
- Live session queries honor the requested calendar-day horizon.
- The count works while live `state.users` remains empty and does not create local identity records.
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
