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

## Final approval blocker follow-up

Date: 2026-08-30

The final approval review found that the first harness correction still used
fixed template IDs and that its safety gate could pass corrupted source. This
follow-up replaces that false-positive-capable source inspection with an
executed SQL-boundary contract.

### RED evidence

- The original safety script passed a temporary harness whose paid and RSVP
  activity IDs were both `event-concurrency-paid`; this reproduced the reported
  false positive before implementation.
- `/tmp/integration-blocker-red-behavioral.out` records two complete real harness
  executions through fake `psql`, followed by the expected failure:
  `template activity ID is not tokenized and SQL-safe: event-concurrency-paid`.
- `/tmp/integration-blocker-red-static-dates.out` records an internally
  consistent mutation to fixed 2099 setup/session/cleanup dates being accepted
  before the validator linked rendered fixtures to the executable HKT query.

### Implementation and behavioral proof

- Every harness process now builds a UTC timestamp/PID/random raw token,
  lowercases it, removes every character outside `[a-z0-9]`, refuses an empty
  result, and renders `event-concurrency-paid-<token>` plus
  `event-concurrency-rsvp-<token>`.
- Session IDs remain exact `activity_id-date` values. Existing variable flow
  carries the same IDs through setup, paid/RSVP child connections, assertions,
  and EXIT cleanup.
- `verify_operational_backend_safety.sh` now runs the actual harness twice
  against a controlled fake `psql`; the fake only replaces unavailable database
  execution and captures every actual SQL payload crossing the process boundary.
- `verify_operational_rsvp_capture.py` parses those captures and enforces:
  distinct lowercase-alphanumeric run tokens and `event-*` activities; exact
  activity/session/date relationships; dates equal to the future consecutive
  values requested by executable HKT SQL; paid capacity 20 / HKD 180 /
  `requires_rsvp=false`; RSVP uncapped / HKD 0 / `requires_rsvp=true`; no
  foreign fixture ID in any captured connection; identical setup/cleanup IDs;
  and bookings-before-sessions-before-templates-before-users cleanup.
- The final capture gate observed distinct tokens
  `202608301538484707977975840` and `20260830153848471482225214642`.
- Adversarial copies made from actual captures are each rejected with exit 1:
  duplicate activity IDs, an invalid session ID in only the `FOR SHARE` child
  connection, static dates that ignore the HKT
  query, inverted paid/RSVP semantics, and parent-first cleanup.
- A real harness lifecycle run through fake `psql` forced body exit 7 and cleanup
  exit 99. Actual cleanup SQL was captured and the harness returned the original
  exit 7.

Final behavioral output:
`/tmp/integration-blocker-verify-verify_operational_backend_safety.out`.

### Fresh complete verification

Passed after the final code change:

- six smoke runs: default/HKT/Los Angeles local runs each produced 217 `ok`
  checks across 223 lines and ended `All smoke tests passed.`; matching live
  runs each produced 41 `ok` checks;
- `app/test-html.mjs` (exit 0);
- syntax for 13 tracked JS/MJS files, 7 tracked shell files, and the Python
  capture validator;
- all three tracked `*_safety.sh` scripts;
- five feature-tip ancestry checks and the exact five-merge parent chain;
- byte-identical owner migrations `00005`–`00008`, their exact order, forward
  RSVP SQL reapplication order, and integration-before-concurrency dispatch;
- protected map/venue/indemnity/auth files and markers, retired-QR and stale-doc
  scans, blocker Shop/Giving scope, conflict-marker scans, and whitespace diffs.

PostgreSQL runtime remains unavailable: `psql` is absent,
`ITC_OPERATIONS_TEST_DATABASE_URL` is unset, and `docker info` exits 1 because
the daemon socket is unavailable. No database, push, Testing fast-forward, or
production-readiness claim is included.
