# Latest Feature Branches to Testing Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the approved Admin Ops, RSVP Events, Notification Routing, Payment System, and Update Existing branch tips into `testing` while preserving every named behavior and proving their cross-feature interactions before pushing.

**Architecture:** Start from immutable Testing baseline `9b7b9ca`, commit this plan on the isolated integration branch, then merge the five approved tips sequentially with explicit `--no-ff` merge commits. Reconcile shared JavaScript and test files by composing each branch’s behavior rather than choosing one side; keep migrations `00005`, `00006`, `00007`, and `00008` byte-for-byte from their owning tips. Add focused combined regressions, run local/live/disposable-database gates, obtain a read-only review after every merge task and one final review, then fast-forward the dedicated `testing` worktree and push only `testing`.

**Tech Stack:** Vanilla JavaScript ES modules, string-template HTML, CSS, `localStorage`, Supabase/PostgreSQL migrations and Realtime, Node smoke scripts, Bash safety verifiers, Git worktrees and merge commits.

**Spec:** `AGENTS.md`; `docs/superpowers/specs/2026-08-29-payme-weekly-event-controls-design.md`; `docs/superpowers/specs/2026-08-28-generic-social-preview-design.md`; `docs/superpowers/specs/2026-08-29-live-lunch-venue-override-design.md`; `docs/superpowers/specs/2026-08-29-semantic-notification-routing-design.md`; `docs/superpowers/specs/2026-08-30-same-device-fps-design.md`; `docs/superpowers/specs/2026-08-30-sunday-first-member-schedule-design.md`; `docs/superpowers/plans/2026-08-30-weekly-verse-hkt-boundary.md`.

## Global Constraints

- Use only `/Users/selesli/projects/island-training-club-app/.worktrees/testing-latest-integration` on branch `work/testing-latest-integration` for integration and reconciliation.
- Baseline `testing` and `origin/testing` must remain `9b7b9ca7d891b7448122295507566aeb1596db3e` until the final fast-forward.
- Merge exactly these immutable tips in this order: Admin Ops `f6d559920d4585338eee6ed7311c9c72832de0ff`, RSVP Events `218fce7e96d86831ffc409aa59d4e949d7cb8b61`, Notification Routing `b42a684bdfcfd51357e15a6d8821b9f211772f51`, Payment System `46f49377f97e0fe15230e8096f31819a771a6dec`, Update Existing `528ab3b76b67af295435e61d7ee2102692fa6b96`.
- Every feature tip must enter through its own `git merge --no-ff` merge commit; do not squash, rebase, cherry-pick, or rewrite a feature branch.
- Preserve RSVP exact counts, identity-free Realtime updates, and Hong Kong time boundaries; RSVP notifications route to exact Activity Details.
- Preserve Admin Weekly Event Controls, PayMe normalization/handoff/note copying, authoritative payout saves, and optional assigned-payout hydration.
- Preserve paid notification routing to exact Payment, RSVP routing to exact Activity Details, successful unread removal/count updates, and failed-read non-navigation.
- Remove all paid-booking and Giving FPS QR placeholders/claims/CSS; preserve same-device destination/reference copying, manual bank-app guidance, and existing mocked reconciliation.
- Preserve Sunday-first member Schedule only; Home and Admin remain Monday-based.
- Preserve weekly verse rotation at Sunday midnight in `Asia/Hong_Kong`, independent of host timezone.
- Preserve indemnity acceptance, emergency-contact fields, venue maps/meeting points/directions, Google auth/application approval, role gating, Giving, and existing localStorage migrations.
- Preserve `supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql`, `20260829000006_lunch_venue_meeting_point_rpc.sql`, `20260829000007_notification_destinations.sql`, and `20260829000008_rsvp_integrity.sql` exactly from their owning tips.
- `app/js/store.js` remains the sole localStorage seam. Do not change the persisted shape or remove keys without a new versioned migration.
- No Shop/merchandise work, dependency, build step, service worker, real payment, real outbound notification, framework, or repository restructure.
- The user has approved the final merge after all integrated checks and reviews pass; do not add another approval pause.
- Do not fast-forward or push `testing` until every automated gate and the final review pass. Never run a destructive SQL verifier against a linked, shared, staging, or production database.

## File Responsibility Map

- `app/js/app.js` — retain semantic notification opening/read behavior, RSVP handlers, Sunday Schedule navigation, safe copy handlers, and authoritative payout form submission.
- `app/js/data.js` — retain HKT event helpers, semantic notification fallbacks, `mondayOf`, new `sundayOf`, and HKT Sunday verse arithmetic.
- `app/js/operations.js` — compose core operational hydration with two independent optional enrichments: assigned payout rows and RSVP counts; retain both Realtime tables.
- `app/js/store.js` — retain PayMe validation/payout consistency, exact attendee counts, HKT session horizons, RSVP lifecycle, notification normalization/read persistence, venue/auth/indemnity seams, and existing state migrations.
- `app/js/views.js` — compose Weekly Event Controls, exact RSVP totals, semantic notification destinations, normalized PayMe and payment note, same-device FPS copy UI, Sunday Schedule, and HKT verse output.
- `app/styles.css` — remove only the unused `.fps-qr` mock-block rules.
- `app/test-html.mjs` — provide exact escaped display/copy binding assertions for paid booking and Giving FPS controls.
- `app/smoke.mjs` — retain all branch tests and add cross-feature route/payment/count/Schedule regressions.
- `app/live-auth-smoke.mjs` — retain live fake-Supabase tests and add combined payout/count degradation and recovery coverage.
- `supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql` — narrow assigned-collector payout hydration RPC, owned by Admin Ops.
- `supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql` — authoritative six-argument lunch/WNT venue RPC and compatibility wrapper, owned by RSVP Events.
- `supabase/migrations/20260829000007_notification_destinations.sql` — exact semantic notification route trigger/resolvers/backfill, owned by Notification Routing.
- `supabase/migrations/20260829000008_rsvp_integrity.sql` — RSVP integrity, exact aggregate table/trigger/RPC, HKT guards, and Realtime publication, owned by RSVP Events.
- `supabase/tests/operational_backend_integration.sql` — combine all payout, venue, RSVP count/integrity, HKT, and notification destination SQL assertions.
- Branch-owned files under `docs/superpowers/` and `.superpowers/sdd/` — retain historical design, plan, and review evidence unchanged unless conflict markers require a mechanical merge.

---

### Task 1: Lock Provenance and Prepare the Isolated Integration Branch

