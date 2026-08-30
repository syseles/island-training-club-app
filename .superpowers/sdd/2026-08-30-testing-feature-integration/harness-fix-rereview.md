# Bounded RSVP Harness Fix Re-review

Date: 2026-08-30

Review range: base `166a0647a3cc11b317910e96ae1cf6ebc8bae04a` plus the bounded harness working diff.

Reviewer mode: local read-only requirements/diff audit; subagent tooling was unavailable in this Pi session.

## Verdict

**Bounded harness blocker resolved: Yes.**

No Critical or Important findings remain in this bounded fix. No push or fast-forward action is authorized or performed by this verdict.

## Requirement audit

| Requirement | Result | Evidence |
|---|---|---|
| RED source contracts | Pass | Initial safety run exited 1 with `concurrency harness is missing paid_activity`; GREEN run passes the new source contract block. |
| Schema-valid template IDs | Pass | `paid_activity` and `rsvp_activity` use `event-*`; setup inserts through those variables. |
| Schema-valid session IDs | Pass | Paid and RSVP IDs are composed as `${activity}-${date}` and use the matching activity/date columns. |
| Dynamic dates | Pass | Dates are derived from `now() at time zone 'Asia/Hong_Kong'` on the disposable target. |
| Child-first cleanup | Pass | EXIT cleanup deletes bookings before sessions, templates, and auth users; session-owned RSVP counts cascade. |
| Original exit preservation | Pass | Trap captures `$?`, suppresses cleanup failures, and exits with the captured value. A fake-`psql` probe preserved body exit 7 despite cleanup exit 99. |
| Bounded scope | Pass | Runtime diff is limited to the concurrency harness and its safety verifier; evidence files are documentation only. |

## Review notes

- Cleanup kills and waits for tracked background processes before issuing bounded SQL cleanup, preventing those children from retaining locks against cleanup.
- Cleanup uses both lock and statement timeouts and cannot overwrite the harness result.
- The former parent-first success cleanup is removed, so failure and success share one lifecycle path.
- Existing migration files remain byte-identical to their owning feature tips.
- The pre-existing cancellation/payment lock inversion remains a separate pre-production backend follow-up and was not changed here.

## Verification boundary

Source, safety, syntax, smoke, scope, ancestry, and immutable-migration checks pass. Actual PostgreSQL migration replay and concurrency execution remain unavailable without `psql` and an explicitly acknowledged disposable database. This re-review makes no production or live-database claim.
