# Same-Device FPS SDD Report

**Date:** 2026-08-30
**Branch:** `feature/payment-system`

## Design

Implemented the approved same-device FPS flow for paid bookings and Giving. Both surfaces now show the destination/payee, exact amount, reference, accessible destination/reference copy controls, and banking-app transfer steps. QR placeholders and claims were removed without changing payment, donation, authentication, or reconciliation state.

## TDD Evidence

- RED — `node app/smoke.mjs`: failed with `same-device booking FPS UI missing Assigned collector / payee`.
- GREEN — `node app/smoke.mjs`: passed after the view/CSS implementation.
- RED — `node app/live-auth-smoke.mjs`: failed because delegated `data-copy-value` was not copied.
- GREEN — `node app/live-auth-smoke.mjs`: passed after guarded destination/reference clipboard delegation and feedback were implemented.

The initial baseline smoke run also exposed a pre-existing date-sensitive Schedule assertion: on Sunday 2026-08-30, the next HYROX is in the following schedule week. The test now derives `weekOffset` from its selected session, matching the existing weekly venue test pattern. No Schedule or Admin Ops production code changed.

## Final Checks

- `node app/smoke.mjs` — passed; `All smoke tests passed.`
- `node app/live-auth-smoke.mjs` — passed.
- `node --check` over `app/js/*.js` and `app/*.mjs` — 12 files passed.
- Runtime QR/scan/embedded-amount search over `app/js`, `app/styles.css`, and `app/index.html` — no matches.
- `git diff --check` — passed.

## Boundaries and Concerns

- No store, Supabase, schema, dependency, or Admin Ops production changes.
- Payments remain mocked and require the existing member declaration plus collector reconciliation.
- Clipboard access still depends on browser support and permission. Unsupported or rejected writes announce an error and leave visible values available for manual selection.
