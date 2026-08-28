# Indemnity Read-and-Accept Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the full indemnity document inside an in-app modal that the user must scroll to the end of before the acceptance checkbox can be ticked. Apply consistently to the apply form (live + local modes) and the Profile > Indemnity page.

**Architecture:** Two new ES modules — `app/js/indemnity-doc.js` (single source of truth for the document body) and `app/js/components.js` (reusable `openIndemnityModal` component owning backdrop, focus trap, scroll detection, sticky ack button). Three surgical edits to existing views + one click handler in `app.js` to wire the trigger. No real `.pdf`, no new deps, no localStorage shape change.

**Tech Stack:** Vanilla ES modules, existing Night Circuit CSS variables, headless Node smoke test.

**Branch:** Implement on `feature/indemnity-pdf-modal` off `main`. The spec commit (`658c67d`) lives on `fix/testing-apply-form-boxes` — cherry-pick it onto the feature branch as the first commit before starting the tasks below.

```bash
git switch main
git pull --ff-only
git switch -c feature/indemnity-pdf-modal
git cherry-pick 658c67d   # bring in the spec doc
```

## File Structure

### New files

- **`app/js/indemnity-doc.js`** — pure render function `renderIndemnityDocument(): string`. No state, no DOM mutation. Returns the four indemnity sections as styled HTML. Imported by `views.js` (Profile > Indemnity inline card) and `components.js` (modal body).
- **`app/js/components.js`** — modal lifecycle component. Exports:
  - `SCROLL_END_THRESHOLD_PX: number` — exported constant for testing.
  - `isAtScrollEnd(scrollTop, clientHeight, scrollHeight): boolean` — pure scroll-end math.
  - `applyIndemnityAcceptance(trigger: Element): boolean` — DOM-mutation helper (enable + check the paired checkbox, hide the hint).
  - `openIndemnityModal({ onAccept }): void` — the modal itself; calls `onAccept(triggerElement)` when the user clicks the footer button.

### Modified files

- **`app/styles.css`** — append modal-related classes (`.modal-shell`, `.modal-backdrop`, `.modal-dialog`, `.modal-header`, `.modal-doc`, `.modal-doc-body`, `.modal-doc-ack`, `.modal-link`) and a disabled-with-hint rule for the paired checkbox.
- **`app/js/views.js`** — three edits: rewrite the `waiver` checkbox block in `viewApplyLive`, rewrite the `indemnity` checkbox block in `viewApplyLocal`, insert the `View as full document` button in `accountIndemnity` and replace its inline text card body with a call to `renderIndemnityDocument()`. Add one new import.
- **`app/js/app.js`** — one new delegated click handler for `[data-action="open-indemnity-doc"]`. Add one new import.
- **`app/smoke.mjs`** — update existing assertions that reference the old "participation waiver" copy; add new assertions for the modal flow.

### Files NOT modified (intentional)

- `app/js/store.js` — `acceptIndemnity`, `applyToMembershipLocal`, `acceptMyIndemnity`, `waiver_accepted_at` / `indemnityAcceptedAt` semantics all unchanged.
- `app/js/data.js` — no new seeds.
- `app/index.html` — new modules are imported via `app.js` / `views.js`, no new `<script>` tags needed.
- `STATE_VERSION` and migrations — unchanged.

## Global Constraints

These apply to every task below. The spec (`docs/superpowers/specs/2026-08-14-indemnity-pdf-modal-design.md`) is the source of truth — any conflict resolves in favour of the spec.

- No npm dependencies, no build step. Plain ES modules only.
- No real `.pdf` asset. The document is HTML styled to look like a paginated document.
- No new localStorage keys. No `STATE_VERSION` bump. No migrations.
- No new Supabase tables, columns, or RLS. `waiver_accepted_at` semantics unchanged.
- Vanilla JS: `const`/`let`, arrow functions, template literals, optional chaining.
- CSS class names consistent with existing palette: use existing `--accent`, `--surface-3`, `--line`, `--radius-sm`, `--ink`, `--muted` variables; do not introduce new colour tokens.
- Title-cased headings on Profile sub-pages (matches existing convention).
- The smoke test (`node app/smoke.mjs` from `app/`) is the contract — update it in the same task as any behaviour change. All tests must pass before the implementation is declared done.
- The acknowledgement copy on the checkbox label is exactly `I accept the <a>Health & Liability Indemnity</a> form. *` (live mode) and identical wording (local mode, `name="indemnity"`).
- The modal acknowledgement button label is exactly `I have read this document`.
- Scroll-end threshold: 4px tolerance (`scrollTop + clientHeight >= scrollHeight - 4`).
- The modal must not introduce a real PDF, must not trigger a download, must not open a new browser tab.
- The Profile > Indemnity page's existing inline text card must remain visually unchanged (only its body source becomes DRY via `renderIndemnityDocument()`).

---

## Task 1: Create the document source module

