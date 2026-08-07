# Testing Domain Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one fast-forward `testing` candidate that combines the latest Payment/Auth, Notification, Giving, and Community visuals and data behavior according to explicit domain ownership.

**Architecture:** Work on `work/testing-feature-integration`, which is based on `testing@4348725`. Establish `feature/payment-system@720dc73` as the shared runtime baseline, then port only domain-owned Notification, Giving, and Community blocks from their immutable source tips. Finish with a shape-aware local state v13 migration and one combined regression matrix.

**Tech Stack:** Vanilla JavaScript ES modules, string-template HTML, CSS, `localStorage`, Supabase Auth/Postgres migrations, Node smoke scripts, Bash safety scripts.

## Global Constraints

- Source tips are immutable: `feature/payment-system@720dc73`, `feature/notification@5842839`, `feature/giving-page@3ef00ad`, `feature/community-page@40bb7c2`, and `testing@4348725`.
- Payment owns shared Auth, Account/Profile, Admin shell, routing, and all Payment operations.
- Notification owns top-bar bell, inbox, filters, read state, notification migrations, SQL tests, and notification styles.
- Giving owns signed-in Giving navigation, campaign/donor UI and state, Admin Giving, Giving migrations, SQL tests, and Giving styles.
- Community owns Community pulse, anniversary, announcements, prayers, fellowship, meals, About, Community data helpers, and Community styles.
- Bottom navigation is Home, Schedule, Community, Giving when signed in, Account/Profile, and Admin for Admin/Super Admin. Notifications remain in the top bar.
- Admin tabs are Approvals, Members, Activities, Giving, and Payments / Ops with exactly one `aria-current="page"`.
- Integrated local state version is exactly `13` and safely accepts Testing v9, Payment v10, Notification v11, and Giving v12 snapshots.
- Supabase remains authoritative for identity, roles, applications, notifications, campaigns, and donor profiles. Payment operations remain UUID-keyed in `localStorage`.
- No dependencies, framework, build step, real payment processing, merchandise/Shop-tab code beyond the requested Giving domain, history rewrite, force-push, or source-branch modification.
- Update `testing` only after exact-tip verification and explicit approval.

---

### Task 1: Establish the Payment/Auth Shared Baseline

**Files:**
- Replace from Payment tip: `README.md`
- Replace from Payment tip: `app/index.html`
- Replace from Payment tip: `app/js/app.js`
- Replace from Payment tip: `app/js/config.js`
- Replace from Payment tip: `app/js/data.js`
- Replace from Payment tip: `app/js/store.js`
- Replace from Payment tip: `app/js/views.js`
- Replace from Payment tip: `app/live-auth-smoke.mjs`
- Replace from Payment tip: `app/smoke.mjs`
- Replace from Payment tip: `app/styles.css`
- Add from Payment tip: `assets/fonts/OFL-Archivo.txt`
- Add from Payment tip: `assets/fonts/archivo-latin-variable.woff2`
- Add from Payment tip: `docs/runbooks/live-auth.md`
- Add from Payment tip: `supabase/migrations/20260804000000_profiles.sql` through `supabase/migrations/20260805000007_admin_application_decisions.sql`
- Preserve: `vercel.json`
- Preserve: `docs/superpowers/specs/2026-08-07-testing-domain-integration-design.md`
- Preserve: `docs/superpowers/plans/2026-08-07-testing-domain-integration.md`

**Interfaces:**
- Produces: Payment’s tested `bootPromise`, `maybeRedirectToApply`, Auth store APIs, Account/Admin views, and Payment reservation/queue/duty/receipt APIs.
- Consumes: none; this is the shared baseline for later domain tasks.

- [ ] **Step 1: Record source provenance**

```bash
test "$(git rev-parse origin/testing)" = 43487254ff28a75ec4a0ac49ebbb71d2ff9b9936
test "$(git rev-parse origin/feature/payment-system)" = 720dc732944dac692334e885db2d9418d024d9bc
test "$(git rev-parse origin/feature/notification)" = 5842839e08f5e486f4b9e175232acec3cb347eb2
test "$(git rev-parse origin/feature/giving-page)" = 3ef00adc4efb327826d5308b20610bc18a9102db
test "$(git rev-parse origin/feature/community-page)" = 40bb7c2acb5ee0a7460f840e73b283cfebce4d31
```

Expected: all commands exit 0. Stop if any source tip moved.

- [ ] **Step 2: Copy the Payment-owned baseline exactly**

