# Profile Details, Privacy, and Indemnity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Profile display application-backed indemnity, membership, privacy, and notification data through read-only cards with explicit edit workflows, while showing weekly encouragement only after sign-in.

**Architecture:** Keep `store.js` as the sole persistence boundary and expose one normalized application reader plus focused update actions. Async account views in `views.js` render either summary or edit routes, while `app.js` owns form submission, toast feedback, and return navigation. A Supabase migration and localStorage migration preserve existing records and default all new notification preferences to Off.

**Tech Stack:** Vanilla JavaScript ES modules, Supabase/Postgres migrations, localStorage state migrations, Node smoke tests.

## Global Constraints

- Work only on `feature/auth-identity`; this is non-Shop work.
- Do not add npm dependencies, a framework, a bundler, or a build step.
- Keep all localStorage access in `app/js/store.js` and bump `STATE_VERSION` for the local shape change.
- Never edit an already-applied Supabase migration; create `supabase/migrations/20260805000005_profile_preferences_age_status.sql`.
- Do not implement real notifications; the three notification values are stored preferences only.
- Date of birth must no longer be displayed, collected, or retained after migration.
- Existing application waiver/privacy/guidelines/submission timestamps must not be rewritten by Profile edits.
- Continue using existing `.card`, `.btn`, `.field`, `.line`, `.receipt-lines`, and toast patterns.
- Run `node app/smoke.mjs` after every implementation task.
- Leave unrelated untracked screenshots and the HYROX design document untouched.

## File Map

- Create `supabase/migrations/20260805000005_profile_preferences_age_status.sql`: preference columns and DOB-to-age conversion.
- Modify `app/js/store.js`: local migration, normalized application reads, focused updates, indemnity persistence, and age-status submission.
- Modify `app/js/views.js`: signed-in encouragement, application age question, summary cards, and edit forms.
- Modify `app/js/app.js`: age-field toggling, section-specific form submission, save navigation, and async indemnity handling.
- Modify `app/smoke.mjs`: local behavior, migration, route, and rendering regressions.
- Modify `app/live-auth-smoke.mjs`: realistic application query/update behavior for live Profile regressions.

---

### Task 1: Persist Age Status and Notification Preferences

**Files:**
- Create: `supabase/migrations/20260805000005_profile_preferences_age_status.sql`
- Modify: `app/js/store.js:26, 174-178`
- Modify: `app/smoke.mjs` migration regression section

**Interfaces:**
- Consumes: existing `public.applications.is_minor`, `date_of_birth`, and local `state.users`.
- Produces: application fields `whatsapp_reminders`, `email_receipts`, `community_news`; local user fields `isMinor`, `privacyAcceptedAt`, `whatsappReminders`, `emailReceipts`, `communityNews`.

- [ ] **Step 1: Add failing local and SQL migration checks**

Add a v9 local-state fixture to `app/smoke.mjs`, load it, and assert literal expected values:

```js
const legacyUser = store.allUsers().find((u) => u.id === "u-member");
if (legacyUser.isMinor !== false || legacyUser.whatsappReminders !== false ||
    legacyUser.emailReceipts !== false || legacyUser.communityNews !== false ||
    legacyUser.privacyAcceptedAt !== legacyUser.appliedAt) {
  failures++;
  console.error("FAIL v9 migration should backfill age, privacy and notification defaults");
}
```

Read the new SQL migration and assert it contains all three `default false` columns, an `is_minor` conversion based on `date_of_birth`, `date_of_birth = null`, and `alter column date_of_birth drop not null`.

- [ ] **Step 2: Run the smoke suite and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because state remains version 8 and the new migration file/fields do not exist.

- [ ] **Step 3: Create the Supabase migration**

Create `supabase/migrations/20260805000005_profile_preferences_age_status.sql` with:

```sql
alter table public.applications
  add column whatsapp_reminders boolean not null default false,
  add column email_receipts boolean not null default false,
  add column community_news boolean not null default false;

update public.applications
set is_minor = case
  when date_of_birth is null then is_minor
  else date_of_birth > (current_date - interval '18 years')::date
end;

update public.applications
set date_of_birth = null;

alter table public.applications
  alter column date_of_birth drop not null;
```

This derives current age status before deleting stored DOB values.

- [ ] **Step 4: Add localStorage migration v9**

Set `STATE_VERSION = 9`. Add a helper used by both fresh seed clones and migration:

