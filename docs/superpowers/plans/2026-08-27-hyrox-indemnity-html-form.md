# Hyrox Indemnity HTML Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the draft indemnity with the supplied Hyrox liability form, keep scroll-to-bottom acknowledgement, and persist typed signature, signing date, document version, and emergency-contact relationship in local and Supabase modes.

**Architecture:** Keep `app/js/documents.js` as the single document registry and keep the existing read-and-accept modal document-only. Add versioned indemnity validation and structured acceptance to `store.js`; local and live application forms collect the new fields, while Profile > Indemnity handles legacy/stale consent and Membership Details remains the canonical emergency-contact editor.

**Tech Stack:** Vanilla ES modules, string-template HTML, localStorage state with versioned migration, Supabase/Postgres additive migration, Node smoke tests. No runtime dependencies or build step.

**Branch:** `feature/read-and-accept-docs`  
**Worktree:** `/Users/selesli/projects/island-training-club-app/.worktrees/read-and-accept-docs`  
**Design:** `docs/superpowers/specs/2026-08-27-hyrox-indemnity-html-form-design.md`

## Global Constraints

- Keep the Profile route and heading `#/account/indemnity` and **Indemnity**.
- Keep `DOCUMENTS.indemnity`; do not create a second Hyrox document key.
- Keep the existing 4px scroll-end threshold, disabled acknowledgement, focus trap, Escape/backdrop/X close, scroll reset, and `applyDocumentAcceptance()` pairing.
- Preserve the Google Form legal wording verbatim except for semantic HTML structure and escaping. Do not rewrite legal copy.
- Keep acceptance at membership application time. Do not add an indemnity check or prompt to HYROX detail, booking, reserve, or checkout.
- No calendar expiry. Only `INDEMNITY_VERSION` changes make consent stale.
- Signature is free-form, trimmed, at least two characters, and need not match the profile name.
- Signing date is `YYYY-MM-DD`, defaults to today, allows backdating, and cannot be later than today.
- Emergency contact name, relationship, and phone are required. Membership Details is canonical.
- No real PDF, PDF library, npm dependency, build step, drawn signature, service worker, or Shop changes.
- Bump local `STATE_VERSION` from 13 to 14 and add an explicit migration; never delete persisted keys or genuine records.
- Add nullable Supabase columns through a new migration; never edit an already-applied migration.
- Run `node app/smoke.mjs` after each local/UI task and `node app/live-auth-smoke.mjs` after each live-mode task.
- Preserve unrelated existing content in `views.js`, including regions outside the named functions.

---

## File Structure

### New file

- `supabase/migrations/20260827000001_hyrox_indemnity_fields.sql` — additive nullable columns for signature, signing date, form version, and emergency relationship.

### Modified files

- `app/js/documents.js` — exact legal body and `INDEMNITY_VERSION`.
- `app/styles.css` — readable ordered/nested legal clauses inside inline and modal document renderings.
- `app/js/store.js` — v14 migration, validation, local/live mappings, structured acceptance actions, current-version helper.
- `app/js/views.js` — application fields, Membership Details relationship, current/stale Profile > Indemnity views.
- `app/js/app.js` — submit payloads and async Membership Details / Indemnity handlers.
- `app/smoke.mjs` — document, local state, migration, form, Profile, and no-HYROX-gate contract.
- `app/live-auth-smoke.mjs` — live application rows, patches, view hydration, and schema mapping contract.
- `README.md` — persisted prototype state version 14.
- `docs/runbooks/live-auth.md` — ordered deployment migration note.

### Interfaces

```js
// app/js/documents.js
export const INDEMNITY_VERSION = "v1";
export const DOCUMENTS = { indemnity, privacy, guidelines };
export function renderIndemnityDocument(); // => string

// app/js/store.js
export function isIndemnityCurrent(user); // => boolean
export function acceptIndemnity(userId, {
  signature,
  signedAt,
  emergencyRelationship,
  formVersion = INDEMNITY_VERSION,
}); // => number | null (indemnityAcceptedAt)
export async function acceptMyIndemnity({
  signature,
  signedAt,
  emergencyRelationship,
  formVersion = INDEMNITY_VERSION,
}); // => number | string (local timestamp or Supabase ISO timestamp)
```

Local application input names are camelCase (`emergencyRelationship`, `indemnitySignature`, `indemnitySignedAt`). Live application names match the database (`emergency_relationship`, `waiver_signature_text`, `waiver_signed_at`); both store paths stamp the current form version internally.

---

### Task 1: Replace the Draft Document with Versioned Hyrox Legal Copy

**Files:**
- Modify: `app/js/documents.js:1-77`
- Modify: `app/styles.css:1453-1558` (existing modal document styles)
- Test: `app/smoke.mjs:417-465, 802-875`

**Interfaces:**
- Consumes: existing `DOCUMENTS.indemnity` registry key and modal renderer.
- Produces: `INDEMNITY_VERSION = "v1"`; `DOCUMENTS.indemnity.title === "Indemnity"`; verbatim Hyrox body from the approved spec.

- [ ] **Step 1: Replace old document expectations with failing legal-copy/version assertions**

In `app/smoke.mjs`, import `documents.js` once near the existing document-registry assertions and assert the new contract:

