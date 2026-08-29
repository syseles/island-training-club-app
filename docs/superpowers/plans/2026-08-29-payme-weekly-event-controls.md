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
- Do not add dependencies, a build step, a localStorage migration, or a Supabase migration.
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