**Files:**
- Create/commit: `docs/superpowers/plans/2026-08-30-latest-feature-branches-to-testing.md`
- Do not modify application or migration files.

**Interfaces:**
- Consumes: clean Testing baseline `9b7b9ca7d891b7448122295507566aeb1596db3e` and five immutable feature tips.
- Produces: `work/testing-latest-integration` with one documentation commit whose first parent is exactly the Testing baseline.

- [ ] **Step 1: Enter the existing isolated worktree and verify branch/baseline**

```bash
cd /Users/selesli/projects/island-training-club-app/.worktrees/testing-latest-integration
test "$(git branch --show-current)" = "work/testing-latest-integration"
test "$(git rev-parse HEAD)" = "9b7b9ca7d891b7448122295507566aeb1596db3e"
git status --short --branch
```

Expected: the only worktree change is this plan file; no application, migration, asset, or test file is modified.

- [ ] **Step 2: Fetch and lock all remote tips**

```bash
git fetch --prune origin
test "$(git rev-parse origin/testing)" = "9b7b9ca7d891b7448122295507566aeb1596db3e"
test "$(git rev-parse origin/feature/admin-ops)" = "f6d559920d4585338eee6ed7311c9c72832de0ff"
test "$(git rev-parse origin/feature/rsvp-events)" = "218fce7e96d86831ffc409aa59d4e949d7cb8b61"
test "$(git rev-parse origin/feature/notification-routing)" = "b42a684bdfcfd51357e15a6d8821b9f211772f51"
test "$(git rev-parse origin/feature/payment-system)" = "46f49377f97e0fe15230e8096f31819a771a6dec"
test "$(git rev-parse origin/feature/update-existing)" = "528ab3b76b67af295435e61d7ee2102692fa6b96"
```

Expected: all six assertions exit 0. If any ref moved, stop; this plan is explicitly scoped to these hashes.

- [ ] **Step 3: Record branch ancestry and expected conflict forecast**

```bash
for tip in \
  f6d559920d4585338eee6ed7311c9c72832de0ff \
  218fce7e96d86831ffc409aa59d4e949d7cb8b61 \
  b42a684bdfcfd51357e15a6d8821b9f211772f51 \
  46f49377f97e0fe15230e8096f31819a771a6dec \
  528ab3b76b67af295435e61d7ee2102692fa6b96
do
  printf '%s merge-base %s\n' "$tip" "$(git merge-base 9b7b9ca7d891b7448122295507566aeb1596db3e "$tip")"
  git log --oneline --reverse 9b7b9ca7d891b7448122295507566aeb1596db3e.."$tip"
done
```

Expected: Admin, Notification, and Payment are based directly on `9b7b9ca`; RSVP is based on `fdf6449`; Update Existing is based on `32f400b`. The old Update Existing base is why its merge must be reviewed for semantic regressions even where Git auto-merges.

- [ ] **Step 4: Run baseline smoke and syntax checks before changing behavior**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for file in $(git ls-files '*.js' '*.mjs'); do node --check "$file"; done
git diff --check
```

Expected: `app/live-auth-smoke.mjs` and syntax checks pass. On Sunday 2026-08-30, baseline `app/smoke.mjs` has the known date-sensitive “schedule row should surface the notice” failure; Task 5’s incoming Payment test stabilization must resolve it without changing production Schedule behavior. Record any additional baseline failure and stop.

- [ ] **Step 5: Commit only the integration plan**

```bash
git add docs/superpowers/plans/2026-08-30-latest-feature-branches-to-testing.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs: plan latest feature branch integration"
```

Expected: the cached path list contains exactly the plan path.

---

### Task 2: Merge and Review Admin Ops

**Files:**
- Merge/inspect: `app/js/app.js`, `app/js/operations.js`, `app/js/store.js`, `app/js/views.js`
- Merge/test: `app/smoke.mjs`, `app/live-auth-smoke.mjs`, `supabase/tests/operational_backend_integration.sql`
- Add unchanged from tip: `supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql`
- Merge unchanged branch documentation/evidence under `docs/superpowers/` and `.superpowers/sdd/`.

**Interfaces:**
- Consumes: baseline payout phone from Membership Details and existing weekly/free/paid controls.
- Produces: `normalizePayMeLink(raw): string`, optional assigned-payout hydration with `operationalStateStatus().payoutError`, authoritative async payout save, copyable PayMe note, and grouped Weekly Event Controls.

- [ ] **Step 1: Start a non-fast-forward, no-commit merge**

```bash
git merge --no-ff --no-commit f6d559920d4585338eee6ed7311c9c72832de0ff
```

Expected: Git’s baseline forecast is a clean merge. Do not commit until the staged diff is inspected.

- [ ] **Step 2: Inspect the Admin merge contract**

```bash
test -z "$(git diff --name-only --diff-filter=U)"
git diff --cached --stat
git diff --cached -- app/js/app.js app/js/operations.js app/js/store.js app/js/views.js
```

Confirm the staged code contains all of these exact contracts:

```js
normalizePayMeLink(raw)
operationalStateStatus().payoutError
get_assigned_collector_payout_profiles
await store.updateCollectorPayouts(member.id, { paymeLink, fpsPhone: profilePhone })
```

Confirm `app/js/views.js` contains one top-level `Weekly Event Controls`, nested `Free & RSVP Events` and `Paid Sessions`, a separate `One-off Events`, and `Finalize with gym` only under Payments.

- [ ] **Step 3: Prove migration `00005` is byte-for-byte from its owner**

```bash
git diff --exit-code f6d559920d4585338eee6ed7311c9c72832de0ff -- \
  supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql
```

Expected: no output and exit 0.

- [ ] **Step 4: Run the Admin task gate and commit the merge**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --cached --check
git commit -m "merge: integrate Admin Ops into testing candidate"
```

Expected: both smoke suites pass and the commit has two parents.

- [ ] **Step 5: Request a read-only task review before proceeding**

```bash
BASE_SHA=$(git rev-parse HEAD^1)
HEAD_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^2)" = "f6d559920d4585338eee6ed7311c9c72832de0ff"
```

Use `superpowers:requesting-code-review` with description “Admin Ops merge: PayMe normalization/handoff, payout authorization/degradation, and grouped weekly controls,” requirements from Task 2 and the Global Constraints, and range `$BASE_SHA..$HEAD_SHA`. The reviewer must specifically inspect payout-cache mutation timing, assigned-row RLS scope, missing-RPC degradation, PayMe URL validation, and control ownership. Fix every Critical or Important finding before Task 3; commit review fixes as:

