# Google OAuth + Email Magic-Link Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Google OAuth as ITC's primary sign-in method while allowing any verified email address to authenticate by magic link, complete a pending membership application with a full name, and await leader approval.

**Architecture:** Add a second Supabase Auth entry point through `signInWithOtp`, using the same exact callback URL and existing deferred `SIGNED_IN` hydration path as Google OAuth. The existing profile trigger and RLS remain authoritative: new users are pending, and the live application writes the applicant's full name to their own profile before upserting the application. SMTP/provider setup stays outside browser code and is documented as an operational deployment step.

**Tech Stack:** Vanilla ES modules, Supabase JS v2 loaded from `esm.sh`, Supabase Auth/Postgres/RLS, static HTML/CSS, Node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-09-16-google-magic-link-auth-design.md`

## Global Constraints

- Base all work on `origin/testing` at `d47df9f` in the isolated `feature/auth-magic-link` worktree.
- No npm runtime dependencies, bundler, transpiler, framework, or build step.
- Keep Google OAuth visually primary; email magic link is secondary.
- Any verified email may create an account, but every new profile remains `pending` until application and Admin approval.
- Phone numbers remain contact information, never authentication credentials.
- Preserve localStorage-only sign-in/application behavior when Supabase is absent.
- Do not change historical Supabase migrations or add a schema migration.
- Do not put SMTP credentials, provider API keys, or magic-link tokens in Git or browser code.
- Use generic request feedback that does not reveal whether an account exists.
- Follow TDD: make the relevant smoke test fail before changing production code.
- Run both `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` before completion.

## File structure

- Modify `app/js/store.js`: expose the magic-link auth seam and persist application full names.
- Modify `app/js/views.js`: render Google-first/email-second sign-in and required live full-name input.
- Modify `app/js/app.js`: submit the live magic-link form with existing busy-control infrastructure.
- Modify `app/live-auth-smoke.mjs`: fake Supabase OTP/profile updates and exercise live auth/UI behavior.
- Modify `app/smoke.mjs` only if local-mode/source-contract coverage needs an explicit assertion.
- Modify `docs/runbooks/live-auth.md`: operational SMTP, redirect, identity-continuity, rollout, and rollback instructions.
- Modify `README.md`: describe Google-or-email pending-profile behavior.
- No CSS file change is planned; existing `.card`, `.field`, `.btn`, `.muted`, `.small`, `.mt16`, and `.center` classes are sufficient.

---

### Task 1: Add the Supabase magic-link store seam and discoverable Google-first UI

**Files:**
- Modify: `app/live-auth-smoke.mjs:300-345, 1880-1900`
- Modify: `app/js/store.js:3766-3776`
- Modify: `app/js/views.js:355-370, 1322-1334`

**Interfaces:**
- Consumes: configured `supabase`, `isLive()`, and the existing exact callback `${window.location.origin}${window.location.pathname}`.
- Produces: `store.signInWithMagicLink(email: string): Promise<{ ok: true }>` and live visitor HTML containing `form-magic-link`.

- [ ] **Step 1: Extend the fake Supabase auth surface and write failing store/view tests**

Add controllable OTP state near the existing OAuth test state:

```js
let magicLinkCalls = 0;
let magicLinkOptions = null;
let releaseMagicLink;
```

Add this method beside `signInWithOAuth` in `fakeSupabase.auth`:

```js
signInWithOtp(options) {
  magicLinkCalls++;
  magicLinkOptions = options;
  return new Promise((resolve) => { releaseMagicLink = resolve; });
},
```

Extend the signed-out Home/Account assertions:

```js
assert.match(signedOutHome, /href="#\/account"[^>]*>Use email instead</);
assert.match(signedOutAccount, /id="form-magic-link"/);
assert.match(signedOutAccount, /name="email"[^>]*type="email"/);
assert.match(signedOutAccount, /Email me a sign-in link/);
assert.ok(
  signedOutAccount.indexOf('data-action="sign-in-google"')
    < signedOutAccount.indexOf('id="form-magic-link"'),
  "Google must remain before the email alternative"
);
```

After the DOM harness defines `globalThis.location` and `window.location`, add the direct store test so the callback URL is available:

```js
const directMagicLink = store.signInWithMagicLink("  Runner@Example.com ");
assert.equal(magicLinkCalls, 1);
assert.deepEqual(magicLinkOptions, {
  email: "runner@example.com",
  options: {
    shouldCreateUser: true,
    emailRedirectTo: `${location.origin}${location.pathname}`,
  },
});
releaseMagicLink({ data: {}, error: null });
assert.deepEqual(await directMagicLink, { ok: true });
```

- [ ] **Step 2: Run the live auth smoke test and verify failure**

Run:

```sh
node app/live-auth-smoke.mjs
```

Expected: FAIL because `store.signInWithMagicLink` and the email UI do not exist.

- [ ] **Step 3: Implement the minimal store function**

Add beside `signInWithGoogle()`:

```js
export async function signInWithMagicLink(email) {
  if (!isLive() || !supabase) {
    throw new Error("signInWithMagicLink requires SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Enter your email address");
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
    },
  });
  if (error) throw error;
  return { ok: true };
}
```

While touching the adjacent guard, change `if (!isLive || !supabase)` in `signInWithGoogle()` to `if (!isLive() || !supabase)`.

- [ ] **Step 4: Implement Google-first/email-second visitor markup**

In live `accountVisitor()`, preserve the Google button and append:

```html
<p class="muted small center mt16">or continue with email</p>
<form id="form-magic-link" class="mt16" novalidate>
  <div class="field">
    <label for="magic-link-email">Email</label>
    <input id="magic-link-email" name="email" type="email"
      autocomplete="email" inputmode="email" placeholder="you@example.com" required>
  </div>
  <button class="btn ghost mt16" type="submit">Email me a sign-in link</button>
  <div class="muted small mt16" data-magic-link-feedback aria-live="polite"></div>