```js
const docsModule = await import("./js/documents.js");
const DOCS = docsModule.DOCUMENTS;
if (docsModule.INDEMNITY_VERSION !== "v1") {
  failures++;
  console.error(`FAIL indemnity version should be v1, got ${docsModule.INDEMNITY_VERSION}`);
}
if (DOCS.indemnity?.title !== "Indemnity") {
  failures++;
  console.error(`FAIL indemnity title should be Indemnity, got ${DOCS.indemnity?.title}`);
}
const indemnityBody = DOCS.indemnity?.renderBody?.() || "";
for (const marker of [
  "ITC Hyrox Training - Liability Release &amp; Data Privacy Form",
  "Hyrox Training from the date of signing to 31 December 2026",
]) {
  if (!indemnityBody.includes(marker)) {
    failures++;
    console.error(`FAIL indemnity document missing opening marker "${marker}"`);
  }
}
for (const [clause, phrase] of [
  ["1", "to assume and accept all and any risks"],
  ["2", "to waive any and all claims"],
  ["3", "to release:"],
  ["4", "to hold harmless and indemnify:"],
  ["5", "that appropriate insurance shall be taken out by me"],
  ["6", "the leaders of ITC and/or IECC have the right"],
  ["7", "that my level of physical fitness is adequate"],
  ["8", "that this Form shall be effective and binding"],
  ["9", "that I agree to the personal data privacy statement"],
  ["10", "that the laws of Hong Kong shall govern this Form"],
]) {
  if (!indemnityBody.includes(`data-clause="${clause}"`) || !indemnityBody.includes(phrase)) {
    failures++;
    console.error(`FAIL indemnity document missing clause ${clause}: "${phrase}"`);
  }
}
if (!indemnityBody.includes("https://www.islandecc.hk/privacy-policy/")) {
  failures++;
  console.error("FAIL indemnity document missing the IECC privacy-policy URL");
}
for (const removed of [
  "Health declaration",
  "Participation at my own risk",
  "Draft — pending ITC leadership review",
]) {
  if (indemnityBody.includes(removed)) {
    failures++;
    console.error(`FAIL indemnity document still contains draft marker "${removed}"`);
  }
}
console.log("ok  indemnity registry exposes versioned Hyrox legal copy");
```

Replace the existing four-heading Profile inline-card loop with assertions for the source title plus `data-clause="1"` through `data-clause="10"`. Replace `docExpectations.indemnity` with the same source-title marker and ten clause attributes. These old assertions must change in Task 1, not a later task, because the single document source updates the modal and inline card simultaneously. Do not weaken the test to count arbitrary `<li>` elements because clauses 3 and 4 contain nested subclauses.

- [ ] **Step 2: Run the smoke suite and verify the new assertions fail**

Run:

```sh
node app/smoke.mjs
```

Expected: failures for missing `INDEMNITY_VERSION`, old title, missing Hyrox clauses, and retained draft headings.

- [ ] **Step 3: Replace `renderIndemnityDocument()` with the exact semantic HTML**

In `app/js/documents.js`, remove the global “All copy is draft” comment, export the version, keep the registry key, and use this complete body:

