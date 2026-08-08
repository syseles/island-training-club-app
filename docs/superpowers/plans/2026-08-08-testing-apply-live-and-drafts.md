# Testing Live Apply Flow and Draft Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `testing` deployment submit membership applications to Supabase and preserve unfinished applications as same-device local drafts that can be resumed or discarded.

**Architecture:** Keep Supabase as the live source of truth for submitted applications and use a separate versioned localStorage envelope for unfinished drafts. Port the existing live application renderer and submit path from `feature/giving-page`; layer draft persistence, resume UI, visitor entry points, and discard actions around that form without changing the local-mode fallback.

**Tech Stack:** Vanilla ES modules, hand-rendered HTML strings, delegated DOM events, Supabase JS v2, localStorage, Node smoke tests.

## Global Constraints

- Work on `fix/testing-apply-live-and-drafts`, based on `origin/testing`; do not change `main` or Shop-specific branches.
- Do not add npm dependencies, a build step, a service worker, or cross-device draft sync.
- Keep submitted applications in Supabase through `store.saveMyApplication(form)`.
- Keep unfinished drafts local-only and clear them only after successful submit or explicit Discard.
- Preserve local mode: `applyForMembership()` and `form#form-apply` remain functional when Supabase is not configured.
- Draft auto-save is debounced by 500ms and has both a visible saved-time indicator and an explicit `Save draft now` button.
- Visitors with drafts see `Continue your application` plus Discard on both Home and Account.
- Run `node app/smoke.mjs` after every task and before completion.
- Never modify or stage unrelated existing untracked files.

---

## File map

- `app/js/store.js` — draft persistence API and existing Supabase application upsert.
- `app/js/views.js` — live application form, draft hydration/banner, Home and Account draft CTAs.
- `app/js/app.js` — live form submission, age/guardian behavior, auto-save debounce, Save-now and Discard actions.
- `app/smoke.mjs` — localStorage draft contract regression tests and source-level wiring checks.
- `app/live-auth-smoke.mjs` — live-mode form render and Supabase upsert regression checks.
- `docs/runbooks/live-auth.md` — operator-facing explanation of drafts and approval states.

---

### Task 1: Add the versioned application-draft store API

**Files:**
- Modify: `app/smoke.mjs` near the existing Application flow checks
- Modify: `app/js/store.js` near storage constants and signup/application actions

**Interfaces:**
- Produces: `getApplyDraft(): null | { version: 1, deviceId: string, savedAt: number, fields: Record<string, string | boolean> }`
- Produces: `saveApplyDraft({ fields }): draft | null`
- Produces: `clearApplyDraft(): void`
- Produces: `getApplyDeviceId(): string | null`
- Storage keys: `itc.device.id` and `itc.apply.draft.v1`
- Invalid or unavailable localStorage must fail closed: return `null`, never prevent application submission.

- [ ] **Step 1: Add failing smoke assertions for the draft contract**

Add this block after the existing Application flow assertions in `app/smoke.mjs`:

```js
// --- Application draft persistence ---
{
  localStorage.removeItem("itc.device.id");
  localStorage.removeItem("itc.apply.draft.v1");

  if (store.getApplyDraft() !== null) {
    throw new Error("fresh application draft should be null");
  }

  const first = store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  if (!first?.deviceId || first.version !== 1 || first.fields.mobile !== "+852 6123 4567") {
    throw new Error("application draft should persist its device, version and fields");
  }

  const merged = store.saveApplyDraft({ fields: { preferred_name: "Jiffriy" } });
  if (merged.fields.mobile !== "+852 6123 4567" || merged.fields.preferred_name !== "Jiffriy") {
    throw new Error("application draft saves should merge fields");
  }

  localStorage.setItem("itc.apply.draft.v1", JSON.stringify({
    version: 99,
    deviceId: first.deviceId,
    savedAt: Date.now(),
    fields: { mobile: "stale" },
  }));
  if (store.getApplyDraft() !== null || localStorage.getItem("itc.apply.draft.v1") !== null) {
    throw new Error("incompatible application draft should be discarded");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6999 0000" } });
  store.clearApplyDraft();
  if (store.getApplyDraft() !== null) {
    throw new Error("clearApplyDraft should remove the application draft");
  }
  console.log("ok  application drafts persist, merge, version and clear");
}
```

