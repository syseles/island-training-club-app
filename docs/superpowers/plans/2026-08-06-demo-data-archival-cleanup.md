# Demo Data Archival and Active-Branch Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the runnable demo at `archive/demo`, then remove named demo identities and fake operational records from every active branch while retaining genuine user-created state and branch-specific product work.

**Architecture:** Push a fixed historical archive ref first. Implement state-versioned cleanup per branch family because schemas diverge; fresh local state becomes identity/transaction-empty, while exact legacy sentinels remain only in migrations and migration tests. Propagate through safe ancestry only and tailor all divergent branches.

**Tech Stack:** Vanilla ES modules, localStorage versioned migrations, Supabase live mode, Node smoke suites, Git branches/worktrees

## Global Constraints

- Do not rewrite Git history, force-push, merge long-lived branches together, or delete branches.
- Preserve all unrelated untracked files.
- Create `archive/demo` exactly at `bd5e7cf` and push it before cleanup branches.
- Do not push cleanup branches until the user reviews the final commit list and verification evidence.
- Keep Shop catalog work only on `feature/shop-page`.
- Fresh state has no users, session, bookings, receipts, campaigns, donations, prayers, notifications, queues, or duty assignments.
- Preserve activities, Shop products, approved anniversary content, leaders, culture, safety copy, and weekly verses.
- Migrations remove only exact known demo identities and dependent fake records; unmatched user-created data survives.
- Tests use neutral `.example.test` fixtures and must not rely on fresh seeded identities.
- No live Supabase Auth user deletion is part of this plan.

---

### Task 1: Create and Verify the Demo Archive

**Files:** No file modifications.

**Interfaces:**
- Consumes: historical commit `bd5e7cf`.
- Produces: remote branch `origin/archive/demo` pointing exactly to `bd5e7cf`.

- [ ] Fetch `origin`, assert `archive/demo` does not exist locally or remotely, and assert `bd5e7cf^{commit}` exists.
- [ ] Create an isolated worktree at `.worktrees/archive-demo` with local branch `archive/demo` starting at `bd5e7cf`.
- [ ] Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, all `node --check` checks, and `git diff --check` in that worktree. Stop if any check fails.
- [ ] Push with `git push -u origin archive/demo` and verify `git ls-remote --heads origin refs/heads/archive/demo` equals `bd5e7cfdbb9c7f6d85bb27cb94a7cc20c2cd93b0`.
- [ ] Keep the branch and archive worktree intact until all active branches are cleaned.

---

### Task 2: Clean `main` Fresh State and Runtime UI

**Files:**
- Modify: `README.md`
- Modify: `app/js/data.js`
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: `resetLocalData(): State`; v9 migration; clean baseline behavior for the main-line branches.

- [ ] Add smoke assertions that fresh state has `users/bookings/receipts` empty; Account HTML excludes the three named emails, `data-action="demo-signin"`, “one-tap demo”, and `reset-demo`; activities remain; `baseBooked` is absent; generic fake announcements are absent.
- [ ] Add a mixed v8 migration fixture with the five exact demo identities, their seed bookings/receipts/session, plus `test-member-1` and a genuine booking/receipt. Assert only demo-owned records and simulated demand are removed.
- [ ] Run `node app/smoke.mjs` and confirm the new assertions fail before implementation.
- [ ] In `data.js`, remove `SEED_USERS`, `seedBookings`, `seedReceipts`, fake announcements, and `baseBooked`; preserve `SEED_ACTIVITIES`, leaders, and culture.
- [ ] In `store.js`, bump `STATE_VERSION` 8→9; make fresh identity/transaction arrays empty; remove obsolete seed imports and old seed-refresh dependencies; add an idempotent v9 exact-sentinel cleanup for IDs `u-super`, `u-admin`, `u-member`, `u-pend-1`, `u-pend-2` and normalized emails, dependent bookings/receipts, session, and `baseBooked`. Preserve unmatched records.
- [ ] Rename internal `resetDemo()` to `resetLocalData()` without reseeding identities. Remove `demoSignIn()`.
- [ ] Remove demo-signin/reset event cases and demo-directed failure copy from `app.js`.
- [ ] Remove one-tap buttons, seeded-email guidance, pending Admin-demo guidance, and reset button from `views.js`.
- [ ] Update README: local state starts empty; applying creates a local pending profile; Admin testing uses Supabase or `archive/demo`.
- [ ] Convert smoke setup to neutral fixtures written through localStorage, using `.example.test` emails and non-demo IDs. Retain exact legacy sentinels only inside migration tests.
- [ ] Run smoke, JS/MJS syntax, and `git diff --check`; inspect `git grep` for named emails in runtime/README.
- [ ] Commit exact files as `feat: remove demo data from main prototype`.

---

### Task 3: Port the Baseline Cleanup to Main-Line Feature Branches