```js
export const INDEMNITY_VERSION = "v1";

export const DOCUMENTS = {
  indemnity: {
    title: "Indemnity",
    renderBody: renderIndemnityDocument,
  },
  privacy: {
    title: "Privacy Policy",
    renderBody: renderPrivacyDocument,
  },
  guidelines: {
    title: "Community Guidelines",
    renderBody: renderGuidelinesDocument,
  },
};

export function renderIndemnityDocument() {
  return `
    <div class="doc-content">
      <h3>ITC Hyrox Training - Liability Release &amp; Data Privacy Form</h3>
      <p>I am aware that my participation in the Island Training Club (“<strong>ITC</strong>”) Hyrox Training from the date of signing to 31 December 2026, including but not limited to: HYROX-style training, running, rowing, SkiErg, sled push/pull, wall balls, lunges, burpees, bodyweight movements, weights, warm-ups, cool-downs, partner drills and/or other functional fitness exercises (the “<strong>Activity</strong>”) involve inherent risks, including fatigue, overexertion, muscle soreness, sprains, strains, falls, collision with persons or objects, aggravation of pre-existing conditions, illness, injury and, in rare cases, serious injury or death.</p>
      <p>Having regard to the religious and non-profit nature of ITC and Island Evangelical Community Church Limited (“<strong>IECC</strong>”) (including but not limited to their officers, directors, employees, agents, representatives and volunteers) (collectively, the “<strong>Organizer</strong>”) of the Activity, and in consideration of IECC and/or ITC accepting my participation in the Activity, I hereby agree and confirm as follows:</p>
      <ol class="doc-clauses">
        <li data-clause="1">to assume and accept all and any risks of personal injury, sickness, death, damage, dangers and expenses arising out of, incidental to or in any way connected with my participation to the Activity;</li>
        <li data-clause="2">to waive any and all claims, actions, costs, expenses and demands that I may have against the Organizer within and outside Hong Kong;</li>
        <li data-clause="3">to release:
          <ol class="doc-subclauses" type="a">
            <li>the Organizer from any and all liability for any loss, damage, injury or expense that I or my next of kin may suffer or incur as a result of my participation in the Activity, due to any cause whatsoever including but not limited to negligence on the part of the Organizer; and</li>
            <li>IECC from any and all liability for any loss, damage or expense that arises in relation to the storage, maintenance and/or usage of any equipment in respect of the Activity or any other Hyrox-related training taking place within the premise of IECC;</li>
          </ol>
        </li>
        <li data-clause="4">to hold harmless and indemnify:
          <ol class="doc-subclauses" type="a">
            <li>the Organizer for any liability sustained by the Organizer as the result of my negligent, willful or intentional acts; and</li>
            <li>IECC for any loss or damage caused to any part of the premise, fixture or equipment of IECC resulting from my participation in the Activity;</li>
          </ol>
        </li>
        <li data-clause="5">that appropriate insurance shall be taken out by me on an individual level (if necessary), and the Organizer shall not be responsible for taking out personal liability insurance for the Activity or for individuals participating in the Activity. It is my sole discretion and responsibility to subscribe my own personal insurance liability relating to the Activity if I deem necessary;</li>
        <li data-clause="6">the leaders of ITC and/or IECC have the right to request an individual to cease participation in the Activity if, at the sole opinion of the leaders of ITC and/or IECC, the actions of that individual may endanger the safety of himself/herself and/or other participants of the Activity;</li>
        <li data-clause="7">that my level of physical fitness is adequate for the Activity and, if not, that I will be responsible for ensuring that I consult with a physician about my physical condition before and after participating in the Activity;</li>
        <li data-clause="8">that this Form shall be effective and binding upon my next of kin, executors, administrators and assigns, in the event of my death;</li>
        <li data-clause="9">that I agree to the personal data privacy statement of IECC (available at <a href="https://www.islandecc.hk/privacy-policy/" target="_blank" rel="noopener noreferrer">https://www.islandecc.hk/privacy-policy/</a>) and I agree that the personal data provided by me for the Activity will be used for the purposes of managing and organizing the Activity and handling my enquiries in relation to the Activity and/or the Organizer; and</li>
        <li data-clause="10">that the laws of Hong Kong shall govern this Form and any disputes arising hereof shall be determined by the courts of Hong Kong.</li>
      </ol>
    </div>`;
}
```

The visible browser numbering is provided by `<ol>`. The `data-clause` attributes make the exact ten-clause contract testable without injecting duplicate visible numbers into the legal text.

- [ ] **Step 4: Add focused clause-list CSS**

Append adjacent to `.modal-doc-body .doc-content` rules in `app/styles.css`:

```css
.doc-content .doc-clauses,
.doc-content .doc-subclauses {
  padding-left: 1.4rem;
}
.doc-content .doc-clauses > li,
.doc-content .doc-subclauses > li {
  margin: 0 0 12px;
  padding-left: 4px;
}
.doc-content .doc-subclauses {
  margin-top: 12px;
  list-style: none;
  counter-reset: doc-subclause;
}
.doc-content .doc-subclauses > li {
  position: relative;
  counter-increment: doc-subclause;
}
.doc-content .doc-subclauses > li::before {
  content: "(" counter(doc-subclause, lower-alpha) ")";
  position: absolute;
  right: calc(100% + 6px);
}
```

- [ ] **Step 5: Run smoke and verify Task 1 passes**

Run:

```sh
node app/smoke.mjs
```

Expected: all tests pass, including the versioned legal-copy assertions and existing modal scroll tests.

- [ ] **Step 6: Commit Task 1**

```sh
git add app/js/documents.js app/styles.css app/smoke.mjs
git commit -m "feat(indemnity): replace draft with Hyrox legal document"
```

---

### Task 2: Add the v14 Local Consent Model and Structured Acceptance

**Files:**
- Modify: `app/js/store.js:1-341, 498-599`
- Modify: `app/smoke.mjs:485-545, 784-834, 1560-1750, 2180-2205`
- Modify: `README.md:39-44`

**Interfaces:**
- Consumes: `INDEMNITY_VERSION` from Task 1; `todayLocal()`, `isoDate()`, and `parseISO()` already imported by `store.js`.
- Produces: v14 user fields; `isIndemnityCurrent(user)`; structured `acceptIndemnity(userId, payload)`; local application persistence.

- [ ] **Step 1: Write failing local-model and validation tests**

Update the local application fixture in `app/smoke.mjs`:

```js
const applyRes = store.applyForMembership({
  fullName: "Test Person",
  preferredName: "Test",
  email: "test@example.com",
  phone: "+852 1234 5678",
  emergencyName: "E Person",
  emergencyRelationship: "Sibling",
  emergencyPhone: "+852 8765 4321",
  heard: "A friend",
  ageConfirmed: true,
  mediaConsent: false,
  donorId: "Not applicable",
  indemnity: true,
  indemnitySignature: "Test Person",
  indemnitySignedAt: data.isoDate(data.todayLocal()),
});
```

Then assert:

```js
for (const [field, expected] of [
  ["emergencyRelationship", "Sibling"],
  ["indemnitySignature", "Test Person"],
  ["indemnitySignedAt", data.isoDate(data.todayLocal())],
  ["indemnityFormVersion", "v1"],
]) {
  if (applyRes.user[field] !== expected) {
    failures++;
    console.error(`FAIL application ${field} expected ${expected}, got ${applyRes.user[field]}`);
  }
}
if (!store.isIndemnityCurrent(applyRes.user)) {
  failures++;
  console.error("FAIL signed v1 application should have current indemnity");
}
```

Add validation assertions:

```js
for (const [label, payload, pattern] of [
  ["short signature", { signature: "X", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "Sibling" }, /full name as your signature/],
  ["invalid date", { signature: "Test Person", signedAt: "2026-02-31", emergencyRelationship: "Sibling" }, /valid signing date/],
  ["future date", { signature: "Test Person", signedAt: "2999-01-01", emergencyRelationship: "Sibling" }, /cannot be in the future/],
  ["missing relationship", { signature: "Test Person", signedAt: data.isoDate(data.todayLocal()), emergencyRelationship: "" }, /relationship/],
]) {
  let error = null;
  try { store.acceptIndemnity(applyRes.user.id, payload); } catch (err) { error = err; }
  if (!error || !pattern.test(error.message)) {
    failures++;
    console.error(`FAIL ${label} should reject with ${pattern}`);
  }
}
```

Add a v13-to-v14 fixture after the existing integrated migration test:

```js
store.resetLocalData();
const v13 = JSON.parse(mem.get("itc.prototype.v1"));
v13.version = 13;
v13.users = [{
  id: "real-v13-member",
  role: "member",
  status: "approved",
  fullName: "Real Member",
  email: "real-v13@example.test",
  indemnityAcceptedAt: 123456789,
}];
mem.set("itc.prototype.v1", JSON.stringify(v13));
store.load();
const v14 = JSON.parse(mem.get("itc.prototype.v1"));
const migratedUser = v14.users.find((user) => user.id === "real-v13-member");
if (v14.version !== 14 || !migratedUser) throw new Error("v14 migration lost the genuine member");
for (const field of ["indemnitySignature", "indemnitySignedAt", "indemnityFormVersion", "emergencyRelationship"]) {
  if (!(field in migratedUser) || migratedUser[field] !== null) {
    throw new Error(`v14 migration should initialize ${field} to null`);
  }
}
if (migratedUser.indemnityAcceptedAt !== 123456789) {
  throw new Error("v14 migration must preserve indemnityAcceptedAt");
}
if (store.isIndemnityCurrent(migratedUser)) {
  throw new Error("timestamp-only v13 acceptance must be stale in v14");
}
console.log("ok  v14 migration preserves legacy acceptance and initializes consent fields");
```

Update existing expected final-version assertions from 13 to 14 without renaming historical v13 cleanup labels. Replace the existing no-payload acceptance call in the Profile smoke block with:

```js
store.acceptIndemnity(store.currentUser().id, {
  signature: "Test Person",
  signedAt: data.isoDate(data.todayLocal()),
  emergencyRelationship: "Sibling",
});
```

- [ ] **Step 2: Run smoke and verify the new model tests fail**

Run:

```sh
node app/smoke.mjs
```

Expected: failures for missing new user fields, missing `isIndemnityCurrent`, old state version, and timestamp-only `acceptIndemnity`.

- [ ] **Step 3: Import the document version and bump state version**

At the top of `app/js/store.js`:

```js
import { INDEMNITY_VERSION } from "./documents.js";
```

Change:

```js
const STATE_VERSION = 14;
```

Before `state.version = STATE_VERSION`, add:

```js
if (v < 14) {
  for (const user of state.users) {
    for (const field of [
      "indemnitySignature",
      "indemnitySignedAt",
      "indemnityFormVersion",
      "emergencyRelationship",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(user, field)) user[field] = null;
    }
  }
}
```

- [ ] **Step 4: Add exact acceptance normalization and current-version helper**

Add near the signup/approval section:

```js
function normalizeIndemnityAcceptance({
  signature,
  signedAt,
  emergencyRelationship,
  formVersion = INDEMNITY_VERSION,
} = {}) {
  const normalizedSignature = String(signature || "").trim();
  const normalizedSignedAt = String(signedAt || "").trim();
  const normalizedRelationship = String(emergencyRelationship || "").trim();
  if (normalizedSignature.length < 2) {
    throw new Error("Type your full name as your signature");
  }
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedSignedAt)
    && isoDate(parseISO(normalizedSignedAt)) === normalizedSignedAt;
  if (!validDate) throw new Error("Enter a valid signing date");
  if (normalizedSignedAt > isoDate(todayLocal())) {
    throw new Error("Signing date cannot be in the future");
  }
  if (!normalizedRelationship) {
    throw new Error("Enter your emergency contact relationship");
  }
  if (formVersion !== INDEMNITY_VERSION) {
    throw new Error("The Indemnity has changed. Reload and review the current document");
  }
  return {
    signature: normalizedSignature,
    signedAt: normalizedSignedAt,
    emergencyRelationship: normalizedRelationship,
    formVersion: INDEMNITY_VERSION,
  };
}

export function isIndemnityCurrent(user) {
  if (!user?.indemnityAcceptedAt || user.indemnityFormVersion !== INDEMNITY_VERSION) return false;
  if (String(user.indemnitySignature || "").trim().length < 2) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(user.indemnitySignedAt || ""))) return false;
  return !!String(user.emergencyRelationship || "").trim();
}
```

- [ ] **Step 5: Persist structured acceptance during local application**

At the beginning of `applyForMembership(form)`, after duplicate detection, validate required acceptance:

```js
if (!form.indemnity) throw new Error("Read and accept the Indemnity");
const acceptance = normalizeIndemnityAcceptance({
  signature: form.indemnitySignature,
  signedAt: form.indemnitySignedAt,
  emergencyRelationship: form.emergencyRelationship,
});
const acceptedAt = Date.now();
```

In the user record, replace timestamp-only acceptance and add canonical relationship:

```js
    emergencyName: form.emergencyName.trim(),
    emergencyRelationship: acceptance.emergencyRelationship,
    emergencyPhone: form.emergencyPhone.trim(),
    indemnityAcceptedAt: acceptedAt,
    indemnitySignature: acceptance.signature,
    indemnitySignedAt: acceptance.signedAt,
    indemnityFormVersion: acceptance.formVersion,
```

- [ ] **Step 6: Replace timestamp-only `acceptIndemnity()`**

```js
export function acceptIndemnity(userId, payload) {
  const user = state.users.find((candidate) => candidate.id === userId);
  if (!user) return null;
  const acceptance = normalizeIndemnityAcceptance(payload);
  user.indemnityAcceptedAt = Date.now();
  user.indemnitySignature = acceptance.signature;
  user.indemnitySignedAt = acceptance.signedAt;
  user.indemnityFormVersion = acceptance.formVersion;
  user.emergencyRelationship = acceptance.emergencyRelationship;
  save();
  return user.indemnityAcceptedAt;
}
```

- [ ] **Step 7: Update persisted-state documentation**

In `README.md`, change the persisted state line to:

```md
- Persisted prototype state is **v14** and accepts/migrates existing **v9–v13** snapshots without discarding genuine domain records.
```

- [ ] **Step 8: Run smoke and verify Task 2 passes**

Run:

```sh
node app/smoke.mjs
```

Expected: all local tests pass, including v14 migration and structured acceptance validation.

- [ ] **Step 9: Commit Task 2**

```sh
git add app/js/store.js app/smoke.mjs README.md
git commit -m "feat(indemnity): persist versioned local signatures"
```

---

### Task 3: Add the Supabase Schema and Live Consent Mapping

**Files:**
- Create: `supabase/migrations/20260827000001_hyrox_indemnity_fields.sql`
- Modify: `app/js/store.js:1845-2085`
- Modify: `app/live-auth-smoke.mjs:25-60, 690-770, 1000-1065, 1310-1438`
- Modify: `app/smoke.mjs:50-80`
- Modify: `docs/runbooks/live-auth.md:40-55, 285-295`

**Interfaces:**
- Consumes: `normalizeIndemnityAcceptance()` and `isIndemnityCurrent()` from Task 2.
- Produces: additive application columns; live application insert/hydration/update mappings; structured `acceptMyIndemnity(payload)`.

- [ ] **Step 1: Add failing schema-source and live mapping assertions**

Add the new migration path to the foundation-file list in `app/smoke.mjs`:

```js
"../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql",
```

Read it and assert all additive columns:

```js
const indemnityMigrationSource = readFileSync(
  resolve(__dirnameSmoke, "../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql"),
  "utf8"
);
for (const column of [
  "waiver_signature_text",
  "waiver_signed_at",
  "waiver_form_version",
  "emergency_relationship",
]) {
  if (!indemnityMigrationSource.includes(column)) {
    throw new Error(`Hyrox indemnity migration missing ${column}`);
  }
}
```

In `app/live-auth-smoke.mjs`, extend the initial application row with:

```js
      emergency_relationship: "Coach",
      waiver_signature_text: "Riley Runner",
      waiver_signed_at: "2026-08-05",
      waiver_form_version: "v1",
```

Update the live apply payload test to include:

```js
  emergency_relationship: "Coach",
  waiver: true,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
```

Add `emergency_relationship: "Coach"` to the `updateMyMembershipDetails()` test payload, update the Membership Details patch key list to include `emergency_relationship`, and add `emergency_relationship` to the fields forbidden from the privacy-preferences patch.

Replace timestamp-only `acceptMyIndemnity()` tests with:

```js
applicationUpdates.length = 0;
const preservedWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(preservedWaiver, "2026-08-05T01:00:00.000Z");
assert.equal(applicationUpdates.length, 0, "current v1 acceptance should remain idempotent");

applicationRows.set(authUser.id, {
  ...applicationRows.get(authUser.id),
  waiver_signature_text: null,
  waiver_signed_at: null,
  waiver_form_version: null,
});
const createdWaiver = await store.acceptMyIndemnity({
  signature: "Riley Runner",
  signedAt: "2026-08-05",
  emergencyRelationship: "Coach",
});
assert.equal(createdWaiver, fixedIso);
assert.deepEqual(applicationUpdates.at(-1), {
  waiver_accepted_at: fixedIso,
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
  waiver_form_version: "v1",
  emergency_relationship: "Coach",
});
```

- [ ] **Step 2: Run live tests and verify failures**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: missing migration file, missing live columns, leaked/missing patch keys, and old timestamp-only acceptance behaviour.

- [ ] **Step 3: Create the additive Supabase migration**

Create `supabase/migrations/20260827000001_hyrox_indemnity_fields.sql`:

```sql
-- Island Training Club — versioned Hyrox indemnity fields
--
-- Existing applications remain readable. Null values identify legacy rows
-- that must re-sign through Profile > Indemnity.

alter table public.applications
  add column if not exists waiver_signature_text text,
  add column if not exists waiver_signed_at date,
  add column if not exists waiver_form_version text,
  add column if not exists emergency_relationship text;
```

Do not add `not null` constraints because deployed legacy rows do not have these values.

- [ ] **Step 4: Extend local/live application mapping**

In `localApplication(user)`, add:

```js
    emergency_relationship: user.emergencyRelationship || null,
    waiver_signature_text: user.indemnitySignature || null,
    waiver_signed_at: user.indemnitySignedAt || null,
    waiver_form_version: user.indemnityFormVersion || null,
```

In `membershipPatch(form)`, add:

```js
    emergency_relationship: String(form.emergency_relationship || "").trim(),
```

Change the contact validation to require all three values:

```js
if (!patch.emergency_name || !patch.emergency_relationship || !patch.emergency_phone) {
  throw new Error("Enter emergency contact name, relationship and phone");
}
```

In the local branch of `updateMyMembershipDetails(form)`, add:

```js
user.emergencyRelationship = patch.emergency_relationship;
```

- [ ] **Step 5: Extend `saveMyApplication(form)`**

Before creating `row`, require the acknowledged checkbox and normalize acceptance:

```js
if (!form.waiver) throw new Error("Read and accept the Indemnity");
const acceptance = normalizeIndemnityAcceptance({
  signature: form.waiver_signature_text,
  signedAt: form.waiver_signed_at,
  emergencyRelationship: form.emergency_relationship,
});
const acceptedAt = new Date().toISOString();
```

Add these row properties:

```js
    emergency_relationship: acceptance.emergencyRelationship,
    waiver_accepted_at: acceptedAt,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
```

Use the same `acceptedAt` value for privacy/guidelines timestamps where the existing code currently creates separate `new Date().toISOString()` values; this is a harmless deterministic simplification within one submission.

- [ ] **Step 6: Replace `acceptMyIndemnity()` with structured local/live behaviour**

```js
export async function acceptMyIndemnity(payload) {
  if (!isLive() || !supabase) {
    const user = currentUser();
    if (!user) throw new Error("Not signed in");
    return acceptIndemnity(user.id, payload);
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const app = await getMyApplication();
  if (!app) throw new Error("Application not found");
  const mapped = {
    indemnityAcceptedAt: app.waiver_accepted_at,
    indemnitySignature: app.waiver_signature_text,
    indemnitySignedAt: app.waiver_signed_at,
    indemnityFormVersion: app.waiver_form_version,
    emergencyRelationship: app.emergency_relationship,
  };
  if (isIndemnityCurrent(mapped)) return app.waiver_accepted_at;
  const acceptance = normalizeIndemnityAcceptance(payload);
  const waiver_accepted_at = new Date().toISOString();
  const patch = {
    waiver_accepted_at,
    waiver_signature_text: acceptance.signature,
    waiver_signed_at: acceptance.signedAt,
    waiver_form_version: acceptance.formVersion,
    emergency_relationship: acceptance.emergencyRelationship,
  };
  const { data, error } = await supabase
    .from("applications")
    .update(patch)
    .eq("profile_id", cu.id)
    .select()
    .single();
  if (error) throw error;
  return data.waiver_accepted_at;
}
```

Extend `listPendingApplications()` with the four mapped properties so Admin and hydrated view fixtures preserve them.

- [ ] **Step 7: Document the deployment migration**

In `docs/runbooks/live-auth.md`, add `20260827000001_hyrox_indemnity_fields.sql` to the ordered migration guidance and state that it is additive and must be applied before deploying UI that writes the new columns.

- [ ] **Step 8: Run local and live tests**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both suites pass; live patches contain only the intended fields.

- [ ] **Step 9: Commit Task 3**

```sh
git add supabase/migrations/20260827000001_hyrox_indemnity_fields.sql app/js/store.js app/smoke.mjs app/live-auth-smoke.mjs docs/runbooks/live-auth.md
git commit -m "feat(indemnity): persist live signature records"
```

---

### Task 4: Add Signature, Date, and Relationship to Both Application Forms

**Files:**
- Modify: `app/js/views.js:1435-1610`
- Modify: `app/js/app.js:390-430, 800-885`
- Test: `app/smoke.mjs:410-530`
- Test: `app/live-auth-smoke.mjs:690-770`

**Interfaces:**
- Consumes: Task 2 local application fields; Task 3 live application fields; existing modal `[data-doc-accept]` convention.
- Produces: required inputs and exact local/live submit payloads; draft save/resume automatically includes new named controls.

- [ ] **Step 1: Add failing local/live render and draft assertions**

For local apply HTML in `app/smoke.mjs`, assert:

```js
for (const name of ["emergencyRelationship", "indemnitySignature", "indemnitySignedAt"]) {
  if (!applyLocalHtml.includes(`name="${name}"`)) {
    failures++;
    console.error(`FAIL local apply form missing ${name}`);
  }
}
if (!applyLocalHtml.includes("Participant's full name as signature")) {
  failures++;
  console.error("FAIL local apply form missing signature label");
}
if (!applyLocalHtml.includes(`max="${data.isoDate(data.todayLocal())}"`)) {
  failures++;
  console.error("FAIL local signing date should be capped at today");
}
```

In `app/live-auth-smoke.mjs`, assert live HTML includes:

```js
for (const name of ["emergency_relationship", "waiver_signature_text", "waiver_signed_at"]) {
  assert.match(liveApplyHtml, new RegExp(`name="${name}"`));
}
assert.match(liveApplyHtml, /data-doc-accept="indemnity"/);
assert.match(liveApplyHtml, /name="waiver"[^>]*disabled[^>]*data-doc-checkbox/);
```

Extend the draft fields and assert their values return:

```js
  emergency_relationship: "Coach",
  waiver_signature_text: "Riley Runner",
  waiver_signed_at: "2026-08-05",
```

- [ ] **Step 2: Run both suites and verify form assertions fail**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: missing field names/labels/defaults in local and live forms.

- [ ] **Step 3: Extend the reusable live apply field helper**

Change `applyField` to support safe caller-provided attributes:

```js
function applyField(type, name, label, required, value = "", attrs = "") {
  return `
    <label class="field">
      <span class="field-label">${esc(label)}${required ? " *" : ""}</span>
      <input type="${type}" name="${name}" value="${esc(value || "")}" ${required ? "required" : ""}${attrs ? ` ${attrs}` : ""}>
    </label>`;
}
```

Only pass static attributes assembled inside `views.js`; never pass user content through `attrs`.

- [ ] **Step 4: Add fields to `applyFormHtml()` (live mode)**

Place relationship between emergency name and phone:

```js
${applyField("text", "emergency_name", "Emergency contact name", true, fields.emergency_name)}
${applyField("text", "emergency_relationship", "Relationship to participant", true, fields.emergency_relationship)}
${applyField("text", "emergency_phone", "Emergency contact phone", true, fields.emergency_phone)}
```

Keep the existing indemnity modal block and change its link text to **Indemnity**. In the existing local modal-trigger expectation array, change the indemnity label from `Health &amp; Liability Indemnity` to `Indemnity`. Then add immediately below the modal block:

```js
${applyField("text", "waiver_signature_text", "Participant's full name as signature", true, fields.waiver_signature_text)}
${applyField(
  "date",
  "waiver_signed_at",
  "Date of signing",
  true,
  fields.waiver_signed_at || todayISO(),
  `max="${todayISO()}"`
)}
```

Do not alter privacy or guidelines modal blocks.

- [ ] **Step 5: Add fields to `viewApplyLocal()`**

Replace the two-field emergency row with three required fields:

```html
<div class="field"><label for="ap-en">Emergency contact name *</label><input id="ap-en" name="emergencyName" required></div>
<div class="field"><label for="ap-er">Relationship to participant *</label><input id="ap-er" name="emergencyRelationship" required></div>
<div class="field"><label for="ap-ep">Emergency contact phone *</label><input id="ap-ep" name="emergencyPhone" type="tel" required></div>
```

Keep the indemnity modal block and use link text **Indemnity**. Add:

```html
<div class="field">
  <label for="ap-signature">Participant's full name as signature *</label>
  <input id="ap-signature" name="indemnitySignature" required autocomplete="name">
</div>
<div class="field">
  <label for="ap-signed-at">Date of signing *</label>
  <input id="ap-signed-at" name="indemnitySignedAt" type="date" value="${todayISO()}" max="${todayISO()}" required>
</div>
```

Remove the local “Draft form — final fields and waiver wording” paragraph. The supplied legal form is now the source.

- [ ] **Step 6: Map local and live submit payloads in `app.js`**

In the live `data-form="apply"` branch, add:

```js
payload.waiver = !!fd.get("waiver");
```

The other live fields already flow through `Object.fromEntries(fd.entries())`.

In the local `form-apply` payload, add:

```js
emergencyRelationship: fd.get("emergencyRelationship") || "",
indemnitySignature: fd.get("indemnitySignature") || "",
indemnitySignedAt: fd.get("indemnitySignedAt") || "",
```

Add this shared DOM-safe helper near `showFieldError()` in `app/js/app.js`:

```js
function showInlineFormError(host, message) {
  if (!host) return;
  host.innerHTML = "";
  const alert = document.createElement("div");
  alert.className = "form-error";
  alert.setAttribute("role", "alert");
  alert.textContent = message;
  host.appendChild(alert);
}
```

Build a named `payload` from the local `FormData`, then wrap `store.applyForMembership(payload)` in `try/catch`; errors render safely through `#apply-error` without clearing values:

```js
const payload = {
  fullName: fd.get("fullName") || "",
  preferredName: fd.get("preferredName") || "",
  email: fd.get("email") || "",
  phone: fd.get("phone") || "",
  emergencyName: fd.get("emergencyName") || "",
  emergencyRelationship: fd.get("emergencyRelationship") || "",
  emergencyPhone: fd.get("emergencyPhone") || "",
  heard: fd.get("heard") || "",
  ageConfirmed: fd.get("ageConfirmed") === "on",
  mediaConsent: fd.get("mediaConsent") === "on",
  donorId: fd.get("donorId") || "",
  indemnity: fd.get("indemnity") === "on",
  indemnitySignature: fd.get("indemnitySignature") || "",
  indemnitySignedAt: fd.get("indemnitySignedAt") || "",
};
try {
  const res = store.applyForMembership(payload);
  if (!res.ok) {
    showInlineFormError(errEl, "An application already exists for that email — try signing in instead.");
    return;
  }
  toast("Application submitted — a leader will review it");
  location.hash = "#/account";
  render();
} catch (err) {
  showInlineFormError(errEl, err.message || "Unable to submit application");
}
```

- [ ] **Step 7: Run local and live tests**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: all tests pass; draft persistence needs no special store changes because `collectApplyDraftFields()` already serializes every named control.

- [ ] **Step 8: Commit Task 4**

```sh
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(indemnity): collect signatures during application"
```

---

### Task 5: Render Current/Stale Consent and Complete Membership Editing

**Files:**
- Modify: `app/js/views.js:980-1288`
- Modify: `app/js/app.js:800-980`
- Test: `app/smoke.mjs:720-875, 1080-1130`
- Test: `app/live-auth-smoke.mjs:1000-1065, 1200-1438`

**Interfaces:**
- Consumes: `isIndemnityCurrent()`, structured `acceptMyIndemnity()`, canonical relationship mapping, existing document modal.
- Produces: Profile row status; current/stale Indemnity page; functioning Membership Details and re-sign submit handlers.

- [ ] **Step 1: Write failing Profile and Membership Details assertions**

Update the Profile heading expectation to:

```js
["indemnity", "Indemnity."],
```

For a current local member, assert the page includes:

```js
for (const marker of [
  "Indemnity confirmed on",
  "Signed by",
  "Test Person",
  "Date of signing",
  "Emergency contact relationship",
  "Sibling",
  "Document version",
  "v1",
]) {
  if (!currentIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL current Indemnity page missing "${marker}"`);
  }
}
```

Make the member stale by setting `indemnityFormVersion = "v0"`, render again, and assert:

```js
for (const marker of [
  "A new version of the Indemnity is available",
  "data-doc-accept=\"indemnity\"",
  "name=\"signature\"",
  "name=\"signedAt\"",
  "name=\"emergencyRelationship\"",
  "Accept &amp; Confirm",
  "Edit in Membership Details",
]) {
  if (!staleIndemnityHtml.includes(marker)) {
    failures++;
    console.error(`FAIL stale Indemnity page missing "${marker}"`);
  }
}
```

For Membership Details edit/summary, assert `name="emergency_relationship"` and “Emergency contact relationship”.

In `app/live-auth-smoke.mjs`, assert hydrated live views show the stored signature/date/relationship/version and stale rows show the re-sign form. Add source assertions that `app.js` calls `updateMyMembershipDetails`, calls `acceptMyIndemnity`, and explicitly checks `fd.get("indemnityAccept") !== "on"`; this prevents a disabled checkbox from bypassing acknowledgement.

- [ ] **Step 2: Run both suites and verify Profile assertions fail**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: old timestamp-only Profile status, old heading, missing details/re-sign fields, and missing Membership Details relationship.

- [ ] **Step 3: Hydrate all new live fields**

In `hydrateLiveUser(user)`, add:

```js
      emergencyRelationship: app.emergency_relationship ?? user.emergencyRelationship ?? "",
      indemnitySignature: app.waiver_signature_text ?? user.indemnitySignature ?? "",
      indemnitySignedAt: app.waiver_signed_at ?? user.indemnitySignedAt ?? "",
      indemnityFormVersion: app.waiver_form_version ?? user.indemnityFormVersion ?? "",
