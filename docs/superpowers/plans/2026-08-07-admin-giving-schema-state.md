# Admin Giving Missing-Schema State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw Admin Giving `PGRST205` failure with an actionable setup-required state while preserving empty, active, and historical campaign management.

**Architecture:** Keep `store.listGivingCampaigns()` authoritative and error-throwing. Catch only exact `PGRST205` in the Admin view boundary and render a dedicated setup state; all other errors continue through route feedback. Implement and verify on `feature/giving-page`, then port the exact view/test behavior into `testing` without merging divergent branch history.

**Tech Stack:** Vanilla JavaScript ES modules, Supabase/PostgREST, string-template HTML, Node smoke scripts.

## Global Constraints

- Source implementation branch: `feature/giving-page@8ef2333`.
- Integration baseline: current `origin/testing`.
- Setup heading is exactly `Giving setup required`.
- Missing-schema state names `20260805000011_giving_campaigns.sql` and `20260806000001_donor_id.sql`.
- Missing-schema state renders no create/edit/publish/close controls and no campaign history.
- Empty successful campaign list retains `No Giving campaigns yet.` and `+ Create campaign`.
- Closed campaigns remain visible as history and permit creating the next campaign.
- Draft/published campaigns continue suppressing a second open campaign.
- Only exact `error.code === "PGRST205"` is handled; all other errors reject.
- `store.listGivingCampaigns()` remains unchanged and error-throwing.
- No fake campaign data, localStorage shape change, dependency, build step, or remote database mutation.
- Push source and Testing only after verification and explicit approval.

---

### Task 1: Implement Missing-Schema Admin State on Giving Source

**Files:**
- Modify: `app/js/views.js`
- Test: `app/live-auth-smoke.mjs`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: `store.listGivingCampaigns(): Promise<Campaign[]>`, thrown Supabase errors with `.code`.
- Produces: `viewAdmin("giving"): Promise<string|redirect>` and `viewAdminCampaign(id): Promise<string|redirect>` with an exact missing-schema setup state.

- [ ] **Step 1: Add fake campaign-list error injection**

Near the Giving fake state in `app/live-auth-smoke.mjs`, add:

```js
let givingCampaignListError = null;
```

Change the fake list query’s `.order()` result to return:

```js
return Promise.resolve({
  data: givingCampaignListError ? null : structuredClone(givingCampaignRows),
  error: givingCampaignListError,
});
```

- [ ] **Step 2: Add failing view-boundary tests**

After hydrating an approved Super Admin, add:

```js
givingCampaignListError = {
  code: "PGRST205",
  message: "Could not find the table 'public.giving_campaigns' in the schema cache",
};
const setupHtml = await views.viewAdmin("giving");
assert.match(setupHtml, /Giving setup required/);
assert.match(setupHtml, /20260805000011_giving_campaigns\.sql/);
assert.match(setupHtml, /20260806000001_donor_id\.sql/);
for (const forbidden of ["+ Create campaign", "form-campaign", "campaign-row", "Publish campaign", "Close campaign"]) {
  assert.doesNotMatch(setupHtml, new RegExp(forbidden.replace(/[+]/g, "\\+")));
}
const setupDetailHtml = await views.viewAdminCampaign("new");
assert.match(setupDetailHtml, /Giving setup required/);

givingCampaignListError = { code: "42501", message: "permission denied" };
await assert.rejects(() => views.viewAdmin("giving"), (error) => error?.message === "permission denied");
givingCampaignListError = null;
```

In `app/smoke.mjs`, retain or add assertions that local empty Giving shows `No Giving campaigns yet.` and `+ Create campaign`, and closed campaigns remain visible while allowing a new campaign.

- [ ] **Step 3: Run tests and verify RED**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: live-auth rejects with the injected `PGRST205` error before rendering setup copy.

- [ ] **Step 4: Add a dedicated setup renderer**

In `app/js/views.js`, add:

