# Same-Device FPS Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every mock FPS QR presentation with accurate, accessible same-device copy-and-transfer instructions while preserving the prototype's existing reconciliation behavior.

**Architecture:** Keep payment data and mutations unchanged. Render deterministic booking references and generated Giving references in `views.js`; route inert clipboard values through the existing delegated click handler in `app.js`; remove the now-unused QR-only CSS.

**Tech Stack:** Vanilla ES modules, hand-rendered HTML/CSS, Node smoke scripts, localStorage/Supabase seams unchanged.

## Global Constraints

- Work only on `feature/payment-system`; do not import or modify unrelated Admin Ops work.
- No QR UI or QR/scan/embedded-amount claims may remain in paid-booking or Giving FPS flows.
- Do not add a universal banking-app deep link or claim one exists.
- Preserve the mock/no-real-payment boundary, authentication, authorization, payment recording, Giving recording, receipts, and reconciliation.
- Add no dependencies, build step, framework, state keys, migrations, or backend changes.
- Every behavior change follows red-green TDD.
- Final verification is `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, JavaScript syntax checks, and `git diff --check`.

## File Structure

**Create**

- `docs/superpowers/specs/2026-08-30-same-device-fps-design.md` — approved behavior and boundaries.
- `docs/superpowers/plans/2026-08-30-same-device-fps.md` — red-green execution checklist.

**Modify**

- `app/js/views.js` — booking reference, FPS detail rows, accessible copy controls, and same-device instructions.
- `app/js/app.js` — delegated destination/reference clipboard success and failure handling.
- `app/styles.css` — remove the unused `.fps-qr` placeholder rule.
- `app/smoke.mjs` — rendered booking/Giving contracts and global QR-removal contract.
- `app/live-auth-smoke.mjs` — delegated clipboard success, unsupported, and rejection behavior.

---

### Task 1: Paid Booking and Giving FPS Presentations

**Files:**
- Modify: `app/smoke.mjs` in the Payment member UI and integrated Giving blocks
- Modify: `app/js/views.js` in `givingFpsStep()` and `viewPay()`
- Modify: `app/styles.css` at the `.fps-qr` rule

**Interfaces:**
- Produces: `bookingPaymentReference(booking: object): string` private view helper returning `ITC-` plus the final six alphanumeric characters of the booking ID.
- Produces: rendered `data-action="copy-fps"` and `data-action="copy-reference"` controls with `data-copy-value` values.
- Preserves: `form-mark-paid`, payment method radios, `giving-confirm`, and all store calls.

- [ ] **Step 1: Add failing paid-booking rendering assertions**

Extend the existing member payment UI block after `const pay = views.viewPay(b.id);`:

```js
const suggestedReference = `ITC-${b.id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase()}`;
for (const marker of [
  "Assigned collector / payee", "FPS mobile number", "Exact amount",
  "Suggested reference", "+852 5000 0003", suggestedReference,
  'data-action="copy-fps"', 'aria-label="Copy FPS number"',
  'data-action="copy-reference"', 'aria-label="Copy payment reference"',
  "Open your banking app", "pay by mobile number", "Paste the FPS number",
]) {
  if (!pay.includes(marker)) throw new Error(`same-device booking FPS UI missing ${marker}`);
}
if (!pay.includes(`value="${suggestedReference}"`)) {
  throw new Error("suggested booking reference must prefill reconciliation input");
}
if (/QR|Scan with your banking app|amount is embedded/i.test(pay)) {
  throw new Error("booking FPS flow must not show or claim QR behavior");
}
```

- [ ] **Step 2: Add failing Giving step-two assertions and source-level QR removal assertion**

After publishing `givingCampaign` and signing in as the member, set:

```js
views.givingState.step = 2;
views.givingState.amount = 250;
views.givingState.name = "Giving Member";
views.givingState.ref = "GIVE-TEST";
views.givingState.campaignId = givingCampaign.id;
const givingFpsHtml = await views.viewGiving();
for (const marker of [
  "FPS ID", "Payee", "HK$250", "GIVE-TEST",
  'data-action="copy-fps"', 'aria-label="Copy FPS ID"',
  'data-action="copy-reference"', 'aria-label="Copy Giving reference"',
  "Open your banking app", "pay using the FPS ID", "Paste the FPS ID",
]) {
  if (!givingFpsHtml.includes(marker)) throw new Error(`same-device Giving FPS UI missing ${marker}`);
}
if (/QR|scan|bank deep.link/i.test(givingFpsHtml)) {
  throw new Error("Giving FPS flow must not show QR or universal deep-link claims");
}
```

The two rendered-flow assertions cover the real member-facing behavior. Do not add a source-grep test; final review separately checks that the unused selector and retired copy are absent.

- [ ] **Step 3: Run local smoke to verify RED**

Run:

```bash
node app/smoke.mjs
```

Expected: FAIL at the first missing same-device booking marker before production edits.

- [ ] **Step 4: Add a deterministic booking-reference helper**

Add near `viewPay()` in `app/js/views.js`:

```js
function bookingPaymentReference(booking) {
  const suffix = String(booking?.id || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(-6)
    .toUpperCase();
  return `ITC-${suffix || "PAYMENT"}`;
}
```

In `viewPay()`, derive `const paymentReference = bookingPaymentReference(b);`.

- [ ] **Step 5: Replace the booking FPS QR block**

Render receipt lines for **Assigned collector / payee**, **FPS mobile number**, **Exact amount**, and **Suggested reference**. Render copy buttons only when their value is non-empty:

```html
<button class="btn ghost sm" type="button" data-action="copy-fps"
  data-copy-value="..." aria-label="Copy FPS number">Copy FPS number</button>
<button class="btn ghost sm" type="button" data-action="copy-reference"
  data-copy-value="..." aria-label="Copy payment reference">Copy reference</button>
```

Add an ordered list with these exact actions: open the banking app; choose FPS and pay by mobile number; paste the FPS number; enter the exact amount and suggested reference; return and select **I’ve paid**. Do not add a bank URL.

Prefill the existing input while leaving it editable:

```html
<input id="pay-ref" name="ref" value="${esc(paymentReference)}">
```

Keep PayMe and all forms/actions intact; remove only its inaccurate “amount ready” claim if the view cannot guarantee it.

- [ ] **Step 6: Replace the Giving FPS QR block**

Keep the existing FPS ID, payee, amount, and generated reference rows. Add adjacent copy controls:

```html
<button class="btn ghost sm" type="button" data-action="copy-fps"
  data-copy-value="${esc(campaign.fpsId)}" aria-label="Copy FPS ID">Copy FPS ID</button>
<button class="btn ghost sm" type="button" data-action="copy-reference"
  data-copy-value="${esc(givingState.ref)}" aria-label="Copy Giving reference">Copy reference</button>
```

Add ordered same-device steps: open banking app; choose FPS and pay using FPS ID; paste FPS ID; enter displayed amount/reference; return and use **I’ve made the transfer**. Preserve the mock disclaimer and existing `giving-confirm` behavior.

- [ ] **Step 7: Remove QR-only CSS and run local smoke GREEN**

Delete the complete `.fps-qr` comment/rule from `app/styles.css`, then run:

```bash
node app/smoke.mjs
```

Expected: exit 0 and print the new same-device FPS success lines.

---

### Task 2: Safe Delegated Clipboard Feedback

**Files:**
- Modify: `app/live-auth-smoke.mjs` near the existing delegated FPS copy regression
- Modify: `app/js/app.js` at the `copy-fps` switch case

**Interfaces:**
- Consumes: button `dataset.copyValue` from Task 1.
- Produces: delegated `copy-fps` and `copy-reference` actions.
- Produces: success toasts `FPS number copied`, `FPS ID copied`, or `Payment reference copied`, selected from `dataset.copyKind`.
- Produces: error alert toast `Copy unavailable — select and copy the value manually` when clipboard support is absent, the value is empty, or `writeText` rejects.

- [ ] **Step 1: Extend delegated clipboard tests for destination/reference success**

Replace the current single copy assertion with controls carrying `copyValue` and `copyKind`:

```js
const copiedValues = [];
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (value) => { copiedValues.push(value); } },
});
for (const [action, copyValue, copyKind, expectedToast] of [
  ["copy-fps", "+852 6123 4567", "number", "FPS number copied"],
  ["copy-fps", "1234567", "id", "FPS ID copied"],
  ["copy-reference", "ITC-A1B2C3", "reference", "Payment reference copied"],
]) {
  toastStack.children.length = 0;
  const control = makeElement();
  control.dataset = { action, copyValue, copyKind };
  control.closest = () => control;
  await click({ target: control, preventDefault() {} });
  assert.equal(copiedValues.at(-1), copyValue);
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [expectedToast]);
  assert.equal(toastStack.children[0].getAttribute("role"), "status");
}
```

- [ ] **Step 2: Add clipboard rejection and unsupported tests**

```js
for (const clipboard of [
  undefined,
  { writeText: async () => { throw new Error("permission denied"); } },
]) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true, value: clipboard,
  });
  toastStack.children.length = 0;
  const control = makeElement();
  control.dataset = { action: "copy-reference", copyValue: "ITC-A1B2C3", copyKind: "reference" };
  control.closest = () => control;
  await click({ target: control, preventDefault() {} });
  assert.deepEqual(toastStack.children.map((item) => item.textContent), [
    "Copy unavailable — select and copy the value manually",
  ]);
  assert.equal(toastStack.children[0].getAttribute("role"), "alert");
}
```

Add one empty `copyValue` case and assert the same error without calling `writeText`.

- [ ] **Step 3: Run live smoke to verify RED**

Run:

```bash
node app/live-auth-smoke.mjs
```

Expected: FAIL because `copy-reference` is not delegated and rejection is not caught.

- [ ] **Step 4: Implement guarded clipboard copying**

Replace the old `copy-fps` case in `app/js/app.js` with shared cases:

```js
case "copy-fps":
case "copy-reference": {
  const value = String(el.dataset.copyValue || "").trim();
  const successMessage = {
    id: "FPS ID copied",
    number: "FPS number copied",
    reference: "Payment reference copied",
  }[el.dataset.copyKind] || "Copied";
  if (!value || !navigator.clipboard?.writeText) {
    toast("Copy unavailable — select and copy the value manually", true);
    break;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast(successMessage);
  } catch (_err) {
    toast("Copy unavailable — select and copy the value manually", true);
  }
  break;
}
```

The handler must not query arbitrary selectors, write HTML, or mutate payment/Giving state.

- [ ] **Step 5: Run both smoke suites GREEN**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0.

---

### Task 3: Final Verification, Review, and Commit

**Files:**
- Review all files listed above
- Create: `docs/superpowers/reports/2026-08-30-same-device-fps-sdd.md`

**Interfaces:**
- Produces: concise SDD evidence report with design, red/green observations, checks, and concerns.

- [ ] **Step 1: Prove all QR UI and claims are gone**

```bash
rg -n -i "qr|scan with your banking app|amount is embedded" \
  app/js app/styles.css app/index.html