**Files:**
- Create: `app/js/indemnity-doc.js`
- Modify: `app/smoke.mjs` (append new assertions after the existing indemnity block, around line 692)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function renderIndemnityDocument(): string` — returns the four indemnity sections (Health declaration, Participation at my own risk, Release & indemnity, Emergency contact) wrapped in a single `<div class="doc-content">` for styling. No wrapper card chrome — the caller adds that.

- [ ] **Step 1: Write the failing smoke assertion**

Append at the end of the indemnity block in `app/smoke.mjs` (just before the `// --- HYROX payment system` comment around line 700):

```js
// --- indemnity document source module ---
const indemnityDoc = await import("./js/indemnity-doc.js");
const docBody = indemnityDoc.renderIndemnityDocument();
for (const heading of [
  "Health declaration",
  "Participation at my own risk",
  "Release &amp; indemnity",
  "Emergency contact",
]) {
  if (!docBody.includes(heading)) {
    failures++;
    console.error(`FAIL indemnity doc missing heading "${heading}"`);
  }
}
console.log("ok  indemnity doc renders all four section headings");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd app && node smoke.mjs 2>&1 | tail -20`
Expected: `FAIL indemnity doc missing heading "Health declaration"` (and similar for the other three). The module file does not exist yet.

- [ ] **Step 3: Create `app/js/indemnity-doc.js`**

Create the file with this exact content:

```js
// Single source of truth for the indemnity document body.
// Both the Profile > Indemnity inline card and the modal import this.
// Copy stays in one place so the modal and the page never drift.

export function renderIndemnityDocument() {
  return `
    <div class="doc-content">
      <h3>Health declaration</h3>
      <p>I confirm that I am physically fit and in good health, and I know of no medical reason I should not take part in Island Training Club (ITC) activities. If my health changes, I will seek professional medical advice before taking part again.</p>
      <h3>Participation at my own risk</h3>
      <p>I understand that ITC activities are recreational, may be volunteer-led, and involve inherent physical risk. I take part at my own risk, will work within my own limits, and will follow the instructions of ITC leaders at all times.</p>
      <h3>Release &amp; indemnity</h3>
      <p>To the fullest extent permitted by law, I release and indemnify ITC, its leaders, members and volunteers against any claim, loss, injury or damage arising from my participation in ITC activities.</p>
      <h3>Emergency contact</h3>
      <p>I confirm the emergency contact details in my membership application are accurate, and I will keep them up to date.</p>
    </div>`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd app && node smoke.mjs 2>&1 | tail -5`
Expected: `ok  indemnity doc renders all four section headings`, no `FAIL` lines from this assertion.

- [ ] **Step 5: Commit**

```bash
git add app/js/indemnity-doc.js app/smoke.mjs
git commit -m "feat(indemnity): add document source module

Single source of truth for the four indemnity sections, imported by
both the Profile > Indemnity inline card and the modal."
```

---

## Task 2: Create the modal component