```js
function backfillProfilePreferences(user) {
  if (user.isMinor === undefined) user.isMinor = false;
  if (user.privacyAcceptedAt === undefined) user.privacyAcceptedAt = user.appliedAt || null;
  if (user.whatsappReminders === undefined) user.whatsappReminders = false;
  if (user.emailReceipts === undefined) user.emailReceipts = false;
  if (user.communityNews === undefined) user.communityNews = false;
  return user;
}
```

Build `freshState().users` with `structuredClone(SEED_USERS).map(backfillProfilePreferences)`, and add:

```js
if (v < 9) state.users.forEach(backfillProfilePreferences);
```

Also add `privacyAcceptedAt: Date.now()` and the same false preference defaults to newly created local users in `applyForMembership()`; Task 2 will wire the selected age value.

- [ ] **Step 5: Run smoke tests and verify GREEN**

Run: `node app/smoke.mjs`

Expected: all checks pass, including the v9 and SQL migration checks.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805000005_profile_preferences_age_status.sql app/js/store.js app/smoke.mjs
git commit -m "feat(profile): migrate age and preference fields"
```

---

### Task 2: Replace Date of Birth With Required Age Status

**Files:**
- Modify: `app/js/views.js:944-1030, 1034-1100`
- Modify: `app/js/app.js:170-191, 367-379, 397-425`
- Modify: `app/js/store.js:348-381, 407-435`
- Modify: `app/smoke.mjs` application-form checks

**Interfaces:**
- Consumes: form field `age_over_18` with literal values `yes` or `no`.
- Produces: live `applications.is_minor`, always-null `applications.date_of_birth`, and local `user.isMinor`.

- [ ] **Step 1: Write failing application age tests**

In `app/smoke.mjs`, assert both live and local application HTML:

```js
if (!applyHtml.includes('name="age_over_18"') ||
    !applyHtml.includes('value="yes"') ||
    !applyHtml.includes('value="no"') ||
    applyHtml.includes('name="date_of_birth"')) {
  failures++;
  console.error("FAIL application should require Yes/No age status and omit DOB");
}
```

Assert the guardian block is marked `data-minor-only`, and add local applications for both answers to verify `isMinor === false` for Yes and `isMinor === true` for No.

- [ ] **Step 2: Run tests and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because forms still contain `date_of_birth` and the store computes age from DOB.

- [ ] **Step 3: Add a reusable age question renderer**

In `views.js`, add:

```js
function ageStatusField(isMinor) {
  return `
    <fieldset class="field age-status">
      <legend>Are you 18 or over? *</legend>
      <label><input type="radio" name="age_over_18" value="yes" ${isMinor === false ? "checked" : ""} required> Yes</label>
      <label><input type="radio" name="age_over_18" value="no" ${isMinor === true ? "checked" : ""} required> No</label>
    </fieldset>`;
}
```

Replace every live application/edit DOB field with `ageStatusField(...)`. Add the same `ageStatusField()` and `[data-minor-only]` guardian name/phone inputs to the local application form, replacing its old `ageConfirmed` checkbox. Show guardian fields only when `isMinor === true`.

- [ ] **Step 4: Replace DOB change handling with age-radio handling**

In `app.js`, handle changes to `input[name="age_over_18"]`. For each relevant form:

```js
const isMinor = target.value === "no";
const block = form.querySelector("[data-minor-only]");
block.hidden = !isMinor;
block.querySelectorAll("input").forEach((input) => {
  input.required = isMinor;
  if (!isMinor) input.value = "";
});
```

Delete `computeAge()` and all DOB listeners.

- [ ] **Step 5: Store age status without DOB**

In `saveMyApplication(form)` require `form.age_over_18` to be `yes` or `no`, set:

```js
const isMinor = form.age_over_18 === "no";
const row = {
  // existing fields
  date_of_birth: null,
  is_minor: isMinor,
  guardian_name: isMinor ? form.guardian_name : null,
  guardian_phone: isMinor ? form.guardian_phone : null,
};
```

Throw `new Error("Choose whether you are 18 or over")` for any other value. In local submission, pass `ageOver18: fd.get("age_over_18")` into `applyForMembership()` and store `isMinor: form.ageOver18 === "no"`; reject values other than `yes`/`no` and require guardian values for minors.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node app/smoke.mjs`