```

Expected: no output from runtime files. Review any output before proceeding; do not suppress legitimate failures.

- [ ] **Step 2: Run syntax checks**

```bash
for file in app/js/*.js app/*.mjs; do node --check "$file" || exit 1; done
```

Expected: exit 0.

- [ ] **Step 3: Run required suites and whitespace validation**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
git diff --check
```

Expected: all exit 0.

- [ ] **Step 4: Review scope and write the SDD report**

Inspect:

```bash
git status --short
git diff --stat
git diff -- app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git diff --name-only
```

Confirm no store, Supabase, admin view, dependency, or unrelated Admin Ops file changed. Write `docs/superpowers/reports/2026-08-30-same-device-fps-sdd.md` with: approved design summary; RED commands/failures observed; GREEN commands/results; implementation boundaries; remaining concern that clipboard access depends on browser support/permissions and manual selection remains the fallback.

- [ ] **Step 5: Commit without pushing or merging**

```bash
git add app/js/views.js app/js/app.js app/styles.css \
  app/smoke.mjs app/live-auth-smoke.mjs \
  docs/superpowers/specs/2026-08-30-same-device-fps-design.md \
  docs/superpowers/plans/2026-08-30-same-device-fps.md \
  docs/superpowers/reports/2026-08-30-same-device-fps-sdd.md
git commit -m "feat(payments): replace FPS QR with same-device transfer"
```

Do not push or merge.