</form>
```

In the live Home visitor card, keep the Google button and add:

```html
<a class="btn ghost mt8" href="#/account">Use email instead</a>
```

- [ ] **Step 5: Run the live auth smoke test**

Run:

```sh
node app/live-auth-smoke.mjs
```

Expected: PASS through the new direct store/view checks and all existing assertions.

- [ ] **Step 6: Commit Task 1**

```sh
git add app/js/store.js app/js/views.js app/live-auth-smoke.mjs
git commit -m "feat(auth): add email magic-link entry point"
```

---

### Task 2: Submit magic-link requests with accessible busy and feedback states

**Files:**
- Modify: `app/live-auth-smoke.mjs:4065-4090, 5480-5515`
- Modify: `app/js/app.js:1350-1410`

**Interfaces:**
- Consumes: `store.signInWithMagicLink(email)`, `withBusyControl(control, label, work, options)`, and `form-magic-link` markup from Task 1.
- Produces: delegated submit behavior with duplicate suppression and generic feedback in `[data-magic-link-feedback]`.

- [ ] **Step 1: Write failing delegated-submit tests**

Create a fake form using the existing `HTMLFormElement`, `makeElement`, `FormData`, and `domListeners` harness:

```js
const magicForm = new HTMLFormElement();
magicForm.id = "form-magic-link";
magicForm.fields = { email: "  Member@Example.com " };
magicForm.reportValidity = () => true;
const magicEmail = makeElement();
magicEmail.name = "email";
magicEmail.disabled = false;
const magicSubmit = makeElement();
magicSubmit.textContent = "Email me a sign-in link";
magicSubmit.disabled = false;
const magicFeedback = makeElement();
magicForm.nativeControls = [magicEmail, magicSubmit];
magicForm.querySelector = (selector) => ({
  '[name="email"]': magicEmail,
  '[type="submit"]': magicSubmit,
  "[data-magic-link-feedback]": magicFeedback,
}[selector] || null);

