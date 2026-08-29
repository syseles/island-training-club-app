# PayMe Handoff and Weekly Event Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the collector’s valid PayMe personal link with a useful payment note, and present all dated recurring-event controls under one clear Admin hierarchy.

**Architecture:** Normalize PayMe personal links at the store seam so both newly saved and legacy persisted values render as safe absolute URLs. Keep the payment screen presentational and use existing delegated clipboard handling. Refactor only the Admin view composition: one `Weekly Event Controls` parent renders separate free/RSVP and paid groups while preserving all existing forms and actions.

**Tech Stack:** Vanilla ES modules, hand-rendered HTML, localStorage/Supabase store seam, delegated DOM events, Node smoke tests.

## Global Constraints

- Implement items 2 and 3 on `feature/admin-ops` only.
- The branch baseline is current `testing` at `9b7b9ca` or newer.
- Accept only collector-specific HTTPS links on `payme.hsbc.com.hk`; never render an empty or relative PayMe `href`.
- Suggested note format: `<session name> · <date> · <location> · <member name>`.
- Label the paid Admin group exactly `Paid Sessions`.
- Preserve one-off event controls as a separate top-level section.
- Preserve all existing weekly form IDs, `data-action` values, and mutation functions.
- Do not add dependencies, a build step, or a localStorage migration. The only permitted Supabase schema change is `20260829000005_assigned_collector_payout_rpc.sql`, the least-privilege read RPC approved after final review.
- Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before completion.

---

### Task 1: Normalize and validate collector PayMe links

**Files:**
- Modify: `app/js/store.js` near collector payout helpers
- Modify: `app/js/app.js` in `form-payouts`
- Test: `app/smoke.mjs` near duty/payout tests
- Test: `app/live-auth-smoke.mjs` near live payout persistence tests

**Interfaces:**
- Produces: `export function normalizePayMeLink(raw)` returning `""` for blank input, a normalized absolute URL for a valid personal link, and throwing for invalid nonblank input.
- Consumes: existing `collectorPayoutsFor()`, `collectorFor()`, and `updateCollectorPayouts()` payout flows.

- [ ] **Step 1: Write failing normalization tests**

Add assertions in `app/smoke.mjs`:

```js
assert.equal(
  store.normalizePayMeLink("payme.hsbc.com.hk/1/collector-code"),
  "https://payme.hsbc.com.hk/1/collector-code"
);
assert.equal(store.normalizePayMeLink(""), "");
for (const invalid of [
  "https://payme.hsbc.com.hk/",
  "http://payme.hsbc.com.hk/1/collector-code",
  "https://example.com/collector",
  "not a url",
]) {
  assert.throws(
    () => store.normalizePayMeLink(invalid),
    /personal PayMe link/
  );
}
```

Use the suite’s existing `assert` import.

- [ ] **Step 2: Run the local suite and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because `store.normalizePayMeLink` is not defined.

- [ ] **Step 3: Implement the normalizer**

Add an exported pure helper near the payout functions:

```js
export function normalizePayMeLink(raw) {
  let value = String(raw ?? "").trim();
  if (!value) return "";
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter your personal PayMe link.");
  }
  const personalPath = url.pathname.split("/").filter(Boolean);
  if (url.protocol !== "https:"
      || url.hostname.toLowerCase() !== "payme.hsbc.com.hk"
      || personalPath.length === 0) {
    throw new Error("Enter your personal PayMe link from PayMe.");
  }
  return url.toString().replace(/\/$/, "");
}
```

Normalize links in three places:

1. `updateCollectorPayouts()` before calling the live RPC or saving local state.
2. `collectorPayoutsFor()` so legacy persisted/live values display normalized in the Admin form.
3. `collectorFor()` when payout details are composed for the member payment screen.

Invalid legacy read values should resolve to `""` rather than crash a view; invalid nonblank form submissions should throw clear feedback.

- [ ] **Step 4: Catch payout form validation errors**

