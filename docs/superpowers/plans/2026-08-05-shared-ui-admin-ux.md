# Shared UI Accessibility and Admin UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve shared typography, accessibility, responsive behavior, async/form feedback, and the canonical Admin workflow on `feature/auth-identity`.

**Architecture:** Keep the vanilla module structure. CSS/index own visual and semantic foundations; `app.js` gains small reusable feedback/error helpers; `views.js` owns truthful Admin grouping and filters. No localStorage shape changes or Notification/Giving behavior are introduced.

**Tech Stack:** Vanilla ES modules, HTML/CSS, localStorage prototype state, Supabase, Node smoke tests

## Global Constraints

- Work only on non-Shop shared UI/Admin behavior on `feature/auth-identity`.
- Do not add Giving, Shop, merchandise, campaign, FPS, or Notification-trigger behavior.
- Preserve the Night Circuit dark-grid and electric-lime direction.
- Self-host Barlow Latin WOFF2 files; no runtime Google Fonts dependency and no npm dependency.
- Every affected compact interactive target is at least 44×44px.
- Preserve existing auth, application, Profile, booking, and Admin permission rules.
- Do not change localStorage shape without a migration; this plan requires no shape change.
- Preserve unrelated untracked files.

---

### Task 1: Self-Hosted Typography and Accessibility Foundations

**Files:**
- Create: `assets/fonts/barlow-400-latin.woff2`
- Create: `assets/fonts/barlow-500-latin.woff2`
- Create: `assets/fonts/barlow-600-latin.woff2`
- Create: `assets/fonts/barlow-700-latin.woff2`
- Create: `assets/fonts/barlow-condensed-700-latin.woff2`
- Create: `assets/fonts/barlow-condensed-800-latin.woff2`
- Create: `assets/fonts/barlow-condensed-900-latin.woff2`
- Create: `assets/fonts/OFL-Barlow.txt`
- Modify: `app/index.html`
- Modify: `app/styles.css`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: existing CSS tokens, `.view`, `.field-row`, compact controls, `navHTML()`.
- Produces: local font faces, skip-link/main focus semantics, global focus-visible/reduced-motion styles, responsive 44px controls, and a bottom nav without Admin.

- [ ] **Step 1: Add failing foundation contract tests**

In `app/smoke.mjs`, read `app/index.html`, `app/styles.css`, and font files. Assert:

```js
for (const path of [
  "../assets/fonts/barlow-400-latin.woff2",
  "../assets/fonts/barlow-500-latin.woff2",
  "../assets/fonts/barlow-600-latin.woff2",
  "../assets/fonts/barlow-700-latin.woff2",
  "../assets/fonts/barlow-condensed-700-latin.woff2",
  "../assets/fonts/barlow-condensed-800-latin.woff2",
  "../assets/fonts/barlow-condensed-900-latin.woff2",
  "../assets/fonts/OFL-Barlow.txt",
]) {
  if (!existsSync(new URL(path, import.meta.url))) throw new Error(`missing self-hosted font asset: ${path}`);
}
if (!indexHtml.includes('rel="preload"') || !indexHtml.includes("barlow-400-latin.woff2")) {
  throw new Error("primary Barlow font must be preloaded");
}
for (const contract of ["@font-face", "font-display: swap", ":focus-visible", "prefers-reduced-motion", "max-width: 420px"]) {
  if (!stylesCss.includes(contract)) throw new Error(`missing accessibility CSS contract: ${contract}`);
}
if (!indexHtml.includes('class="skip-link"') || !indexHtml.includes('id="view"')) {
  throw new Error("app shell must provide a skip link and main target");
}
if (viewsSource.includes('{ key: "admin", label: "Admin"')) {
  throw new Error("Admin belongs in Profile, not bottom navigation");
}
```

Add a live harness assertion after route rendering that `document.activeElement` or the fake focus record targets `#view`.

- [ ] **Step 2: Run the tests and verify the red state**

Run: `node app/smoke.mjs && node app/live-auth-smoke.mjs`

Expected: FAIL on missing font assets/foundation contracts.

- [ ] **Step 3: Download the pinned official Latin WOFF2 assets and license**