Expected: all smoke checks pass and no application form contains a DOB input.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/js/store.js app/smoke.mjs
git commit -m "feat(apply): replace date of birth with age status"
```

---

### Task 3: Add Focused Application Read and Update Actions

**Files:**
- Modify: `app/js/store.js:330-385, 495-515`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: `getMyApplication(): Promise<Application|null>` in both modes.
- Produces: `updateMyMembershipDetails(form): Promise<Application>`.
- Produces: `updateMyPrivacyPreferences(form): Promise<Application>`.
- Produces: `acceptMyIndemnity(): Promise<string>`.
- `Application` uses Supabase snake-case fields in both modes so views have one shape.

- [ ] **Step 1: Add failing store contract tests**

Extend `app/live-auth-smoke.mjs` so the fake Supabase supports `applications` select and update. Use a complete application fixture containing contact fields, `is_minor`, all consent timestamps, and all three preferences. Assert:

```js
const app = await store.getMyApplication();
if (app.waiver_accepted_at !== "2026-08-05T01:00:00.000Z") throw new Error("waiver missing");

await store.updateMyMembershipDetails({
  mobile: "+852 9000 0000",
  age_over_18: "yes",
  emergency_name: "Alex Runner",
  emergency_phone: "+852 9111 1111",
  heard_source: "friend",
  heard_detail: "Run club",
  preferred_name: "Riley",
});
```

Verify the captured membership update contains only membership columns and excludes `photo_consent`, preference fields, and all acceptance/submission timestamps. Do the inverse for `updateMyPrivacyPreferences()`. Verify `acceptMyIndemnity()` preserves an existing timestamp and writes one only when absent.

Add equivalent local assertions to `app/smoke.mjs` using a signed-in seeded member.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: FAIL because the three focused actions do not exist and local `getMyApplication()` returns null.

- [ ] **Step 3: Normalize local application reads**

Change local `getMyApplication()` to map the current user into the live application shape:

```js
function localApplication(user) {
  return {
    profile_id: user.id,
    mobile: user.phone || "",
    is_minor: !!user.isMinor,
    guardian_name: user.guardianName || null,
    guardian_phone: user.guardianPhone || null,
    emergency_name: user.emergencyName || "",
    emergency_phone: user.emergencyPhone || "",
    heard_source: user.heard || "other",
    heard_detail: user.heardDetail || null,
    preferred_name: user.preferredName || null,
    photo_consent: !!user.mediaConsent,
    waiver_accepted_at: user.indemnityAcceptedAt || null,
    privacy_accepted_at: user.privacyAcceptedAt || null,
    guidelines_accepted_at: user.guidelinesAcceptedAt || user.appliedAt || null,
    submitted_at: user.appliedAt || null,
    whatsapp_reminders: !!user.whatsappReminders,
    email_receipts: !!user.emailReceipts,
    community_news: !!user.communityNews,
  };
}
```

Return this from `getMyApplication()` when not live.

- [ ] **Step 4: Implement focused membership updates**

Implement `updateMyMembershipDetails(form)` with explicit validation and an allowlisted payload:

```js
const isMinor = form.age_over_18 === "no";
const patch = {
  mobile: String(form.mobile || "").trim(),
  is_minor: isMinor,
  date_of_birth: null,
  guardian_name: isMinor ? String(form.guardian_name || "").trim() : null,
  guardian_phone: isMinor ? String(form.guardian_phone || "").trim() : null,
  emergency_name: String(form.emergency_name || "").trim(),
  emergency_phone: String(form.emergency_phone || "").trim(),
  heard_source: form.heard_source,
  heard_detail: String(form.heard_detail || "").trim() || null,
  preferred_name: String(form.preferred_name || "").trim() || null,
};
```

Validate required and minor guardian values. In live mode update `applications` by `profile_id` and return `.select().single()` data. In local mode map these fields back to the signed-in user and call `save()`.

- [ ] **Step 5: Implement focused privacy and indemnity updates**

Implement `updateMyPrivacyPreferences(form)` with only:

```js
const patch = {
  photo_consent: !!form.photo_consent,
  whatsapp_reminders: !!form.whatsapp_reminders,
  email_receipts: !!form.email_receipts,
  community_news: !!form.community_news,
};
```

Implement `acceptMyIndemnity()` to return an existing acceptance unchanged; otherwise set one ISO timestamp in live mode or one numeric timestamp locally. Do not update privacy, guidelines, or submission timestamps.

- [ ] **Step 6: Run focused and full tests**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: all focused and smoke tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/js/store.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(profile): add focused application updates"
```