```bash
git checkout origin/feature/payment-system -- \
  README.md \
  app/index.html app/js/app.js app/js/config.js app/js/data.js app/js/store.js app/js/views.js \
  app/live-auth-smoke.mjs app/smoke.mjs app/styles.css \
  assets/fonts/OFL-Archivo.txt assets/fonts/archivo-latin-variable.woff2 \
  docs/runbooks/live-auth.md \
  supabase/migrations/20260804000000_profiles.sql \
  supabase/migrations/20260804000001_applications.sql \
  supabase/migrations/20260804000002_audit_notifications.sql \
  supabase/migrations/20260804000003_rls.sql \
  supabase/migrations/20260805000001_short_application.sql \
  supabase/migrations/20260805000002_fix_profiles_rls_recursion.sql \
  supabase/migrations/20260805000003_self_update_application.sql \
  supabase/migrations/20260805000004_apply_any_role.sql \
  supabase/migrations/20260805000005_profile_preferences_age_status.sql \
  supabase/migrations/20260805000006_restore_pending_self_insert_application.sql \
  supabase/migrations/20260805000007_admin_application_decisions.sql
```

- [ ] **Step 3: Add baseline provenance assertions to `app/smoke.mjs`**

After the existing foundation-file check, add:

```js
const integrationSourceTips = {
  payment: "720dc732944dac692334e885db2d9418d024d9bc",
  notification: "5842839e08f5e486f4b9e175232acec3cb347eb2",
  giving: "3ef00adc4efb327826d5308b20610bc18a9102db",
  community: "40bb7c2acb5ee0a7460f840e73b283cfebce4d31",
};
if (new Set(Object.values(integrationSourceTips)).size !== 4) {
  throw new Error("integration source tips must stay explicit and distinct");
}
console.log("ok  integration source-tip provenance is explicit");
```

- [ ] **Step 4: Verify Payment baseline**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for f in app/js/app.js app/js/config.js app/js/data.js app/js/store.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs; do
  node --check "$f"
done
git diff --check
```

Expected: both suites pass and all checks exit 0.

- [ ] **Step 5: Commit the baseline**

```bash
git add README.md app assets/fonts docs/runbooks/live-auth.md supabase/migrations
git commit -m "feat(testing): establish Payment Auth baseline"
```

---

### Task 2: Integrate the Latest Notification Domain

**Files:**
- Modify: `app/index.html`
- Modify: `app/js/app.js`
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/styles.css`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`
- Add from Notification tip: `docs/runbooks/admin-notifications-db-verification.md`
- Add from Notification tip: `supabase/migrations/20260805000008_admin_operational_notifications.sql`
- Add from Notification tip: `supabase/migrations/20260805000009_notification_read_at_privileges.sql`
- Add from Notification tip: `supabase/migrations/20260805000010_notification_read_privileges.sql`
- Add from Notification tip: `supabase/tests/admin_notifications_integration.sql`
- Add from Notification tip: `supabase/tests/verify_admin_notifications.sh`
- Add from Notification tip: `supabase/tests/verify_admin_notifications_safety.sh`

**Interfaces:**
- Consumes: Payment async render generation and `store.currentUser()`.
- Produces: `notificationBellHTML(unreadCount, active)`, `notificationFilters`, `viewNotifications(now, prefetchedRows)`, `listMyNotifications()`, and `markNotificationRead(id)`.

- [ ] **Step 1: Add failing Notification composition contracts**

Port the Notification-tip assertions that exercise bell chrome, kind filters, member/admin visibility, read-state destinations, stale cache suppression, relative/HKT time, and SQL safety markers into `app/live-auth-smoke.mjs`. Add these source-level coexistence checks to `app/smoke.mjs`:

```js
for (const marker of [
  "notificationBellHTML",
  "notification-filter",
  "notification-kind-badge",
  "notificationRelativeTime",
  "notificationHktTime",
]) {
  if (!integratedViewSource.includes(marker) && !integratedAppSource.includes(marker)) {
    throw new Error(`integrated Notification domain missing ${marker}`);
  }
}
```

- [ ] **Step 2: Run live-auth smoke and verify RED**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: fail on missing latest Notification bell/filter/inbox contracts.

- [ ] **Step 3: Copy immutable Notification database assets**

```bash
git checkout origin/feature/notification -- \
  docs/runbooks/admin-notifications-db-verification.md \
  supabase/migrations/20260805000008_admin_operational_notifications.sql \
  supabase/migrations/20260805000009_notification_read_at_privileges.sql \
  supabase/migrations/20260805000010_notification_read_privileges.sql \
  supabase/tests/admin_notifications_integration.sql \
  supabase/tests/verify_admin_notifications.sh \
  supabase/tests/verify_admin_notifications_safety.sh
