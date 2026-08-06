# Approved-Member Giving Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Giving from visitors, redirect direct visitor access, and show pending/declined users a content-safe locked Giving screen while preserving approved access.

**Architecture:** Navigation visibility is role-aware in `views.js`; the router guards unauthenticated direct routes in `app.js`; `viewGiving()` defends its own content boundary by returning a status-specific locked view unless `status === 'approved'`. No state or database migration is needed.

**Tech Stack:** Vanilla ES modules, localStorage demo state, Supabase-backed live identity, Node smoke tests

## Global Constraints

- Work only on `feature/giving-page`.
- Implement this access change in one separate feature commit.
- Visitor navigation hides Giving and direct `#/giving` redirects to `#/account`.
- Pending and declined signed-in users see Giving navigation and a locked page with no Giving details.
- Approved member, Admin, and Super Admin retain the complete existing Giving experience.
- Do not change localStorage shape, notification behavior, database migrations, or existing Giving flow details.
- Preserve unrelated untracked files.

---

### Task 1: Enforce Giving Navigation and Content Access

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `store.currentUser()`, normalized user `status`, `navHTML()`, `viewGiving()`, and router redirects.
- Produces: visitor-hidden navigation, visitor route redirect, and pending/declined locked HTML.

- [ ] **Step 1: Write failing access-matrix tests**

In `app/smoke.mjs`, add explicit navigation/view cases:

```js
const givingSensitiveCopy = ["Give via FPS", "Campaign progress", "I’ve made the transfer", "Donation history"];

const visitorNav = views.navHTML("home", null);
if (visitorNav.includes("#/giving")) throw new Error("visitor navigation must hide Giving");

const pendingNav = views.navHTML("giving", pendingUser);
if (!pendingNav.includes("#/giving")) throw new Error("pending navigation must retain Giving");
const pendingGiving = views.viewGiving();
if (!pendingGiving.includes("approved ITC members") || givingSensitiveCopy.some((copy) => pendingGiving.includes(copy))) {
  throw new Error("pending Giving must be locked without Giving content");
}
```

Repeat for a declined user. Test approved member, Admin, and Super Admin fixtures still include `Give via FPS` and the campaign/history flow. In the app harness, route a visitor to `#/giving` and assert the hash becomes `#/account` before Giving HTML is committed.

Add a live pending/declined fixture assertion so local-only status mapping cannot mask the behavior.

- [ ] **Step 2: Run tests and verify red state**

Run: `node app/smoke.mjs && node app/live-auth-smoke.mjs`

Expected: FAIL because visitors still receive Giving navigation/full view and non-approved users see campaign content.

- [ ] **Step 3: Gate navigation and direct visitor routes**

Change the Giving nav item to signed-in visibility:

```js
{ key: "giving", label: "Giving", icon: "heart", href: "#/giving", roles: ["signed-in"] },
```

The existing `navHTML()` signed-in role filtering then includes it for pending, declined, approved, Admin, and Super Admin but not visitors.

In the router:

```js
case "giving":
  out = store.currentUser() ? views.viewGiving() : { redirect: "#/account" };
  break;
```

Keep the redirect inside the generation-safe route flow where applicable; do not render the full Giving view before deciding.

- [ ] **Step 4: Add a content-safe locked Giving view**

At the top of `viewGiving()`:

```js
const user = store.currentUser();
if (!user || user.status !== "approved") return givingLocked(user);
```

Implement `givingLocked(user)` with a real page heading, lock/banner treatment, and no campaign/FPS/history/donor data. Pending copy explains access unlocks after leadership review. Declined copy directs the user to contact an ITC leader. Both include 44px-accessible links to `#/account` and `#/schedule` using existing button classes.

Do not mention campaign totals, amount presets, donor IDs, transfer instructions, QR/FPS, transfer confirmation, or history in locked HTML.

- [ ] **Step 5: Run focused and full verification**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/views.js
node --check app/js/app.js
git diff --check
```

Expected: all pass, including existing Giving amount/confirmation/history checks.

- [ ] **Step 6: Commit the access change separately**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(giving): restrict access to approved members"
```

---

### Task 2: Final Giving Access Verification

**Files:**
- Verify only; modify Task 1 files only if a regression is found.

**Interfaces:**
- Consumes: completed Giving access matrix.
- Produces: fresh branch-level evidence that access and existing Giving flows coexist.

- [ ] **Step 1: Run the complete branch suite**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
for file in app/js/*.js app/*.mjs; do node --check "$file"; done
git diff --check
git status --short --branch
```

Expected: all pass; only known unrelated files remain untracked in the original checkout.

- [ ] **Step 2: Inspect the exact feature scope**

```bash
git diff --stat 7257f79..HEAD
git diff --check 7257f79..HEAD
git log --oneline 7257f79..HEAD
```

Expected: one implementation commit touching only router, Giving/nav view, and smoke coverage; no Notification, database, or localStorage changes.

- [ ] **Step 3: Commit only if verification required a correction**

Rerun Step 1 after any correction and commit only exact corrected Task 1 files:

```bash
git commit -m "fix(giving): address access regression"
```

Do not create an empty commit.
