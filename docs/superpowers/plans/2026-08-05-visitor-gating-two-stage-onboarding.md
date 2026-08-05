# Visitor Gating & Two-Stage Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give visitors one front door (Google sign-in), make "My Week" signed-in-only, route sign-out back to the sign-in page, and keep the post-sign-in application as the single onboarding form.

**Architecture:** All changes are view/router-layer edits in the vanilla-JS prototype (`app/js/views.js`, `app/js/app.js`), verified by the headless smoke suite (`app/smoke.mjs`). No state-shape changes, so no `STATE_VERSION` migration. Spec: `docs/superpowers/specs/2026-08-05-visitor-gating-two-stage-onboarding-design.md`.

**Tech Stack:** Plain ES modules, no build. Smoke tests run with `node app/smoke.mjs` from the repo root.

**Branch:** `feature/auth-identity` — every commit lands here. The PayMe reconciliation block (spec Section 3) is explicitly **out of scope**; it gets its own plan on `feature/payment-system`.

## Global Constraints

- Branch: `feature/auth-identity`. Do not touch Shop files, do not commit payment-system work here.
- After every change run `node app/smoke.mjs` from the repo root — all checks must pass before committing.
- The smoke test is the contract: new behavior and its test land in the same commit.
- Free activities never show booking/capacity language (existing product rule — keep it true).
- The localStorage (non-live) path is the demo seam: `#/apply` in **local** mode keeps working as today; the redirect in Task 3 targets the **live** path only.
- Copy, verbatim from the approved spec:
  - Visitor home section heading: `This week — open to all` (en dash).
  - Guest card subcopy: `New here? You'll be guided through a short application after sign-in.`
  - Paid-activity visitor banner: `This is a paid member session. Sign in to book — new here? You'll be guided through a short free application after sign-in.`
- `views.js` already imports `isLive` (used by `accountVisitor`); reuse it — no new imports needed there.

---

### Task 1: Visitor home — no "My Week", free-only preview, single CTA

**Files:**
- Modify: `app/js/views.js` (`viewHome`, lines ~145-205)
- Modify: `app/smoke.mjs` (visitor section, after `check("home (visitor)", …)`)
- Modify: `AGENTS.md` (the "My Week" pitfall bullet)

**Interfaces:**
- Consumes: `store.upcomingSessions(14)`, `sessionRow(s, { highlight })`, `store.bookingsForUser`, `data.sessionStarted` (all already used in `viewHome`); `isLive()` from `./config.js` (already imported in `views.js`).
- Produces: visitor home with section heading `This week — open to all`, zero `href="#/apply"` links, exactly one CTA `href="#/account"`. Signed-in rendering is unchanged (approved members see booked sessions under `My Week`; pending users see the upcoming preview).

- [ ] **Step 1: Write the failing smoke checks**

In `app/smoke.mjs`, immediately after the existing `check("home (visitor)", () => views.viewHome());` line, add:

```js
const homeVisitor = views.viewHome();
if (homeVisitor.includes("My Week")) {
  failures++;
  console.error('FAIL visitor home must not show "My Week"');
} else console.log('ok  "My Week" is signed-in-only');
if (!homeVisitor.includes("This week — open to all")) {
  failures++;
  console.error("FAIL visitor home missing free open-to-all preview");
} else console.log("ok  visitor home shows the free open-to-all preview");
if (homeVisitor.includes('href="#/apply"')) {
  failures++;
  console.error("FAIL visitor home must not link to #/apply");
} else console.log("ok  visitor home has no #/apply link");
if (!homeVisitor.includes('href="#/account"')) {
  failures++;
  console.error("FAIL visitor home missing its #/account CTA");
} else console.log("ok  visitor home CTA points to #/account");
if (homeVisitor.includes("Book & pay")) {
  failures++;
  console.error("FAIL visitor home preview must not contain paid booking language");
} else console.log("ok  visitor home preview has no paid booking language");
```

- [ ] **Step 2: Run the smoke suite to verify the new checks fail**

Run: `node app/smoke.mjs`
Expected: FAIL on "My Week is signed-in-only", "visitor home missing free open-to-all preview", and "visitor home must not link to #/apply" (the current guest card links to `#/apply` and everyone sees `My Week`).

- [ ] **Step 3: Rewrite `viewHome` in `app/js/views.js`**

Replace the whole `viewHome` function (from `export function viewHome() {` through its closing `}` just before the `// --- Schedule ---` comment) with:

