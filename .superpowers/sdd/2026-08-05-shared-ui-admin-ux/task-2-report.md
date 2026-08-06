# Task 2 Report — Shared Async and Accessible Form Feedback

## Status

Complete.

## Files

- `app/index.html`
- `app/styles.css`
- `app/js/app.js`
- `app/live-auth-smoke.mjs`
- `app/smoke.mjs`
- `.superpowers/sdd/2026-08-05-shared-ui-admin-ux/task-2-report.md`

`app/js/views.js` required no template changes: the targeted controls and uniquely identified fields/error hosts were already present, and the reusable delegated helpers apply the dynamic accessibility semantics.

## Red / Green Tests

- Red: `node app/live-auth-smoke.mjs && node app/smoke.mjs` failed because an async route did not set `#view[aria-busy]`.
- Green: both smoke suites pass, including delayed route feedback, retained route UI on failure, duplicate Google action suppression, exact busy copy, control recovery, alert toast semantics, and form-feedback source/render contracts.
- Green: every `app/js/*.js` and `app/*.mjs` file passes `node --check`.
- Green: `git diff --check` passes.

## Commit

`feat(ui): add accessible async feedback` (this task commit; hash reported by the implementer)

## Concerns

None. Notification and Giving behavior were not changed.

## Fix Round 1

### Status

Complete. Route rendering now uses generations: stale renders cannot commit page DOM, redirect, append notification badges, surface stale errors, or clear the current render's `aria-busy`/delayed loader state. The Notification-specific handler was restored to its pre-Task-2 behavior.

### Regression Coverage

- Added a deterministic three-render overlap test. A stale middle completion must leave the current loader and busy state intact; the current Membership Details route commits; the oldest route then completes without replacing it.
- Added delegated sign-out rejection coverage beyond Google sign-in. It verifies the exact `Signing out…` label, duplicate suppression, control recovery, alert output, and absence of a success toast.
- Updated the boot/auth source contract to require the feedback-wrapped render.

### Commands and Results

- `node app/live-auth-smoke.mjs && node app/smoke.mjs` — PASS; focused live-auth regressions passed and the full smoke suite ended with `All smoke tests passed.`
- `for f in app/js/*.js app/*.mjs; do node --check "$f" || exit; done` — PASS; all JavaScript and MJS syntax checks exited 0.
- `git diff --check` — PASS; no whitespace errors.

### Concerns

None.
