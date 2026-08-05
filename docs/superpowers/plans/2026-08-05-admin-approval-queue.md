# Admin Approval Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show both pending-profile groups in Admin Approvals and allow live approval or decline only after an application is submitted.

**Architecture:** Build the queue profiles-first in `store.js`, merging pending profiles with application rows by profile ID. Add a focused decision action with server-backed validation, render submitted and not-submitted cards in `views.js`, and persist declined lifecycle state as a Supabase profile role through one additive migration.

**Tech Stack:** Vanilla ES modules, Supabase/Postgres RLS, Node smoke tests, localStorage demo state

## Global Constraints

- Pending profiles with a submitted application show enabled Approve and Decline actions.
- Pending profiles without an application show “Application not submitted” and real disabled buttons.
- Approved and declined profiles do not appear in Approvals.
- The store rejects decisions for profiles without applications.
- Add `declined` through a new rerunnable migration; do not edit an applied migration.
- Preserve local demo approval and decline behavior.
- Do not add dependencies, a build step, or real notifications/email.
- Preserve unrelated untracked files.

## File Structure

- Create `supabase/migrations/20260805000007_admin_application_decisions.sql`: extend profile roles and Admin update RLS for decline decisions.
- Modify `app/js/store.js`: map declined live users, build a profiles-first approval queue, and validate application decisions.
- Modify `app/js/views.js`: render the two pending groups and map declined members correctly.
- Modify `app/js/app.js`: route approval actions through the focused async decision action and await rerenders.
- Modify `app/live-auth-smoke.mjs`: exercise live queue merging, decisions, declined identity mapping, and Supabase failures.
- Modify `app/smoke.mjs`: preserve local approval/decline regressions and assert the not-submitted UI contract/migration source.

---

### Task 1: Add the Declined Role and Admin Decision Policy

**Files:**
- Create: `supabase/migrations/20260805000007_admin_application_decisions.sql`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: existing `public.profiles.role`, `public.current_user_role()`, and the `admin approve pending` policy.
- Produces: database support for `profiles.role = 'declined'` and Admin transitions from `pending` to either `member` or `declined`.

- [ ] **Step 1: Write failing migration contract tests**

Append source checks near the existing migration assertions in `app/smoke.mjs`:

```js
const adminDecisionSql = readFileSync(
  new URL("../supabase/migrations/20260805000007_admin_application_decisions.sql", import.meta.url),
  "utf8"
);
if (!adminDecisionSql.includes("'declined'") || !adminDecisionSql.includes("profiles_role_check")) {
  throw new Error("admin decision migration must permit the declined profile role");
}
if (!adminDecisionSql.includes("role in ('member', 'declined')")) {
  throw new Error("admin decision migration must allow submitted applications to be approved or declined");
}
console.log("ok  migration supports approve and decline decisions");
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `node app/smoke.mjs`

Expected: FAIL because `20260805000007_admin_application_decisions.sql` does not exist.

- [ ] **Step 3: Write the additive rerunnable migration**

Create `supabase/migrations/20260805000007_admin_application_decisions.sql`:

```sql
-- Island Training Club — complete Admin application decisions

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('pending', 'member', 'admin', 'super_admin', 'declined'));

drop policy if exists "admin approve pending" on public.profiles;
drop policy if exists "admin decide pending" on public.profiles;
create policy "admin decide pending"
  on public.profiles for update
  using (
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      public.current_user_role()
    ) = 'admin'
    and role = 'pending'
  )
  with check (role in ('member', 'declined'));
```

- [ ] **Step 4: Run the focused and full checks**

Run: `node app/smoke.mjs && git diff --check`

Expected: PASS, including `ok  migration supports approve and decline decisions`.

- [ ] **Step 5: Commit**

```bash
git add app/smoke.mjs supabase/migrations/20260805000007_admin_application_decisions.sql
git commit -m "feat(db): support declined applications"
```

---

### Task 2: Build and Validate the Profiles-First Approval Queue

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `listProfiles(): Promise<Profile[]>`, application rows keyed by `profile_id`, `updateProfileRole(profileId, newRole)`.
- Produces: `listApprovalCandidates(): Promise<ApprovalCandidate[]>` and `decideApplication(profileId, decision): Promise<void>`, where `decision` is `member` or `declined` and each candidate has `applicationSubmitted: boolean`.

- [ ] **Step 1: Expand the fake Supabase fixture and write failing store tests**

In `app/live-auth-smoke.mjs`, import strict assertions and add two pending profiles—one whose ID exists in `applicationRows`, and one without an application:

```js
import assert from "node:assert/strict";