Use these exact Google Fonts v13 Latin files:

```bash
mkdir -p assets/fonts
curl -fsSL https://fonts.gstatic.com/s/barlow/v13/7cHpv4kjgoGqM7E_DMs5.woff2 -o assets/fonts/barlow-400-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E3_-gs51os.woff2 -o assets/fonts/barlow-500-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E30-8s51os.woff2 -o assets/fonts/barlow-600-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlow/v13/7cHqv4kjgoGqM7E3t-4s51os.woff2 -o assets/fonts/barlow-700-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B46r2z3bWuQ.woff2 -o assets/fonts/barlow-condensed-700-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1z3bWuQ.woff2 -o assets/fonts/barlow-condensed-800-latin.woff2
curl -fsSL https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B45L0z3bWuQ.woff2 -o assets/fonts/barlow-condensed-900-latin.woff2
curl -fsSL https://raw.githubusercontent.com/google/fonts/main/ofl/barlow/OFL.txt -o assets/fonts/OFL-Barlow.txt
```

Verify every WOFF2 begins with `wOF2` and no file is empty.

- [ ] **Step 4: Add font faces, preload, contrast, sizing, focus, motion, and responsive rules**

In `styles.css`, define one `@font-face` per file with `font-display: swap`; set:

```css
--font: "Barlow", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
--faint: #79807d;
--line: #48504c;
```

Increase compact typography to the approved minimums. Ensure `.top-avatar`, `.btn.sm`, `.chip`, `.week-nav button`, checkbox labels, and Admin controls have 44px hit areas. Replace layout-shifting `.btn:active { transform: ... }` with an opacity/background press state.

Add:

```css
.skip-link { position: fixed; left: 12px; top: -80px; z-index: 100; }
.skip-link:focus { top: 12px; }
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
@media (max-width: 420px) {
  .field-row { grid-template-columns: 1fr; gap: 0; }
  .booking-card .actions { flex-wrap: wrap; }
  .member-row { align-items: flex-start; flex-wrap: wrap; }
}
```

Preload `../assets/fonts/barlow-400-latin.woff2` in `index.html`, add `<a class="skip-link" href="#view">Skip to main content</a>`, and retain `main#view[tabindex=-1]`.

Remove only the Admin item from `NAV_ITEMS`; keep Notifications until `feature/notification` supplies the top-bar bell. In `render()`, after successful HTML/nav replacement and `window.scrollTo`, call `viewEl.focus({ preventScroll: true })`.

- [ ] **Step 5: Verify and commit foundations**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/app.js
node --check app/js/views.js
git diff --check
```

Expected: PASS.

```bash
git add assets/fonts app/index.html app/styles.css app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(ui): improve shared accessibility foundations"
```

---

### Task 2: Shared Async and Accessible Form Feedback

**Files:**
- Modify: `app/index.html`
- Modify: `app/styles.css`
- Modify: `app/js/app.js`
- Modify: `app/js/views.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `main#view`, existing toast stack, delegated click/submit handlers, async `render()`.
- Produces: delayed route-loading state, reusable busy-control and field-error helpers, duplicate-action prevention, and accessible error semantics.

- [ ] **Step 1: Write failing behavior tests**

Extend the DOM harness with focus, attributes, timers, and a route-loader host. Add tests proving:

```js
const slowRender = windowListeners.get("hashchange")();
if (viewEl.getAttribute("aria-busy") !== "true") throw new Error("async route must announce busy immediately");
// Advance the fake clock 300ms while the Supabase read remains unresolved.
if (!routeLoader.hidden) throw new Error("slow route must expose delayed loading feedback");
// Resolve and await.
if (viewEl.hasAttribute("aria-busy") || !routeLoader.hidden) throw new Error("route busy state must clear");
```

Add delegated form/action assertions that a pending control is disabled with the exact progress label, a second event does not invoke the store again, and an injected failure restores label/disabled state without a success toast.

