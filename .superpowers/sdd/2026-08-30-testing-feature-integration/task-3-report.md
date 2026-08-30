# Task 3 — RSVP Events Integration Report

## Merge

- First parent: `3ef4e3ac8a516acde07bb0b569482f4d1612b8a8` (Admin-integrated candidate)
- Second parent: `218fce7e96d86831ffc409aa59d4e949d7cb8b61` (exact RSVP tip)
- Notification Routing was not merged.

## Conflicts and resolutions

- `app/js/operations.js`: composed assigned-payout and RSVP-count hydration as independent optional enrichments; retained both error channels and both Realtime tables.
- `app/live-auth-smoke.mjs`: united payout RLS/degradation/recovery with booking privacy, exact counts, count Realtime, HKT horizon, and lunch venue tests.
- `app/smoke.mjs`: united payout migration assertions with RSVP count/privacy/HKT/social/venue assertions; removed a duplicate `assert` declaration introduced by auto-merge.
- `supabase/tests/operational_backend_integration.sql`: retained payout authorization/RLS fixtures and all RSVP backfill, DELETE, boundary, venue, integrity, and Realtime fixtures.
- Auto-merged `store.js`/`views.js`: retained HKT/social/lunch behavior and routed Schedule, Activity Details, and grouped Admin RSVP totals through `attendeeCountFor`.

## Verification

- `node app/smoke.mjs`: pass
- `node app/live-auth-smoke.mjs`: pass
- JS/MJS syntax: 12 files pass; shell syntax: 6 files pass
- Three source safety harnesses: pass
- Conflict-marker, whitespace, scope, and Shop-path scans: pass
- `00006` SHA-256: `bc30621e742fb32d0469c763b11ffdf7268e729ac6280c7a4baef8c7201a4948`
- `00008` SHA-256: `6f63f34c87d8e6d008531180fe4885675a03dccd20526c3e0161165830654e37`
- Both migration files compare byte-identically with the RSVP owner tip.

## Review and concern

Focused RSVP/Admin coexistence review found no Critical or Important issue. No disposable database URL was available, so the direct operational verifier correctly refused to run; PostgreSQL replay remains unverified. No push was performed.
