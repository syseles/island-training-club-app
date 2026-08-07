# Testing Auth and Giving Regression Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Auth-owned visitor Home and Admin navigation behavior, and keep the Giving page reachable when the deployed Supabase Giving schema is absent.

**Architecture:** Reintroduce the Auth reference’s status-aware Home rendering and Profile-only Admin entry in `views.js`. At the Giving store seam, convert only PostgREST `PGRST205` into the same null campaign result used when no campaign is published; retain all other errors. Keep schema deployment explicit and never restore seeded campaign data.

**Tech Stack:** Vanilla JavaScript ES modules, string-template HTML, Supabase/PostgREST, localStorage, Node smoke scripts, Bash safety scripts.

## Global Constraints

- Target baseline is `testing@a4345d2439012c209b8c9235bbb8860f2e82eae6` plus approved design commit `a86c791`.
- Auth reference is `feature/auth-identity@bcce208c857f2295f02607b7c254205a7074243b`.
- Visitor heading is exactly `This week — open to all` and contains free sessions only.
- Pending profiles retain `My Week` with free sessions only.
- Approved profiles retain `My Week` with booked sessions only.
- Primary navigation never includes Admin; Admin/Super Admin access remains at `Profile → Admin Tools`.
- Missing `public.giving_campaigns` (`PGRST205`) renders the no-active-campaign state.
- No published campaign also renders the no-active-campaign state.
- Any non-`PGRST205` Supabase error remains an error.
- Member-facing copy is exactly `No active Giving campaign at the moment` and `Check back soon for the next opportunity to support the ITC community.`
- Do not restore fake campaigns, seeded donations, demo users, or demo actions.
- Do not change localStorage shape or `STATE_VERSION = 13`.
- Do not add dependencies, a build step, Shop/merchandise behavior, or remote database mutations.
- Do not push until complete verification, review, and explicit approval.

---

### Task 1: Restore Auth Home and Primary Navigation

**Files:**
- Modify: `app/js/views.js`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: `store.currentUser()`, `store.upcomingSessions(14)`, `store.bookingsForUser(user.id)`, and canonical session `kind`.
- Produces: `viewHome(): string` with status-aware section content and `navHTML(routeKey, user): string` without Admin.

- [ ] **Step 1: Add failing visitor, member-state, and navigation regressions**

In `app/smoke.mjs`, immediately after `const localVisitorHome = views.viewHome();`, add:

```js
if (!localVisitorHome.includes("This week — open to all")) {
  throw new Error("visitor Home must show the open-to-all heading");
}
if (localVisitorHome.includes("My Week")) {
  throw new Error("visitor Home must not show My Week");
}
if (!localVisitorHome.includes(free.name) || localVisitorHome.includes(paid.name)) {
  throw new Error("visitor Home must show free sessions only");
}
```

Because `paid` and `free` are currently declared later, move the existing `allUpcoming`, `paid`, and `free` declarations above this new block without changing their logic.

After creating the pending user and rendering Account, add:

```js
const pendingHome = views.viewHome();
if (!pendingHome.includes("My Week") || !pendingHome.includes(free.name) || pendingHome.includes(paid.name)) {
  throw new Error("pending Home must show My Week with free sessions only");
}
```

After the approved member obtains a confirmed booking, assert:

```js
const approvedHome = views.viewHome();
if (!approvedHome.includes("My Week") || !approvedHome.includes(booking.snapshot.name)) {
  throw new Error("approved Home must show booked sessions in My Week");
}
for (const session of allUpcoming.filter((item) => item.id !== booking.sessionId)) {
  if (approvedHome.includes(`href="#/activity/${session.id}"`)) {
    throw new Error("approved My Week must exclude unbooked sessions");
  }
}
```

Add an Admin navigation contract near the existing Admin view checks:

```js
const adminPrimaryNav = views.navHTML("account", store.currentUser());
if (adminPrimaryNav.includes('href="#/admin"') || adminPrimaryNav.includes("<span>Admin</span>")) {
  throw new Error("Admin must not appear in primary navigation");
}
const adminProfile = await views.viewAccount();
if (!adminProfile.includes("Admin Tools") || !adminProfile.includes('href="#/admin"')) {
  throw new Error("Admin Tools must remain available from Profile");
}
```