Wrap `form-payouts` in `try/catch`, await the store update, and keep the form rendered on failure:

```js
try {
  await store.updateCollectorPayouts(member.id, {
    paymeLink: fd.get("paymeLink"),
    fpsPhone: profilePhone,
  });
  toast("Payout details saved");
  render();
} catch (err) {
  toast(err.message || "Unable to save payout details", true);
}
```

- [ ] **Step 5: Extend live coverage for normalized persistence**

Change the live payout fixture to submit `payme.hsbc.com.hk/1/live-admin` without a scheme. Assert the Admin output, persisted operational payout cache, and member-facing payment view contain `https://payme.hsbc.com.hk/1/live-admin`.

- [ ] **Step 6: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass.

- [ ] **Step 7: Commit PayMe validation**

```bash
git add app/js/store.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(payments): normalize collector PayMe links"
```

---

### Task 2: Render the PayMe handoff and suggested note

**Files:**
- Modify: `app/js/views.js` in `viewPay()`
- Modify: `app/js/app.js` near `copy-fps`
- Test: `app/smoke.mjs` in member payment UI coverage
- Test: `app/live-auth-smoke.mjs` in delegated clipboard coverage

**Interfaces:**
- Consumes: normalized `collector.paymeLink`, booking snapshot fields, current member identity, `fmtDate()`, and `navigator.clipboard.writeText()`.
- Produces: a safe external PayMe action, payment instructions, a suggested note, and `data-action="copy-payment-note"`.

- [ ] **Step 1: Write failing payment-view assertions**

Before rendering, sign in as the fixture Admin, save `payme.hsbc.com.hk/1/test-admin`, then sign back in as the fixture member. Derive the expected note and assert:

```js
const expectedNote = `${sess.name} · ${data.fmtDate(sess.dateISO)} · ${sess.location} · Test Member`;
if (!pay.includes('href="https://payme.hsbc.com.hk/1/test-admin"')
    || !pay.includes('target="_blank"')
    || !pay.includes(expectedNote)
    || !pay.includes('data-action="copy-payment-note"')) {
  throw new Error("pay screen should open the collector PayMe link and show the suggested note");
}
if (pay.includes("amount ready")) {
  throw new Error("PayMe instructions must not claim the amount is prefilled");
}
```

Add a second fixture with an empty PayMe link and assert there is no clickable PayMe anchor and the output says to use FPS.

- [ ] **Step 2: Run the local suite and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because the note and delegated copy control do not exist and old PayMe copy remains.

- [ ] **Step 3: Implement the payment note and safe PayMe states**

In `viewPay()` derive:

```js
const memberName = user.fullName || user.preferredName || "ITC Member";
const paymentNote = `${s.name} · ${fmtDate(s.dateISO)} · ${s.location || "Venue TBC"} · ${memberName}`;
```

When `payme` is nonblank, render an external anchor to the normalized value and copy that says PayMe opens the collector, after which the member enters the displayed amount. When blank, render a disabled visual action without an `href` and explain that the member should use FPS.

Below the amount guidance, render:

```html
<p class="muted small mt8">Suggested payment note</p>
<p><strong>${esc(paymentNote)}</strong>
  <button class="btn ghost sm" type="button"
    data-action="copy-payment-note" data-note="${esc(paymentNote)}">Copy note</button>
</p>
```

- [ ] **Step 4: Add delegated note copying**

Add a click case beside `copy-fps`:

```js
case "copy-payment-note":
  if (el.dataset.note && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(el.dataset.note);
    toast("Payment note copied");
  } else {
    toast("Copy unsupported on this device");
  }
  break;
```

- [ ] **Step 5: Add delegated live clipboard coverage**

Follow the existing fake `copy-fps` control pattern in `app/live-auth-smoke.mjs`: dispatch `copy-payment-note` with a note containing session, date, location, and member, then assert the clipboard stub received the exact string.

- [ ] **Step 6: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass.