**Files:**
- Create: `app/js/components.js`
- Modify: `app/smoke.mjs` (append assertions after Task 1's block)

**Interfaces:**
- Consumes: nothing (no imports needed — pure DOM APIs).
- Produces:
  - `export const SCROLL_END_THRESHOLD_PX = 4`
  - `export function isAtScrollEnd(scrollTop, clientHeight, scrollHeight): boolean`
  - `export function applyIndemnityAcceptance(trigger): boolean`
  - `export function openIndemnityModal({ onAccept }): void`

`applyIndemnityAcceptance(trigger)`:
- Calls `trigger.closest("form")`.
- If a form is found, queries it for `[data-indemnity-checkbox]` and `[data-indemnity-hint]`.
- If the checkbox is found: sets `checkbox.disabled = false`, `checkbox.checked = true`, and `hint.hidden = true` (if a hint exists).
- Returns `true` if a checkbox was found and updated, `false` otherwise (e.g. the trigger was the Profile > Indemnity button with no form context).

`openIndemnityModal({ onAccept })`:
- Creates a backdrop + dialog DOM, inserts at `document.body`.
- Dialog has `role="dialog"`, `aria-modal="true"`, `aria-labelledby="indemnity-modal-title"`.
- Renders `indemnityDoc.renderIndemnityDocument()` inside the scrollable body (which has `tabindex="0"`).
- Footer button (`data-modal-ack`) starts `disabled` with label `I have read this document`.
- Wires a `scroll` listener on the body that calls `isAtScrollEnd(...)` and toggles the button's `disabled` attribute. Calls the listener once after layout (via `requestAnimationFrame`) so a doc that fits the viewport enables the button immediately.
- Closes on: X button click, backdrop click, `Escape` key. Each close path: removes the backdrop, returns focus to the previously-focused element.
- Focus trap: Tab cycles between focusable elements inside the dialog.
- When the ack button is clicked: calls `onAccept(currentTrigger)` (the trigger is captured from the click handler that opened the modal — see Step 3 for how), then closes.

> **Importing `indemnityDoc` inside `components.js`:** add `import * as indemnityDoc from "./indemnity-doc.js";` at the top of `components.js`. The two new modules are co-located so the relative import works.

- [ ] **Step 1: Write the failing smoke assertions**

Append after Task 1's assertion block:

```js
// --- modal component: scroll-end math ---
const components = await import("./js/components.js");
if (components.SCROLL_END_THRESHOLD_PX !== 4) {
  failures++;
  console.error(`FAIL scroll-end threshold should be 4, got ${components.SCROLL_END_THRESHOLD_PX}`);
} else console.log("ok  scroll-end threshold is 4px");

const cases = [
  [100, 200, 300, true],   // 300 >= 296
  [50, 200, 300, false],   // 250 < 296
  [0, 200, 200, true],     // everything fits, 200 >= 196
  [0, 100, 50, true],      // degenerate: doc smaller than viewport
];
for (const [top, height, scroll, expected] of cases) {
  const got = components.isAtScrollEnd(top, height, scroll);
  if (got !== expected) {
    failures++;
    console.error(`FAIL isAtScrollEnd(${top},${height},${scroll}) expected ${expected}, got ${got}`);
  }
}
console.log("ok  isAtScrollEnd math returns correct values for 4 cases");

// --- applyIndemnityAcceptance: mutates the paired checkbox ---
const fakeCheckbox = { disabled: true, checked: false };
const fakeHint = { hidden: false };
const fakeForm = {
  querySelector: (sel) => {
    if (sel === "[data-indemnity-checkbox]") return fakeCheckbox;
    if (sel === "[data-indemnity-hint]") return fakeHint;
    return null;
  },
};
const fakeTrigger = { closest: (sel) => (sel === "form" ? fakeForm : null) };
if (components.applyIndemnityAcceptance(fakeTrigger) !== true) {
  failures++;
  console.error("FAIL applyIndemnityAcceptance should return true when a checkbox is paired");
}
if (fakeCheckbox.disabled !== false || fakeCheckbox.checked !== true || fakeHint.hidden !== true) {
  failures++;
  console.error("FAIL applyIndemnityAcceptance did not enable/check checkbox and hide hint");
} else console.log("ok  applyIndemnityAcceptance enables + checks paired checkbox and hides hint");

// applyIndemnityAcceptance: returns false when no checkbox is paired (Profile > Indemnity trigger)
const orphanTrigger = { closest: () => null };
if (components.applyIndemnityAcceptance(orphanTrigger) !== false) {
  failures++;
  console.error("FAIL applyIndemnityAcceptance should return false when no form is found");
} else console.log("ok  applyIndemnityAcceptance returns false for orphan triggers");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd app && node smoke.mjs 2>&1 | tail -15`
Expected: `FAIL scroll-end threshold should be 4, got undefined` (plus the other failures). The module file does not exist yet.

- [ ] **Step 3: Create `app/js/components.js`**

Create the file with this exact content:

```js
// Reusable read-and-accept modal component.
// Owns: backdrop, focus trap, ESC-to-close, scroll-end detection,
// sticky acknowledgement button, and the acknowledgement callback.
//
// Public API:
//   SCROLL_END_THRESHOLD_PX      — constant exported for testing
//   isAtScrollEnd(top,h,scroll)  — pure scroll-end math
//   applyIndemnityAcceptance(t)  — DOM-mutation helper for the ack callback
//   openIndemnityModal({onAccept})— the modal itself
//
// The modal currently renders only the indemnity document, but is designed
// so any future document body can be swapped in by changing the body source.

import * as indemnityDoc from "./indemnity-doc.js";

export const SCROLL_END_THRESHOLD_PX = 4;

export function isAtScrollEnd(scrollTop, clientHeight, scrollHeight) {
  return scrollTop + clientHeight >= scrollHeight - SCROLL_END_THRESHOLD_PX;
}

export function applyIndemnityAcceptance(trigger) {
  const form = trigger && trigger.closest ? trigger.closest("form") : null;
  const checkbox = form && form.querySelector
    ? form.querySelector("[data-indemnity-checkbox]")
    : null;
  if (!checkbox) return false;
  checkbox.disabled = false;
  checkbox.checked = true;
  const hint = form.querySelector("[data-indemnity-hint]");
  if (hint) hint.hidden = true;
  return true;
}

export function openIndemnityModal({ onAccept } = {}) {
  const previouslyFocused = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "indemnity-modal-title");

  dialog.innerHTML = `
    <header class="modal-header">
      <h2 id="indemnity-modal-title" class="display sm">Health &amp; Liability Indemnity</h2>
      <button type="button" class="modal-close" aria-label="Close document">×</button>
    </header>
    <div class="modal-doc">
      <div class="modal-doc-body" tabindex="0">
        ${indemnityDoc.renderIndemnityDocument()}
      </div>
      <footer class="modal-doc-ack">
        <p class="muted small" data-modal-hint>Scroll to the end of the document to continue.</p>
        <button type="button" class="btn" disabled data-modal-ack>I have read this document</button>
      </footer>
    </div>`;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const body = dialog.querySelector(".modal-doc-body");
  const ackButton = dialog.querySelector("[data-modal-ack]");

  function updateAckState() {
    ackButton.disabled = !isAtScrollEnd(body.scrollTop, body.clientHeight, body.scrollHeight);
  }
  body.addEventListener("scroll", updateAckState, { passive: true });
  requestAnimationFrame(updateAckState);

  // --- focus trap ---
  function getFocusables() {
    return [...dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((el) => !el.disabled && el.offsetParent !== null);
  }
  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = getFocusables();
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  dialog.addEventListener("keydown", trapFocus);
  (getFocusables()[0] || dialog).focus();

  // --- close paths ---
  function close() {
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  dialog.querySelector(".modal-close").addEventListener("click", close);

  // --- acknowledgement ---
  ackButton.addEventListener("click", () => {
    if (typeof onAccept === "function") onAccept(openingTrigger);
    close();
  });

  // The opening trigger is set by the delegated click handler in app.js
  // via a one-shot property on the backdrop; default to null for safety.
  const openingTrigger = backdrop.dataset.openingTrigger
    ? document.querySelector(`[data-trigger-id="${backdrop.dataset.openingTrigger}"]`)
    : null;
}
```

> **Note on the opening trigger:** the modal needs to know which element opened it so `onAccept` can be called with the right trigger for `applyIndemnityAcceptance`. The implementation above relies on the click handler in `app.js` (Task 4) stamping a `data-trigger-id` onto the backdrop before calling `openIndemnityModal`. If the stamp is missing, `openingTrigger` is `null` and `onAccept(null)` is called — `applyIndemnityAcceptance(null)` is safe and returns `false`. This is acceptable because the only callers are wired in Task 4.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd app && node smoke.mjs 2>&1 | tail -10`
Expected: `ok  scroll-end threshold is 4px`, `ok  isAtScrollEnd math returns correct values for 4 cases`, `ok  applyIndemnityAcceptance enables + checks paired checkbox and hides hint`, `ok  applyIndemnityAcceptance returns false for orphan triggers`. No new `FAIL` lines.

- [ ] **Step 5: Commit**

```bash
git add app/js/components.js app/smoke.mjs
git commit -m "feat(indemnity): add reusable read-and-accept modal component

Exports isAtScrollEnd (pure math), applyIndemnityAcceptance (DOM
mutation), and openIndemnityModal (backdrop, focus trap, scroll-end
detection, ESC/backdrop/X close paths, ack callback)."
```

---

## Task 3: Add modal CSS

**Files:**
- Modify: `app/styles.css` (append a new section at the end of the file)
- Modify: `app/smoke.mjs` (append a class-name assertion)

**Interfaces:** none — pure styling.

- [ ] **Step 1: Write the failing smoke assertion**

Append after Task 2's assertion block:

```js
// --- modal CSS classes present ---
const stylesSource = readFileSync(resolve(__dirnameSmoke, "styles.css"), "utf8");
for (const cls of [
  ".modal-backdrop",
  ".modal-dialog",
  ".modal-header",
  ".modal-doc",
  ".modal-doc-body",
  ".modal-doc-ack",
  ".modal-link",
  ".check input[disabled] + span",
]) {
  if (!stylesSource.includes(cls)) {
    failures++;
    console.error(`FAIL styles.css missing rule for "${cls}"`);
  }
}
console.log("ok  styles.css contains all modal-related class definitions");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd app && node smoke.mjs 2>&1 | tail -10`
Expected: `FAIL styles.css missing rule for ".modal-backdrop"` (plus similar for the others).

- [ ] **Step 3: Append the modal CSS section**

Open `app/styles.css` and append this block at the very end of the file (after the last existing rule):

```css
/* ---- Modal: read-and-accept document ------------------------------ */

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(3, 5, 4, .72);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 16px;
  animation: backdrop-in .18s ease-out;
}