---

### Task 4: Fix Signed-In Encouragement and Indemnity Rendering

**Files:**
- Modify: `app/js/views.js:219-230, 574-610, 790-835`
- Modify: `app/js/app.js:95-120, 479-488`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `getMyApplication()` and `acceptMyIndemnity()` from Task 3.
- Produces: async account Profile/Indemnity views that derive acceptance from application data.

- [ ] **Step 1: Add failing view regressions**

Assert visitor Home excludes “Encouragement of the week,” while pending and approved Home include it. In the live test, render Profile and Indemnity from an application with `waiver_accepted_at` and assert both show the literal confirmation date and neither includes “To be accepted.” Test a null waiver fixture, call the acceptance action, rerender, and assert the prompt disappears.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: visitor encouragement and live indemnity checks fail.

- [ ] **Step 3: Gate encouragement by signed-in user**

In `viewHome()`, render the card only through:

```js
${user ? encouragement : ""}
```

Do not restrict by approval status.

- [ ] **Step 4: Make account Profile and Indemnity application-backed**

Make `viewAccount(section, editMode)` async. Fetch `const application = await store.getMyApplication()` for signed-in Profile sections that need application data. In live mode, only pending users missing an application redirect to `#/apply`. Approved, admin, and super-admin users missing an application render a clear “Application details unavailable” card on application-dependent Profile sections; they must not see edit/acceptance forms or an indemnity “To be accepted” status. Pass `application` to `accountMember(user, application)` and `accountIndemnity(user, application)`. Use:

```js
const indemnityAt = application?.waiver_accepted_at || user.indemnityAcceptedAt;
```

for both the Profile row and Indemnity page.

- [ ] **Step 5: Submit live/local indemnity through one async action**

In `app.js`, replace `store.acceptIndemnity(user.id)` with:

```js
await store.acceptMyIndemnity();
toast("Indemnity accepted and confirmed");
await render();
```

Catch errors, show `toast(err.message || "Unable to confirm indemnity", true)`, and do not claim success.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node app/smoke.mjs`

Expected: all tests pass; visitor Home has no encouragement and accepted waiver status is consistent.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "fix(profile): sync encouragement and indemnity state"
```

---

### Task 5: Build Membership Summary and Edit Workflow

**Files:**
- Modify: `app/js/views.js:574-610, 735-750, 997-1030`
- Modify: `app/js/app.js:80-120, 360-390`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `getMyApplication()` and `updateMyMembershipDetails(form)`.
- Produces: `#/account/details` summary and `#/account/details/edit` form.

- [ ] **Step 1: Add failing summary/edit tests**

For summary HTML, assert it contains `.card`, all required labels, `18 or over` or `Under 18`, and `href="#/account/details/edit"`; assert it does not contain `data-form="membership-details"` or a DOB label. For edit HTML, assert the prefilled fields, age radios, conditional guardian block, `data-form="membership-details"`, “Save changes,” and no photo-consent control.

Add an app source/behavior check that successful membership submission sets `location.hash = "#/account/details"`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because Membership Details is currently always a form.

- [ ] **Step 3: Route summary versus edit mode**

Pass `arg2` from the router:

```js
out = await views.viewAccount(arg, arg2);
```

In `viewAccount(section, mode)`, render the details edit form only when `section === "details" && mode === "edit"`; otherwise render the summary.

- [ ] **Step 4: Render the Membership Details card**

Render labelled rows inside one `.card` using profile plus application data. Use `application.is_minor ? "Under 18" : "18 or over"`. Include guardian rows only for minors. Add:

```html
<a class="btn ghost mt16" href="#/account/details/edit">Update details</a>
```

Never render blank DOB fields.

- [ ] **Step 5: Render the prefilled edit form**

Create `accountDetailsEdit(user, application)` with `data-form="membership-details"`. Include preferred name, mobile, required age Yes/No, guardian block, emergency contact, heard source, and heard detail. Display full name and email as read-only card rows above the form. Exclude photo/video and all acceptance controls.

- [ ] **Step 6: Handle membership save and return navigation**

In the submit delegate:

```js
if (form.dataset.form === "membership-details") {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const fd = new FormData(form);
  try {
    await store.updateMyMembershipDetails(Object.fromEntries(fd.entries()));
    toast("Membership details saved");
    location.hash = "#/account/details";
  } catch (err) {
    toast(err.message || "Unable to save membership details", true);
  }
  return;
}
```

