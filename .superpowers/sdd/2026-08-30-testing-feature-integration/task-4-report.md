# Task 4 — Semantic Notification Routing Integration Report

## Merge

- First parent: `6a242995c974fe89d9be09f206ee64c61491aced` (Admin + RSVP candidate)
- Second parent: `b42a684bdfcfd51357e15a6d8821b9f211772f51` (exact Notification Routing tip)
- Merge subject: `merge: integrate Notification Routing into testing candidate`
- Payment System and push work were not started.

## Conflicts and reconciliation

- `app/smoke.mjs`: retained Admin payout and RSVP migration/count/HKT assertions, added the complete Notification routing/read contract, and updated the cancellation fixture assertions to the Notification tip's shared HKT-relative SQL fixture table.
- `supabase/tests/operational_backend_integration.sql`: retained assigned-payout authorization/RLS and all RSVP `00006`/`00008` count, integrity, DELETE, boundary, venue, and Realtime fixtures; added Notification producer, exact destination, explicit precedence, read-state, unique historical backfill, ambiguity refusal, and idempotent reapplication checks. Future-guarded booking/queue/defer scenarios use the shared HKT-relative fixture table.
- `app/live-auth-smoke.mjs`: the integrated Admin auth-transition test had refreshed the live operations cache as another member. Rehydrating after restoring the Admin fixture keeps the existing paid booking available for the exact `#/pay/<booking>` notification route test.
- `app/js/store.js`: local venue notifications now persist only the existing `link/read/createdAt` shape. Inbox normalization supplies `destination/read_at/created_at` without writing live-shaped fields into localStorage.

## Preserved behavior

- New paid reservations route to exact `#/pay/<booking-id>`.
- New RSVP confirmations route to exact `#/activity/<session-id>`.
- Unique historical paid/RSVP rows backfill exact destinations; ambiguous or foreign rows remain unresolved.
- Explicit internal `#/` destinations take precedence; safe semantic fallbacks remain Payment, Schedule, Admin, Giving, and Account routes.
- Inbox renders unread rows only. A successful click persists read state, hides the row, decrements the unread count, then navigates. Failed local/live read updates retain the page, row, count, and hash.
- Admin payout hydration and exact RSVP count/privacy/Realtime behavior remain covered.

## Verification

- `node app/smoke.mjs`: pass.
- `node app/live-auth-smoke.mjs`: pass.
- JS/MJS syntax: 12 files pass.
- Shell syntax: 6 files pass.
- Dedicated Admin Notification, Giving, and Operational safety self-tests: pass.
- Conflict-marker, whitespace, merge-head, scope, and Shop-path audits: pass.
- Migrations `00005`, `00006`, and `00008` still compare byte-identically with their owning tips.
- Migration `00007` compares byte-identically with `b42a684`; SHA-256 `9180f5a84ba0d2c9c0ad8ab9b84f0fcd44bc2cee57e8be0aec8ab5407206787f`.

## Review and concerns

Focused read-only review found no Critical or Important issue in route ownership/privacy, exact-vs-historical resolution, read-before-route ordering, failure behavior, or coexistence with payout/RSVP migrations. This Pi session has no subagent tool, so an independent reviewer could not be dispatched.

No disposable database URL or `psql` is available. The dedicated safety self-tests passed, but direct PostgreSQL migration/integration replay and the verifier's connected `--safety-check-only` gate remain unverified. No database, Testing ref, or remote was modified.