- [ ] **Step 2: Run the smoke suite and confirm the new test fails**

Run:

```bash
node app/smoke.mjs
```

Expected: failure because `store.getApplyDraft` is not defined.

- [ ] **Step 3: Implement the minimal draft API in `app/js/store.js`**

Add constants beside `STORAGE_KEY`:

```js
const APPLY_DEVICE_KEY = "itc.device.id";
const APPLY_DRAFT_KEY = "itc.apply.draft.v1";
const APPLY_DRAFT_VERSION = 1;
```

Add exported helpers before the signup/approval section:

```js
export function getApplyDeviceId() {
  try {
    let id = localStorage.getItem(APPLY_DEVICE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || uid("device");
      localStorage.setItem(APPLY_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function getApplyDraft() {
  try {
    const raw = localStorage.getItem(APPLY_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const deviceId = getApplyDeviceId();
    const valid = draft?.version === APPLY_DRAFT_VERSION
      && draft?.deviceId === deviceId
      && Number.isFinite(draft?.savedAt)
      && draft?.fields
      && typeof draft.fields === "object"
      && !Array.isArray(draft.fields);
    if (!valid) {
      localStorage.removeItem(APPLY_DRAFT_KEY);
      return null;
    }
    return draft;
  } catch {
    try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
    return null;
  }
}

export function saveApplyDraft({ fields = {} } = {}) {
  try {
    const deviceId = getApplyDeviceId();
    if (!deviceId) return null;
    const existing = getApplyDraft();
    const draft = {
      version: APPLY_DRAFT_VERSION,
      deviceId,
      savedAt: Date.now(),
      fields: { ...(existing?.fields || {}), ...fields },
    };
    localStorage.setItem(APPLY_DRAFT_KEY, JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function clearApplyDraft() {
  try { localStorage.removeItem(APPLY_DRAFT_KEY); } catch {}
}
```

Do not put the draft inside `state` and do not bump `STATE_VERSION`: the draft has its own key and version envelope.

- [ ] **Step 4: Run the smoke suite and confirm it passes**

Run:

```bash
node app/smoke.mjs
```

Expected: all existing checks pass, plus `ok  application drafts persist, merge, version and clear`.

- [ ] **Step 5: Commit the draft-store contract**

```bash
git add app/js/store.js app/smoke.mjs
git commit -m "feat(testing): add versioned application drafts"
```

---