```bash
git add app/js/app.js app/js/operations.js app/js/store.js app/js/views.js \
  app/smoke.mjs app/live-auth-smoke.mjs supabase/tests/operational_backend_integration.sql
git commit -m "fix(integration): address Admin Ops review"
```

Do not create that fix commit when the review has no required changes.

---

### Task 3: Merge and Reconcile RSVP Events

**Files:**
- Merge/reconcile: `app/js/operations.js`, `app/js/store.js`, `app/js/views.js`
- Merge/reconcile tests: `app/smoke.mjs`, `app/live-auth-smoke.mjs`, `supabase/tests/operational_backend_integration.sql`
- Merge: `app/js/data.js`
- Add unchanged from tip: `supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql`, `supabase/migrations/20260829000008_rsvp_integrity.sql`
- Merge unchanged RSVP/social specs and plans.

**Interfaces:**
- Consumes: Admin optional payout enrichment and grouped weekly controls.
- Produces: `attendeeCountFor(session): number`, `liveRsvpCountFor(sessionId): number|null`, `nextSocialSession(): object|null`, HKT horizon/start helpers, exact RSVP Realtime counts, lunch venue overrides, and optional `rsvpCountError` alongside `payoutError`.

- [ ] **Step 1: Start the RSVP merge and list conflicts**

```bash
git merge --no-ff --no-commit 218fce7e96d86831ffc409aa59d4e949d7cb8b61 || true
git diff --name-only --diff-filter=U
```

Expected from the branch interaction: conflicts in `app/js/operations.js`, `app/live-auth-smoke.mjs`, `app/smoke.mjs`, and `supabase/tests/operational_backend_integration.sql`. Inspect any additional conflict instead of accepting a whole side.

- [ ] **Step 2: Reconcile operational hydration as two independent enrichments**

In `app/js/operations.js`, retain the Admin assigned-payout fetch and RSVP count fetch in the same hydration. The resolved structure must follow this composition:

```js
const [
  sessions, bookings, queues, receipts, assignments, payouts,
  assignedPayouts, templates, venueOverrides, rsvpCounts,
] = await Promise.all([
  supabase.from("operational_sessions").select("*").gte("session_date", since).order("session_date"),
  supabase.from("operational_bookings").select("*"),
  supabase.from("operational_queue_entries").select("*")
    .or("status.eq.active,status.eq.promoted,status.eq.dissolved")
    .order("joined_at"),
  supabase.from("operational_receipts").select("*").order("issued_at", { ascending: false }),
  supabase.from("collector_assignments").select("*"),
  supabase.from("collector_payout_profiles").select("*"),
  fetchAssignedPayoutRows(),
  supabase.from("operational_activity_templates").select("*").order("activity_id"),
  supabase.from("operational_session_venue_overrides").select("*"),
  fetchRsvpCounts(),
]);
```

Only core table reads belong in the fatal `result.error` loop. Merge direct payout rows with assigned rows, return both optional error channels, and initialize successful empty RSVP aggregates to exact zero:

```js
return {
  sessions: (sessions.data || []).map((row) => buildSessionRow(row, templatesById)),
  templates: templateRows,
  bookings: (bookings.data || []).map(buildBookingRow),
  queues: (queues.data || []).map(buildQueueRow),
  receipts: (receipts.data || []).map(buildReceiptRow),
  assignments: (assignments.data || []).map(buildAssignmentRow),
  payouts: [...payoutRowsByProfile.values()].map(buildPayoutRow),
  payoutError: assignedPayouts.error,
  venueOverrides: (venueOverrides.data || []).map(buildVenueOverrideRow),
  rsvpCounts: rsvpCounts.rows,
  rsvpCountError: rsvpCounts.error,
};
```

Retain both `collector_payout_profiles` and `operational_rsvp_counts` in `LIVE_TABLES` and in `startOperationalRealtime()`. `operationalStateStatus()` must expose both `payoutError` and `rsvpCountError` without setting core `error` for either enrichment failure.

- [ ] **Step 3: Reconcile store and view semantics**

Keep RSVP’s HKT horizon, `nextSocialSession`, authoritative `session.activityId` venue resolution, and count seam. In `app/js/views.js`, preserve Admin’s grouping but replace identity-derived Admin lunch totals with the exact count seam:

```js
<p class="muted small mt8">${store.attendeeCountFor(s)} going${s.capacity != null ? ` · cap ${s.capacity}` : ""}</p>
```

Schedule’s unbooked/owner RSVP rows, Activity Details, and Admin must all call `store.attendeeCountFor(s)`. `store.attendeesFor(s)` remains only for attendee-name formatting such as gym messages; do not persist fake identities to make counts work.

Update the RSVP smoke assertions that refer to old top-level `Weekly Venue Overrides` / `Weekly Session Overrides` so they inspect `Weekly Event Controls`, `Free & RSVP Events`, and `Paid Sessions` while retaining the same control checks.

- [ ] **Step 4: Reconcile live and SQL tests by semantic union**

In `app/live-auth-smoke.mjs`, retain:

- Admin’s missing/forbidden assigned-payout cases and cold-member recovery;
- RSVP’s exact zero, foreign-member aggregate, count-table Realtime, exact `+1/-1`, HKT horizon, lunch venue, and identity-empty cases;
- both error fields in status assertions;
- a Realtime handler count that includes both new tables.

In `supabase/tests/operational_backend_integration.sql`, preserve Admin payout authorization/RLS assertions and all RSVP `00006`/`00008` venue, count, trigger, ordinary-free refusal, paid-vs-RSVP HKT boundary, backfill, DELETE, and Realtime assertions. Keep HKT-relative future fixtures; do not restore stale literal future assumptions.

- [ ] **Step 5: Resolve markers and prove migrations `00006` and `00008`**

```bash
git add app/js/data.js app/js/operations.js app/js/store.js app/js/views.js \
  app/smoke.mjs app/live-auth-smoke.mjs supabase/tests/operational_backend_integration.sql \
  supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql \
  supabase/migrations/20260829000008_rsvp_integrity.sql \
  docs/superpowers/plans docs/superpowers/specs
test -z "$(git diff --name-only --diff-filter=U)"
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)' -- . ':!docs/superpowers/plans/2026-08-30-latest-feature-branches-to-testing.md'
git diff --exit-code 218fce7e96d86831ffc409aa59d4e949d7cb8b61 -- \
  supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql \
  supabase/migrations/20260829000008_rsvp_integrity.sql
```

Expected: no unresolved markers and both migration comparisons exit 0.