- [ ] **Step 7: Commit the member handoff**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(payments): add PayMe handoff note"
```

---

### Task 3: Combine dated recurring controls under one Admin section

**Files:**
- Modify: `app/js/views.js` around `adminWeeklySessions()`, `adminFreeEventVenues()`, and `adminActivities()`
- Test: `app/smoke.mjs` in Admin Activities and RSVP coverage
- Test: `app/live-auth-smoke.mjs` where Admin Activities is rendered

**Interfaces:**
- Produces: `adminWeeklyEventControls()` returning one top-level `<details>` section.
- Consumes: unchanged free/RSVP card markup and unchanged paid-session card markup.

- [ ] **Step 1: Write failing hierarchy assertions**

Render Admin Activities and isolate the region between `Weekly Event Controls` and `One-off Events`. Assert:

```js
if ((adminActivitiesHtml.match(/>Weekly Event Controls</g) || []).length !== 1
    || !adminActivitiesHtml.includes("Free &amp; RSVP Events")
    || !adminActivitiesHtml.includes("Paid Sessions")) {
  throw new Error("Activities should group weekly controls by free/RSVP and paid sessions");
}
if (adminActivitiesHtml.includes(">Weekly Venue Overrides<")
    || adminActivitiesHtml.includes(">Weekly Session Overrides<")) {
  throw new Error("legacy weekly override headings should be removed");
}
```

Within the grouped region, retain assertions for:

- `data-action="form-week-venue"`
- `data-action="reset-week-venue"`
- RSVP count and `Cancel this week's event`
- `form-session-time`
- `form-session-notice`
- `data-action="venue-tbc-toggle"`
- `data-action="midtown-toggle"`
- `form-cancel-week`

Also assert `One-off Events` appears after the combined section and remains outside it.

- [ ] **Step 2: Run the local suite and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because the two legacy top-level headings still render.

- [ ] **Step 3: Refactor group renderers without changing forms**

Change the existing helper boundaries:

- `adminFreeEventVenues()` becomes a group renderer that returns a heading `Free & RSVP Events`, its explanatory copy, and the unchanged cards, without a top-level `details` wrapper.
- `adminWeeklySessions()` becomes a group renderer that returns a heading `Paid Sessions`, its explanatory copy, and unchanged paid cards, without a top-level `details` wrapper.
- Empty groups render a concise empty state rather than removing the entire parent.

Add:

```js
function adminWeeklyEventControls() {
  return `
    <details class="admin-section mt24">
      <summary><h2>Weekly Event Controls</h2></summary>
      <p class="muted small mt8">Manage one dated event without changing its recurring defaults.</p>
      <section class="admin-control-group" aria-labelledby="free-rsvp-events-title">
        ${adminFreeEventControls()}
      </section>
      <section class="admin-control-group mt24" aria-labelledby="paid-sessions-title">
        ${adminPaidSessionControls()}
      </section>
    </details>`;
}
```

Each group renderer must include the matching heading ID. Preserve every card’s form/action markup exactly.

Replace:

```js
${adminFreeEventVenues()}
${adminWeeklySessions()}
```

with:

```js
${adminWeeklyEventControls()}
```

Keep `${adminOneOffEvents()}` after it.

- [ ] **Step 4: Update contextual copy references**

Change live recurring-default guidance and any activity-edit guidance that names `Weekly Venue Overrides` to direct Admins to `Weekly Event Controls > Free & RSVP Events`. Do not change Payments copy or move Finalize with gym.

- [ ] **Step 5: Run both suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass with the new hierarchy and all old form contracts preserved.

- [ ] **Step 6: Commit the Admin hierarchy**

```bash
git add app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "refactor(admin): group weekly event controls"
```

---

### Task 4: Final verification

**Files:**
- Verify: `app/js/store.js`
- Verify: `app/js/views.js`
- Verify: `app/js/app.js`
- Verify: `app/smoke.mjs`
- Verify: `app/live-auth-smoke.mjs`