### Task 2: Restore the Supabase-backed live application view

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/views.js` around the Apply section

**Interfaces:**
- Consumes: `store.getCurrentUser()`, `store.getMyApplication()`, `isLive()`
- Produces: `viewApplyLive(): Promise<string | { redirect: string }>`
- Produces: `viewApply(): string | Promise<string | { redirect: string }>`
- Live form identity: `<form data-form="apply" class="form-grid">`
- Local form identity remains: `<form id="form-apply" ...>`

- [ ] **Step 1: Add a failing live-auth smoke assertion for the application form**

In `app/live-auth-smoke.mjs`, after the mocked Supabase client is established and views are imported, add a pending-profile case with no `applicationRows` entry and assert:

```js
const originalProfile = structuredClone(profile);
const originalApplication = structuredClone(applicationRows.get(authUser.id));
Object.assign(profile, { role: "pending" });
applicationRows.delete(authUser.id);
await store.getCurrentUser();
const liveApplyHtml = await views.viewApply();
assert.match(liveApplyHtml, /data-form="apply"/);
assert.match(liveApplyHtml, /name="mobile"/);
assert.match(liveApplyHtml, /name="age_over_18"/);
assert.match(liveApplyHtml, /name="waiver"/);
assert.doesNotMatch(liveApplyHtml, /name="email"/);
Object.assign(profile, originalProfile);
if (originalApplication) applicationRows.set(authUser.id, originalApplication);
```

Place it where profile/application mocks can be safely restored before later checks.

- [ ] **Step 2: Run the live-auth smoke and verify the test fails**

Run:

```bash
node app/live-auth-smoke.mjs
```

Expected: the current local form lacks `data-form="apply"` and the assertion fails.

- [ ] **Step 3: Port the live Apply renderer from `feature/giving-page`**

Use these commands as the reference implementation:

```bash
git show feature/giving-page:app/js/views.js
git show feature/giving-page:app/js/app.js
```

In `app/js/views.js`:

1. Extract the existing body of `viewApply()` unchanged into `function viewApplyLocal()`.
2. Add `viewApplyLive()` from `feature/giving-page`.
3. Add `applyFormHtml(cu)`, `ageStatusField(isMinor)`, `applyField(...)`, and `applySelect(...)` from `feature/giving-page`.
4. Reuse the existing `heardSourceLabel()` helper already present in the live Auth composition; if absent, add the exact enum labels:

```js
function heardSourceLabel(value) {
  return {
    friend: "Friend",
    family: "Family",
    search: "Search",
    social: "Social media",
    event: "Event",
    other: "Other",
  }[value] || presentValue(value);
}
```

5. Replace the exported dispatcher with:

```js
export function viewApply() {
  if (isLive()) return viewApplyLive();
  return viewApplyLocal();
}
```

The live form must contain these exact names because `saveMyApplication()` expects them:

```text
mobile
age_over_18
guardian_name
guardian_phone
emergency_name
emergency_phone
heard_source
heard_detail
preferred_name
photo_consent
waiver
privacy
guidelines
```

- [ ] **Step 4: Run both smoke suites**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass. Local smoke still sees `name="donorId"`; live smoke sees `data-form="apply"` and the Supabase field names.

- [ ] **Step 5: Commit the live application view**

```bash
git add app/js/views.js app/live-auth-smoke.mjs
git commit -m "fix(testing): restore live membership application form"
```

---

### Task 3: Submit the live form through Supabase

**Files:**
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/js/app.js` around the form delegation and age-status change handling
- Modify: `app/js/store.js` in `saveMyApplication()`

**Interfaces:**
- Consumes: `<form data-form="apply">`
- Consumes: `store.saveMyApplication(payload): Promise<void>`
- Produces: live submit path that never calls local `applyForMembership()`
- Preserves: local `case "form-apply"` behavior

- [ ] **Step 1: Add source-level assertions and an application-upsert mock**

In `app/live-auth-smoke.mjs`, extend the fake `applications` table with:

```js
upsert(row) {
  applicationRows.set(row.profile_id, structuredClone(row));
  return Promise.resolve({ data: structuredClone(row), error: null });
},
```

Then read `app/js/app.js` using the file utilities already imported and add:

```js
const appSource = readFileSync(resolve(__dirnameSmoke, "js/app.js"), "utf8");
assert.match(appSource, /form\.dataset\.form === "apply"/);
assert.match(appSource, /await store\.saveMyApplication\(payload\)/);
assert.match(appSource, /t\.name !== "age_over_18"/);
```

- [ ] **Step 2: Run live-auth smoke and verify it fails**

Run:

```bash
node app/live-auth-smoke.mjs
```

Expected: missing `data-form` submit path assertion.

- [ ] **Step 3: Port the age/guardian change handler**

Add before other form input handling in `app/js/app.js`:

```js
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== "age_over_18") return;
  const form = t.closest("form");
  if (!form || (!["apply", "membership-details"].includes(form.dataset.form) && form.id !== "form-apply")) return;
  const block = form.querySelector("[data-minor-only]");
  if (!block) return;
  const isMinor = t.value === "no";
  block.hidden = !isMinor;
  block.querySelectorAll("input").forEach((input) => {
    input.required = isMinor;
    if (!isMinor) input.value = "";
  });
});
```