const firstMagicSubmit = domListeners.get("submit")({
  target: magicForm,
  preventDefault() {},
});
assert.equal(magicEmail.disabled, true);
assert.equal(magicSubmit.disabled, true);
assert.equal(magicSubmit.textContent, "Sending…");
const duplicateMagicSubmit = domListeners.get("submit")({
  target: magicForm,
  preventDefault() {},
});
assert.equal(magicLinkCalls, 2, "one direct store test plus one form request");
releaseMagicLink({ data: {}, error: null });
await Promise.all([firstMagicSubmit, duplicateMagicSubmit]);
assert.equal(magicEmail.disabled, false);
assert.equal(magicSubmit.disabled, false);
assert.match(magicFeedback.textContent, /Check your inbox/);
assert.equal(magicFeedback.getAttribute("role"), "status");
```

Then issue a second form request, release it with `{ error: new Error("User not found") }`, and assert that:

```js
assert.equal(magicFeedback.getAttribute("role"), "alert");
assert.equal(
  magicFeedback.textContent,
  "We couldn’t send the link. Wait a moment and try again."
);
assert.doesNotMatch(magicFeedback.textContent, /User not found/);
assert.equal(magicEmail.disabled, false);
assert.equal(magicSubmit.disabled, false);
```

- [ ] **Step 2: Run the live auth smoke test and verify failure**

Run:

```sh
node app/live-auth-smoke.mjs
```

Expected: FAIL because the submit listener has no `form-magic-link` case.

- [ ] **Step 3: Implement form feedback and submission**

Add a small local helper near `showInlineFormError`:

```js
function showMagicLinkFeedback(form, message, isError = false) {
  const host = form.querySelector("[data-magic-link-feedback]");
  if (!host) return;
  host.textContent = message;
  host.setAttribute("role", isError ? "alert" : "status");
}
```

Add this case to the delegated form switch before local `form-signin`:

```js
case "form-magic-link": {
  e.preventDefault();
  if (!form.reportValidity()) return;
  const email = form.querySelector('[name="email"]');
  const control = form.querySelector('[type="submit"]');
  const emailValue = new FormData(form).get("email");
  showMagicLinkFeedback(form, "");
  await withBusyControl(control, "Sending…", async () => {
    try {
      await store.signInWithMagicLink(emailValue);
      showMagicLinkFeedback(
        form,
        "Check your inbox. We sent a private sign-in link. Open it on this device to continue."
      );
    } catch {
      showMagicLinkFeedback(
        form,
        "We couldn’t send the link. Wait a moment and try again.",
        true
      );
    }
  }, { controls: [email, control] });
  break;
}
```

- [ ] **Step 4: Run both smoke suites**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both PASS.

- [ ] **Step 5: Commit Task 2**

```sh
git add app/js/app.js app/live-auth-smoke.mjs
git commit -m "feat(auth): handle magic-link requests"
```

---

### Task 3: Capture and persist the applicant's full name

**Files:**
- Modify: `app/live-auth-smoke.mjs:365-410, 1920-2000`
- Modify: `app/js/views.js:1930-1970`
- Modify: `app/js/store.js:3985-4035`

**Interfaces:**
- Consumes: current authenticated profile, profile self-update RLS, application draft collection, and `saveMyApplication(form)`.
- Produces: required `full_name` application field and a refreshed live identity after profile/application persistence.

- [ ] **Step 1: Make the fake profile update support full-row returns**

Allow the existing fake `.select()` to serve both role mutations and the new self-name mutation:

```js
select(columns) {
  if (!['id, role', '*'].includes(columns)) {
    throw new Error("Unexpected profile update return columns");
  }
  return {
    single: async () => {
      // preserve the existing gate/error/target logic
      Object.assign(target, patch);
      return {
        data: columns === "*"
          ? structuredClone(target)
          : { id: targetId, role: target.role },
        error: null,
      };
    },
  };
},
```

Do not remove the existing expected-role checks or `profileUpdates` recording.

- [ ] **Step 2: Write failing rendering and persistence tests**

Extend the live application assertions:

```js
assert.match(liveApplyHtml, /name="full_name"[^>]*required/);
assert.match(liveApplyHtml, /name="full_name"[^>]*autocomplete="name"/);
```

Add `full_name: "Riley Magic"` to the draft fixture and assert it renders:

```js
assert.match(draftApplyHtml, /name="full_name" value="Riley Magic"/);
```

Add `full_name: "  Riley Magic  "` to `liveApplyPayload`. Before the successful save, record profile-update count; afterwards assert:

```js
assert.equal(profile.full_name, "Riley Magic");
assert.ok(profileUpdates.slice(profileUpdatesBeforeApplication).some((update) =>
  update.id === authUser.id && update.full_name === "Riley Magic"
));
assert.equal(applicationRows.get(authUser.id).profile_id, authUser.id);
assert.equal((await store.getCurrentUser()).fullName, "Riley Magic");
```

Add validation and ordering checks:

```js
await assert.rejects(
  () => store.saveMyApplication({ ...liveApplyPayload, full_name: "   " }),
  /Enter your full name/
);

applicationRows.delete(authUser.id);
profileUpdateError = new Error("Profile name unavailable");
await assert.rejects(
  () => store.saveMyApplication(liveApplyPayload),
  /Profile name unavailable/
);
assert.equal(applicationRows.has(authUser.id), false,
  "application must not be written after profile-name failure");
profileUpdateError = null;
```

- [ ] **Step 3: Run the live auth smoke test and verify failure**

Run:

```sh
node app/live-auth-smoke.mjs
```

Expected: FAIL because the live application lacks `full_name` and `saveMyApplication` does not update the profile.

- [ ] **Step 4: Render the required full-name field**

In `applyFormHtml`, derive the value from the draft first and profile second:

```js
const fullName = fields.full_name || cu?.profile?.full_name || "";
```

Add this as the first application field:

```js
${applyField(
  "text",
  "full_name",
  "Full name",
  true,
  fullName,
  'autocomplete="name" maxlength="120"'
)}
```

The existing generic draft collector automatically includes this named input.

- [ ] **Step 5: Persist the name before the application**

In `saveMyApplication`, after all existing application validation but before application upsert:

```js
const fullName = String(form.full_name || "").trim();
if (!fullName) throw new Error("Enter your full name");
if (fullName.length > 120) throw new Error("Full name must be 120 characters or fewer");
```

After building the application row and before writing it:

```js
const { data: savedProfile, error: profileError } = await supabase
  .from("profiles")
  .update({ full_name: fullName })
  .eq("id", cu.id)
  .select("*")
  .single();