Add source/render assertions that custom form errors use `role="alert"`, set `aria-invalid`, associate `aria-describedby`, and focus the invalid field.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node app/live-auth-smoke.mjs && node app/smoke.mjs`

Expected: FAIL on missing route busy/loading and helper behavior.

- [ ] **Step 3: Implement delayed route feedback**

Add a hidden semantic loader after `<main>`:

```html
<div id="route-loader" class="route-loader" role="status" aria-live="polite" hidden>Loading…</div>
```

In `app.js`, add:

```js
const routeLoader = document.getElementById("route-loader");

async function renderWithFeedback() {
  viewEl.setAttribute("aria-busy", "true");
  const timer = setTimeout(() => { routeLoader.hidden = false; }, 300);
  try {
    await render();
  } finally {
    clearTimeout(timer);
    routeLoader.hidden = true;
    viewEl.removeAttribute("aria-busy");
  }
}
```

Use this wrapper for boot/hashchange and async rerenders. Preserve the prior view until `render()` has a complete result. The wrapper throws to the existing toast boundary; it does not replace content with an incorrect empty state.

- [ ] **Step 4: Implement reusable busy controls and accessible errors**

Add focused helpers:

```js
const controlBusy = new WeakSet();
async function withBusyControl(control, busyLabel, work) {
  if (!control || controlBusy.has(control)) return;
  controlBusy.add(control);
  const label = control.textContent;
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  control.textContent = busyLabel;
  try { return await work(); }
  finally {
    controlBusy.delete(control);
    control.disabled = false;
    control.removeAttribute("aria-busy");
    control.textContent = label;
  }
}

function showFieldError(form, field, errorHost, message) {
  errorHost.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = "form-error";
  alert.id = `${field.id}-error`;
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  errorHost.appendChild(alert);
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), alert.id].filter(Boolean).join(" "));
  field.focus();
}
```

Add delegated `input` clearing for stale custom errors. Apply the helper to sign-in, application donor ID, Donor Profile, and prayer-request custom errors. Apply `withBusyControl` to Google sign-in (`Connecting…`), sign-out (`Signing out…`), live application submission (`Submitting…`), membership details (`Saving…`), privacy preferences (`Saving…`), indemnity acceptance (`Confirming…`), and checkout (`Processing…`). Preserve checkout's current error recovery while preventing duplicate submission consistently.

Make toast errors use `role="alert"`; success remains polite status output.

- [ ] **Step 5: Verify and commit shared feedback**

Run both smoke suites, all app syntax checks, and `git diff --check`.

```bash
git add app/index.html app/styles.css app/js/app.js app/js/views.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(ui): add accessible async feedback"
```

---

### Task 3: Group and Harden Admin Approvals

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/styles.css`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `listApprovalCandidates()`, `decideApplication(profileId, decision)`, and `withBusyControl()` from Task 2.
- Produces: Ready/Awaiting groups, truthful counts/empty states, decline confirmation, per-card busy state, and inline decision errors.

- [ ] **Step 1: Write failing grouped-queue and decision tests**

Render a queue containing one submitted and one incomplete profile. Assert headings `Ready for review (1)` and `Awaiting application (1)`, submitted appears first, each group has accurate empty copy when independently empty, and the all-empty copy says `No pending members`.

Dispatch Decline and assert `confirm()` includes the applicant name. During the unresolved decision, assert both card buttons are disabled and the initiating button reads `Declining…`. Inject failure and assert the card remains, buttons recover, an inline `role="alert"` exists, and no success toast appears.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node app/live-auth-smoke.mjs && node app/smoke.mjs`

Expected: FAIL because the queue is flat and decisions lack confirmation/inline state.

- [ ] **Step 3: Implement grouped rendering**

Split candidates in `adminApprovals()`:

```js
const ready = pending.filter((item) => item.applicationSubmitted);
const awaiting = pending.filter((item) => !item.applicationSubmitted);
```

Render `Ready for review (${ready.length})` first and `Awaiting application (${awaiting.length})` second. Use reusable section helpers and section-specific empty copy. Add `data-applicant-name`, a stable card ID/data attribute, and `<div class="decision-error" role="alert" hidden></div>` to submitted cards.

Style Awaiting cards with reduced emphasis without reducing essential text contrast. Ensure actions wrap and maintain 44px controls.

- [ ] **Step 4: Harden delegated decisions**

Before decline, call:

```js
if (!window.confirm(`Decline ${name}’s membership application?`)) return;
```

Use `withBusyControl()`, disable both card action buttons, clear prior inline errors, await `store.decideApplication()`, toast only after success, and await `renderWithFeedback()`. On error, restore controls, retain the card, populate its inline alert, and show the accessible error toast.

- [ ] **Step 5: Verify and commit Admin approvals**

Run both smoke suites, syntax checks, and `git diff --check`.

```bash
git add app/js/views.js app/js/app.js app/styles.css app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(admin): improve approval queue UX"
```

---

### Task 4: Add Member Search, Filters, Confirmations, and Canonical Routing

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/styles.css`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: live/local member arrays, `updateProfileRole()`, `setRole()`, shared busy controls.
- Produces: `adminMemberFilters`, truthful counts/search/filter results, confirmed role changes, and canonical `#/admin/members` handling.