- [ ] **Step 6: Run the RSVP task gate and commit the merge**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --cached --check
git commit -m "merge: integrate RSVP Events into testing candidate"
```

Expected: all branch behavior tests pass together and the merge commit’s second parent is the RSVP tip.

- [ ] **Step 7: Request the RSVP/Admin coexistence review**

```bash
BASE_SHA=$(git rev-parse HEAD^1)
HEAD_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^2)" = "218fce7e96d86831ffc409aa59d4e949d7cb8b61"
```

Use `superpowers:requesting-code-review` for Task 3 and `$BASE_SHA..$HEAD_SHA`. Require review of the two optional hydration errors, exact public count privacy, count-table Realtime, HKT start/date boundaries, lunch six-argument RPC, exact count use inside grouped Admin controls, and SQL fixture stability. Resolve Critical/Important findings and commit only required changes with `fix(integration): address RSVP Events review` before proceeding.

---

### Task 4: Merge and Reconcile Semantic Notification Routing

**Files:**
- Merge/inspect: `app/js/app.js`, `app/js/data.js`, `app/js/store.js`, `app/js/views.js`
- Merge/reconcile: `app/smoke.mjs`, `app/live-auth-smoke.mjs`, `supabase/tests/operational_backend_integration.sql`
- Add unchanged from tip: `supabase/migrations/20260829000007_notification_destinations.sql`
- Merge unchanged Notification specs/plans/review reports.

**Interfaces:**
- Consumes: exact paid booking IDs, exact RSVP session IDs, unread notification rows, Payment and Activity routes.
- Produces: `notificationDestination(kind, destination): string`, unread-only Inbox rendering, local/live read persistence, and route-after-read behavior.

- [ ] **Step 1: Start the Notification merge**

```bash
git merge --no-ff --no-commit b42a684bdfcfd51357e15a6d8821b9f211772f51 || true
git diff --name-only --diff-filter=U
```

Expected interaction conflicts are concentrated in `app/smoke.mjs` and `supabase/tests/operational_backend_integration.sql`; retain all already-integrated payout/RSVP assertions around the Notification additions.

- [ ] **Step 2: Preserve exact routing and unread behavior**

Verify `app/js/data.js` accepts only explicit internal `#/` destinations, uses `#/account/payments` for unresolved paid member events, `#/schedule` for unresolved RSVP/session events, stable Admin/Giving routes, and `#/account` for unknown kinds.

Verify the `notification-open` handler performs this order:

```js
await store.markNotificationRead(el.dataset.notificationId);
notificationRouteRows = notificationRouteRows.filter(
  (row) => row.id !== el.dataset.notificationId
);
commitNotificationCount(notificationRouteRows.filter((row) => !row.read_at).length, true);
location.hash = destination;
```

A failed read must toast an error and exit before navigation. A successful read remains successful even if destination rendering later fails. Local notification normalization must map existing `read/link/createdAt` to `read_at/destination/created_at` without adding those live-shaped fields to persisted local rows.

- [ ] **Step 3: Reconcile SQL tests without weakening prior migrations**

Keep the HKT-relative reservation/queue/defer fixtures from Notification review fixes. Add Notification assertions around the integrated payout/RSVP SQL rather than replacing them. Preserve exact paid destinations constructed as `` `#/pay/${booking.id}` ``, RSVP destinations constructed as `` `#/activity/${session.id}` ``, payment approval/deferral Booking Details, Admin payment routes, unique-only historical backfill, explicit destination precedence, read state, and ambiguous-row refusal.

- [ ] **Step 4: Prove migration `00007` and commit**

```bash
git add app/js/app.js app/js/data.js app/js/store.js app/js/views.js \
  app/smoke.mjs app/live-auth-smoke.mjs supabase/tests/operational_backend_integration.sql \
  supabase/migrations/20260829000007_notification_destinations.sql \
  docs/superpowers/plans docs/superpowers/specs .superpowers/sdd
test -z "$(git diff --name-only --diff-filter=U)"
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)'
git diff --exit-code b42a684bdfcfd51357e15a6d8821b9f211772f51 -- \
  supabase/migrations/20260829000007_notification_destinations.sql
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --cached --check
git commit -m "merge: integrate Notification Routing into testing candidate"
```

Expected: both smoke suites pass, `00007` matches its owner, and the merge has Notification as second parent.

- [ ] **Step 5: Request the Notification task review**

```bash
BASE_SHA=$(git rev-parse HEAD^1)
HEAD_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^2)" = "b42a684bdfcfd51357e15a6d8821b9f211772f51"
```

Use `superpowers:requesting-code-review` for Task 4 and `$BASE_SHA..$HEAD_SHA`. Require inspection of route ownership/privacy, exact-vs-historical resolver matching, read-before-route ordering, failed-read behavior, unread hiding/count, HKT-relative SQL fixtures, and coexistence with `00005/00006/00008`. Fix Critical/Important findings with a tested `fix(integration): address Notification Routing review` commit.

---

### Task 5: Merge and Reconcile Same-Device FPS with PayMe

**Files:**
- Merge/reconcile: `app/js/app.js`, `app/js/views.js`, `app/styles.css`
- Merge/reconcile tests: `app/smoke.mjs`, `app/live-auth-smoke.mjs`
- Add: `app/test-html.mjs`
- Merge unchanged Payment spec/plan/report.

**Interfaces:**
- Consumes: validated collector PayMe link, Membership Details FPS phone, booking snapshot, member identity, booking ID, Giving campaign destination/reference.
- Produces: accurate PayMe handoff and note copy plus QR-free same-device FPS destination/reference copy for paid booking and Giving.

- [ ] **Step 1: Start the Payment merge and inspect overlap**

```bash
git merge --no-ff --no-commit 46f49377f97e0fe15230e8096f31819a771a6dec || true
git diff --name-only --diff-filter=U
```

Pay particular attention to `app/js/app.js`, `app/js/views.js`, `app/smoke.mjs`, and `app/live-auth-smoke.mjs`: Admin owns PayMe validation/note/degraded payout behavior while Payment owns QR removal and destination/reference copy behavior.

- [ ] **Step 2: Compose the paid Payment view instead of selecting one side**

The final `viewPay(bookingId)` must derive both payment artifacts:

```js
const payouts = collector ? store.collectorPayoutsFor(collector.id) : null;
const payme = payouts?.paymeLink || collector?.paymeLink || "";
const fps = payouts?.fpsPhone || collector?.fpsPhone || "";
const paymentReference = bookingPaymentReference(b);
const memberName = user.fullName || user.preferredName || "ITC Member";
const paymentNote = `${s.name} · ${fmtDate(s.dateISO)} · ${s.location || "Venue TBC"} · ${memberName}`;
```