```js
export function viewHome() {
  const user = store.currentUser();
  // Same 14-day window bookings are made in — a confirmed booking can never
  // fall out of "My week" (e.g. next Saturday's booking seen on Sat evening).
  const upcoming = store.upcomingSessions(14);
  const name = user ? esc(user.preferredName || user.fullName.split(" ")[0]) : null;

  const guest = !user
    ? `
    <div class="card mt24"><div class="card-body">
      <span class="kicker">New to ITC?</span>
      <h3 class="mt8">Everyone is welcome</h3>
      <p class="hero-meta">Free activities are open to all — just show up. Membership is free too; sign in and an ITC leader approves every application before paid booking unlocks.</p>
      <a class="btn mt16" href="#/account">${isLive() ? "Continue with Google" : "Sign in or join"}</a>
      <p class="muted small mt8">New here? You'll be guided through a short application after sign-in.</p>
    </div></div>`
    : "";

  // "My week" is signed-in-only: approved members see the sessions they've
  // booked (free ones included); other signed-in users see the upcoming
  // preview. Visitors get the free open-to-all preview instead.
  let weekSection;
  if (user) {
    let rows = upcoming.slice(0, 3);
    let emptyMsg = "No upcoming sessions — check back soon.";
    if (user.status === "approved") {
      const bookedIds = new Set(
        store
          .bookingsForUser(user.id)
          .filter((b) => b.status === "confirmed" && !sessionStarted(b.snapshot))
          .map((b) => b.sessionId)
      );
      rows = upcoming.filter((s) => bookedIds.has(s.id));
      emptyMsg = `Nothing booked this week yet. <a href="#/schedule" style="color:var(--accent)">Find a session →</a>`;
    }
    weekSection = `
    <div class="section-head">
      <h2>My Week</h2>
      <a href="#/schedule">See more →</a>
    </div>
    <div class="session-list">
      ${rows.length
        ? rows.map((s, i) => sessionRow(s, { highlight: i === 0 })).join("")
        : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
  } else {
    const freeRows = upcoming.filter((s) => s.kind === "free");
    weekSection = `
    <div class="section-head">
      <h2>This week — open to all</h2>
      <a href="#/schedule">See more →</a>
    </div>
    <div class="session-list">
      ${freeRows.length
        ? freeRows.map((s, i) => sessionRow(s, { highlight: i === 0 })).join("")
        : `<div class="empty">No open sessions this week — check back soon.</div>`}
    </div>`;
  }

  return `
    <div class="kicker">${esc(fmtDateLong(todayLocal()))} · Hong Kong</div>
    <h1 class="display">${name ? `Good to see you, ${name}.` : "Train together."}</h1>
    ${user && user.status === "pending" ? pendingBanner() : ""}
    ${guest}
    ${weekSection}
    <div class="section-head"><h2>The Club</h2><a href="#/community">More →</a></div>
    <a class="card" href="#/community" style="display:block;text-decoration:none">
      <img class="photo" src="../assets/itc/community.webp" alt="ITC community">
      <div class="card-body">
        <h3>Connect and grow with us</h3>
        <p class="hero-meta">Prayers, fellowship, ad-hoc meals and announcements from the church and the community.</p>
      </div>
    </a>`;
}
```

Also update the pitfall bullet in `AGENTS.md`:

Old:
```
- **"My Week" on Home is signed-in-only and shows booked sessions.** Visitors see the upcoming preview, not "My Week".
```
New:
```
- **"My Week" on Home is signed-in-only and shows booked sessions.** Visitors see a free-only "This week — open to all" preview, not "My Week".
```

- [ ] **Step 4: Run the smoke suite to verify all checks pass**

Run: `node app/smoke.mjs`
Expected: PASS, 0 failures — including the pre-existing member checks ("My week" shows/hides the right sessions for approved members), which are unaffected.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/smoke.mjs AGENTS.md
git commit -m "feat(app): visitor home — free open-to-all preview, single sign-in CTA, no My Week"
```

---

### Task 2: Paid activity (visitor) — single "Sign in to book" CTA

**Files:**
- Modify: `app/js/views.js` (`viewActivity`, the final `else` branch of the action-block chain, ~lines 334-343)
- Modify: `app/smoke.mjs` (after the paid-activity badge checks)