if (profileError) throw profileError;
if (!savedProfile) throw new Error("Unable to save your full name");
liveProfile = savedProfile;
liveProfileFetchedAt = Date.now();
await getCurrentUser();

const { error } = await supabase.from("applications").upsert(row);
```

Keep `clearApplyDraft()` after both writes succeed.

- [ ] **Step 6: Run both smoke suites**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both PASS, including existing Admin role-update tests.

- [ ] **Step 7: Commit Task 3**

```sh
git add app/js/store.js app/js/views.js app/live-auth-smoke.mjs
git commit -m "feat(auth): save magic-link applicant names"
```

---

### Task 4: Document free-tier SMTP deployment and production acceptance

**Files:**
- Modify: `docs/runbooks/live-auth.md:1-110, 310-325`
- Modify: `README.md:30-50`

**Interfaces:**
- Consumes: magic-link behavior from Tasks 1-3 and the existing static Vercel/Supabase deployment seam.
- Produces: operator instructions that keep provider secrets out of the repository and block launch on identity duplication.

- [ ] **Step 1: Write the runbook section**

Add **Email magic links and custom SMTP** after redirect configuration, covering these exact operational requirements:

```markdown
## Email magic links and custom SMTP

Google remains the primary button. Email magic links are the secondary path
for members without Google accounts. Supabase Auth creates/verifies the token;
a custom transactional SMTP provider delivers the email.

1. Enable the Email provider in Supabase Authentication settings.
2. Create a transactional-email account on its current free tier (Resend is
   the initial candidate) and verify an ITC-controlled sending domain.
3. Publish the provider's SPF and DKIM records and enable DMARC monitoring.
4. Put SMTP host, port, username, password/API credential, and sender only in
   Supabase project SMTP settings. Never add them to `app/index.html` or Git.
5. Configure the exact local, preview, and production `/app/` redirect URLs.
6. Target a 15-minute link lifetime where supported and configure request
   throttling/cooldown.
7. Recheck provider quotas at deployment; free-tier terms can change.
```

Document the generic success copy, same-device phase-one support, expired-link retry, provider disable rollback, and the two required identity-continuity tests. State that rollout is blocked if the same exact email receives a second UUID.

- [ ] **Step 2: Update Google-only product wording**

Change README/runbook statements such as “a new Google profile” and “Google OAuth creates” to “Google OAuth or email magic-link authentication creates”, while preserving the pending/approval rule.

Do not change historical spec documents that intentionally describe the earlier Google-only phase.

- [ ] **Step 3: Review docs and source for secrets or stale claims**

Run:

```sh
rg -n "SMTP|magic link|Google profile|Google OAuth creates|API key|password" README.md docs/runbooks/live-auth.md app/js

git diff --check
```

Expected:

- No literal provider credential or token.
- Current operational docs describe both providers.
- Historical design docs remain untouched.
- No whitespace errors.

- [ ] **Step 4: Run final automated verification**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
git status --short
git diff --check
```

Expected: both smoke suites PASS; only intended documentation changes are uncommitted before the task commit; `git diff --check` prints nothing.

- [ ] **Step 5: Commit Task 4**

```sh
git add README.md docs/runbooks/live-auth.md
git commit -m "docs(auth): add magic-link deployment runbook"
```

---

### Task 5: Final branch verification and manual-deployment handoff

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a verified branch and an explicit list of dashboard/manual checks that cannot be proven by local smoke tests.

- [ ] **Step 1: Inspect the complete feature diff**

Run:

```sh
git diff --stat origin/testing...HEAD
git diff --check origin/testing...HEAD
git log --oneline origin/testing..HEAD
```

Expected: only the approved spec, plan, auth UI/store/tests, README, and live-auth runbook changes.

- [ ] **Step 2: Run fresh final tests**

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: both exit 0 with their success summaries.

- [ ] **Step 3: Record the remaining manual acceptance work in the completion report**

Report that these require the configured Supabase/SMTP environment and are not claimed as locally verified:

1. Branded email delivery and inbox/spam placement.
2. Expired, reused, and rate-limited link behavior.
3. Google-first then magic-link identity UUID continuity.
4. Magic-link-first then Google identity UUID continuity.
5. Safari/iOS, Chrome/Android, and desktop callback behavior.
6. Free-tier quota and provider terms at deployment time.
7. Provider-disable rollback while Google remains available.

Do not claim production readiness until these checks pass.