- [ ] **Step 1: Run all required checks from the branch root**

```bash
git diff --check
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: whitespace check exits with no output, local smoke prints `All smoke tests passed.`, and live-auth smoke finishes with no error.

- [ ] **Step 2: Review scope and branch history**

```bash
git status --short --branch
git diff origin/testing...HEAD --stat
git log -6 --oneline
```

Confirm application changes are limited to PayMe normalization/handoff, payment-note copying, weekly Admin hierarchy, and matching tests/docs. Keep the worktree for review and do not merge into `testing` without explicit approval.

---

### Task 5: Final-review remediation — secure live payout reads and transactional saves

**Files:**
- Create: `supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql`
- Modify: `supabase/tests/operational_backend_integration.sql`
- Modify: `app/js/operations.js` in `fetchOperationalState()`
- Modify: `app/js/store.js` in `updateCollectorPayouts()`
- Modify: `app/js/app.js` in `form-payouts`
- Modify: `app/js/views.js` in `viewPay()`
- Test: `app/smoke.mjs`
- Test: `app/live-auth-smoke.mjs`

**Interfaces:**
- Produces: `public.get_assigned_collector_payout_profiles()` returning `table(profile_id uuid, payme_link text, fps_phone text)` to authenticated approved profiles only.
- Consumes: existing `collector_assignments`, `collector_payout_profiles`, `current_user_role()`, direct payout-table hydration, and `liveOps.liveUpdatePayout()`.
- Invariant: normal RLS continues to expose self/Admin payout rows; the RPC adds only payout rows for profiles that appear in `collector_assignments`.
- Invariant: rejected live updates do not mutate `state.paymentPayouts`; successful updates persist the normalized value only after RPC settlement.

- [ ] **Step 1: Write failing SQL and smoke coverage for the secure read contract**

In `supabase/tests/operational_backend_integration.sql`, assert that the function exists, `authenticated` can execute it, and `anon` cannot. In a transaction, create payout rows for an assigned Admin and an unassigned Super Admin. As an approved member, assert the RPC returns the assigned row but not the unassigned row; as a pending profile, assert the RPC raises `Approved membership required.`

In `app/smoke.mjs`, read the new migration and assert it contains all of these load-bearing controls:

```js
for (const marker of [
  "security definer",
  "set search_path = public",
  "current_user_role()",
  "collector_assignments",
  "collector_payout_profiles",
  "revoke all on function public.get_assigned_collector_payout_profiles() from public",
  "grant execute on function public.get_assigned_collector_payout_profiles() to authenticated",
]) assert.ok(assignedPayoutMigrationSource.toLowerCase().includes(marker));
```

- [ ] **Step 2: Run the local suite and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because `20260829000005_assigned_collector_payout_rpc.sql` does not exist.

- [ ] **Step 3: Add the least-privilege RPC migration**

Create `public.get_assigned_collector_payout_profiles()` as a `stable`, `SECURITY DEFINER`, SQL/PLpgSQL function with `set search_path = public`. It must:

1. Raise `Authentication required.` when `auth.uid()` is null.
2. Raise `Approved membership required.` unless `public.current_user_role()` is one of `member`, `admin`, or `super_admin`.
3. Return distinct `profile_id`, `payme_link`, and `fps_phone` rows by joining `collector_assignments` to `collector_payout_profiles` on the assigned collector UUID.
4. Return no arbitrary unassigned payout profiles.
5. Revoke execution from `public` and `anon`, then grant execution only to `authenticated`.

Do not relax the payout table’s existing RLS policies.

- [ ] **Step 4: Add failing cold-member hydration coverage**

In `app/live-auth-smoke.mjs`, make the fake direct `collector_payout_profiles` read respect the active profile: Admins can read all rows; members can read only their own row. Add fake RPC handling for `get_assigned_collector_payout_profiles` that returns only rows joined to assignments for approved callers.

Simulate a fresh/forced approved-member hydration after clearing any Admin-derived payout cache. Assert the direct table result has no collector row, the assigned-payout RPC is called, and `views.viewPay()` still renders the assigned collector’s normalized PayMe URL and FPS phone. Also assert an unassigned payout row is absent.

Run: `node app/live-auth-smoke.mjs`

Expected: FAIL because hydration does not call or merge the assigned-payout RPC.

- [ ] **Step 5: Merge assigned payout rows during live hydration**

In `fetchOperationalState()`, request `supabase.rpc("get_assigned_collector_payout_profiles")` alongside the existing direct payout-table select. Treat either error through `operationalProblem()`. Merge direct and assigned payout rows by `profile_id` before `buildPayoutRow()` so:

- Admin hydration retains all directly visible payout profiles.
- A cold member hydration gains only assigned collector payout profiles.
- Duplicate self/Admin/assigned rows collapse to one cache entry.

If the test needs a cache lifecycle seam, add a production `resetOperationalState()` or forced hydration path that clears/replaces all authorization-sensitive maps; use it on auth transitions rather than exposing a test-only API.

- [ ] **Step 6: Write failing transactional-save and busy-state coverage**

Change the deferred rejected-RPC test in `app/live-auth-smoke.mjs` to seed a prior payout value and assert:

- The prior persisted value remains while the RPC is pending.
- All payout form controls are disabled and the submit control is busy while pending.
- RPC rejection leaves the prior value unchanged.
- The submitted field value and rendered form remain unchanged.
- Controls are restored and alert feedback appears after rejection.

Add a successful deferred-RPC case asserting the normalized value is persisted only after RPC resolution.

Run: `node app/live-auth-smoke.mjs`

Expected: FAIL because current code writes before settlement and does not busy-guard the form.

- [ ] **Step 7: Persist only after success and busy-guard the form**

Keep `updateCollectorPayouts()` synchronous for local mode. In live mode, return the existing Promise chain and write `state.paymentPayouts[userId]` only in its success continuation:

```js
return liveOps.liveUpdatePayout(userId, normalizedPayMeLink, resolvedFpsPhone)
  .then((result) => {
    state.paymentPayouts[userId] = {
      paymeLink: normalizedPayMeLink,
      fpsPhone: resolvedFpsPhone,
    };
    save();
    return result;
  });