- [ ] **Step 1: Write failing member-management tests**

Assert the Members summary includes Approved, Pending, and Declined counts. Render/search fixtures across member/admin/super-admin/pending/declined states and test:

```js
views.adminMemberFilters.query = "tina";
views.adminMemberFilters.status = "approved";
views.adminMemberFilters.role = "admin";
```

Only matching name/email/status/role rows may render. Assert an accurate no-results message. Assert labels use `Member`, `Admin`, and `Super Admin`, never raw `superadmin`/`super_admin`.

Route `#/admin/users` and assert redirect to `#/admin/members`, with no undefined legacy `.row`/`.avatar` UI. Confirm promote/demote/revoke prompts name the person and target state; cancel produces no store call.

- [ ] **Step 2: Run tests and verify failure**

Run: `node app/live-auth-smoke.mjs && node app/smoke.mjs`

Expected: FAIL on missing filters/counts/canonical redirect.

- [ ] **Step 3: Implement filters and truthful labels**

Export view-local state:

```js
export const adminMemberFilters = { query: "", status: "all", role: "all" };
```

Render a search input plus status and role selects with visible labels. Filter case-insensitively by full name/email, then status and normalized role. Render counts from the unfiltered source and an empty result that names active filters. Add a `roleLabel()` helper mapping both local/live role spellings. For Super Admin viewers, keep the member/admin/super-admin role select and add a separate destructive Revoke access button for approved users other than self.

Use delegated `input` for search and `change` for filters, then rerender the Members tab. No values enter localStorage.

- [ ] **Step 4: Consolidate routing and role-change behavior**

Change `#/admin/users` to `{ redirect: "#/admin/members" }`. Remove or stop exporting legacy row rendering once no route consumes it.

For main Members role changes, use `updateProfileRole()` in live mode and `setRole()` locally. Confirm each operation with person name and target label. Apply shared busy/error semantics and await rerender. Preserve Super Admin self-protection.

- [ ] **Step 5: Verify and commit member management**

Run both smoke suites, syntax checks, and `git diff --check`.

```bash
git add app/js/views.js app/js/app.js app/styles.css app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(admin): improve member management UX"
```

---

### Task 5: Final Shared UI Regression Verification

**Files:**
- Verify all task files; modify only to correct a discovered regression.

**Interfaces:**
- Consumes: completed shared UI/Admin implementation.
- Produces: fresh verification evidence suitable for merging into `feature/notification`.

- [ ] **Step 1: Run complete verification**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
for file in app/js/*.js app/*.mjs; do node --check "$file"; done
git diff --check
git status --short --branch
```

Expected: all tests pass, syntax/diff checks are silent, and only known unrelated files remain untracked in the original checkout.

- [ ] **Step 2: Inspect scope and font payload**

```bash
find assets/fonts -type f -maxdepth 1 -print -exec wc -c {} \;
git diff --stat 05ddae1..HEAD
git diff --check 05ddae1..HEAD
git log --oneline 05ddae1..HEAD
```

Expected: seven non-empty WOFF2 files plus license, and changes are limited to shared visual/accessibility/Admin files and tests.

- [ ] **Step 3: Commit only if verification required a correction**

If a correction was necessary, rerun Step 1 and commit exact corrected files with:

```bash
git commit -m "fix(ui): address shared UX regression"
```

Do not create an empty commit.