**Interfaces:**
- Consumes: nothing new — edits the visitor (`!user`) branch of `viewActivity`'s `actionBlock`.
- Produces: visitor paid-activity page contains `Sign in to book` and `href="#/account"`, and no `href="#/apply"`.

- [ ] **Step 1: Write the failing smoke checks**

In `app/smoke.mjs`, immediately after the existing paid-activity price/badge check block (the one ending with `console.log("ok  paid activity shows price and paid badge");` or its current equivalent closing brace), add:

```js
const paidVisitor = views.viewActivity(paid.id);
if (!paidVisitor.includes("Sign in to book") || !paidVisitor.includes('href="#/account"')) {
  failures++;
  console.error("FAIL paid activity (visitor) should offer a single sign-in CTA");
} else console.log("ok  paid activity (visitor) routes to sign-in");
if (paidVisitor.includes('href="#/apply"')) {
  failures++;
  console.error("FAIL paid activity (visitor) must not link to #/apply");
} else console.log("ok  paid activity (visitor) has no #/apply link");
```

- [ ] **Step 2: Run the smoke suite to verify the new checks fail**

Run: `node app/smoke.mjs`
Expected: FAIL on "paid activity (visitor) should offer a single sign-in CTA" and "must not link to #/apply" (the current visitor branch renders `Apply to join` → `#/apply`).

- [ ] **Step 3: Edit the visitor branch in `viewActivity`**

In `app/js/views.js`, find the final `else` branch of the action-block chain (the one rendering the `Members only` banner with the `Apply to join` / `Sign in` button pair) and replace it with:

```js
  } else {
    actionBlock = `
      <div class="banner mt16">
        <span class="kicker">Members only</span>
        <p>This is a paid member session. Sign in to book — new here? You'll be guided through a short free application after sign-in.</p>
      </div>
      <a class="btn mt16" href="#/account">Sign in to book</a>`;
  }
```

- [ ] **Step 4: Run the smoke suite to verify all checks pass**

Run: `node app/smoke.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(app): paid activity visitor — single Sign in to book CTA"
```

---

### Task 3: `#/apply` as visitor (live) — redirect to `#/account`

**Files:**
- Modify: `app/js/views.js` (`viewApplyLive`, ~line 893)
- Modify: `app/smoke.mjs` (source-check block near the existing `viewsSrc` checks, ~line 467)

**Interfaces:**
- Consumes: the router's existing redirect handling (`app.js` `render()` already honors `{ redirect }` objects returned from awaited views — same mechanism as `viewCheckout`).
- Produces: `viewApplyLive()` returns `{ redirect: "#/account" }` when there is no signed-in live user. The string `Please sign in first` no longer exists in `views.js`. Local mode (`viewApplyLocal`) is untouched — the smoke suite exercises local mode and must keep rendering the apply page.

- [ ] **Step 1: Write the failing smoke checks**

In `app/smoke.mjs`, in the source-check block right after the existing `accountVisitorLive` check, add:

```js
if (viewsSrc.includes("Please sign in first")) {
  failures++;
  console.error("FAIL views.js: the 'Please sign in first' wall should be gone");
} else {
  console.log("ok  views.js: no 'Please sign in first' wall");
}
if (!viewsSrc.includes('if (!cu) return { redirect: "#/account" };')) {
  failures++;
  console.error("FAIL views.js: viewApplyLive should redirect visitors to #/account");
} else {
  console.log("ok  views.js: viewApplyLive redirects visitors to #/account");
}
```

- [ ] **Step 2: Run the smoke suite to verify the new checks fail**

Run: `node app/smoke.mjs`
Expected: FAIL on both new checks.

- [ ] **Step 3: Edit `viewApplyLive` in `app/js/views.js`**

Replace:

```js
  const cu = await store.getCurrentUser();
  if (!cu) return `<section class="card"><p class="muted">Please sign in first.</p></section>`;
```

with:

```js
  const cu = await store.getCurrentUser();
  if (!cu) return { redirect: "#/account" };
```

- [ ] **Step 4: Run the smoke suite to verify all checks pass**

Run: `node app/smoke.mjs`
Expected: PASS, 0 failures — the existing `check("apply", () => views.viewApply())` (local mode) still renders the form.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(app): apply page redirects visitors to account instead of a sign-in wall"
```

---

### Task 4: Sign-out lands on `#/account`

**Files:**
- Modify: `app/js/app.js` (the `case "signout":` block, ~line 242)
- Modify: `app/smoke.mjs` (source-check block; add `app.js` source read)

