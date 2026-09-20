## Critical

1. **Live reserve / mark-paid forms treat asynchronous RPCs as synchronous**
   - `app/js/app.js:1164-1189`
   - `app/js/store.js:981-985`, `1032-1035`
   - In live mode both store calls return promises. Reservation immediately navigates to `#/pay/undefined`; mark-paid announces success and navigates before settlement, while rejected RPCs bypass the surrounding `try/catch`.
   - Minimal verification confirmed both return promises and synchronous `booking.id` is absent.
   - Add awaited, busy-guarded handlers and delegated tests with delayed success and rejection. Current live tests seed bookings directly at `app/live-auth-smoke.mjs:2015`, bypassing the broken form path.

## Important

1. **Live reservation release is cache-only**
   - `app/js/store.js:1117-1124`
   - There is no live RPC branch. It mutates the in-memory live booking and writes local state, but not PostgreSQL; the next hydration can restore the reservation.
   - `app/live-auth-smoke.mjs:3418-3422` only checks the mutated cache, masking the persistence failure.
   - Add an authorized backend release RPC or hide the control in live mode, then test across forced rehydration.

2. **RSVP count trigger can deadlock concurrent paid-booking updates**
   - `supabase/migrations/20260829000008_rsvp_integrity.sql:47-59`, `108-112`
   - The trigger runs for every booking update and acquires an exclusive session lock even for non-RSVP paid sessions. Existing payment operations first take shared session locks (`20260808000002_operational_member_rpcs.sql:327-357`, `20260808000003_operational_admin_rpcs.sql:60-87`).
   - Two concurrent payments for different bookings in the same session can each hold a shared lock and wait for the other while upgrading.
   - Keep immutable `00008`; add a forward migration that avoids RSVP recalculation/session locking for non-RSVP updates, plus a concurrency regression.

3. **Assigned payout Realtime does not reach ordinary assigned members**
   - `app/js/operations.js:483-487`
   - `supabase/migrations/20260808000001_operational_schema.sql:278-291`
   - `00005` exposes assigned payouts through a definer RPC, but the table’s SELECT RLS remains self/Admin. Supabase Postgres Changes applies SELECT RLS, so an ordinary member will not receive updates to another assigned collector’s payout row. Their payment destination remains stale until another refresh trigger or reload.
   - Use a privacy-safe invalidation/broadcast mechanism or refresh payout enrichment when opening Payment. Do not loosen payout-table RLS.

## Minor

1. **Operational documentation is stale**
   - `README.md:41-42`
   - `docs/runbooks/live-auth.md:19-23`, `147-148`
   - It still describes HYROX/Payments Ops naming, state v14, and Weekly Venue Overrides; the candidate uses Payments, v16, and Weekly Event Controls including RSVP lunch.

2. **The worktree is not clean**
   - Untracked: `.superpowers/sdd/2026-08-30-testing-feature-integration/final-review.md`
   - The committed SHA is unaffected, but the plan’s clean-worktree fast-forward gate currently fails.

## Verified strengths

- All five exact feature tips are ancestors and are second parents of five ordered merge commits.
- Migrations `00005`–`00008` are byte-identical to their owning tips and ordered correctly.
- Notification exact/new/historical routing, unread removal/count, failed-read behavior, PayMe safety, QR-free FPS/Giving, Sunday Schedule, HKT verse/RSVP boundaries, Social/lunch rendering, maps, indemnity, auth/roles, and v9–v16 migrations have substantial coverage.
- Fresh checks passed:
  - Six smoke runs: local/live-fake under default, HKT, and Los Angeles timezones.
  - Syntax: 13 JS/MJS and 6 shell files.
  - All three source-only safety harnesses.
  - Conflict, whitespace, protected-file, Shop-scope, and retired-QR scans.
- PostgreSQL replay was not run: `psql` unavailable, Docker daemon unavailable, and disposable DB URL unset. This alone would be permissible for non-production testing under the plan, but the findings above block readiness.

## Ready to merge into testing

**No.** The live Payment entry path is broken, release is non-authoritative, and two backend/Re​altime integration issues remain.

## Live deployment prerequisites

1. Resolve all Critical/Important findings and rerun the complete verification matrix.
2. Provision a fresh empty Supabase-compatible database with `psql`, set `ITC_OPERATIONS_TEST_DATABASE_URL` and `ITC_ALLOW_DATABASE_RESET=1`, then run the full operational verifier.
3. Apply the complete ordered migration chain to the intended project; verify RLS, grants, triggers, Realtime publication, backfills, and PostgREST schema reload.
4. Configure only the browser-safe Supabase URL/anon key in `app/index.html` and exact Google OAuth redirect URLs.
5. Bootstrap the verified Super Admin with audited trusted SQL and publish a real Giving campaign.
6. Perform deployed browser acceptance for roles, payments, payout/count Realtime, notifications, Giving, venue maps/directions, and indemnity.
7. Update the runbook and finalize provisional privacy/guidelines/approval copy. This prototype is not suitable for production/live money movement without the outstanding backend, payment, legal, and operational decisions.