```

- [ ] **Step 4: Port Notification store behavior**

From `origin/feature/notification:app/js/store.js`, reconcile the exact implementations of:

```js
export async function listMyNotifications()
export async function markNotificationRead(id)
```

Retain Payment’s other store APIs and local Payment `notifications` collection. Do not replace `store.js` wholesale.

- [ ] **Step 5: Port Notification visuals**

From `origin/feature/notification:app/js/views.js`, copy the exact owned blocks:

```js
export function notificationBellHTML(unreadCount = 0, active = false)
export const notificationFilters = { kind: "all" }
export async function viewNotifications(now = new Date(), prefetchedRows = null)
```

Also copy the private category/filter/time/destination helpers used by those exports. Remove Payment’s bottom-nav Notifications item and `unreadBadge()` helper. Preserve Payment’s Home, Account, Admin, and Payment views.

- [ ] **Step 6: Port Notification app orchestration**

From `origin/feature/notification:app/js/app.js`, compose into Payment’s router:

- `const notificationEl = document.getElementById("top-notifications")`.
- Top-bar hidden/active/unread hydration guarded by render generation.
- `case "notifications"` using the latest prefetched/cache-safe render path.
- `case "notification-filter"`.
- `case "notification-open"` with read-state suppression and destination routing.

Retain Payment’s `pay`, reservation, mark-paid, queue, duty, collector, and Admin actions. Ensure only one case exists for each Notification action.

- [ ] **Step 7: Port Notification styles**

Copy the Notification-owned selector blocks from `origin/feature/notification:app/styles.css`:

```text
.top-icon-button
.notification-badge
.notification-header
.notification-filter-scroll
.notification-filter-chips
.notification-section
.notification-list
.notification-row
.notification-unread
.notification-copy
.notification-kind-badge
.notification-time
.notification-empty
.notification-inbox-empty
```

Preserve Payment’s shared tokens and Payment selectors.

- [ ] **Step 8: Verify Notification integration**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_admin_notifications_safety.sh
for f in app/js/app.js app/js/store.js app/js/views.js app/live-auth-smoke.mjs; do node --check "$f"; done
git diff --check
```

Expected: all checks pass. The SQL integration script may require configured Supabase/Postgres credentials; its safety script must run locally without them.

- [ ] **Step 9: Commit Notification integration**

```bash
git add app docs/runbooks/admin-notifications-db-verification.md supabase
git commit -m "feat(testing): integrate latest Notifications"
```

---

### Task 3: Integrate the Latest Giving Domain and State v13

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/js/data.js`
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/styles.css`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`
- Add from Giving tip: `supabase/migrations/20260805000011_giving_campaigns.sql`
- Add from Giving tip: `supabase/migrations/20260806000001_donor_id.sql`
- Add from Giving tip: `supabase/tests/giving_campaigns_integration.sql`
- Add from Giving tip: `supabase/tests/verify_giving_campaigns.sh`
- Add from Giving tip: `supabase/tests/verify_giving_campaigns_safety.sh`

**Interfaces:**
- Consumes: Payment Auth/profile UUID and Notification top-bar composition.
- Produces: Giving route/views, campaign APIs, donor persistence, Admin Giving, and integrated local state v13.

- [ ] **Step 1: Add failing Giving and migration contracts**

Port Giving-tip smoke/live-auth assertions for approved-member access, pending/declined gating, amount/FPS/thanks/history flow, donor ID, campaign serialization, stale generations, publish/close, and SQL safety. Add migration fixtures with these minimum shapes:

```js
const sourceSnapshots = [
  { version: 9, prayers: [{ id: "p-real" }] },
  { version: 10, queues: { real: { waitlist: ["real-user"], interest: [] } }, duty: { "2026-08-08": { userId: "real-user" } } },
  { version: 11, notifications: [{ id: "n-real", userId: "real-user" }] },
  { version: 12, campaigns: [{ id: "c-real", title: "Member campaign" }], donations: [{ id: "d-real", userId: "real-user" }] },
];
```

For each fixture, load through the store and assert version 13 plus preservation of every supplied genuine record.

- [ ] **Step 2: Run both suites and verify RED**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: fail on missing Giving route/APIs and state version 13.

- [ ] **Step 3: Copy immutable Giving database assets**

```bash
git checkout origin/feature/giving-page -- \
  supabase/migrations/20260805000011_giving_campaigns.sql \
  supabase/migrations/20260806000001_donor_id.sql \
  supabase/tests/giving_campaigns_integration.sql \
  supabase/tests/verify_giving_campaigns.sh \
  supabase/tests/verify_giving_campaigns_safety.sh