**Interfaces:**
- Consumes: existing `signout` click action in `app.js`'s delegation switch.
- Produces: after sign-out the app navigates to `#/account` (the visitor sign-in page) instead of `#/home`.

- [ ] **Step 1: Write the failing smoke check**

In `app/smoke.mjs`, right after the `viewsSrc` source-check block (after the `accountVisitorLive` check and the Task 3 additions), add:

```js
const appSrc = readFileSync(resolve(__dirname, "js/app.js"), "utf8");
if (!/case "signout":[\s\S]*?location\.hash = "#\/account"/.test(appSrc)) {
  failures++;
  console.error("FAIL app.js: signout should navigate to #/account");
} else {
  console.log("ok  app.js: signout navigates to #/account");
}
```

(`readFileSync` and `resolve` are already imported in `smoke.mjs` — it already reads `js/views.js` the same way.)

- [ ] **Step 2: Run the smoke suite to verify the new check fails**

Run: `node app/smoke.mjs`
Expected: FAIL on "signout should navigate to #/account" (it currently sets `#/home`).

- [ ] **Step 3: Edit the signout case in `app/js/app.js`**

Replace:

```js
    case "signout":
      store.signOut();
      toast("Signed out");
      location.hash = "#/home";
      render();
      break;
```

with:

```js
    case "signout":
      store.signOut();
      toast("Signed out");
      // Back to the sign-in page — the account page IS the visitor front door.
      location.hash = "#/account";
      render();
      break;
```

- [ ] **Step 4: Run the smoke suite to verify all checks pass**

Run: `node app/smoke.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add app/js/app.js app/smoke.mjs
git commit -m "feat(app): sign-out returns to the account sign-in page"
```

---

### Task 5: Apply form shows the Google identity it was prefilled from

**Files:**
- Modify: `app/js/views.js` (`viewApplyLive` + `applyFormHtml`, ~lines 893-940)
- Modify: `app/smoke.mjs` (source-check block)

**Interfaces:**
- Consumes: `store.getCurrentUser()` live shape `{ id, email, role, profile }` where `profile.full_name` may be null (`store.js` ~lines 249-254). `esc()` helper already in `views.js`.
- Produces: `applyFormHtml(cu)` — the application form opens with a `Signed in as <strong>…</strong> · email` line, making the Google-prefilled identity explicit. No name/email inputs are added.

- [ ] **Step 1: Write the failing smoke check**

In `app/smoke.mjs`, next to the Task 3 source checks, add:

```js
if (!viewsSrc.includes("Signed in as")) {
  failures++;
  console.error("FAIL views.js: apply form should show the signed-in Google identity");
} else {
  console.log("ok  views.js: apply form shows the signed-in identity");
}
```

- [ ] **Step 2: Run the smoke suite to verify the new check fails**

Run: `node app/smoke.mjs`
Expected: FAIL on "apply form should show the signed-in Google identity".

- [ ] **Step 3: Edit `viewApplyLive` and `applyFormHtml` in `app/js/views.js`**

In `viewApplyLive`, change the final line from `return applyFormHtml();` to:

```js
  return applyFormHtml(cu);
```

Then change `applyFormHtml` to accept the user and show the identity line:

```js
function applyFormHtml(cu) {
  const displayName = cu?.profile?.full_name || cu?.email || "";
  return `
    <section class="card">
      <p class="kicker">Application</p>
      <h2 class="display">Tell us about you</h2>
      <p class="muted">Signed in as <strong>${esc(displayName)}</strong>${cu?.email ? ` · ${esc(cu.email)}` : ""}. We collect this so the team can approve your application and reach you in an emergency.</p>
      <form data-form="apply" class="form-grid">
        … (rest of the form unchanged) …
      </form>
    </section>
  `;
}
```

Only the function signature and the intro `<p class="muted">` line change; every form field stays exactly as it is.

- [ ] **Step 4: Run the smoke suite to verify all checks pass**

Run: `node app/smoke.mjs`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(app): apply form shows the signed-in Google identity"
```

---

## Out of scope (next plan)

- Spec Section 3 (PayMe reconciliation block at first checkout, `paymentPhone` profile field, collector confirmations list) — planned separately on `feature/payment-system`, after that branch's member payment screen from `2026-08-04-hyrox-booking-payment-system-design.md` exists.
