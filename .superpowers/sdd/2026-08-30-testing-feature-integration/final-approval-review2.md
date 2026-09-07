## Critical

None.

## Important

1. **Rendered-SQL propagation gate still has a false-positive path**
   - The real harness correctly locks `$paid_session` before `mark_operational_payment`: `supabase/tests/operational_rsvp_concurrency.sh:166-196`.
   - However, the validator only rejects session IDs outside the run’s allowed set: `supabase/tests/verify_operational_rsvp_capture.py:350-394`.
   - Adversarially replacing the paid `FOR SHARE` session with the same run’s valid RSVP session still returned **exit 0**. That mutation defeats the paid-lock regression while passing validation.
   - The existing mutation uses an obviously foreign `invalid-paid-session`, so it misses this case: `supabase/tests/verify_operational_backend_safety.sh:203-217`.
   - With PostgreSQL unavailable, this false-positive-capable gate is significant and blocks final approval.

2. **The claimed timezone regression matrix does not currently pass**
   - `TZ=America/Los_Angeles node app/smoke.mjs` exited **1**.
   - Smoke fixtures/assertions use host-local dates at `app/smoke.mjs:1124-1130` and `3070-3129`, while application behavior intentionally uses HKT at `app/js/views.js:69` and `app/js/store.js:1364,1423-1429`.
   - This predates `f28b3e9` and appears to be a test defect rather than a product regression, but it contradicts the recorded six-run pass and violates the repository’s all-tests-pass merge gate.

## Minor

- Activity and session IDs are unique per run, but user and booking UUIDs remain fixed at `operational_rsvp_concurrency.sh:53-60`. The harness must run serially; overlapping invocations would collide.
- `/tmp/integration-final-approval-review.out` was absent. The original review was recovered from tracked `final-review.md`.

## Original finding status

| Finding | Status |
|---|---|
| Async live reserve/mark-paid | Addressed: awaited, duplicate-guarded, errors caught |
| Authoritative live reservation release | Addressed through RPC/client/store/UI; role/status/payment checks present |
| RSVP paid lock-upgrade problem | Migration source addressed with selective triggers and advisory locking |
| Assigned payout freshness | Addressed on Payment entry and visibility restoration without loosening RLS |
| Invalid harness activity/session IDs | Addressed |
| Dynamic future HKT dates | Addressed: future consecutive HKT-derived dates |
| Paid/RSVP fixture semantics | Correct in current harness |
| Cleanup order/status | Correct: bookings → sessions → templates → users; original exit preserved |
| Documentation/worktree findings | Addressed; worktree clean |

Freshly passed: default and HKT local smoke, default/HKT/LA live smoke, HTML test, syntax checks, all safety scripts, ancestry/provenance, immutable migrations, diff check, and Shop-scope check.

## Ready to merge testing

**No.**

## Deployment caveats

- PostgreSQL execution remains unavailable: no `psql`, no test database URL, and Docker daemon unavailable. Migrations, SQL integration, and real concurrency remain unexecuted.
- Before deployment, run `verify_operational_backend.sh` against a fresh acknowledged Supabase-compatible database.
- Apply migrations in order: `20260829000008` → `20260830000001` → `20260830000002`; verify triggers, ACLs, RLS, backfill, Realtime publication, and PostgREST reload.
- The pre-existing cancellation/payment lock-order inversion remains acceptable only for mocked non-production testing; resolve before production or real-money use.
- Run the concurrency harness serially on a dedicated disposable target.
