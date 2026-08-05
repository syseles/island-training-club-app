# HYROX demo attendance data cleanup — design

Date: 2026-08-05
Branch: feature/auth-identity (non-Shop work)

## Problem

The deployed app (live mode, Supabase auth) shows fake attendance on the two
Saturday HYROX sessions. The club currently has one real user and zero
sign-ups, so the session page must reflect that.

Sources of fake attendance (all active in live mode):

1. `attendeesFor()` in `app/js/store.js` slices a hardcoded pool of 14 fake
   member names ("Jason M.", "Natalie C.", …) sized by `session.baseBooked`.
2. Both HYROX seed activities carry `baseBooked: 9` / `baseBooked: 14`
   ("simulated demand"), which also inflates the spots-taken count in
   `spotsLeft()` and the admin activity form.
3. `seedBookings()` / `seedReceipts()` in `app/js/data.js` create a past
   "attended" and an upcoming "confirmed" HYROX booking (plus two receipts)
   for the demo member `u-member` (CM Chui). `attendeesFor()` prepends
   real-booking names, so "CM C." appears in "Who's coming" even in live
   mode. Bookings/receipts live in localStorage `state` regardless of mode.

Wrinkle: activities/bookings are copied into persisted localStorage state, so
editing seeds alone does not clean browsers that already loaded the app.
Requires a `STATE_VERSION` bump + migration (established pattern, see v2/v4).

## Decision (approved by user)

Full cleanup — nobody is booked, "Who's coming" shows only real bookings.

## Changes

1. **`app/js/store.js` — `attendeesFor()`**: delete the fake name pool and
   the `pool.slice(...)` line. Return only names from
   `activeBookingsForSession()`. (Session detail view already handles the
   empty case by omitting the attendee chips list.)
2. **`app/js/data.js`**: remove `baseBooked` from `hyrox` and
   `hyrox-midtown` seed activities. Delete `seedBookings()` and
   `seedReceipts()` entirely. Their only call sites are `freshState()` and
   the v2 migration step in `store.js`: `freshState()` becomes
   `bookings: [], receipts: []`, and the v2 step drops its seed
   booking/receipt replacement loop (the new v10 step removes any lingering
   seed records by id, and v1-era state is hypothetical anyway).
   `receiptCounter` seed (49) stays so receipt numbers don't regress.
3. **`app/js/store.js` — migration**: bump `STATE_VERSION` to 10. New step
   `if (v < 10)`: for `hyrox`/`hyrox-midtown` activities delete
   `baseBooked`; remove seed-owned bookings `b-seed-past`/`b-seed-next` and
   receipts `r-seed-past`/`r-seed-next` from persisted state (filter by id,
   leaving user-created records untouched).
4. **`app/smoke.mjs`**: update the contract — assert `attendeesFor` for a
   HYROX session contains no fake-pool names, seed bookings/receipts lists
   are empty, and a v9-state fixture migrates to v10 with `baseBooked`
   stripped and seed bookings/receipts removed while user-created records
   survive.

## Notes / trade-offs

- The prototype demo loop loses its pre-seeded receipt; booking a session in
   the demo now takes ~30s to regenerate one. Acceptable per user.
- The admin "Simulated existing bookings" field (`views.js`,
  `store.js#saveActivity`) stays — it's a prototype affordance for testing
  capacity, now defaulting to 0 for HYROX.
- `spotsLeft()` needs no change: `session.baseBooked || 0` already tolerates
  the missing field.
- Wednesday Night Training and other sessions are untouched.

## Verification

`node app/smoke.mjs` must pass. Manual: load the app in a fresh browser
profile, open the HYROX session page — "Who's coming" shows no chips; spots
show full capacity (18/18).
