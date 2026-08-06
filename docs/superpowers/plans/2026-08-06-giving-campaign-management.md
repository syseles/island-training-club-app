# Giving Campaign Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Remove Giving demo content, add one-campaign Admin management, and notify approved users on first publication.

**Architecture:** Local mode stores campaigns behind `store.js` with a versioned migration. Live mode uses a Supabase campaign table with RLS and transition/publication triggers. Async views/actions share the inherited route/busy/error infrastructure.

**Tech Stack:** Vanilla ES modules, localStorage, Supabase/Postgres, Node smoke tests, disposable local Supabase verification

## Constraints

- Work only on `feature/giving-page` after the Auth/Notification merge.
- Keep demo cleanup, database schema, and Admin/member UI in separate commits.
- Preserve visitor/pending/declined Giving access rules.
- No real payment processing or donation backend.
- Preserve genuine persisted donations and unrelated files.

---

### Task 1: Remove Giving Demo State Safely

**Files:** Modify `app/js/data.js`, `app/js/store.js`, `app/js/views.js`, `app/smoke.mjs`.

- [ ] Add failing tests that fresh state has `campaigns: []`, `donations: []`, no Standard Chartered/18450/seed references, and active campaign lookup returns null. Add migration fixture containing seed donation IDs plus a user donation and assert only seed IDs are removed and user donation remains.
- [ ] Bump `STATE_VERSION` from 10 to 11. Add `campaigns: []` to fresh state; replace seeded donations with `[]`. In `v < 11`, initialize campaigns if absent and filter exactly `d-seed-1`, `d-seed-2` from donations. Preserve all other state.
- [ ] Remove `GIVING_CAMPAIGN` and `seedDonations` exports/imports plus hardcoded base progress. Refactor donation/campaign helpers to accept/use a campaign record from state rather than a constant. Add local `campaigns()`, `activeGivingCampaign()`, and campaign-ID-aware raised/record functions sufficient for later tasks.
- [ ] Make approved `viewGiving()` render a safe “No active campaign right now” empty state when lookup is null; no progress/form/FPS/QR/transfer controls. Show genuine history only if present. Preserve non-approved locks.
- [ ] Run smoke/syntax/diff checks.
- [ ] Commit: `feat(giving): remove campaign demo data`.

---

### Task 2: Add Live Campaign Schema and Publication Notifications

**Files:** Create `supabase/migrations/20260805000011_giving_campaigns.sql`; create `supabase/tests/giving_campaigns_integration.sql`; modify verification runbook/script as appropriate; modify `app/smoke.mjs`.

- [ ] Add failing source contracts for table fields/status constraint/positive goal, one-published partial unique index, RLS roles, no delete, transition enforcement, exact publication kind/title/body, member/admin/super recipients, pending/declined exclusion, security definer/search path, and first-publish guard.
- [ ] Create table and touch trigger using existing `public.touch_updated_at()`. Add partial unique index for `status='published'` and another invariant/trigger enforcing at most one non-closed campaign (Draft or Published).
- [ ] Add `before update` transition function permitting Draft→Draft/Published, Published→Published/Closed, Closed→Closed; reject all others. Set published/closed timestamps consistently.
- [ ] Add RLS: Admin/Super Admin read all and insert/update; approved member reads Published only; pending/declined/visitor read none; no DELETE policy/grant.
- [ ] Add `after insert or update of status` publication trigger that fires only first publication (insert Published or OLD Draft→NEW Published), inserts `giving_campaign_published` with exact copy to profiles in `member/admin/super_admin`, and never duplicates on Published edits.
- [ ] Add executable SQL tests for migration application, audience fan-out, exclusions, duplicate suppression, one-open invariant, closed immutability/no republish, and member/admin/pending RLS. Extend the existing safe disposable Supabase verification path or add an equally safe Giving verifier.
- [ ] Start a disposable local Supabase project with Docker/absolute CLI, apply all migrations through `00011`, execute tests with container psql, record actual result, stop stack.
- [ ] Run app smoke/shell/diff checks.
- [ ] Commit: `feat(db): add Giving campaign management`.

---

### Task 3: Add Store APIs, Admin Giving Tools, and Active Member Flow

**Files:** Modify `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, `app/styles.css`, `app/live-auth-smoke.mjs`, `app/smoke.mjs`.

**Interfaces to produce:** async `listGivingCampaigns()`, `getActiveGivingCampaign()`, `saveGivingCampaign(draft)`, `publishGivingCampaign(id)`, `closeGivingCampaign(id)` for local/live modes.

- [ ] Write failing local/live store tests for empty list, create/edit draft, required publish validation, one-open invariant, publish, active lookup, published edit without duplicate state transition, close, closed immutability, and new draft after closure. Verify role guards and checked single-row Supabase mutations.
- [ ] Implement local actions behind state plus live Supabase queries/mutations. Normalize DB snake_case to the view model at the store seam. Validate title/description/goal/FPS ID/payee and allowed transitions before writes; DB remains authoritative live.
- [ ] Make `viewGiving()` async and await active campaign. Use active campaign fields throughout progress/FPS/record donation. Empty state has no sensitive controls; genuine history remains conditional.
- [ ] Add **Giving** to Admin tabs only on this branch. Render campaign status/list and Create campaign when no Draft/Published exists. Add `#/admin/campaign/new` and `#/admin/campaign/:id` routing/form with visible labels and accessible errors. Closed campaigns render read-only history.
- [ ] Add delegated save/publish/close actions using inherited busy controls. Publish validates all fields and confirms publication; Close confirms campaign name. Separate mutation success from refresh failure and never falsely report mutation failure.
- [ ] Ensure publication event appears through inherited Club updates filter and routes to Giving.
- [ ] Test Admin/Super access, member denial, local/live actions, empty/published Giving HTML, no demo copy, confirmations, busy/error recovery, and notification destination/category.
- [ ] Run full smoke/syntax/diff checks.
- [ ] Commit: `feat(giving): add Admin campaign management`.

---

### Task 4: Final Cross-Branch Verification

- [ ] Run both smoke suites, all JS/MJS syntax, shell syntax, safety tests, and `git diff --check`.
- [ ] Run clean disposable Supabase reset plus Notification and Giving database integration SQL; record pass and stop stack.
- [ ] Verify fresh UI has no campaign/history data, published flow works, Admin tools work, publication notification filters/routes correctly, and Archivo is the only normal UI font.
- [ ] Inspect branch log: demo cleanup, DB, and UI commits remain separate; no untracked files were added.
- [ ] Do not create an empty commit.