```

Use `store.isIndemnityCurrent(hydrated)` for Profile row state and pending summary instead of testing only `indemnityAcceptedAt`.

- [ ] **Step 4: Add emergency relationship to Membership Details**

In `accountDetailsEdit(user)`, insert between contact name and phone:

```html
<div class="field">
  <label for="md-emergency_relationship">Emergency contact relationship *</label>
  <input id="md-emergency_relationship" name="emergency_relationship" value="${esc(hydrated.emergencyRelationship || "")}" required>
</div>
```

In `accountDetails(user)`, add:

```html
<div class="line"><span>Emergency contact relationship</span><strong>${esc(hydrated.emergencyRelationship)}</strong></div>
```

Update pending/admin emergency summaries that concatenate name and phone to include relationship when present without rendering “undefined”.

- [ ] **Step 5: Replace `accountIndemnity(user)` with current/stale rendering**

Use:

```js
async function accountIndemnity(user) {
  const hydrated = await hydrateLiveUser(user);
  const current = store.isIndemnityCurrent(hydrated);
  const hadAcceptance = !!hydrated.indemnityAcceptedAt;
  const defaultDate = todayISO();
  return `
    <a class="back-link" href="#/account">← Profile</a>
    <div class="kicker mt16">Profile · Indemnity</div>
    <h1 class="display sm">Indemnity.</h1>
    ${current ? `
      <div class="banner mt16">
        <span class="kicker">Indemnity confirmed on ${fmtDay(hydrated.indemnityAcceptedAt)}</span>
        <p>You’re confirmed to join ITC activities.</p>
      </div>` : `
      <div class="banner warn mt16">
        <span class="kicker">To be accepted</span>
        <p>${hadAcceptance
          ? "A new version of the Indemnity is available. Please read and re-sign."
          : "Please read the Indemnity, then accept and confirm."}</p>
      </div>`}
    <a class="btn ghost sm mt16" href="#" data-action="open-doc" data-doc="indemnity">View as full document</a>
    <div class="card mt16"><div class="card-body prose">
      ${indemnityDoc.renderIndemnityDocument()}
    </div></div>
    ${current ? `
      <div class="card mt16"><div class="card-body receipt-lines">
        <div class="line"><span>Signed by</span><strong>${esc(hydrated.indemnitySignature)}</strong></div>
        <div class="line"><span>Date of signing</span><strong>${fmtDay(parseISO(hydrated.indemnitySignedAt))}</strong></div>
        <div class="line"><span>Emergency contact name</span><strong>${esc(hydrated.emergencyName)}</strong></div>
        <div class="line"><span>Emergency contact relationship</span><strong>${esc(hydrated.emergencyRelationship)}</strong></div>
        <div class="line"><span>Emergency contact phone</span><strong>${esc(hydrated.emergencyPhone)}</strong></div>
        <div class="line"><span>Document version</span><strong>${esc(hydrated.indemnityFormVersion)}</strong></div>
      </div></div>` : `
      <form id="form-indemnity" class="mt16" novalidate>
        <div data-doc-accept="indemnity">
          <label class="check"><input type="checkbox" name="indemnityAccept" required disabled data-doc-checkbox>
            <span>I accept the <a href="#" class="modal-link" data-action="open-doc" data-doc="indemnity">Indemnity</a> form. *</span>
          </label>
          <p class="muted small" data-doc-hint>Read the document to enable acceptance.</p>
        </div>
        <div class="field"><label for="indemnity-signature">Participant's full name as signature *</label><input id="indemnity-signature" name="signature" required autocomplete="name"></div>
        <div class="field"><label for="indemnity-signed-at">Date of signing *</label><input id="indemnity-signed-at" name="signedAt" type="date" value="${defaultDate}" max="${defaultDate}" required></div>
        <div class="card"><div class="card-body receipt-lines">
          <div class="line"><span>Emergency contact name</span><strong>${esc(hydrated.emergencyName || "Not provided")}</strong></div>
          <div class="line"><span>Emergency contact phone</span><strong>${esc(hydrated.emergencyPhone || "Not provided")}</strong></div>
        </div></div>
        <div class="field"><label for="indemnity-relationship">Emergency contact relationship *</label><input id="indemnity-relationship" name="emergencyRelationship" value="${esc(hydrated.emergencyRelationship || "")}" required></div>
        <a class="btn ghost sm" href="#/account/details/edit">Edit in Membership Details →</a>
        <div id="indemnity-error"></div>
        <button class="btn mt16" type="submit">Accept &amp; Confirm</button>
      </form>`}
  `;
}
```

`parseISO` is already imported by `views.js`. Keep the document inline for both states and keep the separate full-document trigger.

- [ ] **Step 6: Wire Membership Details submit in `app.js`**

Before the `switch (form.id)` block, add:

```js
if (form.dataset.form === "membership-details") {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const control = form.querySelector('[type="submit"]');
  await withBusyControl(control, "Saving…", async () => {
    try {
      await store.updateMyMembershipDetails(Object.fromEntries(new FormData(form).entries()));
      toast("Membership details saved");
      location.hash = "#/account/details";
      await renderWithFeedback();
    } catch (err) {
      toast(err.message || "Unable to save membership details", true);
    }
  });
  return;
}
```

This activates the existing edit form for both local and live mode instead of adding a second relationship-only action.

- [ ] **Step 7: Replace the `form-indemnity` submit handler**

```js
case "form-indemnity": {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const fd = new FormData(form);
  const errorEl = form.querySelector("#indemnity-error");
  if (fd.get("indemnityAccept") !== "on") {
    showInlineFormError(errorEl, "Read and accept the Indemnity before confirming");
    return;
  }
  try {
    await store.acceptMyIndemnity({
      signature: fd.get("signature") || "",
      signedAt: fd.get("signedAt") || "",
      emergencyRelationship: fd.get("emergencyRelationship") || "",
    });
    toast("Indemnity accepted & confirmed");
    await renderWithFeedback();
  } catch (err) {
    showInlineFormError(errorEl, err.message || "Unable to accept the Indemnity");
  }
  break;
}
```

The explicit `indemnityAccept` check is required because a disabled checkbox is excluded from both native constraint validation and `FormData`. The store remains the signature/date/relationship validation boundary.

- [ ] **Step 8: Update local and live fixtures to represent current consent**

Every fixture expected to render as confirmed must include:

```js
indemnitySignature: "Test Member",
indemnitySignedAt: "2026-08-05",
indemnityFormVersion: "v1",
emergencyRelationship: "Coach",
```

Use the equivalent `waiver_*` and `emergency_relationship` fields in live rows. Leave dedicated legacy fixtures timestamp-only so stale-state assertions remain meaningful.

- [ ] **Step 9: Run both suites**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: all tests pass; Profile title remains Indemnity; current/stale states are version-aware; Membership Details saves relationship.

- [ ] **Step 10: Commit Task 5**

```sh
git add app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(indemnity): add version-aware Profile consent"
```

---

## Final Verification

- [ ] **Step 1: Run formatting and repository checks**

```sh
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional implementation changes are present.

