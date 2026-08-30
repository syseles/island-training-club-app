# Bounded RSVP Harness Fix Report

Date: 2026-08-30

Branch: `work/testing-latest-integration`

Base: `166a0647a3cc11b317910e96ae1cf6ebc8bae04a`

## Scope

Fixed only the RSVP concurrency harness blocker reported in `final-rereview.md`. No application behavior, migration, Shop/Giving code, dependency, push, or Testing fast-forward was included.

## RED source-contract evidence

Added source contracts to `supabase/tests/verify_operational_backend_safety.sh` for:

- schema-valid `event-*` fixture activity IDs;
- session IDs derived exactly as `activity_id-session_date`;
- HKT-derived dynamic fixture dates;
- EXIT cleanup that preserves the original status;
- child-first database cleanup: bookings, sessions, templates, users.

The first run failed as intended with exit 1:

```text
FAIL: concurrency harness is missing paid_activity
```

Evidence: `/tmp/harness-fix-red-source-contracts.out`.

## Implementation

`supabase/tests/operational_rsvp_concurrency.sh` now:

- derives three fixture dates from the disposable database's current HKT date;
- uses `event-concurrency-paid` and `event-concurrency-rsvp` template IDs;
- composes each session ID from its exact activity ID and session date;
- uses those same dynamic dates in session rows and booking snapshots;
- captures the original EXIT status, disables recursive trapping, kills and waits for background children, performs bounded child-first SQL cleanup, removes the temp directory, and restores the original exit status;
- removes the old parent-first success-path cleanup.

A fake-`psql` lifecycle probe forced body exit 7 and cleanup exit 99. Cleanup was invoked and the observed harness exit remained 7.

## Fresh checks

Passed:

- RED then GREEN operational source contracts and safety gate;
- all three `*_safety.sh` verifiers;
- six smoke runs: local/live under default, HKT, and Los Angeles host timezones;
- `app/test-html.mjs`;
- syntax for 13 JS/MJS and 7 shell files;
- `git diff --check`, conflict-marker, retired-QR, bounded-scope, feature ancestry, and immutable migration `00005`–`00008` gates;
- fake-`psql` original-exit preservation probe.

Smoke evidence:

- default local: 223 lines, `All smoke tests passed.`
- default live: 41 checks;
- HKT local/live: 223 lines / 41 checks;
- Los Angeles local/live: 223 lines / 41 checks.

## Unavailable verification

PostgreSQL runtime/concurrency replay was not run because `psql` is unavailable, `ITC_OPERATIONS_TEST_DATABASE_URL` is unset, and the Docker daemon is unavailable. A fresh acknowledged disposable Supabase-compatible database remains required before deployment claims.

No push or fast-forward testing was performed.