- [ ] **Step 4: Port the live submit branch before `switch (form.id)`**

Add this immediately after validating `form instanceof HTMLFormElement`:

```js
if (form.dataset.form === "apply") {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const control = form.querySelector('[type="submit"]');
  await withBusyControl(control, "Submitting…", async () => {
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.photo_consent = !!fd.get("photo_consent");
    try {
      await store.saveMyApplication(payload);
      toast(form.dataset.toast || "Application submitted.");
      location.hash = "#/home";
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Submit failed", true);
    }
  });
  return;
}
```

- [ ] **Step 5: Run live-auth smoke and confirm submit wiring passes**

```bash
node app/live-auth-smoke.mjs
```

Expected: source assertions for the live form submit and age handler pass.

- [ ] **Step 6: Add a failing regression for successful-submit draft cleanup**

Add to `app/live-auth-smoke.mjs`:

```js
const previousRole = profile.role;
const previousApplication = structuredClone(applicationRows.get(authUser.id));
profile.role = "pending";
applicationRows.delete(authUser.id);
store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
await store.saveMyApplication({
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  guardian_name: "",
  guardian_phone: "",
  emergency_name: "Taylor Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  heard_detail: "",
  preferred_name: "Riley",
  photo_consent: false,
});
assert.equal(store.getApplyDraft(), null, "successful live submit must clear its draft");
profile.role = previousRole;
if (previousApplication) applicationRows.set(authUser.id, previousApplication);
else applicationRows.delete(authUser.id);
```

- [ ] **Step 7: Run live-auth smoke and verify cleanup fails**

```bash
node app/live-auth-smoke.mjs
```

Expected: `successful live submit must clear its draft` fails because the draft remains.

- [ ] **Step 8: Clear the draft inside `store.saveMyApplication()`**

Add `clearApplyDraft()` immediately after the successful applications upsert:

```js
const { error } = await supabase.from("applications").upsert(row);
if (error) throw error;
clearApplyDraft();
```

Keep clearing inside the store action so every successful submission path gets the same lifecycle. Never clear before the Supabase write succeeds.

- [ ] **Step 9: Run both smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass.

- [ ] **Step 10: Commit the Supabase submit wiring**

```bash
git add app/js/app.js app/js/store.js app/live-auth-smoke.mjs
git commit -m "fix(testing): submit membership applications to Supabase"
```

---

### Task 4: Hydrate and render resumable drafts in the live form

**Files:**
- Modify: `app/js/views.js` in `viewApplyLive()` / `applyFormHtml()`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `store.getApplyDraft()`
- Produces: draft-aware live form HTML with `data-draft-resume`, `data-draft-status`, `data-action="save-draft"`, and `data-action="discard-draft"`

- [ ] **Step 1: Add failing live-view assertions for resume UI**

In `app/live-auth-smoke.mjs`, extend Task 2's temporary pending-profile / no-application block before restoring `profile` and `applicationRows`:

```js
store.saveApplyDraft({ fields: {
  mobile: "+852 6123 4567",
  age_over_18: "yes",
  emergency_name: "Taylor Coach",
  emergency_phone: "+852 6777 8888",
  heard_source: "friend",
  preferred_name: "Riley",
  photo_consent: true,
  waiver: true,
  privacy: true,
  guidelines: true,
} });
const draftApplyHtml = await views.viewApply();
assert.match(draftApplyHtml, /data-draft-resume/);
assert.match(draftApplyHtml, /value="\+852 6123 4567"/);
assert.match(draftApplyHtml, /name="age_over_18" value="yes" checked/);
assert.match(draftApplyHtml, /data-action="save-draft"/);
assert.match(draftApplyHtml, /data-action="discard-draft"/);
store.clearApplyDraft();
```

