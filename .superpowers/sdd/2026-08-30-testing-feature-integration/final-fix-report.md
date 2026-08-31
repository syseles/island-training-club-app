# Final Review Fix Wave Report

Date: 2026-08-30

Branch: `work/testing-latest-integration`

Implementation commit: `d075a68` (`fix(integration): address final operational review`)

## Root causes and fixes

1. **Promise-returning live mutations were consumed synchronously.**
   - `form-reserve` and `form-mark-paid` now capture inputs before disabling, await settlement inside a form-level busy guard, suppress duplicate delegated submissions, catch resolved RPC errors and transport rejections, and navigate/toast only after success.
   - The adjacent confirmed live Promise seams now follow the same pattern: waitlist/interest join and leave, collector duty claim/handoff, payment confirmation, Midtown open/close, venue-TBC, dated cancellation, session time, and session notice.
   - Local synchronous store behavior remains compatible because `await` accepts local return values.

2. **Live reservation release mutated only the cache.**
   - Added `20260830000002_release_operational_reservation.sql` after the locking correction.
   - The SECURITY DEFINER RPC derives owner/role/status/payment state server-side, permits only an approved owner or Admin/Super Admin, accepts only an unmarked `reserved` row, and revokes PUBLIC/anon execution before granting authenticated execution.
   - Added operations/store live adapters and awaited delegated UI. Returned rows update the cache before forced reconciliation; forced hydration tests prove persistence.
   - Local release still cascades freed capacity. Live release deliberately does not fake waitlist promotion.

3. **The immutable `00008` trigger serialized every booking update with a session-row lock upgrade.**
   - Kept migrations `00005`–`00008` byte-identical.
   - Added `20260830000001_rsvp_count_trigger_locking.sql`, replacing the broad trigger with contribution-sensitive INSERT, DELETE, and `UPDATE OF status, session_id` triggers.
   - RSVP classification occurs without a tuple lock. Exact recounts use per-RSVP-session advisory transaction locks; move candidates are sorted before locking.
   - The migration removes stale non-RSVP count rows, backfills every RSVP session including zero, and reasserts RLS, read grants, Realtime publication membership, and helper revocations.
   - SQL integration reapplication now removes all old/new trigger forms, reapplies `00008`, then reapplies `00001` in deployment order.
   - Added and wired `operational_rsvp_concurrency.sh` with bounded lock/statement/deadlock timeouts for paid-share noise, concurrent RSVP inserts/deletes, and opposing moves. Source-only safety tests prove unsafe inputs are refused and safety mode never invokes `psql`.

4. **Assigned payout Realtime is RLS-suppressed for ordinary members.**
   - Approved live `#/pay/:id` rendering now forces `hydrateLiveOperations({ force: true })` before rendering.
   - Returning visibility on a current Payment route rerenders through the same forced read path.
   - Existing render-generation ownership prevents delayed Payment hydration from overwriting a newer route.
   - No payout RLS, table grants, public views, or public payout data changed.

5. **Operational documentation was stale.**
   - README and `docs/runbooks/live-auth.md` now describe Payments, Weekly Event Controls, live Supabase ownership, the narrow device cache, state v16/v9–v15 compatibility, current venue controls, forward migrations, and the non-production database-verification boundary.

## RED evidence

- `/tmp/final-fix-red-live.out`: route-entry regression failed because the assigned-payout RPC count stayed `52` instead of increasing to `53`; the Payment route had not forced hydration.
- `/tmp/final-fix-red-safety.out`: source safety failed because the bounded RSVP concurrency harness did not exist.
- `/tmp/final-fix-red-safety-wiring.out`: after adding the harness test artifact, source safety still failed because the operational verifier did not invoke it.
- `/tmp/debug-async-payment.out`: delayed live reserve/mark-paid probe showed immediate settlement, `#/pay/undefined`, duplicate RPCs, early success, and an escaped rejected Promise.
- `/tmp/debug-release.out`: forced hydration restored the cache-only release from `cancelled` to backend `reserved` with no RPC call.
- `/tmp/debug-rsvp-lock.out`: lock-order trace demonstrated the broad `00008` trigger's paid payment lock-upgrade cycle.
- `/tmp/debug-payout-realtime.out`: RLS trace demonstrated that a foreign assigned payout update cannot reach an ordinary member through Postgres Changes.

## Fresh verification evidence before commit

- Default local smoke: exit 0, 223 output lines, `All smoke tests passed.`
- Default live fake-Supabase smoke: exit 0, 41 checks.
- `TZ=Asia/Hong_Kong` local/live: exit 0, 223 lines / 41 checks.
- `TZ=America/Los_Angeles` local/live: exit 0, 223 lines / 41 checks.
- Syntax: 13 JS/MJS files and 7 shell files passed.
- Source-only safety: Admin Notifications, Giving, and Operational harnesses passed.
- Source/diff gates passed: conflict markers, whitespace, protected maps/venues/indemnity/auth markers, retired FPS QR copy, Shop scope, forward-migration order, SQL reapplication order, feature ancestry, and documentation stale-name scans.
- Immutable owner comparisons passed for migrations `20260829000005`–`20260829000008`.
- Work stayed on `work/testing-latest-integration`; `testing` was not updated and nothing was pushed.