const pendingProfiles = [
  {
    id: "pending-submitted",
    email: "submitted@example.com",
    full_name: "Submitted Runner",
    role: "pending",
    created_at: "2026-08-05T03:00:00.000Z",
  },
  {
    id: "pending-incomplete",
    email: "incomplete@example.com",
    full_name: "Incomplete Runner",
    role: "pending",
    created_at: "2026-08-05T04:00:00.000Z",
  },
];
applicationRows.set("pending-submitted", {
  ...structuredClone(applicationRows.get(authUser.id)),
  profile_id: "pending-submitted",
  profiles: pendingProfiles[0],
});
const profileUpdates = [];
```

Extend the fake `profiles` table's `select()` chain so `.order()` resolves to `[profile, ...pendingProfiles]`, while preserving the existing `.eq("id", authUser.id).maybeSingle()` path. Add `update(patch).eq("id", id)` that records `{ id, ...patch }` in `profileUpdates`. Extend the fake `applications` select chain so the no-filter queue request resolves to cloned `applicationRows` values, while preserving the self `.eq("profile_id", authUser.id).maybeSingle()` path.

Add assertions after store initialization:

```js
const queue = await store.listApprovalCandidates();
const submitted = queue.find((item) => item.id === "pending-submitted");
const incomplete = queue.find((item) => item.id === "pending-incomplete");
if (!submitted?.applicationSubmitted || incomplete?.applicationSubmitted !== false) {
  throw new Error("Approval queue must include both pending groups");
}
if (queue.some((item) => item.id === authUser.id)) {
  throw new Error("Approved/admin profiles must not enter the approval queue");
}
await store.decideApplication(submitted.id, "declined");
if (!profileUpdates.some((update) => update.id === submitted.id && update.role === "declined")) {
  throw new Error("Decline must persist the declined profile role");
}
await assert.rejects(
  () => store.decideApplication(incomplete.id, "member"),
  /Application not submitted/
);
```

Also switch `profile.role` temporarily to `declined`, force profile hydration, and assert `store.currentUser().status === "declined"`.

- [ ] **Step 2: Run the live smoke test and verify failure**

Run: `node app/live-auth-smoke.mjs`

Expected: FAIL because `listApprovalCandidates` and `decideApplication` are not exported.

- [ ] **Step 3: Implement queue mapping and live declined status**

In `app/js/store.js`, change live status mapping to:

```js
status:
  liveProfile.role === "pending"
    ? "pending"
    : liveProfile.role === "declined"
      ? "declined"
      : "approved",
```

Adapt the application-list query so it returns submitted applications without filtering out profiles, retain its existing mapped fields, then add:

```js
export async function listApprovalCandidates() {
  if (!isLive() || !supabase) {
    return pendingApplicants().map((user) => ({
      ...user,
      applicationSubmitted: true,
    }));
  }
  const [profiles, applications] = await Promise.all([
    listProfiles(),
    listPendingApplications(),
  ]);
  const applicationByProfile = new Map(applications.map((item) => [item.id, item]));
  return profiles
    .filter((profile) => profile.role === "pending")
    .map((profile) => {
      const application = applicationByProfile.get(profile.id);
      return application
        ? { ...application, applicationSubmitted: true }
        : {
            id: profile.id,
            fullName: profile.full_name || profile.email,
            email: profile.email,
            appliedAt: profile.created_at,
            applicationSubmitted: false,
          };
    })
    .sort((a, b) => new Date(a.appliedAt) - new Date(b.appliedAt));
}
```

Implement guarded decisions:

```js
export async function decideApplication(profileId, decision) {
  if (!new Set(["member", "declined"]).has(decision)) {
    throw new Error("Invalid application decision.");
  }
  if (!isLive() || !supabase) {
    const candidate = pendingApplicants().find((user) => user.id === profileId);
    if (!candidate) throw new Error("Pending application not found.");
    if (decision === "member") approveApplicant(profileId);
    else declineApplicant(profileId);
    return;
  }
  const candidate = (await listApprovalCandidates()).find((item) => item.id === profileId);
  if (!candidate) throw new Error("Pending application not found.");
  if (!candidate.applicationSubmitted) throw new Error("Application not submitted.");
  await updateProfileRole(profileId, decision);
}
```

- [ ] **Step 4: Run store-focused checks**

Run: `node app/live-auth-smoke.mjs && node --check app/js/store.js`

Expected: PASS, including both pending groups, rejected incomplete decisions, persisted decline, and declined live status.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/live-auth-smoke.mjs
git commit -m "feat(admin): build complete approval queue"
```

---

