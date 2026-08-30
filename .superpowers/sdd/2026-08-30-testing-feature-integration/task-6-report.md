# Task 6 — Sunday Schedule + HKT Verse Integration Report

## Merge

- First parent: `6d7b86dba92593d3720d4bf478d23bd291b70db8` (Task 5 integrated candidate)
- Second parent: `528ab3b76b67af295435e61d7ee2102692fa6b96` (exact Update Existing tip)
- Subject: `merge: integrate Sunday Schedule and HKT verse into testing candidate`
- Task 7, Testing fast-forward, and push were not started.

## Conflict and reconciliation

- Direct conflict: `app/smoke.mjs` only, matching the integration forecast.
- The import conflict was resolved by retaining modern `node:assert/strict` and rendered FPS helpers while adding Update Existing's `spawnSync` timezone harness.
- The Schedule conflict retained the modern chronological category filters (`All`, `Run`, `Water`, `Strength`, `HYROX`, `Socials`) and explicit assertions that Free/Paid chips remain absent, while adding Sunday boundary, Sunday-first strip, Week-of-Sunday, today/current-week, Sunday/offset-week, and exact seven-day navigation coverage.
- Modern local and live Schedule fixtures were changed from `mondayOf` to `sundayOf`, including RSVP count and lunch venue rendering. Home fixtures intentionally remain on `mondayOf`.
- `app/js/data.js` keeps `todayHktISO()` and `hktEventStartMs()`, adds pure `sundayOf()`, and rotates `weeklyVerse()` by HKT calendar days using the current instant by default.
- `app/js/views.js` keeps Home Monday-based and changes only member Schedule range/labels/selection to Sunday–Saturday via `scheduleSelectionForWeek()`.
- `app/js/app.js` delegates week navigation selection to that shared helper.
- Update Existing's three plan/spec files are byte-exact with the source tip.

## Modern-code preservation

- `components.js`, `documents.js`, `map.js`, `operations.js`, `store.js`, `venue.js`, `styles.css`, `index.html`, and all migrations are byte-identical to the Task 5 first parent.
- Source and smoke scans retain semantic Notification routing/read behavior, exact RSVP counts and HKT helpers, Payment/PayMe/FPS copy flows, Google auth/application gates, venue maps/meeting points/directions, and indemnity/emergency-contact behavior.
- Protected map/venue/document files and venue assets remain present.
- No runtime Free/Paid Schedule filters, retired FPS QR UI/copy, Shop paths, state-shape changes, or migration changes were introduced.

## TDD evidence

- HKT smoke first failed against Task 5 production because the fixed HKT-boundary instant selected `2 Timothy 4:7` under `America/Los_Angeles` instead of `Hebrews 12:1`.
- After the minimal HKT verse change, smoke failed on the missing exported `sundayOf` helper.
- After the minimal Schedule implementation, the full HKT smoke suite passed, followed by the full HKT/LA and live-auth verification matrix.

## Fresh post-commit verification

- `TZ=Asia/Hong_Kong node app/smoke.mjs`: pass (`All smoke tests passed.`)
- `TZ=America/Los_Angeles node app/smoke.mjs`: pass (`All smoke tests passed.`)
- `TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs`: pass
- `TZ=America/Los_Angeles node app/live-auth-smoke.mjs`: pass
- JavaScript/MJS syntax: 13 tracked files pass.
- Shell syntax: 6 tracked files pass.
- Admin Notification, Giving, and Operational safety self-tests: pass.
- Whitespace, conflict-marker, clean-status, scope, protected-deletion, and Shop-path checks: pass.
- Source scans: Home Monday, Schedule Sunday, HKT RSVP helpers present, modern feature markers present, no QR claims, and no Free/Paid runtime filters.
- Provenance: all five exact feature tips are ancestors; Task 6's second parent is exactly `528ab3b76b67af295435e61d7ee2102692fa6b96`.

## Review and concerns

Regression-focused review found no Critical, Important, or Minor issues. The review checked old-base code loss, Schedule-only Sunday semantics, HKT verse boundary/default instant, RSVP/live Schedule offsets, exact merge provenance, and preservation of Notification/Payment/count/auth/map/indemnity behavior.

This Pi session has no subagent tool, so an independent reviewer could not be dispatched; the required review template was applied directly as a read-only self-review. No disposable PostgreSQL replay was run because Task 6 changes no SQL or migrations; source safety self-tests passed. No Testing ref or remote was modified.