- [ ] **Step 2: Run live-auth smoke and verify it fails**

```bash
node app/live-auth-smoke.mjs
```

Expected: resume banner or prefilled value assertion fails.

- [ ] **Step 3: Add form-value helpers in `app/js/views.js`**

Add small helpers near the Apply renderer:

```js
const draftChecked = (fields, name) => fields?.[name] ? "checked" : "";
const draftSavedLabel = (savedAt) => new Date(savedAt).toLocaleTimeString("en-HK", {
  hour: "numeric",
  minute: "2-digit",
});
```

Update `viewApplyLive()` to read the draft only after confirming no submitted application exists:

```js
const draft = store.getApplyDraft();
return applyFormHtml(cu, draft);
```

Update `applyFormHtml(cu, draft)` so all text/select/radio/checkbox values come from `draft?.fields || {}`. Derive the age state without defaulting a fresh form to adult:

```js
const savedAge = fields.age_over_18 === "no"
  ? true
  : fields.age_over_18 === "yes"
    ? false
    : undefined;
```

Pass `savedAge` to `ageStatusField(savedAge)`. Required acceptance checkboxes may restore as checked; actual timestamps are created only by successful submission.

Render above the form when a draft exists:

```html
<div class="banner mt16" data-draft-resume>
  <p>Resumed from your draft saved at <strong>HH:MM</strong>.</p>
  <button class="btn ghost sm" type="button" data-action="discard-draft">Discard draft</button>
</div>
```

Render below the primary Submit button for every live form:

```html
<div class="draft-controls mt16">
  <button class="btn ghost sm" type="button" data-action="save-draft">Save draft now</button>
  <span class="muted small" data-draft-status aria-live="polite">Saved at HH:MM</span>
</div>
```

For a fresh form, the status text is empty until the first save.

- [ ] **Step 4: Run both smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass; local Apply form remains unchanged.

- [ ] **Step 5: Commit resumable form rendering**

```bash
git add app/js/views.js app/live-auth-smoke.mjs
git commit -m "feat(testing): resume membership application drafts"
```

---

### Task 5: Wire debounced auto-save, Save-now, and Discard actions

**Files:**
- Modify: `app/js/app.js`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `<form data-form="apply">`
- Produces: `collectApplyDraftFields(form): Record<string, string | boolean>`
- Produces: 500ms auto-save debounce
- Produces actions: `save-draft`, `discard-draft`

- [ ] **Step 1: Add source-level smoke assertions for all action wiring**

In `app/live-auth-smoke.mjs`, add:

```js
assert.match(appSource, /const APPLY_DRAFT_DEBOUNCE_MS = 500/);
assert.match(appSource, /data-action="save-draft"|case "save-draft"/);
assert.match(appSource, /case "discard-draft"/);
assert.match(appSource, /store\.saveApplyDraft/);
assert.match(appSource, /store\.clearApplyDraft/);
```

If `appSource` was declared in Task 3, reuse it rather than redeclaring.

- [ ] **Step 2: Run live-auth smoke and verify it fails**

```bash
node app/live-auth-smoke.mjs
```

Expected: debounce/action wiring assertion fails.

- [ ] **Step 3: Add the form serializer and status updater**

Near the app-level state variables in `app/js/app.js`:

```js
const APPLY_DRAFT_DEBOUNCE_MS = 500;
let applyDraftTimer = null;

function collectApplyDraftFields(form) {
  const fields = {};
  for (const [name, value] of new FormData(form).entries()) fields[name] = value;
  form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
    fields[input.name] = input.checked;
  });
  return fields;
}

function updateApplyDraftStatus(form, draft) {
  const status = form.querySelector("[data-draft-status]");
  if (!status || !draft) return;
  const time = new Date(draft.savedAt).toLocaleTimeString("en-HK", {
    hour: "numeric",
    minute: "2-digit",
  });
  status.textContent = `Saved at ${time}`;
}

function saveApplyDraftForm(form) {
  const draft = store.saveApplyDraft({ fields: collectApplyDraftFields(form) });
  updateApplyDraftStatus(form, draft);
  return draft;
}
```