### Task 3: Render Both Groups and Wire Both Decisions

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `listApprovalCandidates()` and `decideApplication(profileId, decision)` from Task 2.
- Produces: enabled decision controls for submitted applications, disabled controls for incomplete profiles, truthful Members labels, and awaited decision rerenders.

- [ ] **Step 1: Write failing render and interaction tests**

In `app/live-auth-smoke.mjs`, render `await views.viewAdmin("approvals")` and assert:

```js
if (!approvalsHtml.includes("Application not submitted")) {
  throw new Error("Approvals must explain incomplete pending profiles");
}
if (!approvalsHtml.match(/data-user="pending-incomplete"[^>]*disabled/)) {
  throw new Error("Incomplete pending profiles must have disabled decisions");
}
if (!approvalsHtml.includes('data-action="decline" data-user="pending-submitted"')) {
  throw new Error("Submitted live applications must expose Decline");
}
```

Render Members with a declined fixture and assert its badge reads `Declined`. Add source assertions in `app/smoke.mjs` that `app.js` calls `decideApplication` for both `approve` and `decline`, preventing the duplicate `case "approve"` regression.

- [ ] **Step 2: Run tests and verify the UI contract fails**

Run: `node app/live-auth-smoke.mjs && node app/smoke.mjs`

Expected: FAIL because Admin still calls `listPendingApplications`, incomplete cards are absent, live Decline is hidden, and handlers do not use `decideApplication`.

- [ ] **Step 3: Render queue candidates explicitly**

In `viewAdmin`, replace the approval source with:

```js
adminApprovals(await store.listApprovalCandidates())
```

Remove the `live` option from `adminApprovals`. For `applicationSubmitted === false`, render a compact card with identity, pending badge, “Application not submitted,” supporting copy, and:

```html
<button class="btn sm" type="button" data-action="approve" data-user="${u.id}" disabled>Approve</button>
<button class="btn danger sm" type="button" data-action="decline" data-user="${u.id}" disabled>Decline</button>
```

For submitted cards, always render:

```html
<button class="btn sm" type="button" data-action="approve" data-user="${u.id}">Approve</button>
<button class="btn danger sm" type="button" data-action="decline" data-user="${u.id}">Decline</button>
```

Update Members mapping so `role === "declined"` becomes `status: "declined"`, while only member/admin/super-admin roles become approved.

- [ ] **Step 4: Consolidate decision event handlers**

In `app/js/app.js`, keep promote/demote on `updateProfileRole`, but remove `approve` from that generic branch. Replace both duplicate local approval cases with one async branch:

```js
case "approve":
case "decline": {
  const decision = action === "approve" ? "member" : "declined";
  try {
    await store.decideApplication(el.dataset.user, decision);
    toast(action === "approve" ? "Approved." : "Declined.");
    await render();
  } catch (err) {
    toast(err.message || "Decision failed", true);
  }
  break;
}
```

Await the existing promote/demote rerender too, so update success is followed by a completed UI refresh.

- [ ] **Step 5: Run focused and complete tests**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/app.js
node --check app/js/views.js
git diff --check
```

Expected: all commands PASS. Confirm the live HTML contains both pending groups, only submitted applications have active controls, and Members labels declined profiles correctly.

- [ ] **Step 6: Commit**

```bash
git add app/js/app.js app/js/views.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(admin): complete approval decisions"
```

---

### Task 4: Final Regression and Migration Verification

**Files:**
- Verify only; modify a prior task's files if a regression is found.

**Interfaces:**
- Consumes: the complete Admin approval queue feature.
- Produces: fresh verification evidence with no syntax, smoke, or whitespace failures.

- [ ] **Step 1: Run every project verification command**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/data.js
node --check app/js/store.js
node --check app/js/views.js
node --check app/js/app.js
git diff --check
git status --short --branch
```

Expected: both smoke suites report success, all syntax checks exit 0, `git diff --check` emits nothing, and only the known unrelated files remain untracked.

- [ ] **Step 2: Inspect the feature diff against the design commit**

Run:

```bash
git diff --stat 7746ce5..HEAD
git diff --check 7746ce5..HEAD
git log --oneline 7746ce5..HEAD
```

Expected: changes are limited to the migration, store, Admin views/actions, and smoke coverage listed in this plan.

- [ ] **Step 3: Commit any verification-only correction**

If Step 1 or 2 required a correction, rerun the complete verification commands, then commit only that correction:

```bash
git add app/js/app.js app/js/store.js app/js/views.js app/live-auth-smoke.mjs app/smoke.mjs supabase/migrations/20260805000007_admin_application_decisions.sql
git commit -m "fix(admin): address approval queue regression"
```

If no correction was needed, do not create an empty commit.