.modal-dialog {
  width: min(640px, 100%);
  max-height: 85vh;
  background: var(--surface-3, #0d1410);
  border: 1px solid var(--line, #1c2520);
  border-radius: var(--radius-md, 14px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--ink, #e7ece9);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line, #1c2520);
}

.modal-header .display { margin: 0; }

.modal-close {
  background: none;
  border: 0;
  color: var(--muted, #8a948f);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 8px);
}
.modal-close:hover { color: var(--accent, #c8ff3d); }

.modal-doc {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.modal-doc-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  background: #fafaf7;
  color: #15181a;
  line-height: 1.55;
  font-size: 14.5px;
  position: relative;
  overscroll-behavior: contain;
}

.modal-doc-body::after {
  content: "Draft — pending ITC leadership review";
  position: sticky;
  display: block;
  bottom: 8px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 10.5px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, .25);
  pointer-events: none;
  margin-top: 24px;
}

.modal-doc-body .doc-content h3 {
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: .04em;
  margin: 18px 0 6px;
  color: #15181a;
}
.modal-doc-body .doc-content h3:first-child { margin-top: 0; }
.modal-doc-body .doc-content p { margin: 0 0 12px; }

.modal-doc-ack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--line, #1c2520);
  background: var(--surface-3, #0d1410);
}
.modal-doc-ack .btn { align-self: flex-end; }
.modal-doc-ack .btn[disabled] { opacity: .45; cursor: not-allowed; }
.modal-doc-ack [data-modal-hint] { margin: 0; }

@keyframes backdrop-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ---- Underlined link inside checkbox labels ----------------------- */

.modal-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
}
.modal-link:hover { color: var(--accent, #c8ff3d); }

/* ---- Disabled checkbox with hint ---------------------------------- */

.check input[disabled] + span { opacity: .55; }
.check input[disabled] + span .modal-link { opacity: 1; }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd app && node smoke.mjs 2>&1 | tail -5`
Expected: `ok  styles.css contains all modal-related class definitions`, no `FAIL` lines from this assertion.

- [ ] **Step 5: Commit**

```bash
git add app/styles.css app/smoke.mjs
git commit -m "feat(indemnity): add modal CSS using existing palette variables

.modal-backdrop / .modal-dialog / .modal-doc / .modal-doc-ack +
.modal-link + disabled-checkbox styling. No new colour tokens."
```

---

## Task 4: Wire the apply form checkboxes (live + local modes)

**Files:**
- Modify: `app/js/views.js` (rewrite the `waiver` block in `viewApplyLive` and the `indemnity` block in `viewApplyLocal`)
- Modify: `app/js/app.js` (add the click handler + import)
- Modify: `app/smoke.mjs` (update existing assertions, add new ones)

**Interfaces:**
- Consumes: `components.openIndemnityModal` from Task 2.
- Produces:
  - `[data-action="open-indemnity-doc"]` trigger inside checkbox labels.
  - `[data-indemnity-checkbox]` on the checkbox element (paired with the trigger).
  - `[data-indemnity-hint]` on the hint paragraph below the checkbox.
  - A delegated click handler in `app.js` that opens the modal and calls `components.applyIndemnityAcceptance(trigger)` on ack.

- [ ] **Step 1: Write the failing smoke assertions**

Two changes to `app/smoke.mjs`:

**1a.** Find the existing assertion at line ~646 (`await check("profile > indemnity", ...)`). Just after it, add a new block that exercises `viewApply()` for the local-mode flow (the live-mode flow needs a Supabase stub; testing it directly is out of scope for the headless smoke — see note below). Find a sensible spot near the local-mode apply tests (search for `viewApplyLocal` usage in smoke) and insert:

```js
// --- apply form checkboxes render the read-and-accept link ---
// local mode: viewApplyLocal is reachable when isLive() returns false
const applyLocalHtml = views.viewApplyLocal();
if (!applyLocalHtml.includes("Health &amp; Liability Indemnity form")) {
  failures++;
  console.error('FAIL local-mode apply form should label the acceptance as "Health & Liability Indemnity form"');
}
if (!applyLocalHtml.includes('data-action="open-indemnity-doc"')) {
  failures++;
  console.error("FAIL local-mode apply form missing modal trigger on the acceptance link");
}
if (!applyLocalHtml.includes("data-indemnity-checkbox")) {
  failures++;
  console.error("FAIL local-mode apply form checkbox missing data-indemnity-checkbox attribute");
}
if (!applyLocalHtml.includes("Read the document to enable acceptance")) {
  failures++;
  console.error("FAIL local-mode apply form missing the read-first hint copy");
}
console.log("ok  local-mode apply form renders the indemnity link + disabled checkbox + hint");
```

**1b.** Find the existing assertion that checks for the old "participation waiver" copy in the live-mode apply form (search for `participation waiver` in smoke). If found, replace the substring assertion with one that checks the new copy is absent:

```js
// Live-mode apply form copy moved from "participation waiver" to
// "Health & Liability Indemnity" — the old string should no longer appear.
if (combinedRuntimeSource.includes("I accept the participation waiver")) {
  failures++;
  console.error('FAIL live-mode apply form still references old "participation waiver" copy');
} else console.log('ok  live-mode apply form no longer references "participation waiver"');
```

> **Why a source-string check rather than rendering `viewApplyLive()`?** `viewApplyLive()` depends on `isLive()` being `true` and on a hydrated user object. Setting up that state in the headless smoke requires Supabase stubs and would couple the test to internals. The source-level assertion is sufficient — the rendered output is verified manually in Task 6, and the live-mode HTML structure mirrors the local-mode one which IS rendered in the headless test.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd app && node smoke.mjs 2>&1 | tail -15`
Expected: `FAIL local-mode apply form should label the acceptance as "Health & Liability Indemnity form"` (and the others). The view function still renders the old `indemnity` summary checkbox.

- [ ] **Step 3: Rewrite the `viewApplyLocal` indemnity checkbox block**

In `app/js/views.js`, find the existing checkbox in `viewApplyLocal`:

```js
<label class="check"><input type="checkbox" name="indemnity" required>
  <span>I accept the health &amp; liability indemnity — I confirm I am fit to take part, I join ITC activities at my own risk, and I release ITC and its leaders from liability. *</span></label>
```

Replace it with:

```js
<label class="check"><input type="checkbox" name="indemnity" required disabled data-indemnity-checkbox>
  <span>I accept the <a href="#" class="modal-link" data-action="open-indemnity-doc">Health &amp; Liability Indemnity</a> form. *</span></label>
<p class="muted small" data-indemnity-hint>Read the document to enable acceptance.</p>
```

- [ ] **Step 4: Rewrite the `viewApplyLive` waiver checkbox block**

In `app/js/views.js`, find the existing waiver checkbox:

```js
<label class="check"><input type="checkbox" name="waiver" ${checked("waiver")} required> I accept the participation waiver. (⏳ text pending ITC review)</label>
```

Replace it with:

```js
<label class="check"><input type="checkbox" name="waiver" ${checked("waiver")} required disabled data-indemnity-checkbox>
  <span>I accept the <a href="#" class="modal-link" data-action="open-indemnity-doc">Health &amp; Liability Indemnity</a> form. *</span></label>
<p class="muted small" data-indemnity-hint>Read the document to enable acceptance.</p>
```

- [ ] **Step 5: Add the delegated click handler in `app.js`**

At the top of `app/js/app.js`, update the imports to include the components module:

```js
import * as components from "./components.js";
```

Find the existing delegated click handlers (search for `case "data-action"` or similar — the file uses a switch on `dataset.action`). Add a new branch, ideally before the existing toast-only cases:

```js
case "open-indemnity-doc": {
  e.preventDefault();
  const trigger = e.target.closest("[data-action='open-indemnity-doc']");
  if (!trigger) return;
  // Stamp the trigger so the modal can pass it to onAccept.
  const triggerId = `indemnity-trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  trigger.dataset.triggerId = triggerId;
  components.openIndemnityModal({
    onAccept: (openingTrigger) => {
      // Prefer the trigger the modal hands back; fall back to the one we
      // captured at click time if the modal didn't see the stamp.
      const target = openingTrigger || trigger;
      components.applyIndemnityAcceptance(target);
      delete trigger.dataset.triggerId;
    },
  });
  break;
}
```

> **Why the dataset round-trip?** The modal in Task 2 reads `backdrop.dataset.openingTrigger` to find the trigger that opened it. The simplest way to pass that reference across the `openIndemnityModal` boundary is to stamp a unique id on the trigger before calling it, then let the modal resolve it back via `document.querySelector`. The stamp is deleted after the ack callback runs to keep the DOM clean.

- [ ] **Step 6: Run the test to confirm it passes**

Run: `cd app && node smoke.mjs 2>&1 | tail -10`
Expected: `ok  local-mode apply form renders the indemnity link + disabled checkbox + hint`, `ok  live-mode apply form no longer references "participation waiver"`. No new `FAIL` lines.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs
git commit -m "feat(indemnity): wire apply form checkboxes to read-and-accept modal

- viewApplyLive waiver block and viewApplyLocal indemnity block now
  link 'Health & Liability Indemnity' to the modal.
- Checkbox starts disabled with a hint; enabled + ticked on ack.
- Delegated click handler in app.js opens the modal."
```

---

## Task 5: Wire Profile > Indemnity page

**Files:**
- Modify: `app/js/views.js` (add `View as full document` button above the inline card; replace the inline card body with `renderIndemnityDocument()`; add the import)
- Modify: `app/smoke.mjs` (update the existing assertion that checks the Profile > Indemnity card contains all four headings; add a new assertion for the button)

**Interfaces:**
- Consumes: `indemnityDoc.renderIndemnityDocument` from Task 1.
- Produces:
  - `import * as indemnityDoc from "./indemnity-doc.js";` added at the top of `views.js` (next to the existing imports).
  - The `accountIndemnity` view inserts a `<button class="btn ghost sm" type="button" data-action="open-indemnity-doc">View as full document</button>` above the existing `.card .prose` block.
  - The four `<h3>` + `<p>` pairs inside that card are replaced by `${indemnityDoc.renderIndemnityDocument()}`.
  - The `.card .prose` wrapper divs and the "Draft wording — the final indemnity will be confirmed…" footer note remain visually unchanged.

- [ ] **Step 1: Write the failing smoke assertions**

Two changes in `app/smoke.mjs`:

**1a.** Replace the existing assertion at line ~646 (`await check("profile > indemnity", () => views.viewAccount("indemnity"));`) — extend it to also assert the new button:

```js
const indemnityPageHtml = await views.viewAccount("indemnity");
if (!indemnityPageHtml.includes("View as full document")) {
  failures++;
  console.error('FAIL Profile > Indemnity should expose a "View as full document" button');
}
console.log('ok  Profile > Indemnity exposes "View as full document" button');
if (!indemnityPageHtml.includes("Accept &amp; Confirm")) {
  failures++;
  console.error("FAIL Profile > Indemnity missing Accept & Confirm");
}
console.log("ok  Profile > Indemnity still offers Accept & Confirm");
```

**1b.** Add an assertion that the Profile > Indemnity card body still renders all four section headings (visual unchanged, source DRY):

```js
for (const heading of [
  "Health declaration",
  "Participation at my own risk",
  "Release &amp; indemnity",
  "Emergency contact",
]) {
  if (!indemnityPageHtml.includes(heading)) {
    failures++;
    console.error(`FAIL Profile > Indemnity card missing heading "${heading}" after DRY refactor`);
  }
}
console.log("ok  Profile > Indemnity card still renders all four section headings (DRY)");
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd app && node smoke.mjs 2>&1 | tail -10`
Expected: `FAIL Profile > Indemnity should expose a "View as full document" button`. The view function still has only the inline card.

- [ ] **Step 3: Add the import in `views.js`**

At the top of `app/js/views.js`, find the existing imports block (it starts with `import * as store from "./store.js";`). Add this line directly below the existing imports:

```js
import * as indemnityDoc from "./indemnity-doc.js";
```

- [ ] **Step 4: Update `accountIndemnity` in `views.js`**

Find the `accountIndemnity` function (the one whose body starts with `<a class="back-link" href="#/account">`). Replace the entire `<div class="card mt16"><div class="card-body prose">...</div></div>` block inside it (the four `<h3>` + `<p>` pairs) with a single template expression that calls `renderIndemnityDocument()`. The new shape of the card section is:

```js
<a class="btn ghost sm mt16" href="#" data-action="open-indemnity-doc">View as full document</a>
<div class="card mt16"><div class="card-body prose">
  ${indemnityDoc.renderIndemnityDocument()}
</div></div>
```

Insert the `<a class="btn ghost sm mt16" ...>` line directly after the banner block (the `${
  at
    ? `<div class="banner mt16">...</div>`
    : `<div class="banner warn mt16">...</div>`
}` block) and BEFORE the inline card.

The full updated function should look like (only the relevant middle section shown — the rest of the function is unchanged):

```js
async function accountIndemnity(user) {
  const hydrated = await hydrateLiveUser(user);
  const at = hydrated.indemnityAcceptedAt;
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Indemnity</div>
    <h1 class="display sm">Health &amp; Liability Indemnity.</h1>
    ${
      at
        ? `
      <div class="banner mt16">
        <span class="kicker">Indemnity confirmed on ${fmtDay(at)}</span>
        <p>You're confirmed to join ITC activities.</p>
      </div>`
        : `
      <div class="banner warn mt16">
        <span class="kicker">To be accepted</span>
        <p>Please read the indemnity below, then accept and confirm — it's required for joining ITC activities.</p>
      </div>`
    }
    <a class="btn ghost sm mt16" href="#" data-action="open-indemnity-doc">View as full document</a>
    <div class="card mt16"><div class="card-body prose">
      ${indemnityDoc.renderIndemnityDocument()}
    </div></div>
    ${
      at
        ? ""
        : `
      <form id="form-indemnity" class="mt16" novalidate>
        <label class="check"><input type="checkbox" name="indemnityAccept" required>
          <span>I have read and accept the health &amp; liability indemnity above. *</span></label>
        <div id="indemnity-error"></div>
        <button class="btn mt16" type="submit">Accept &amp; Confirm</button>
      </form>`
    }
    <p class="muted small mt16">Draft wording — the final indemnity will be confirmed with ITC leadership before launch.</p>`;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd app && node smoke.mjs 2>&1 | tail -10`
Expected: `ok  Profile > Indemnity exposes "View as full document" button`, `ok  Profile > Indemnity still offers Accept & Confirm`, `ok  Profile > Indemnity card still renders all four section headings (DRY)`. No new `FAIL` lines.

- [ ] **Step 6: Commit**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(indemnity): expose Profile > Indemnity document via modal trigger

- 'View as full document' button opens the same modal as the apply form.
- Inline text card body now sourced from indemnity-doc.js (single source).
- Existing Accept & Confirm flow untouched."
```

---

## Task 6: Manual smoke verification + final commit

**Files:** none modified — verification only.

- [ ] **Step 1: Start the local dev server**

Run: `cd <repo-root> && python3 -m http.server 4173`
Then open `http://127.0.0.1:4173/app/` in a browser.

- [ ] **Step 2: Verify local-mode apply form flow**

Navigate to `/#/apply` (with no Supabase configured, this hits `viewApplyLocal`).

Verify in order:
- The "I accept the **Health & Liability Indemnity** form. *" checkbox is present.
- The checkbox is visually disabled (dimmed).
- The "Read the document to enable acceptance." hint is visible below it.
- The underlined link text is clickable and styled (electric-lime accent on hover).
- Clicking the link opens the modal with the document, dark backdrop, "Health & Liability Indemnity" title.
- The modal's "I have read this document" footer button starts disabled with hint copy "Scroll to the end of the document to continue."
- The body's content overflows the viewport (scroll bar visible).
- Scrolling to the bottom enables the footer button (becomes electric-lime accent).
- Clicking the enabled button closes the modal, enables + ticks the checkbox, hides the hint.
- Submitting the form still works as today (writes `indemnityAcceptedAt` via `store.acceptIndemnity`).
- ESC key, X button, and backdrop click all close the modal and reset the scroll position.

- [ ] **Step 3: Verify live-mode apply form flow**

Configure a Supabase URL/key in `app/index.html` (or skip this step if the live-mode path is covered by the source-level assertions only — note this in the commit message if so).

Verify:
- Same flow as local mode but with the `waiver` checkbox name. The label reads "I accept the **Health & Liability Indemnity** form. *".
- The modal still opens, the same acknowledgement flow works.
- Submitting records `waiver_accepted_at` on Supabase and reads back as `indemnityAcceptedAt` on the Profile page.

- [ ] **Step 4: Verify Profile > Indemnity flow**

Navigate to `/#/account/indemnity`.

Verify:
- The "View as full document" button is present above the inline text card.
- Clicking it opens the modal with the same document.
- The modal's onAck callback does NOT check any checkbox (no `[data-indemnity-checkbox]` in scope).
- The inline text card still renders all four sections, visually unchanged.
- The existing "I have read and accept…" checkbox + "Accept & Confirm" flow still works.

- [ ] **Step 5: Verify smoke test still passes**

Run: `cd app && node smoke.mjs`
Expected: zero `FAIL` lines. The full suite must pass.

- [ ] **Step 6: Final commit (no functional change)**

If Step 3 was skipped because the live-mode path couldn't be reached, commit a `docs:` note explaining the manual coverage gap:

```bash
git commit --allow-empty -m "docs(indemnity): mark manual smoke verified for indemnity modal

Local-mode apply form, Profile > Indemnity modal trigger, and
scroll-to-end acknowledgement flow all verified manually against
python3 -m http.server 4173. Live-mode apply form covered by the
source-level assertions in app/smoke.mjs (Step 4 of Task 4)."
```

If nothing was skipped, no commit is needed.

- [ ] **Step 7: Hand off for review**

Push the branch and request a code review:

```bash
git push -u origin feature/indemnity-pdf-modal
```

Then invoke `superpowers:requesting-code-review` against the pushed branch.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered in task |
|---|---|
| Problem statement (one-line checkbox vs full text) | Task 4, Task 5 |
| Goal 1 (surface full document in-app) | Task 1, Task 2 |
| Goal 2 (scroll-to-end gate) | Task 2 (scroll detection), Task 3 (CSS) |
| Goal 3 (consistency across three surfaces) | Task 4 (live + local apply), Task 5 (Profile) |
| Goal 4 (no npm, no build, no .pdf, no storage change) | Global Constraints + every task's file list |
| Non-goals | File Structure "Files NOT modified" section |
| Document source — HTML styled as paginated PDF | Task 1 + Task 3 CSS |
| Modal mechanics (trigger, structure, scroll detection, footer button, close paths, a11y) | Task 2 + Task 3 |
| Apply form live mode | Task 4 |
| Apply form local mode | Task 4 |
| Profile > Indemnity page | Task 5 |
| Acknowledgement callback | Task 4 (app.js) reuses `applyIndemnityAcceptance` from Task 2 |
| Data classification (no new persisted fields) | Global Constraints + File Structure |
| Files touched (expected) | File Structure section |
| Test plan (smoke + manual) | Tasks 1–5 (smoke) + Task 6 (manual) |

**Placeholder scan:** No TBD / TODO / "implement later" in any task. Every code block contains the actual content. Every step lists the exact command or file edit.

**Type consistency:**
- `SCROLL_END_THRESHOLD_PX = 4` defined in Task 2, asserted in Task 2, used internally in `isAtScrollEnd` (Task 2).
- `isAtScrollEnd(scrollTop, clientHeight, scrollHeight)` signature used identically in Task 2's implementation and assertions.
- `applyIndemnityAcceptance(trigger): boolean` defined in Task 2, called in Task 4 with `(openingTrigger || trigger)`.
- `openIndemnityModal({ onAccept })` defined in Task 2, called in Task 4 with `{ onAccept: ... }`.
- `renderIndemnityDocument(): string` defined in Task 1, called in Task 5 and Task 2.

All signatures consistent across tasks. No name drift detected.

**One ambiguity flagged for the implementer:** Step 5 of Task 4 uses a `dataset.triggerId` round-trip to pass the trigger element into `openIndemnityModal`. The modal's implementation in Task 2 reads `backdrop.dataset.openingTrigger` and resolves it back via `document.querySelector`. If the implementer prefers a simpler approach (e.g. have `openIndemnityModal` accept the trigger as a second argument), they can refactor that signature in Task 2 — both tasks should be updated together to keep the call sites and implementation in sync.