- [ ] **Step 2: Run smoke and verify RED**

```bash
node app/smoke.mjs
```

Expected: failure on visitor `This week — open to all` or Admin primary-navigation assertion.

- [ ] **Step 3: Restore Auth status-aware Home behavior**

Replace the unconditional Home row/header logic in `viewHome()` with the Auth-reference structure:

```js
let rows;
let emptyMsg;
let weekHeading;
if (!user) {
  rows = upcoming.filter((session) => session.kind === "free");
  emptyMsg = "No open sessions this week — check back soon.";
  weekHeading = "This week — open to all";
} else if (user.status !== "approved") {
  rows = upcoming.filter((session) => session.kind === "free");
  emptyMsg = "No open sessions this week — check back soon.";
  weekHeading = "My Week";
} else {
  const bookedIds = new Set(
    store.bookingsForUser(user.id)
      .filter((booking) => booking.status === "confirmed" && !sessionStarted(booking.snapshot))
      .map((booking) => booking.sessionId)
  );
  rows = upcoming.filter((session) => bookedIds.has(session.id));
  emptyMsg = `Nothing booked this week yet. <a href="#/schedule" style="color:var(--accent)">Find a session →</a>`;
  weekHeading = "My Week";
}
```

Render `<h2>${weekHeading}</h2>` in the existing section head. Retain guest CTA, pending banner, session highlighting, Club card, and Schedule link unchanged.

- [ ] **Step 4: Remove Admin from primary navigation**

Delete only this `NAV_ITEMS` entry:

```js
{ key: "admin", label: "Admin", icon: "shield", href: "#/admin", roles: ["admin", "superadmin"] },
```

Simplify `navHTML()` only if a now-unused `isAdmin` variable remains. Do not remove `isAdminRole`, Admin routes, Admin tabs, or the `Admin Tools` Profile row.

- [ ] **Step 5: Run focused and full tests**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/views.js
node --check app/smoke.mjs
git diff --check
```

Expected: all commands exit 0; visitor/pending/approved and Admin-entry assertions pass.

- [ ] **Step 6: Commit Auth alignment**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "fix(testing): restore Auth Home and navigation"
```

---

### Task 2: Make Missing Giving Schema Render the Empty State

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/views.js`
- Test: `app/live-auth-smoke.mjs`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: Supabase query result `{ data, error }` and exact `error.code`.
- Produces: `getActiveGivingCampaign(options): Promise<Campaign|null>` where `PGRST205` returns `null` and all other errors reject.

- [ ] **Step 1: Make the fake Giving query support exact error injection**

Near `let activeGivingCampaignRow = null;` in `app/live-auth-smoke.mjs`, add:

```js
let activeGivingCampaignError = null;
```

In the fake `giving_campaigns` `maybeSingle()` result, replace `error: null` with:

```js
error: activeGivingCampaignError,
```

- [ ] **Step 2: Add failing live missing-schema and error-boundary tests**

After an approved live profile has been hydrated, add:

```js
activeGivingCampaignRow = null;
activeGivingCampaignError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const missingSchemaGiving = await views.viewGiving();
assert.match(missingSchemaGiving, /No active Giving campaign at the moment/);
assert.match(missingSchemaGiving, /Check back soon for the next opportunity to support the ITC community\./);

activeGivingCampaignError = null;
const emptyGiving = await views.viewGiving();
assert.match(emptyGiving, /No active Giving campaign at the moment/);

