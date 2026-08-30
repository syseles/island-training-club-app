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

## Independent review fixes — 2026-08-30

- Added local-mode notification adaptation at `app/js/store.js`: existing local rows retain their IDs, kinds, titles, messages, bodies, and persisted fields while `read`, `link`, and `createdAt` are exposed as `read_at`, `destination`, and `created_at` for the shared Inbox/count UI.
- Local `markNotificationRead(id)` now updates only the signed-in owner’s existing unread row, persists the existing `read = true` field, and adds no localStorage fields or migration.
- Added smoke coverage proving the local Inbox renders the exact destination, includes the unread row in its count, persists a click across `store.load()`, decrements the unread count by one, and hides the clicked row.
- Replaced every paid/RSVP reserve, queue, and defer integration call affected by future guards with deterministic Saturday fixtures based on the current Hong Kong date. Generated IDs retain the required `<activity-id>-YYYY-MM-DD` form.
- Derived producer-scoped payment, gym, RSVP, and cancellation copy/routes from PL/pgSQL fixture variables. Paid reservation remains exact `#/pay/<booking-id>` and RSVP remains exact `#/activity/<session-id>`.
- Preserved the deliberately expired `hyrox-2026-08-15` reservation so `Session is cancelled` remains proven to take precedence over the paid future guard; moved closed-session checks to future generated fixtures.

### Test-first evidence

- RED: `node app/smoke.mjs` failed at `local notification seam must preserve id, kind, title, message, and body` while local listing returned no rows.
- GREEN: the new local Inbox/count/destination/click-persistence regression passes after the store-seam implementation.
- RED: `node app/smoke.mjs` failed at `notification integration missing time-stable fixture marker operational_time_fixtures` before the SQL fixture rewrite.
- GREEN: the smoke contract and guarded-call audit pass; the only remaining literal guarded call is the intentional cancelled-session precedence fixture.

### Review-fix verification

Passed:

- `node app/smoke.mjs`
- `node app/live-auth-smoke.mjs`
- `bash supabase/tests/verify_admin_notifications_safety.sh`
- `bash supabase/tests/verify_giving_campaigns_safety.sh`
- `bash supabase/tests/verify_operational_backend_safety.sh`
- `node --check` across `app/js/*.js` and `app/*.mjs`
- `git diff --check`

The three destructive database verifiers were invoked and refused safely before execution. Disposable PostgreSQL execution remains unavailable: `ITC_OPERATIONS_TEST_DATABASE_URL` is unset, `psql` is not installed, and the local Docker daemon is not running. The integration SQL was audited statically but must still run against the required fresh disposable Supabase-compatible database before deployment.