Retain Admin’s conditional absolute PayMe anchor/disabled FPS fallback and accurate “enter the displayed amount” copy. Retain `data-action="copy-payment-note"` with escaped `data-note`.

Replace only the FPS portion with Payment’s lines and controls:

```js
const fpsTransferDetails = `
  <div class="receipt-lines">
    <div class="line"><span>Assigned collector / payee</span><strong>${cname}</strong></div>
    <div class="line"><span>FPS mobile number</span><strong class="mono">${fps ? esc(fps) : "Not available"}</strong></div>
    <div class="line"><span>Exact amount</span><strong>${fmtMoney(s.price)}</strong></div>
    <div class="line total"><span>Suggested reference</span><strong class="mono">${esc(paymentReference)}</strong></div>
  </div>
  <div class="btn-row two">
    ${fps ? `<button class="btn ghost" type="button" data-action="copy-fps"
      data-copy-value="${esc(fps)}" data-copy-kind="number" aria-label="Copy FPS number">Copy FPS number</button>` : ""}
    <button class="btn ghost" type="button" data-action="copy-reference"
      data-copy-value="${esc(paymentReference)}" data-copy-kind="reference" aria-label="Copy payment reference">Copy reference</button>
  </div>`;
```

Prefill the existing mark-paid `ref` input with `paymentReference`. Preserve method selection, mark-paid, collector confirmation, receipts, and the mock-payment boundary.

- [ ] **Step 3: Compose delegated copy behavior**

Retain a guarded `copy-payment-note` handler and Payment’s guarded shared handler for `copy-fps` / `copy-reference`. Both must reject empty values, feature-detect `navigator.clipboard.writeText`, await/catch rejection, and use error toasts without changing payment state. Success labels remain specific: FPS ID, FPS number, payment reference, Giving reference, and PayMe payment note.

- [ ] **Step 4: Preserve QR-free Giving and remove only dead CSS**

Keep Giving’s FPS ID, payee, exact amount, generated reference, `copy-fps`/`copy-reference` buttons, ordered same-device instructions, transfer declaration, thank-you state, donor ID, history, and role gating. Remove `.fps-qr` from `app/styles.css`; do not change unrelated cards or tokens.

- [ ] **Step 5: Reconcile tests and enforce the source scan**

Retain Admin PayMe tests and Payment’s `assertFpsCopyBindings` tests for escaped display/data values. Paid booking assertions must cover PayMe fallback/note and same-device FPS in the same rendered view. Giving retains its own exact binding test.

```bash
git add app/js/app.js app/js/views.js app/styles.css app/test-html.mjs \
  app/smoke.mjs app/live-auth-smoke.mjs docs/superpowers/plans \
  docs/superpowers/specs docs/superpowers/reports
test -z "$(git diff --name-only --diff-filter=U)"
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)'
if rg -n -i 'fps-qr|fps qr|scan with your banking app|amount is embedded' \
  app/js app/styles.css app/index.html; then
  echo "Retired FPS QR UI or claim remains" >&2
  exit 1
fi
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --cached --check
git commit -m "merge: integrate Payment System into testing candidate"
```

Expected: no retired FPS QR UI/copy, both smoke suites pass, and both PayMe and same-device FPS behavior remain.

- [ ] **Step 6: Request the Payment/Admin coexistence review**

```bash
BASE_SHA=$(git rev-parse HEAD^1)
HEAD_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^2)" = "46f49377f97e0fe15230e8096f31819a771a6dec"
```

Use `superpowers:requesting-code-review` for Task 5 and `$BASE_SHA..$HEAD_SHA`. Require inspection of URL safety, escaping parity, clipboard failures, QR removal, missing FPS data, Payment notification compatibility, Giving role gates, and unchanged reconciliation. Fix Critical/Important findings with `fix(integration): address Payment System review` and rerun both smoke suites.

---

### Task 6: Merge Sunday Schedule and HKT Verse Without Regressing Modern Code

**Files:**
- Merge/inspect: `app/js/app.js`, `app/js/data.js`, `app/js/views.js`
- Merge/reconcile: `app/smoke.mjs`
- Merge unchanged Update Existing specs/plans.

**Interfaces:**
- Consumes: `mondayOf(date)`, HKT date/event helpers, current Schedule state/navigation, weekly verse list.
- Produces: `sundayOf(date): Date`, `scheduleSelectionForWeek(referenceDate, weekOffset): string`, Sunday-only Schedule range, and host-independent `weeklyVerse(date): object`.

- [ ] **Step 1: Start the old-base Update Existing merge**

```bash
git merge --no-ff --no-commit 528ab3b76b67af295435e61d7ee2102692fa6b96 || true
git diff --name-only --diff-filter=U
```

Expected direct conflict: `app/smoke.mjs`. Even when `app/js/app.js`, `app/js/data.js`, and `app/js/views.js` auto-merge, inspect those files because this feature originated at old base `32f400b`.

- [ ] **Step 2: Preserve HKT helpers and narrow Sunday semantics to Schedule**

`app/js/data.js` must retain RSVP’s `todayHktISO()` and `hktEventStartMs()` alongside:

```js
export function sundayOf(date) {
  return addDays(new Date(date.getTime()), -date.getDay());
}

export function weeklyVerse(date = new Date()) {
  const weeks = Math.floor((hktCalendarDay(date) - VERSE_EPOCH_DAY) / 7);
  const n = WEEKLY_VERSES.length;
  return WEEKLY_VERSES[((weeks % n) + n) % n];
}
```

`app/js/views.js` must keep Home calculations on `mondayOf(todayLocal())`; only `viewSchedule()` uses `sundayOf`. `app/js/app.js` must set week navigation through `views.scheduleSelectionForWeek(todayLocal(), st.weekOffset)`.

- [ ] **Step 3: Reconcile Schedule tests with RSVP tests**

Keep literal Sunday/Monday/Saturday `sundayOf` cases, Sunday-first `Sun Mon Tue Wed Thu Fri Sat`, “Week of Sunday,” today-on-current-week, Sunday-on-offset-week, and exact seven-day navigation tests. Update every RSVP/live Schedule fixture offset to use Sunday boundaries:

```js
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(session.dateISO)) - data.sundayOf(data.todayLocal()))
    / (7 * 86400000)
);
```

Do not change Home/Admin tests that intentionally use `mondayOf`.