## Unavailable verification

PostgreSQL runtime replay was not run:

- `psql` is unavailable.
- `ITC_OPERATIONS_TEST_DATABASE_URL` is unset.
- Docker CLI exists, but the Docker daemon is unavailable (`docker info` exit 1).

Therefore the new migrations, SQL integration additions, and concurrency harness are source/safety/syntax reviewed but not executed against PostgreSQL. A fresh acknowledged Supabase-compatible disposable database remains required before deployment claims.

## Remaining concerns

- The pre-existing Admin cancellation (`session → booking`) versus payment (`booking → session`) lock-order inversion identified in `/tmp/debug-rsvp-lock.out` is outside this RSVP-trigger correction and remains a backend follow-up.
- Assigned payout refresh is guaranteed on Payment route entry and tab visibility restore, not continuously while a Payment page remains foregrounded.
- This remains a pre-production prototype with mocked payment reconciliation; no production-readiness claim is made.

## Final approval follow-up

Date: 2026-08-30

Review source: `final-approval-review2.md` (captured from `/tmp/integration-final-approval-review2.out`).

The follow-up changes only smoke/test infrastructure, this evidence, and the implementation plan. Production migrations are untouched; migrations `20260829000005` through `20260829000008` remain immutable.

### RED evidence

- `/tmp/final-approval-red-la-smoke.out`: `TZ=America/Los_Angeles node app/smoke.mjs` exited 1 at the generic Social selector because fixtures were anchored to `todayLocal()` while selection follows HKT.
- After that selector was corrected, the LA run exposed the two review-noted signing-date assertions still expecting host-local today; both failed against the existing HKT application contract before their expectations were corrected.
- `/tmp/final-approval-red-paid-lock.out`: the adversarial mutation changed the paid holder’s `FOR SHARE` literal to a valid setup RSVP session. The old validator accepted it and the safety runner failed with `expected exit 1, got 0`.
- `/tmp/final-approval-red-fixed-uuids.out`: after cross-run UUID validation was added, two real harness captures failed because their fixed auth user UUIDs overlapped.

### Fixes and behavioral proof

- Generic Social rolling-window fixtures parse `data.todayHktISO()` into a calendar date before applying day offsets. An explicit day-zero assertion binds fixture construction to the HKT ISO date. The adjacent signing-date assertions now also match the existing HKT contract, allowing the LA run to reach completion without production changes.
- `verify_operational_rsvp_capture.py` parses exactly one real captured `SELECT id FROM public.operational_sessions ... FOR SHARE` statement and requires its literal to equal the paid session derived from setup. The valid-RSVP substitution is rejected with the exact expected/actual session IDs.
- The concurrency harness hashes its UTC timestamp/PID/random run seed into a 32-hex token. It derives three version-4/variant-compatible member/profile UUIDs and three booking UUIDs from that token and carries the existing variables through auth/profile setup, authenticated payment, booking mutations, and child-first cleanup.
- The capture validator parses auth inserts, profile updates, authenticated connection identity, booking inserts, and auth cleanup. It requires valid/distinct run-level UUID relationships and disjoint auth/profile/booking UUID sets across two captures.
- A `cross-run-uuid-collision` mutation rewrites one complete capture to the other run’s six individually valid UUIDs while preserving all intra-run references. Cross-run validation rejects it. Existing duplicate-ID, foreign-session, static-date, inverted-semantics, and parent-first-cleanup adversaries remain enforced.
- Bounded lock/statement/deadlock timeouts, background-child termination/waiting, bookings-before-sessions-before-templates-before-users cleanup, and restoration of the original body exit remain unchanged.

### Verification evidence

- Six smoke runs passed: local/live under default, `Asia/Hong_Kong`, and `America/Los_Angeles`; each local run produced 217 `ok` lines across 223 lines and ended `All smoke tests passed.`, and each live run produced 41 `ok` checks.
- `app/test-html.mjs` passed.
- Syntax passed for 13 tracked JS/MJS files, 7 tracked shell files, and `verify_operational_rsvp_capture.py`.
- Admin Notifications, Giving, and Operational safety scripts passed. Operational safety executed the actual concurrency harness twice through fake `psql`, rejected all seven rendered-SQL mutations including valid-RSVP lock substitution and cross-run UUID collision, and preserved body exit 7 over cleanup exit 99.
- PostgreSQL replay remains unavailable: no `psql`, no acknowledged disposable database URL, and no available Docker daemon. Actual migration/runtime/concurrency execution is still required before deployment.
- Nothing was pushed and `testing` was not fast-forwarded.
