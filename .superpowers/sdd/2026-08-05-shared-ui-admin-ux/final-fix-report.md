# Final Fix Report — Shared UI / Admin UX

Date: 2026-08-05
Status: Complete
Commit: `fix(admin): address final shared UX review`

## Finding 1 — Authoritative mutations vs refresh failures

- `app/js/app.js:76-93` adds a shared Admin post-mutation refresh boundary. It announces authoritative success first, then reports a rejected refresh as a distinct stale-view error rather than an action failure.
- `app/js/app.js:397-413`, `449-475`, and `772-790` apply that boundary to revocation, approval/decline, and role changes. Retained stale controls are disabled after mutation success so users cannot retry an already-applied change. Decision cards also expose the stale-view message inline.
- Existing render-generation gating remains unchanged and is still used by every post-mutation refresh.
- `app/live-auth-smoke.mjs:983-1002` covers a successful live role mutation followed by a rejected Members refresh, including truthful success, distinct stale-view feedback, and retry prevention.
- `app/live-auth-smoke.mjs:1124-1148` covers a successful live approval followed by a rejected queue refresh, including authoritative mutation state, separate messages, retained-card locking, and inline alert output.

## Finding 2 — Visible route loader contract

- `app/styles.css:1113-1126` replaces undefined `--top-h` and `--panel` references with `top: 70px` and the defined `--surface-3` token.
- `app/smoke.mjs:1204-1209` verifies the loader uses the visible position/background declarations and rejects the undefined references.

## Finding 3 — Compact typography minimums

- `app/styles.css:227-241` raises bottom-navigation labels to 11px.
- `app/styles.css:826-834` raises form labels to 12px.
- `app/styles.css:584-590`, `615-619`, `653-668`, `769-776`, and `1034` raise the cited schedule/activity/member functional metadata to 12px.
- `app/smoke.mjs:1189-1203` adds selector-targeted minimum-size contracts for every cited area.

## Finding 4 — Admin semantics and filter focus

- `app/js/views.js:1334-1340` emits exactly one `aria-current="page"` on the active Admin tab.
- `app/js/app.js:753-764` restores focus to the corresponding status or role select after a successful filter rerender.
- `app/smoke.mjs:476-480` verifies the active-tab semantic contract.
- `app/smoke.mjs:1757-1773` behaviorally verifies corresponding status/role filter focus restoration while preserving non-persisted filter state.

## Verification

Fresh final run:

- `node app/live-auth-smoke.mjs` — PASS, exit 0 (6 reported checks).
- `node app/smoke.mjs` — PASS, exit 0 (`All smoke tests passed`, 227 reported checks; this suite also runs the live smoke subprocess).
- `for file in app/js/*.js app/*.mjs; do node --check "$file"; done` — PASS, exit 0.
- `git diff --check` — PASS, exit 0, no output.

## Self-review

- Scope is limited to shared UI/Admin implementation, CSS, and smoke coverage; no Shop, Giving, campaign, FPS, Notification-trigger, persistence-shape, or dependency changes were introduced.
- Local/live dispatch rules and backend-authoritative validation are preserved.
- Refresh handling continues through generation-safe `renderWithFeedback()`; no stale render can commit over a newer generation.
- No new concerns found. Previously deferred Minor findings remain outside this final Important-finding wave.