```

Wrap `form-payouts` with the existing `withBusyControl()` helper, using the submit button as the announced control, the form as `busyKey`, and all payout inputs/buttons as `controls`. Keep application lookup, normalization, RPC update, success render, and failure toast inside the busy work callback.

- [ ] **Step 8: Correct payment markup and harden semantic tests**

Move the premature `</div>` in `viewPay()` so the reference field and confirmation copy remain inside `.card-body`, producing exactly one `.card` and one `.card-body` close before the submit button.

Add a payment-note fixture containing `&`, `"`, and `<` in member/location values. Assert visible text and `data-note` are escaped and decode to the exact clipboard payload. Replace radio assertions that depend on serialized attribute order with checks scoped to each input tag, independently asserting `checked` and absence/presence of `disabled`.

- [ ] **Step 9: Run all available verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

If `ITC_OPERATIONS_TEST_DATABASE_URL` and `ITC_ALLOW_DATABASE_RESET=1` are available, also run:

```bash
bash supabase/tests/verify_operational_backend.sh
```

Otherwise report the disposable-database integration check as not run; do not claim the migration deployed or remotely verified.

- [ ] **Step 10: Commit the remediation**

```bash
git add docs/superpowers/specs/2026-08-29-payme-weekly-event-controls-design.md \
  docs/superpowers/plans/2026-08-29-payme-weekly-event-controls.md \
  supabase/migrations/20260829000005_assigned_collector_payout_rpc.sql \
  supabase/tests/operational_backend_integration.sql \
  app/js/operations.js app/js/store.js app/js/app.js app/js/views.js \
  app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(payments): secure live collector payouts"
```