```

- [ ] **Step 4: Compose fresh state and migration v13**

Set:

```js
const STATE_VERSION = 13;
```

Ensure `freshState()` includes:

```js
campaigns: [],
donations: [],
sessionOverrides: {},
queues: {},
notifications: [],
duty: {},
prayers: [],
```

Before version checks, normalize all arrays/objects. Add a v13 reconciliation that applies Payment’s exact-sentinel identity/dependent cleanup, removes `baseBooked`, removes only Giving seed donation IDs `d-seed-1` and `d-seed-2`, and preserves unmatched queues, duty, overrides, notifications, campaigns, donations, prayers, bookings, and receipts.

- [ ] **Step 5: Port Giving store APIs**

From `origin/feature/giving-page:app/js/store.js`, copy and reconcile:

```js
export async function updateMyDonorId(raw)
export function campaigns()
export function activeGivingCampaign()
export async function listGivingCampaigns()
export async function getActiveGivingCampaign()
export async function saveGivingCampaign(draft)
export async function publishGivingCampaign(id)
export function closeGivingCampaign(id)
export function campaignRaised(campaign)
export function donationsForUser(userId)
export function recordDonation(input)
```

Retain all Payment and Notification APIs.

- [ ] **Step 6: Port Giving views and navigation**

From `origin/feature/giving-page:app/js/views.js`, port:

```js
export function resetGivingState()
export async function viewGiving(options)
export async function viewAdminCampaign(id)
```

Copy the private Giving step/history/Admin helpers. Add the signed-in Giving item to Payment’s bottom nav. Add `Giving` between Activities and Payments / Ops in Admin tabs. Preserve latest Notification top-bar chrome.

- [ ] **Step 7: Port Giving routes/actions/forms**

From `origin/feature/giving-page:app/js/app.js`, compose:

- `case "giving"` route with generation ownership.
- `giving-amount`, `giving-back`, `giving-confirm`, `giving-reset`.
- `campaign-publish`, `campaign-close`.
- `form-giving`, live/local `form-donor-id`, and `form-campaign`.
- Admin campaign detail route.

Use Payment’s busy/error helpers and retain all existing Payment/Notification cases exactly once.

- [ ] **Step 8: Port Giving styles**

Copy Giving-owned selector blocks from `origin/feature/giving-page:app/styles.css`, including Giving lock, campaign hero/progress, amount chips, FPS card, gift history, and Admin campaign editor selectors. Preserve shared Payment tokens and Notification selectors.

- [ ] **Step 9: Verify Giving and v13 integration**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_admin_notifications_safety.sh
bash supabase/tests/verify_giving_campaigns_safety.sh
for f in app/js/app.js app/js/data.js app/js/store.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs; do node --check "$f"; done
git diff --check
```

Expected: all checks pass, every v9–v12 fixture reaches v13, and genuine records survive.

- [ ] **Step 10: Commit Giving integration**

```bash
git add app supabase
git commit -m "feat(testing): integrate latest Giving"
```

---

### Task 4: Integrate the Latest Community Domain

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/js/data.js`
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: combined Auth/Payment/Notification/Giving shell.
- Produces: latest Community pulse, anniversary, announcements, prayer/fellowship/meal/About behavior.

- [ ] **Step 1: Add failing Community contracts**

Port the Community-tip smoke assertions covering:

```text
personalized Community heading
next-connection feature
anniversary preview and story
prayer form/local persistence
fellowship
meals
announcements
About/leaders/culture ordering
unknown Community section 404
```

Add a combined assertion that Home, Notification bell, Giving nav, Community pulse, and Payment Ops markers coexist in the integrated source/rendered HTML.

- [ ] **Step 2: Run smoke and verify RED**

```bash
node app/smoke.mjs
```

Expected: fail on missing Community pulse/anniversary visuals.

- [ ] **Step 3: Port Community data helpers**

From `origin/feature/community-page:app/js/data.js`, reconcile the latest `ANNOUNCEMENTS`, `LEADERS`, and `CULTURE` data plus helpers they require. Preserve Payment activity/session helpers and Giving data imports.

- [ ] **Step 4: Port Community views**

From `origin/feature/community-page:app/js/views.js`, copy the exact owned block from `viewCommunity(section)` through the Community private helpers:

```text
communityHeading
communityHome
communityAbout
communityPrayers
communityFellowship
communityMeals
communityAnnouncements
```

Preserve Payment Home/Account/Admin, Notification inbox, and Giving views.

- [ ] **Step 5: Reconcile Community actions and store**

Retain one `form-prayer` handler and one `recordPrayer(input)` store action. Port any latest Community link/action behavior from the Community tip without replacing Payment, Notification, or Giving handlers.

- [ ] **Step 6: Port Community styles**

Copy Community-owned selectors from `origin/feature/community-page:app/styles.css`, including pulse, feature, action grid, announcement preview, anniversary story/hero/timeline/message/commitment, and responsive Community selectors. Preserve all shared/domain CSS already integrated.

- [ ] **Step 7: Verify Community composition**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_admin_notifications_safety.sh
bash supabase/tests/verify_giving_campaigns_safety.sh
for f in app/js/app.js app/js/data.js app/js/store.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs; do node --check "$f"; done
git diff --check
```