- [ ] **Step 4: Retain cross-timezone verse tests and commit**

```bash
git add app/js/app.js app/js/data.js app/js/views.js app/smoke.mjs \
  docs/superpowers/plans docs/superpowers/specs
test -z "$(git diff --name-only --diff-filter=U)"
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)'
TZ=Asia/Hong_Kong node app/smoke.mjs
TZ=America/Los_Angeles node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --cached --check
git commit -m "merge: integrate Sunday Schedule and HKT verse into testing candidate"
```

Expected: both timezone smoke runs and live-auth smoke pass; the merge’s second parent is Update Existing.

- [ ] **Step 5: Request the Update Existing task review**

```bash
BASE_SHA=$(git rev-parse HEAD^1)
HEAD_SHA=$(git rev-parse HEAD)
test "$(git rev-parse HEAD^2)" = "528ab3b76b67af295435e61d7ee2102692fa6b96"
```

Use `superpowers:requesting-code-review` for Task 6 and `$BASE_SHA..$HEAD_SHA`. Require a regression-focused review for old-base code loss, Schedule-only Sunday semantics, HKT verse boundary/default instant, RSVP Schedule offsets, and preservation of modern notification/payment/count/auth/map/indemnity code. Fix Critical/Important findings with `fix(integration): address Update Existing review`.

---

### Task 7: Add Combined Cross-Feature Regression Tests

**Files:**
- Modify/Test: `app/smoke.mjs`
- Modify/Test: `app/live-auth-smoke.mjs`
- Modify only if a new combined test exposes a real integration defect: `app/js/app.js`, `app/js/data.js`, `app/js/operations.js`, `app/js/store.js`, `app/js/views.js`

**Interfaces:**
- Consumes: integrated notification destinations, Payment views, exact RSVP counts, Sunday Schedule state, and dual optional hydration errors.
- Produces: regressions proving those features work together, not merely in separate branch-owned blocks.

- [ ] **Step 1: Add a paid-notification-to-composed-payment regression**

Inside the existing paid booking Payment block in `app/smoke.mjs`, after reservation `b` and before marking it paid, add:

```js
const paymentDestination = `#/pay/${b.id}`;
const paidNotificationRows = [{
  id: "combined-paid-route",
  kind: "operational_booking_reserved",
  title: "Booking reserved",
  body: "Pay now to keep your spot.",
  destination: paymentDestination,
  read_at: null,
  created_at: new Date().toISOString(),
}];
const paidInboxHtml = await views.viewNotifications(new Date(), paidNotificationRows);
if (!paidInboxHtml.includes(`data-destination="${paymentDestination}"`)) {
  throw new Error("paid notification must preserve the exact Payment destination");
}
if (data.notificationDestination(paidNotificationRows[0].kind, paidNotificationRows[0].destination)
    !== paymentDestination) {
  throw new Error("paid notification resolver must return the exact Payment destination");
}
const routedPaymentHtml = views.viewPay(paymentDestination.slice("#/pay/".length));
for (const marker of [
  "PayMe", "Suggested payment note", 'data-action="copy-payment-note"',
  "Assigned collector / payee", "Suggested reference",
  'data-action="copy-fps"', 'data-action="copy-reference"',
]) {
  if (!routedPaymentHtml.includes(marker)) {
    throw new Error(`routed Payment view missing integrated marker: ${marker}`);
  }
}
if (/QR|Scan with your banking app|amount is embedded/i.test(routedPaymentHtml)) {
  throw new Error("notification-routed Payment view must remain QR-free");
}
```

- [ ] **Step 2: Run RED if reconciliation is incomplete**

```bash
node app/smoke.mjs
```

Expected: PASS when Task 5 correctly composed PayMe and same-device FPS. A failure identifies a cross-feature integration defect; do not weaken the assertions.

- [ ] **Step 3: Add RSVP-route/count/Sunday-Schedule coexistence coverage**

Inside the local RSVP block, after `rsvp` is confirmed and before withdrawal, add:

```js
const rsvpDestination = `#/activity/${lunch.id}`;
const rsvpInboxHtml = await views.viewNotifications(new Date(), [{
  id: "combined-rsvp-route",
  kind: "operational_rsvp_confirmed",
  title: "RSVP confirmed",
  body: "You are counted in.",
  destination: rsvpDestination,
  read_at: null,
  created_at: new Date().toISOString(),
}]);
if (!rsvpInboxHtml.includes(`data-destination="${rsvpDestination}"`)
    || data.notificationDestination("operational_rsvp_confirmed", rsvpDestination) !== rsvpDestination) {
  throw new Error("RSVP notification must route to exact dated Activity Details");
}
const priorCombinedSchedule = { ...views.scheduleState };
views.scheduleState.weekOffset = Math.round(
  (data.sundayOf(data.parseISO(lunch.dateISO)) - data.sundayOf(data.todayLocal()))
    / (7 * 86400000)
);
views.scheduleState.selected = lunch.dateISO;
const combinedRsvpScheduleHtml = views.viewSchedule();
Object.assign(views.scheduleState, priorCombinedSchedule);
if (!combinedRsvpScheduleHtml.includes(`href="${rsvpDestination}"`)
    || !combinedRsvpScheduleHtml.includes("1 going")
    || !views.viewActivity(lunch.id).includes("1 going")) {
  throw new Error("exact RSVP count must agree across Sunday Schedule and Activity Details");
}
const scheduleLabels = [...combinedRsvpScheduleHtml.matchAll(
  /class="day-cell[^>]*>[\s\S]*?\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/g
)].map((match) => match[1]);
if (scheduleLabels.join(" ") !== "Sun Mon Tue Wed Thu Fri Sat") {
  throw new Error(`combined RSVP Schedule must remain Sunday-first; got ${scheduleLabels.join(" ")}`);
}
```

Then render Admin as the Admin fixture before withdrawal and assert `Weekly Event Controls`, `Free & RSVP Events`, and `1 going` coexist in that output.

- [ ] **Step 4: Add combined dual-enrichment hydration coverage**

In `app/live-auth-smoke.mjs`, after both branch-owned payout and count mock handlers exist, add two forced hydration cases:

```js
const successfulCombinedOperationalRpcHandler = operationalRpcHandler;
const combinedLunch = store.upcomingSessions(21).find((session) => session.kind === "rsvp");
const combinedAssignedId = operationalTableRows.collector_assignments[0].collector_profile_id;
const combinedAssignedPayout = operationalTableRows.collector_payout_profiles.find(
  (row) => row.profile_id === combinedAssignedId
);
assert.ok(combinedLunch, "combined hydration requires a live RSVP lunch");
assert.ok(combinedAssignedPayout, "combined hydration requires an assigned payout fixture");