- [ ] **Step 2: Run both automated suites from the repository root**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0 with all checks passing.

- [ ] **Step 3: Verify no HYROX gate was introduced**

```sh
rg -n "isIndemnityCurrent|acceptMyIndemnity|indemnityFormVersion" app/js/views.js app/js/app.js
```

Expected: matches are limited to Profile/application/Membership Details code; no match appears inside `viewActivity`, `viewCheckout`, reserve, payment, or booking handlers.

- [ ] **Step 4: Verify the migration and state documentation**

```sh
rg -n "STATE_VERSION = 14|v14|20260827000001_hyrox_indemnity_fields" app/js/store.js README.md docs/runbooks/live-auth.md app/smoke.mjs
```

Expected: local state version, migration test, README, runbook, and schema smoke marker all agree.

- [ ] **Step 5: Manual browser verification**

Run:

```sh
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/app/` and verify:

1. Apply form contains relationship, signature, and signing date.
2. Indemnity checkbox cannot be selected directly.
3. Closing the document before the bottom does not enable acceptance.
4. Reopening resets scroll position.
5. Reaching the bottom enables “I have read this document.”
6. Application submits and Profile > Indemnity shows the stored record.
7. Membership Details edits relationship and Profile > Indemnity reflects it.
8. A stale version renders the re-sign form.
9. HYROX detail and checkout show no second indemnity prompt.
10. Mobile and desktop layouts remain readable.

- [ ] **Step 6: Request code review before integration**

Use `superpowers:requesting-code-review`, address findings, rerun both suites, and then use `superpowers:finishing-a-development-branch` to choose integration/push steps.