**Branches:** `feature/community-page`, `feature/verse-pool`, `testing`

**Files per branch:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`.

**Interfaces:**
- Consumes: Task 2 main cleanup semantics.
- Produces: v9 clean-state migrations on all three branches.

- [ ] Create local tracking branches for remote-only `feature/verse-pool` and `testing` without changing their remote history.
- [ ] For each branch, add failing fresh-state/render/mixed-migration tests equivalent to Task 2 using neutral fixtures.
- [ ] Port the main cleanup with a normal merge only when conflict-free and branch-safe; otherwise apply a tailored commit. Do not overwrite branch-specific views/data.
- [ ] On `feature/community-page`, preserve only `ann-itc-turns-2` and its authored anniversary rendering; remove old fake announcements, seeded users/bookings/receipts, and simulated demand.
- [ ] On `feature/verse-pool`, preserve its verse pool exactly while removing demo runtime data.
- [ ] On `testing`, preserve test-branch-specific behavior while replacing runtime demo dependencies with neutral test fixtures.
- [ ] Bump each branch’s state version 8→9 and prove mixed-state migration preservation.
- [ ] On each of these three branches run `node app/smoke.mjs`, all tracked JS/MJS files through `node --check`, and `git diff --check`. None of these branch tips contains `app/live-auth-smoke.mjs`.
- [ ] Commit separately on each branch as `feat: remove demo data from <branch-purpose>`.

---

### Task 4: Clean the Modern Auth Baseline

**Branch:** `feature/auth-identity`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`, `app/live-auth-smoke.mjs`, current auth runbooks where demo instructions appear.

**Interfaces:**
- Produces: v11 identity cleanup compatible with local and Supabase auth modes.

- [ ] Add failing tests for empty fresh identities, no demo controls/copy, local application→pending sign-in, live Google sign-in unchanged, and mixed v10 migration preservation.
- [ ] Remove seeded identities and fake fundraiser announcement from `data.js`; retain activities, leaders, culture, and verses.
- [ ] Bump state version 10→11. Remove exact demo identities/session/dependent local records and legacy simulated fields while retaining real local applicants. Remove old seed-name refresh logic that requires `SEED_USERS`.
- [ ] Remove one-tap/reset handlers and UI; rename internal reset helper; make local not-found copy direct users to apply.
- [ ] Replace named smoke users with localStorage/application fixtures using neutral IDs/emails. Keep exact old IDs only in migration tests.
- [ ] Update README/runbook wording without changing Supabase schema or deleting live users.
- [ ] Run both smoke suites, syntax/safety checks, and diff/source scans.
- [ ] Commit as `feat(auth): remove seeded demo identities`.

---

### Task 5: Propagate Identity Cleanup Through Notifications

**Branch:** `feature/notification`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`, `app/live-auth-smoke.mjs`, `docs/runbooks/live-auth.md`, `docs/runbooks/admin-notifications-db-verification.md`.

**Interfaces:**
- Consumes: Task 4 clean Auth behavior.
- Produces: v11 clean local notification state; live notification behavior unchanged.

- [ ] Merge Task 4’s Auth cleanup into `feature/notification`, resolving only notification-specific conflicts.
- [ ] Add failing tests with neutral member/Admin fixtures for application, decision, role-change, and `giving_campaign_published` display/filter behavior; assert fresh local notification/account state is empty.
- [ ] Ensure the v11 migration filters demo-owned local notifications if this branch stores any, but preserves notifications belonging to unmatched users.
- [ ] Remove fake fundraiser announcement while retaining notification category support for real future Giving publications.
- [ ] Run smoke, live-auth smoke, notification shell safety tests, all syntax checks, and `git diff --check`.
- [ ] Commit notification-specific adjustments as `test(notifications): use clean account fixtures` if the merge commit alone is insufficient.

---

### Task 6: Propagate Cleanup Through Giving

**Branch:** `feature/giving-page`

**Files:** Auth/Notification baseline files plus Giving store/views/tests and Giving runbook/tests as applicable.

**Interfaces:**
- Consumes: Task 5 clean Notification branch.
- Produces: v12 migration with empty fresh campaigns/donations and no seeded identities.

- [ ] Merge Task 5 into Giving without reverting campaign management or donor-ID persistence.
- [ ] Add failing tests for fresh empty users/campaigns/donations; mixed v11 migration containing demo users, known donation sentinels, and genuine campaign/donation records; preserve genuine records not owned by demo identities.
- [ ] Bump state version 11→12 and remove demo identities plus their dependent donations while retaining Admin-created campaigns and gifts from unmatched users.
- [ ] Replace Giving tests’ demo accounts with neutral approved member/Admin fixtures. Keep campaign publication notification routing/filtering intact.
- [ ] Remove prefilled payment-card values and ensure mocked checkout remains functional with test-provided values.
- [ ] Run smoke, live-auth smoke, Notification/Giving safety verifiers, syntax checks, and `git diff --check`.
- [ ] Commit as `feat(giving): remove account demo dependencies`.

---

### Task 7: Clean Divergent `development`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`.