```js
const isGivingSchemaMissing = (error) => error?.code === "PGRST205";

function adminGivingSetupRequired() {
  return `
    <div class="section-head"><h2>Giving setup required</h2></div>
    <div class="card"><div class="card-body">
      <p class="hero-meta">Campaign management becomes available after the Giving schema migrations are applied to the deployed Supabase project.</p>
      <div class="receipt-lines mt16">
        <div class="line"><span>1</span><strong class="mono">20260805000011_giving_campaigns.sql</strong></div>
        <div class="line"><span>2</span><strong class="mono">20260806000001_donor_id.sql</strong></div>
      </div>
      <p class="muted small mt16">After installation, return here to create and publish the first real campaign.</p>
    </div></div>`;
}
```

Do not include buttons or fake campaign details.

- [ ] **Step 5: Catch only PGRST205 at both Admin Giving view boundaries**

Replace the nested Giving body expression with an explicit branch:

```js
let body;
if (tab === "activities") body = adminActivities();
else if (tab === "giving") {
  try {
    body = adminGiving(await store.listGivingCampaigns());
  } catch (error) {
    if (!isGivingSchemaMissing(error)) throw error;
    body = adminGivingSetupRequired();
  }
} else if (tab === "members") body = adminMembers(user, memberUsers);
else body = adminApprovals(await store.listApprovalCandidates());
```

At the start of `viewAdminCampaign(id)`, wrap only `listGivingCampaigns()`:

```js
let campaignList;
try {
  campaignList = await store.listGivingCampaigns();
} catch (error) {
  if (!isGivingSchemaMissing(error)) throw error;
  return adminGivingSetupRequired();
}
```

- [ ] **Step 6: Verify source behavior**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_giving_campaigns_safety.sh
node --check app/js/views.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: setup/empty/history/error-boundary assertions pass.

- [ ] **Step 7: Commit source fix**

```bash
git add app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(giving): explain missing campaign schema"
```

---

### Task 2: Integrate the Reviewed Fix into Testing

**Files:**
- Modify in Testing worktree: `app/js/views.js`
- Modify in Testing worktree: `app/live-auth-smoke.mjs`
- Modify in Testing worktree: `app/smoke.mjs` only if its existing local campaign-state assertions need the new setup contract

**Interfaces:**
- Consumes: reviewed source commit from Task 1 and Testing’s integrated Admin tab shell.
- Produces: Testing candidate with identical PGRST205 setup behavior and all integrated domains preserved.

- [ ] **Step 1: Start from current origin/testing in an isolated worktree**

```bash
git fetch origin --prune
git worktree add .worktrees/testing-giving-schema-fix -b work/testing-giving-schema-fix origin/testing
```

Do not merge `feature/giving-page`; its history diverges from Testing.

- [ ] **Step 2: Add failing Testing regressions**

Port the Task 1 fake error injection and assertions into Testing’s larger `app/live-auth-smoke.mjs`. Preserve existing Giving active-campaign, missing-member-schema, Notification, Payment, and Auth fake behavior.

Add source/render assertions in Testing smoke for:

```text
Giving setup required
20260805000011_giving_campaigns.sql
20260806000001_donor_id.sql
No Giving campaigns yet.
+ Create campaign
```

- [ ] **Step 3: Run Testing suites and verify RED**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: Testing’s Admin Giving PGRST205 path rejects before rendering setup copy.

- [ ] **Step 4: Port only the reviewed view helpers and catches**

Apply `isGivingSchemaMissing`, `adminGivingSetupRequired`, and the two exact view-boundary catches from Task 1. Preserve Testing’s five Admin tabs, Payment Ops/member-directory prefetch, Giving tab placement, and async generation behavior. Do not replace `views.js` wholesale.

- [ ] **Step 5: Run complete Testing verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f"; done
for f in $(git ls-files '*.sh' '*.bash'); do bash -n "$f"; done
for f in $(git ls-files '*_safety.sh'); do bash "$f"; done
git diff --check origin/testing...HEAD
git diff --check
```

Expected: all commands pass; no integrated domain or state-v13 regressions.

- [ ] **Step 6: Commit Testing integration**

```bash
git add app/js/views.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "fix(testing): explain missing Giving schema"
```

- [ ] **Step 7: Present verification and request push approval**

Report source and Testing commits, test evidence, and the remaining manual remote migration requirement. Do not push either branch until explicit approval.
