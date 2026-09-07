## Verdict

**Ready to merge into `testing`: No.**

No new Critical findings. One **new Important** blocks readiness: the RSVP concurrency harness cannot run successfully against the current schema.

## Original findings

| Finding | Status | Evidence |
|---|---|---|
| **Critical — async reserve / mark-paid** | **Addressed** | Both handlers await settlement, use form-level duplicate guards, capture `FormData` before disabling, restore controls, and catch RPC/transport failures: `app/js/app.js:1202-1237`. Delayed success, rejection, busy, and duplicate tests pass. |
| **Important — authoritative release** | **Addressed** | Live RPC/client/store/UI chain exists: `20260830000002_release_operational_reservation.sql:7-76`, `app/js/operations.js:680-692`, `app/js/store.js:1117-1120`, `app/js/app.js:822-834`. Roles are exactly `member`, `admin`, `super_admin`; pending/declined and non-owner members fail closed. PUBLIC/anon are revoked. Forced rehydration tests pass. |
| **Important — RSVP paid lock upgrade** | **Not fully addressed** | The forward migration itself is source-correct: selective triggers, sorted move candidates, advisory locks, exact backfill, ACL and Realtime restoration are present. Under READ COMMITTED, a waiter recounts using a fresh statement snapshot after acquiring the advisory lock. However, the required concurrency regression is invalid; see New Important below. |
| **Important — assigned payout freshness** | **Addressed** | Approved Payment entry forces least-privilege hydration at `app/js/app.js:437-441`; visible-tab restoration refreshes at `app/js/app.js:1639-1645`; render-generation ownership prevents stale Payment DOM commits. No payout RLS or public exposure was loosened. Tests cover RLS suppression, route/visibility refresh, unassigned-row exclusion, and stale generation. |
| **Minor — stale docs** | **Addressed** | README/runbook now use Payments, Weekly Event Controls, state v16/v9–v15, current ownership, and ordered forward migrations. Stale-name scans pass. |
| **Minor — clean worktree** | **Not currently addressed** | The original `final-review.md` is tracked, but the strict clean-worktree gate still fails because `.superpowers/sdd/2026-08-30-testing-feature-integration/final-rereview.md` is an untracked zero-byte file. |

The audited adjacent live handlers—queues, duty claim/handoff, confirmation, Midtown, venue TBC, cancellation, session time, and notice—correctly await RPCs, suppress duplicates, restore busy state, and capture form values before disabling. No regression was found there.

## NEW Important

### RSVP concurrency harness violates schema constraints and cleanup ordering

- Latest template IDs must be `hyrox`, `hyrox-midtown`, `lunch`, or start with `event-`:
  `supabase/migrations/20260829000002_rsvp_events.sql:17-21`
- The harness inserts invalid IDs `itc-concurrency-paid` and `itc-concurrency-rsvp`:
  `supabase/tests/operational_rsvp_concurrency.sh:92-99`
- Session IDs must equal `activity_id || '-' || session_date`:
  `supabase/migrations/20260808000001_operational_schema.sql:70-71`
- Harness session IDs omit their dates:
  `supabase/tests/operational_rsvp_concurrency.sh:81-83,100-112`

Therefore setup fails before any concurrency scenario runs.

Even after correcting those IDs, cleanup deletes sessions while paid/RSVP bookings still reference them:

- Booking FK: `supabase/migrations/20260808000001_operational_schema.sql:94-98`
- Surviving bookings: `operational_rsvp_concurrency.sh:113-119,220-224`
- Parent-first cleanup: `operational_rsvp_concurrency.sh:259-263`

The harness must use schema-conforming fixtures and delete bookings before sessions/templates/users.

## Cancellation/payment inversion

The pre-existing cancellation (`session → booking`) versus mark/approve (`booking → session`) inversion is real, but **does not independently block this non-production testing integration**:

- PostgreSQL aborts one transaction rather than partially committing.
- Payments are mocked.
- The corrected UI handlers await and surface failures for retry.
- It is documented as a pre-existing follow-up.

It must still be resolved and concurrency-tested before production or real-money operation.

## Verification

Passed freshly:

- Six smoke runs: local/live under default, HKT, and Los Angeles timezones.
- `app/test-html.mjs`.
- Syntax: 13 JS/MJS and 7 shell files.
- All three source-only safety harnesses.
- Whitespace, conflict, Shop scope, retired-QR, and stale-doc gates.
- Feature-tip ancestry and exact second parents.
- Immutable migrations `00005`–`00008`.
- Forward migration and SQL reapplication order.

Unavailable:

- `psql`
- `ITC_OPERATIONS_TEST_DATABASE_URL`
- Docker daemon

Thus PostgreSQL syntax/runtime, migrations, SQL integration, and actual concurrency remain unexecuted.

## Deployment prerequisites

1. Repair the concurrency harness fixture IDs and cleanup order; rerun all source checks.
2. Clean the worktree before the fast-forward gate.
3. Provision a fresh disposable Supabase-compatible database and run `verify_operational_backend.sh` with explicit reset acknowledgement.
4. Apply migrations in order: `00008` → `20260830000001` → `20260830000002`; verify triggers, ACLs, RLS, publication, backfill, and PostgREST reload.
5. Perform deployed acceptance for release persistence, payment settlement/errors, RSVP concurrency/counts, payout route/tab freshness, and role boundaries.
6. Resolve the cancellation/payment lock inversion before production/live-money use.
7. Retain the existing browser-safe Supabase configuration, trusted Super Admin bootstrap, real Giving campaign, and legal/operational-policy prerequisites.