Expected: all checks pass and cross-domain markers coexist.

- [ ] **Step 8: Commit Community integration**

```bash
git add app
git commit -m "feat(testing): integrate latest Community"
```

---

### Task 5: Complete Cross-Domain Acceptance and Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/live-auth.md`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`
- Preserve: all Supabase migrations/tests from Tasks 1–3

**Interfaces:**
- Consumes: all integrated domains.
- Produces: release evidence for a fast-forward update to `testing`.

- [ ] **Step 1: Document the combined Testing candidate**

Update README/runbook to state:

```text
Supabase: identity, roles, applications, notifications, campaigns, donor profile
localStorage: Payment operations and Community prototype interactions
Navigation: Notification bell + signed-in Giving tab
Admin: Approvals, Members, Activities, Giving, Payments / Ops
State: v13, accepting v9-v12 persisted snapshots
```

Keep the exact Vercel `/app/` OAuth callback requirement.

- [ ] **Step 2: Add final cross-domain assertions**

Add tests that prove:

```js
for (const marker of [
  "Continue with Google",
  "notification-filter",
  "Giving &amp; Fundraising",
  "ITC Anniversary",
  "Payments / Ops",
]) {
  if (!combinedRuntimeSource.includes(marker)) {
    throw new Error(`testing integration missing ${marker}`);
  }
}
```

Also assert pending/declined profiles cannot render reserve, queue, pay, or giving controls; approved UUIDs own Payment records; sign-out preserves local Payment records; and exactly one Admin tab is active.

- [ ] **Step 3: Run complete exact-tip verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f"; done
for f in $(git ls-files '*.sh' '*.bash'); do bash -n "$f"; done
for f in $(git ls-files '*_safety.sh'); do bash "$f"; done
git diff --check

! git grep -nEi 'one-tap demo|data-action="demo-signin"|data-action="reset-demo"|baseBooked|4242 4242|value="12/28"|value="424"' \
  -- README.md app/js/app.js app/js/data.js app/js/views.js
```

Expected: every command exits 0. Record unavailable credential-dependent SQL integration tests as manual deployment checks; their safety scripts must pass.

- [ ] **Step 4: Review source-tip ownership**

```bash
git diff --stat origin/testing...HEAD
git diff --name-only origin/testing...HEAD
git log --oneline origin/testing..HEAD
```

Confirm no merchandise or Shop-tab runtime code beyond the explicitly requested Giving domain, no source branch changes, all Payment operational APIs, all Notification/Giving migrations, and Community-owned markers remain.

- [ ] **Step 5: Commit final acceptance**

```bash
git add README.md docs/runbooks/live-auth.md app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "docs(testing): document integrated domain candidate"
```

- [ ] **Step 6: Re-run Step 3 from committed tip and request approval**

Confirm:

```bash
test -z "$(git status --porcelain)"
git merge-base --is-ancestor origin/testing HEAD
```

Present commit list, conflict-resolution ownership, full verification evidence, and manual Supabase requirements. Do not push yet.

- [ ] **Step 7: Fast-forward `testing` only after explicit approval**

```bash
git push origin HEAD:refs/heads/testing
local_sha=$(git rev-parse HEAD)
remote_sha=$(git ls-remote origin refs/heads/testing | awk '{print $1}')
test "$local_sha" = "$remote_sha"
```

Expected: non-force fast-forward push succeeds and local/remote SHAs match. Preserve all source branches and worktrees.
