# Notification refinement report

Date: 2026-08-29
Branch: `feature/notification-routing`

## Delivered

- Preserved `operational_booking_reserved` at exact `#/pay/<booking-id>` navigation into the existing Book & Pay view.
- Routed new and uniquely resolvable historical `operational_rsvp_confirmed` rows to exact `#/activity/<session-id>` destinations; ambiguous history remains unresolved and falls back to `#/schedule`.
- Made the notification window unread-only. Successful activation persists `read_at`, removes the row and updates the count before navigation; failures retain the row. Database rows are never deleted.
- Preserved valid explicit destinations, cancellation fallbacks, RLS, fixed search paths, and revoked browser execution privileges.
- Updated the semantic notification spec and implementation plan; amended known-undeployed migration `00007` only.

## TDD and review

- RED observed in `app/smoke.mjs` for the old RSVP Payments fallback and in `app/live-auth-smoke.mjs` for old RSVP routing/unread rendering behavior.
- GREEN observed after the implementation; focused self-review found no Critical or Important issues. No subagent reviewer was available.

## Verification

Passed:

- `node app/smoke.mjs`
- `node app/live-auth-smoke.mjs`
- `bash supabase/tests/verify_admin_notifications_safety.sh`
- `bash supabase/tests/verify_operational_backend_safety.sh`
- `node --check` for all changed JavaScript files
- `git diff --check`

## Remaining concern

Disposable PostgreSQL integration execution and live deployment were not performed because `ITC_OPERATIONS_TEST_DATABASE_URL` is unset. Migration `00007` must be verified against a fresh disposable Supabase-compatible database and deployed before claiming live routing is updated.