- [ ] **Step 4: Add debounced auto-save listeners**

Add one delegated listener that responds to both `input` and `change`:

```js
const scheduleApplyDraftSave = (e) => {
  const form = e.target?.closest?.('form[data-form="apply"]');
  if (!form) return;
  clearTimeout(applyDraftTimer);
  applyDraftTimer = setTimeout(() => saveApplyDraftForm(form), APPLY_DRAFT_DEBOUNCE_MS);
};
document.addEventListener("input", scheduleApplyDraftSave);
document.addEventListener("change", scheduleApplyDraftSave);
```

The existing age/guardian `change` handler remains separate and still runs.

- [ ] **Step 5: Add delegated click actions**

In the existing `switch (action)` click handler:

```js
case "save-draft": {
  const form = el.closest('form[data-form="apply"]');
  if (!form) break;
  clearTimeout(applyDraftTimer);
  const draft = saveApplyDraftForm(form);
  toast(draft ? "Draft saved on this device" : "Unable to save draft", !draft);
  break;
}
case "discard-draft":
  clearTimeout(applyDraftTimer);
  store.clearApplyDraft();
  toast("Application draft discarded");
  await renderWithFeedback();
  break;
```

If the click listener is not async at the outer function boundary, use its existing render helper pattern instead of adding a second listener.

- [ ] **Step 6: Run both smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass.

- [ ] **Step 7: Commit draft interactions**

```bash
git add app/js/app.js app/live-auth-smoke.mjs
git commit -m "feat(testing): auto-save and discard application drafts"
```

---

### Task 6: Surface drafts on visitor Home and Account

**Files:**
- Modify: `app/js/views.js` in `viewHome()` visitor card and `accountVisitor()`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `store.getApplyDraft()`
- Produces: visitor draft CTA containing `Continue your application`
- Produces: discard buttons using `data-action="discard-draft"`

- [ ] **Step 1: Add failing local smoke assertions for visitor draft CTAs**

After Task 1's draft store tests in `app/smoke.mjs`, add a separate isolated block:

```js
{
  store.signOut();
  store.clearApplyDraft();
  const homeWithoutDraft = views.viewHome();
  if (homeWithoutDraft.includes("Continue your application")) {
    throw new Error("fresh visitor home should not advertise a draft");
  }

  store.saveApplyDraft({ fields: { mobile: "+852 6123 4567" } });
  const homeWithDraft = views.viewHome();
  const accountWithDraft = await views.viewAccount();
  for (const [label, html] of [["home", homeWithDraft], ["account", accountWithDraft]]) {
    if (!html.includes("Continue your application") || !html.includes('data-action="discard-draft"')) {
      throw new Error(`${label} should expose Continue + Discard for a saved draft`);
    }
  }
  store.clearApplyDraft();
  store.signIn("test@example.com");
  console.log("ok  visitor Home and Account surface resumable drafts");
}
```

If local-mode Home uses different visitor copy, assert only the draft-specific elements; do not require Google sign-in copy in local smoke.

- [ ] **Step 2: Run smoke and verify it fails**

```bash
node app/smoke.mjs
```

Expected: `Continue your application` is absent.

- [ ] **Step 3: Add one shared draft CTA renderer in `app/js/views.js`**

Add:

```js
function visitorDraftActions() {
  const draft = store.getApplyDraft();
  if (!draft) return "";
  return `
    <div class="banner mt16" data-draft-resume>
      <p><strong>Continue your application</strong><br><span class="muted small">Your unfinished form is saved on this device.</span></p>
      <div class="actions">
        <a class="btn sm" href="#/apply">Continue your application</a>
        <button class="btn ghost sm" type="button" data-action="discard-draft">Discard</button>
      </div>
    </div>`;
}
```

- [ ] **Step 4: Render the shared CTA on Home and Account**

