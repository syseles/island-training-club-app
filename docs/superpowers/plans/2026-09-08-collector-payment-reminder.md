# Collector Payment Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-out member HYROX payment reminders and an idempotent 4 PM collector reminder while preserving the existing 6 PM reconciliation summary.

**Architecture:** Keep notification scheduling at the existing cycle sweep seam. Local mode adds the same decision to `store.js`; live mode keeps Supabase authoritative by adding a preference column, a cycle sent-at column, and a narrow SECURITY DEFINER RPC called by `operations.js`. The view and store use the existing Privacy & Notifications route and application preference update path.

**Tech Stack:** Vanilla ES modules, localStorage prototype state, Supabase SQL migrations/RPCs, Node smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-08-collector-payment-reminder-design.md`

## Global Constraints

- BFT/Midtown share one 32-place pool; Quarry Bay remains separate.
- HKT checkpoints are Thursday 4 PM reminder, Thursday 6 PM payment deadline, Thursday 7 PM grace end, and Thursday 8 PM close.
- Live Supabase is authoritative; never fall back to local state.
- Collector notifications contain aggregate counts only and link to `#/admin/payments`.
- Existing bookings, queues, and migration compatibility must be preserved.
- No npm dependencies or build step.

---

### Task 1: Add failing coverage for reminder preference and collector reminder

**Files:**
- Modify: `app/smoke.mjs` near the existing HYROX checkpoint sweep and migration assertions.
- Test: `app/smoke.mjs` (the repository smoke suite is the test runner).

**Interfaces:**
- Consumes: existing `installLocalFixtures`, `store.scheduleHyroxCycle`, `store.reserveHyroxCycle`, `store.sweepHyroxCycleDeadlines`, `store.notificationsFor`.
- Produces: failing assertions for `hyroxPaymentReminders`, the new migration markers, and one collector aggregate notification.

- [ ] **Step 1: Add migration contract assertions** for `hyrox_payment_reminders`, `collector_payment_reminder_sent_at`, the RPC name, SECURITY DEFINER, and aggregate destination.
- [ ] **Step 2: Add a local RED test** that creates an opted-out member and an unpaid reservation, sweeps at `cycle.paymentDeadlineAt - 1 hour`, and asserts no `hyrox-payment-reminder` for that member.
- [ ] **Step 3: Extend the same RED fixture** with a collector sweep repeated at the same timestamp and assert exactly one `hyrox-collector-payment-reminder` notification with no member identity text.
- [ ] **Step 4: Run `node app/smoke.mjs` and confirm failure is caused by the missing new behavior, not a syntax error.

### Task 2: Implement local preference and collector reminder behavior

**Files:**
- Modify: `app/js/store.js` local application normalization, privacy updates, migration defaults, and `sweepHyroxCycleDeadlines`.
- Modify: `app/js/views.js` Privacy & Notifications edit and summary views.

**Interfaces:**
- Consumes: Task 1 assertions and existing `privacyPatch`, `localApplication`, `hydrateLiveUser`, `collectorFor`.
- Produces: `user.hyroxPaymentReminders` defaulting to true; local in-app preference persistence; one aggregate collector notification per cycle.

- [ ] **Step 1: Add the smallest local default/migration change** so absent `hyroxPaymentReminders` values normalize to `true` without overwriting explicit `false`.
- [ ] **Step 2: Gate only pooled HYROX member payment reminders on `user.hyroxPaymentReminders !== false`; keep holder-grace and promotion notifications unchanged.
- [ ] **Step 3: Add an idempotent local collector reminder at the same 4 PM checkpoint, selecting the assigned collector with `collectorFor(cycle.bftSessionId || cycle.midtownSessionId)` and including only confirmed, unmarked, and weekly-waitlist counts.
- [ ] **Step 4: Wire `hyrox_payment_reminders` through `localApplication`, `privacyPatch`, local update, live hydration mapping, and the Privacy & Notifications form/summary copy.
- [ ] **Step 5: Run the focused smoke command and confirm the new tests pass.

### Task 3: Add live schema and narrow reminder RPC

**Files:**
- Create: `supabase/migrations/20260908000001_collector_payment_reminders.sql`.
- Modify: `app/js/operations.js` live sweep wrapper.
- Modify: `app/js/store.js` live profile/application mapping if Task 2 did not cover all live fields.

**Interfaces:**
- Consumes: existing `sweep_hyrox_cycle_deadlines` RPC and live application/profile hydration.
- Produces: migration-safe preference/cycle columns, `send_hyrox_collector_payment_reminder(timestamptz)`, and a live sweep that invokes both authoritative RPCs.

- [ ] **Step 1: Add the migration with `ADD COLUMN IF NOT EXISTS`, SECURITY DEFINER member/collector reminder RPCs, least-privilege execute grants, and no table grants that expose booking rows.
- [ ] **Step 2: In the RPC, process cycles at `payment_deadline_at - interval '2 hours'`, lock with `FOR UPDATE SKIP LOCKED`, resolve the latest collector assignment, insert only aggregate counts, and timestamp only after a collector notification is inserted.
- [ ] **Step 3: Add the migration-owned notification trigger that suppresses only opted-out `operational_hyrox_payment_reminder` rows and leaves missing/NULL preferences enabled.
- [ ] **Step 4: Call the member RPC, existing deadline sweep, and collector RPC from `liveSweepHyroxDeadlines` with the same server time, then refresh operational state once.
- [ ] **Step 5: Run SQL text smoke assertions and JavaScript syntax checks.

### Task 4: Full verification and commit

**Files:**
- Modify: `app/live-auth-smoke.mjs` only if its existing privacy preference contract requires the new field.
- Modify: `app/smoke.mjs` only for final assertion wording or fixture cleanup.

- [ ] **Step 1: Run `node --check app/js/store.js`, `node --check app/js/operations.js`, `node --check app/js/views.js`, and `node --check app/smoke.mjs`.
- [ ] **Step 2: Run `node app/smoke.mjs` and inspect the complete output for failures.
- [ ] **Step 3: Run `git diff --check` and inspect `git diff --stat` plus the migration diff for scope.
- [ ] **Step 4: Commit the Group B implementation on `feature/collector-payment-reminder` with message `feat(hyrox): add collector payment reminders`.