**Interfaces:** Produces v9 cleanup for development’s Giving/Shop preview state.

- [ ] Add failing tests for zero fresh users/bookings/receipts/donations/campaigns, no simulated demand, no demo UI, and mixed v8 migration preservation.
- [ ] Remove demo identities, bookings, receipts, Giving campaign/donations, fundraiser/generic announcements, demo UI, and prefilled card data. Preserve activities, Shop products, culture, leaders, and verses.
- [ ] Bump state version 8→9 and filter exact demo/dependent records without disturbing unmatched users or product configuration.
- [ ] Replace smoke demo dependencies with neutral fixtures; update README.
- [ ] Run all branch checks and commit as `feat: remove demo data from development`.

---

### Task 8: Clean Divergent Payment System

**Branch:** `feature/payment-system`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`.

**Interfaces:** Produces v10 cleanup of payment-specific local operational state.

- [ ] Add failing fresh/migration tests covering users, bookings, receipts, collectors, PayMe/FPS details, duty, queues, waitlists, interest lists, and notifications. Include unmatched user-created payment records that must survive.
- [ ] Remove demo identities, seed bookings/receipts, simulated demand, default collector/duty, fake payout details, fake queue/notification entries, demo UI, and prefilled card values. Preserve payment feature behavior and activity configuration.
- [ ] Bump state version 9→10; remove exact demo references from every payment-specific collection while preserving unmatched records.
- [ ] Rebuild payment smoke scenarios with neutral member/Admin fixtures created in test state rather than fresh application state.
- [ ] Update README and run full checks.
- [ ] Commit as `feat(payments): remove demo operational data`.

---

### Task 9: Clean Divergent Shop Branch

**Branch:** `feature/shop-page`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`.

**Interfaces:** Produces v9 clean identity/transaction state while preserving Shop catalog/product imagery.

- [ ] Add failing tests proving fresh users/bookings/receipts/donations/Giving campaign are empty and Shop products remain unchanged; add mixed v8 migration preservation.
- [ ] Remove demo identities, bookings/receipts, Giving fake campaign/donations, fundraiser announcements, simulated demand, demo UI, and prefilled checkout values.
- [ ] Preserve `SHOP_PRODUCTS`, merchandise imagery, Giving/Shop tab behavior specific to this branch, activities, leaders, culture, and verses.
- [ ] Bump state version 8→9 and remove exact demo/dependent records while retaining unmatched orders/gifts if represented.
- [ ] Replace smoke identities with neutral fixtures, update README, run full checks.
- [ ] Commit as `feat(shop): remove demo account data`.

---

### Task 10: Clean the Donor-ID Fix Branch

**Branch:** `fix/donor-id-save`

**Files:** `README.md`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/smoke.mjs`, `app/live-auth-smoke.mjs`.

**Interfaces:** Produces v11 clean state without importing later Giving campaign-management work.

- [ ] Add failing clean-state and mixed v10 migration tests using neutral donor/member/Admin fixtures.
- [ ] Apply a tailored identity/Giving demo cleanup; do not merge modern Giving campaign management merely to share code.
- [ ] Remove fake campaign/donations/announcement, seeded identities, demo UI, and prefilled values while preserving the donor-ID live-profile fix.
- [ ] Bump state version 10→11 and preserve unmatched donations/users.
- [ ] Run both smoke suites, syntax/safety checks, and diff scans.
- [ ] Commit as `feat(giving): remove demo data from donor fix branch`.

---

### Task 11: Cross-Branch Audit and Approval Gate

**Files:** No intended source changes; fixes discovered by verification receive branch-local commits and review.

- [ ] Fetch `origin`; for every target branch verify it is not behind its remote. Stop on unexpected remote movement and do not force-push.
- [ ] For every branch, run smoke, live-auth smoke where present, JS/MJS syntax, shell syntax/safety, and `git diff --check`.
- [ ] Run a source scan over each branch tip for named demo emails, one-tap/reset controls, fake campaign copy, `baseBooked`, seed booking/donation constructors, and prefilled card values. Classify any legacy IDs found only in migrations/tests.
- [ ] Verify `archive/demo` still points exactly to `bd5e7cf` and remains runnable.
- [ ] Inspect each branch diff to ensure Shop/Payment/Notification/Giving work did not cross branch boundaries.
- [ ] Confirm unrelated untracked files were never staged.
- [ ] Present branch-by-branch commits, diff stats, test evidence, retained migration sentinels, and any unresolved live Supabase account question to the user.
- [ ] Wait for explicit approval before pushing any cleanup branch.
- [ ] After approval, push each branch without force and verify every local/remote SHA matches.