activeGivingCampaignError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewGiving(), /permission denied/);
activeGivingCampaignError = null;
```

Preserve and run the existing active-campaign stale-generation test afterward.

In `app/smoke.mjs`, update the local no-campaign assertion to require the exact new heading and body.

- [ ] **Step 3: Run live-auth and verify RED**

```bash
node app/live-auth-smoke.mjs
```

Expected: rejection with the injected `PGRST205` error.

- [ ] **Step 4: Handle only the missing-table code at the store seam**

In `getActiveGivingCampaign()` change:

```js
if (error) throw error;
```

to:

```js
if (error?.code === "PGRST205") {
  if (ownsGeneration()) liveGivingCampaign = null;
  return null;
}
if (error) throw error;
```

Do not add broad message matching or catch all PostgREST errors. Do not change `listGivingCampaigns()`; Admin must still surface missing migration errors.

- [ ] **Step 5: Update member-facing empty campaign copy**

In `viewGiving()` replace only:

```html
<h3>No active campaign right now</h3>
```

with:

```html
<h3>No active Giving campaign at the moment</h3>
```

Keep the approved body sentence exactly as specified. Do not add fallback FPS details or a local campaign.

- [ ] **Step 6: Verify Giving behavior and coexistence**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_giving_campaigns_safety.sh
node --check app/js/store.js
node --check app/js/views.js
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: missing schema and empty table render the member empty state; `42501` remains rejected; active campaign/generation tests and all existing suites pass.

- [ ] **Step 7: Commit Giving fallback**

```bash
git add app/js/store.js app/js/views.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "fix(giving): handle undeployed campaign schema"
```

---

### Task 3: Document Deployment Recovery and Verify the Candidate

**Files:**
- Modify: `docs/runbooks/live-auth.md`
- Modify: `README.md`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: ordered Giving migrations and Admin campaign management.
- Produces: deployment instructions that distinguish reachable empty-state behavior from functional Giving setup.

- [ ] **Step 1: Add documentation contracts**

In `app/smoke.mjs`, read `README.md` and `docs/runbooks/live-auth.md` if not already loaded, then assert:

```js
for (const marker of [
  "20260805000011_giving_campaigns.sql",
  "20260806000001_donor_id.sql",
  "Admin Tools → Giving",
  "No fake campaign data is restored",
]) {
  if (!deploymentDocs.includes(marker)) {
    throw new Error(`Giving deployment recovery docs missing ${marker}`);
  }
}
```

- [ ] **Step 2: Run smoke and verify RED**

```bash
node app/smoke.mjs
```

Expected: failure on the new deployment recovery markers.

- [ ] **Step 3: Document the Giving recovery sequence**

Add a concise `Giving schema and campaign` section to `docs/runbooks/live-auth.md` and link/summarize it from README:

```text
The member route treats PostgREST PGRST205 as no active campaign so Giving remains reachable. This does not make donations functional.

To enable Giving:
1. Apply the ordered chain including 20260805000011_giving_campaigns.sql and 20260806000001_donor_id.sql.
2. Sign in as an approved Admin/Super Admin and use Admin Tools → Giving to create and publish a real campaign.
3. Verify the published campaign as an approved member.

No fake campaign data is restored.
```

Retain the existing disposable-target SQL verifier commands and destructive-target warnings.

- [ ] **Step 4: Run complete release verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f"; done
for f in $(git ls-files '*.sh' '*.bash'); do bash -n "$f"; done
for f in $(git ls-files '*_safety.sh'); do bash "$f"; done
git diff --check origin/testing...HEAD
git diff --check

! git grep -nEi 'one-tap demo|data-action="demo-signin"|data-action="reset-demo"|case "demo-signin"|case "reset-demo"|case "form-checkout"|store\.payForSession|use a demo profile|d-seed-1|d-seed-2' \
  -- README.md app/js/app.js app/js/data.js app/js/views.js
```

Expected: all commands exit 0. The seed donation IDs may remain in `store.js` migration cleanup and smoke fixtures only, not runtime copy/data/views.

- [ ] **Step 5: Commit deployment documentation**

```bash
git add README.md docs/runbooks/live-auth.md app/smoke.mjs
git commit -m "docs(giving): document campaign schema recovery"
```

- [ ] **Step 6: Verify committed tip and request review**

```bash
test -z "$(git status --porcelain)"
git merge-base --is-ancestor origin/testing HEAD
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check origin/testing...HEAD
```

Present commits, root-cause evidence, verification output, and the still-manual remote migration step. Do not push until explicit approval.