Normalize the radio and checkbox fields explicitly where needed; do not navigate in the catch branch.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: all tests pass and summary/edit HTML remain distinct.

- [ ] **Step 8: Commit**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(profile): add membership card edit flow"
```

---

### Task 6: Build Privacy Summary and Edit Workflow

**Files:**
- Modify: `app/js/views.js:574-610, 900-925`
- Modify: `app/js/app.js` submit delegation
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: `getMyApplication()` and `updateMyPrivacyPreferences(form)`.
- Produces: `#/account/privacy` summary and `#/account/privacy/edit` form.

- [ ] **Step 1: Add failing privacy summary/edit tests**

Use an application fixture with photo consent true, a fixed privacy timestamp, and mixed preferences. Assert summary literals “Photo/video consent,” “Allowed,” the accepted date, and correct On/Off values. Assert the edit form has four editable checkboxes, displays privacy acceptance read-only, and links/saves back to `#/account/privacy`.

Also test an existing application with omitted preference properties and assert all three render Off.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: FAIL because the current page hardcodes notification values and has no edit mode.

- [ ] **Step 3: Render application-backed privacy summary**

Create `accountPrivacy(user, application)` with one `.card` and labelled rows:

```js
const onOff = (value) => value ? "On" : "Off";
```

Use `application.photo_consent`, `application.privacy_accepted_at`, and boolean-coerced preference fields. Add `href="#/account/privacy/edit"` “Update details.”

- [ ] **Step 4: Render privacy edit form**

Create `accountPrivacyEdit(application)` with `data-form="privacy-preferences"`. Render privacy acceptance as a read-only dated row. Render checked states from the application for:

```html
<input type="checkbox" name="photo_consent">
<input type="checkbox" name="whatsapp_reminders">
<input type="checkbox" name="email_receipts">
<input type="checkbox" name="community_news">
```

The submit button text is “Save changes.”

- [ ] **Step 5: Handle privacy save and return navigation**

Build explicit booleans from FormData:

```js
const fd = new FormData(form);
await store.updateMyPrivacyPreferences({
  photo_consent: fd.has("photo_consent"),
  whatsapp_reminders: fd.has("whatsapp_reminders"),
  email_receipts: fd.has("email_receipts"),
  community_news: fd.has("community_news"),
});
toast("Privacy preferences saved");
location.hash = "#/account/privacy";
```

On error, show `Unable to save privacy preferences` and stay on the form.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: all tests pass with application-backed consent and preference values.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(profile): add privacy preferences edit flow"
```

---

### Task 7: Final Integration Verification

**Files:**
- Verify all files changed in Tasks 1-6
- Update tests only if a test itself is proven incorrect; do not weaken product assertions

**Interfaces:**
- Consumes: all preceding task outputs.
- Produces: a verified branch ready to push to the existing auth PR.

- [ ] **Step 1: Run syntax checks**

```bash
node --check app/js/store.js
node --check app/js/views.js
node --check app/js/app.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
```

Expected: every command exits 0 with no output.

- [ ] **Step 2: Run focused live-auth regression**

Run: `node app/live-auth-smoke.mjs`

Expected: every live OAuth/Profile line prints `ok`; exit 0.

- [ ] **Step 3: Run the complete product smoke suite**

Run: `node app/smoke.mjs`

Expected: final line `All smoke tests passed.` and exit 0.

- [ ] **Step 4: Check migration and diff integrity**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no whitespace errors; only planned files/commits are present; unrelated untracked files remain untouched.

- [ ] **Step 5: Manually exercise the browser flow**

Serve with `python3 -m http.server 4173`, then verify:

1. Visitor Home has no encouragement; signed-in Home does.
2. Application uses required age Yes/No and requires guardian fields for No.
3. Profile indemnity matches application acceptance.
4. Membership summary → Update details → Save changes returns to updated summary.
5. Privacy summary → Update details → Save changes returns to updated summary.
6. Refreshing both summary pages preserves values.

Expected: no console errors, false success toasts, DOB fields, stale statuses, or accidental navigation.

- [ ] **Step 6: Commit any verification-only corrections**

If verification required a genuine code correction, rerun Steps 1-4 and commit only that correction:

```bash
git add app/js/app.js app/js/store.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs supabase/migrations/20260805000005_profile_preferences_age_status.sql
git commit -m "fix(profile): correct profile workflow regression"
```

If no correction was required, do not create an empty commit.