operationalRsvpCountRowsOverride = [{ session_id: combinedLunch.id, going_count: 4 }];
operationalRpcHandler = (name, args) => {
  if (name === "get_assigned_collector_payout_profiles") {
    operationalRpcCalls.push({ name, args: structuredClone(args) });
    return Promise.resolve({ data: null, error: { message: "assigned payout unavailable" } });
  }
  return successfulCombinedOperationalRpcHandler(name, args);
};
await store.hydrateLiveOperations({ force: true });
assert.equal(operations.operationalStateStatus().error, null);
assert.equal(operations.operationalStateStatus().payoutError, "assigned payout unavailable");
assert.equal(operations.operationalStateStatus().rsvpCountError, null);
assert.equal(store.attendeeCountFor(combinedLunch), 4);
assert.ok(store.upcomingSessions(21).some((session) => session.kind === "paid"));
assert.ok(store.upcomingSessions(21).some((session) => session.kind === "rsvp"));

operationalRpcHandler = successfulCombinedOperationalRpcHandler;
operationalRsvpCountRowsOverride = null;
operationalRsvpCountError = { message: "RSVP count unavailable" };
await store.hydrateLiveOperations({ force: true });
assert.equal(operations.operationalStateStatus().error, null);
assert.equal(operations.operationalStateStatus().payoutError, null);
assert.equal(operations.operationalStateStatus().rsvpCountError, "RSVP count unavailable");
assert.ok(operations.livePayoutFor(combinedAssignedId));
assert.ok(store.getSession(combinedLunch.id));

operationalRsvpCountError = null;
await store.hydrateLiveOperations({ force: true });
assert.equal(operations.operationalStateStatus().payoutError, null);
assert.equal(operations.operationalStateStatus().rsvpCountError, null);
```

This proves one enrichment can fail while the other and core Schedule data survive, in both directions.

- [ ] **Step 5: Run the combined RED/GREEN gate and make only minimal fixes**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/smoke.mjs
```

Expected: all pass. If a test fails, use `superpowers:systematic-debugging`, fix the integration seam rather than deleting branch behavior, and rerun all three commands.

- [ ] **Step 6: Commit combined regressions and request task review**

```bash
git add app/smoke.mjs app/live-auth-smoke.mjs \
  app/js/app.js app/js/data.js app/js/operations.js app/js/store.js app/js/views.js
git diff --cached --check
git commit -m "test(integration): cover routes payments counts and hydration"
BASE_SHA=$(git rev-parse HEAD^)
HEAD_SHA=$(git rev-parse HEAD)
```

Use `superpowers:requesting-code-review` for Task 7 and `$BASE_SHA..$HEAD_SHA`. Require the reviewer to reject source-only assertions where rendered/store behavior can be tested, state leakage between fixtures, timezone-sensitive date assumptions, false-positive string matches, or recovery cases that do not force hydration. Fix Critical/Important findings with `fix(integration): address combined regression review`.

---

### Task 8: Full Verification, Migration/Diff Audit, and Final Review

**Files:**
- Verify all tracked files; modify none unless a failing gate or final review identifies a real integration defect.

**Interfaces:**
- Consumes: completed integration branch and, when available, a fresh disposable Supabase-compatible database URL in `ITC_OPERATIONS_TEST_DATABASE_URL`.
- Produces: evidence that every branch is present, all available automated tests pass, protected legacy behavior remains, and the branch is ready to fast-forward into the non-production Testing environment; database replay remains an explicit deployment prerequisite when infrastructure is unavailable.

- [ ] **Step 1: Verify merge graph and immutable migrations**

```bash
for tip in \
  f6d559920d4585338eee6ed7311c9c72832de0ff \
  218fce7e96d86831ffc409aa59d4e949d7cb8b61 \
  b42a684bdfcfd51357e15a6d8821b9f211772f51 \
  46f49377f97e0fe15230e8096f31819a771a6dec \
  528ab3b76b67af295435e61d7ee2102692fa6b96
do
  git merge-base --is-ancestor "$tip" HEAD
done
git log --first-parent --merges --oneline 9b7b9ca7d891b7448122295507566aeb1596db3e..HEAD

git diff --exit-code f6d559920d4585338eee6ed7311c9c72832de0ff -- \
  supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql
git diff --exit-code 218fce7e96d86831ffc409aa59d4e949d7cb8b61 -- \
  supabase/migrations/20260829000006_lunch_venue_meeting_point_rpc.sql \
  supabase/migrations/20260829000008_rsvp_integrity.sql
git diff --exit-code b42a684bdfcfd51357e15a6d8821b9f211772f51 -- \
  supabase/migrations/20260829000007_notification_destinations.sql
find supabase/migrations -maxdepth 1 -type f -name '2026082900000[5-8]*.sql' -print | sort
```

Expected: five feature tips are ancestors, five first-parent merge commits are visible, all owner comparisons are empty, and ordered output is `00005`, `00006`, `00007`, `00008`.

- [ ] **Step 2: Run full local/live smoke in both relevant host timezones**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
TZ=Asia/Hong_Kong node app/smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
```

Expected: every run exits 0. The Los Angeles runs prove HKT RSVP/verse behavior is independent of host timezone.

- [ ] **Step 3: Run all syntax and shell safety gates**

```bash
for file in $(git ls-files '*.js' '*.mjs'); do node --check "$file"; done
for file in $(git ls-files '*.sh'); do bash -n "$file"; done
for file in $(git ls-files '*_safety.sh'); do bash "$file"; done
```

Expected: every tracked JS/MJS parses, every shell script parses, and all safety harness self-tests pass.

- [ ] **Step 4: Run the full disposable-database verifier**

Use a fresh, empty, explicitly disposable Supabase-compatible database. The verifier itself applies every migration in filename order and runs Admin Notification, Giving, and Operational integration SQL:

```bash
: "${ITC_OPERATIONS_TEST_DATABASE_URL:?Set ITC_OPERATIONS_TEST_DATABASE_URL to a fresh disposable Supabase-compatible database}"
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_operational_backend.sh --safety-check-only
bash supabase/tests/verify_operational_backend.sh
```

Expected when disposable infrastructure is available: the safety gate passes, all migrations including `00005/00006/00007/00008` apply, and all three SQL integration suites pass. If `psql`, Docker, or disposable credentials are unavailable, run every source-only safety verifier, record PostgreSQL replay as unverified, and permit fast-forward into non-production `testing` for combined review. Never substitute a shared/live database, deploy migrations, merge `main`, or claim database behavior is live.

- [ ] **Step 5: Audit protected behavior and retired FPS UI**

```bash
test -f app/js/map.js
test -f app/js/venue.js
test -f app/js/documents.js
test -f assets/itc/venues/island-ecc-11.jpg
test -f assets/itc/venues/island-ecc-9.jpg
rg -n 'mountActivityMap|setWeekVenue|meetingLat|Get Directions' app/js app/smoke.mjs app/live-auth-smoke.mjs
rg -n 'INDEMNITY_VERSION|indemnitySignature|emergencyRelationship' app/js app/smoke.mjs app/live-auth-smoke.mjs
rg -n 'signInWithGoogle|saveMyApplication|admin_application' app/js supabase/migrations app/live-auth-smoke.mjs
if rg -n -i 'fps-qr|fps qr|scan with your banking app|amount is embedded' \
  app/js app/styles.css app/index.html; then
  echo "Retired FPS QR UI or claim remains" >&2
  exit 1