In the visitor Home card, render `${visitorDraftActions()}` before the existing Google/local sign-in CTA. When a draft exists, change the primary CTA label to `Continue your application`; when no draft exists, preserve existing copy exactly.

In `accountVisitor()`, render `${visitorDraftActions()}` above the Google sign-in card in live mode and above the local sign-in/join card in local mode.

Do not remove the Google sign-in button: a visitor with a draft still needs Google Auth before Supabase submission.

- [ ] **Step 5: Run both smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both pass and smoke logs `ok  visitor Home and Account surface resumable drafts`.

- [ ] **Step 6: Commit visitor draft entry points**

```bash
git add app/js/views.js app/smoke.mjs
git commit -m "feat(testing): surface application drafts to visitors"
```

---

### Task 7: Document and verify the complete workflow

**Files:**
- Modify: `docs/runbooks/live-auth.md`
- Verify: `app/js/store.js`, `app/js/views.js`, `app/js/app.js`, smoke suites

**Interfaces:**
- No new runtime interfaces.
- Produces an operator runbook explaining `Awaiting application` versus `Ready for review`, local drafts, and reset behavior.

- [ ] **Step 1: Update the live-auth runbook**

Add an `Application drafts and approval states` section covering:

```markdown
## Application drafts and approval states

- Google OAuth creates `public.profiles(role = 'pending')`. Until an `applications` row exists, Admin shows the profile under **Awaiting application** and approval controls remain locked.
- The live membership form calls `saveMyApplication()` and upserts `public.applications`. Successful submission moves the profile to **Ready for review**.
- Unfinished forms auto-save every 500 ms to `itc.apply.draft.v1` on that browser only. Drafts are not uploaded to Supabase and do not appear to administrators.
- Home, Account and Apply expose Continue / Discard controls while a local draft exists.
- A successful Supabase submission or explicit Discard removes the local draft. Sign-out does not remove it.
- To reset a tester's draft without deleting their Supabase identity:
  `localStorage.removeItem('itc.apply.draft.v1')`.
```

Keep the existing Supabase inspection SQL unchanged.

- [ ] **Step 2: Run automated verification**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0 with no `FAIL` lines.

- [ ] **Step 3: Run static source checks**

```bash
rg -n 'saveMyApplication|data-form="apply"|saveApplyDraft|clearApplyDraft|Continue your application' app/js docs/runbooks/live-auth.md
```

Expected:

- `app.js` uses `saveMyApplication` for `data-form="apply"`.
- `store.js` exports all three draft helpers.
- `views.js` contains live form, resume banner and visitor CTA.
- Runbook documents the behavior.

- [ ] **Step 4: Perform local manual smoke in live mode**

Serve the app:

```bash
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/` with the committed live Supabase config and verify:

1. Sign in with a disposable Google identity.
2. Start the Apply form, enter several fields, wait >500ms, and confirm `Saved at HH:MM` appears.
3. Reload `/app/#/apply`; confirm fields prefill and the resume banner appears.
4. Go Home and Account; confirm both show Continue + Discard.
5. Return to Apply, submit successfully, and confirm the draft key is gone:

```js
localStorage.getItem("itc.apply.draft.v1")
```

Expected: `null` after successful submission.

6. As an admin, confirm the applicant moves from **Awaiting application** to **Ready for review**.

- [ ] **Step 5: Commit the runbook**

```bash
git add docs/runbooks/live-auth.md
git commit -m "docs(testing): document application drafts and approvals"
```

- [ ] **Step 6: Review the final branch diff**

```bash
git status --short
git diff --stat origin/testing...HEAD
git log --oneline origin/testing..HEAD
```

Expected: only the design, plan, intended application files, tests and runbook are tracked; unrelated untracked files remain untouched.

- [ ] **Step 7: Push the feature branch**

```bash
git push -u origin fix/testing-apply-live-and-drafts
```

Expected: branch is published without force-push.