fi
if git diff --name-status 9b7b9ca7d891b7448122295507566aeb1596db3e..HEAD \
  | grep -E '^D[[:space:]].*(app/js/(map|venue|documents)\.js|assets/itc/venues/)'; then
  echo "Protected map, venue, indemnity, or venue asset was deleted" >&2
  exit 1
fi
```

Expected: map/venue/indemnity/auth markers and protected files remain; no FPS QR runtime/CSS/copy remains; no protected deletion is reported.

- [ ] **Step 6: Perform whitespace, conflict, status, and scope diff checks**

```bash
! git grep -n -E '^(<<<<<<<|=======|>>>>>>>)'
git diff --check 9b7b9ca7d891b7448122295507566aeb1596db3e..HEAD
git diff --stat 9b7b9ca7d891b7448122295507566aeb1596db3e..HEAD
git diff --name-status 9b7b9ca7d891b7448122295507566aeb1596db3e..HEAD
git status --short --branch
```

Expected: no markers or whitespace failures, no Shop paths, and a clean worktree.

- [ ] **Step 7: Request the final read-only integrated review**

```bash
BASE_SHA=9b7b9ca7d891b7448122295507566aeb1596db3e
HEAD_SHA=$(git rev-parse HEAD)
```

Use `superpowers:requesting-code-review` with description “Five-branch Testing integration with combined regressions and migrations 00005–00008,” this complete plan as requirements, and `$BASE_SHA..$HEAD_SHA`. The final reviewer must inspect in passes:

1. merge provenance and migration immutability/order/security;
2. dual hydration degradation/recovery and Realtime subscriptions;
3. notification exact routes, unread hide/count, and authorization;
4. PayMe plus QR-free same-device FPS and Giving reconciliation;
5. Sunday Schedule versus Monday Home/Admin and HKT verse/RSVP boundaries;
6. maps, directions, venue overrides, indemnity, auth/application/roles, state migrations, and test quality.

Ready-to-fast-forward requires `Ready to merge? Yes` with no Critical or Important issues. If review finds an issue, use test-first correction, commit it as `fix(integration): address final integration review`, rerun every command in Steps 1–6, and request a follow-up review over the original `$BASE_SHA..HEAD` range.

---

### Task 9: Fast-Forward Testing and Push

**Files:**
- No file edits. Update only Git refs after all prior gates and reviews pass.

**Interfaces:**
- Consumes: approved clean `work/testing-latest-integration` and unchanged local/remote `testing` at `9b7b9ca`.
- Produces: local and remote `testing` pointing at the reviewed integration tip via fast-forward only.

- [ ] **Step 1: Reconfirm remote baseline and clean worktrees**

```bash
cd /Users/selesli/projects/island-training-club-app/.worktrees/testing-latest-integration
INTEGRATION_HEAD=$(git rev-parse HEAD)
git fetch origin
test "$(git rev-parse origin/testing)" = "9b7b9ca7d891b7448122295507566aeb1596db3e"
test -z "$(git status --porcelain)"
test "$(git -C /Users/selesli/projects/island-training-club-app/.worktrees/testing branch --show-current)" = "testing"
test "$(git -C /Users/selesli/projects/island-training-club-app/.worktrees/testing rev-parse HEAD)" = "9b7b9ca7d891b7448122295507566aeb1596db3e"
test -z "$(git -C /Users/selesli/projects/island-training-club-app/.worktrees/testing status --porcelain)"
```

Expected: the reviewed integration tip is captured, remote/local Testing did not move, and both worktrees are clean. If Testing moved, do not push; rebuild and re-review the integration from the new baseline.

- [ ] **Step 2: Fast-forward local Testing only**

```bash
INTEGRATION_HEAD=$(git rev-parse work/testing-latest-integration)
git -C /Users/selesli/projects/island-training-club-app/.worktrees/testing \
  merge --ff-only work/testing-latest-integration
test "$(git -C /Users/selesli/projects/island-training-club-app/.worktrees/testing rev-parse HEAD)" = "$INTEGRATION_HEAD"
```

Expected: `testing` fast-forwards with no new merge commit.

- [ ] **Step 3: Run final post-fast-forward smoke and push Testing**

```bash
cd /Users/selesli/projects/island-training-club-app/.worktrees/testing
node app/smoke.mjs
node app/live-auth-smoke.mjs
git status --short --branch
git push origin testing
```

Expected: both suites still pass from the actual Testing worktree and the push succeeds.

- [ ] **Step 4: Verify the remote ref and graph**

```bash
INTEGRATION_HEAD=$(git rev-parse testing)
test "$(git ls-remote origin refs/heads/testing | awk '{print $1}')" = "$INTEGRATION_HEAD"
for tip in \
  f6d559920d4585338eee6ed7311c9c72832de0ff \
  218fce7e96d86831ffc409aa59d4e949d7cb8b61 \
  b42a684bdfcfd51357e15a6d8821b9f211772f51 \
  46f49377f97e0fe15230e8096f31819a771a6dec \
  528ab3b76b67af295435e61d7ee2102692fa6b96
do
  git merge-base --is-ancestor "$tip" testing
done
git log --graph --oneline --decorate --first-parent \
  9b7b9ca7d891b7448122295507566aeb1596db3e..testing
```

Expected: remote `testing` equals the reviewed integration tip, all five branch tips are ancestors, and first-parent history shows the five required merge commits plus reviewed integration test/fix commits.
