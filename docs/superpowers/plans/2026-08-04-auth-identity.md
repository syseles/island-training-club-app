# Auth & Identity + Approval Workflow + Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship live Google OAuth sign-in, an admin panel for user/role management, and an approval workflow with audit log + welcome notification — replacing the prototype's frictionless email-only localStorage sign-in.

**Architecture:** Supabase (Postgres + Auth + RLS) on the back end; vanilla ES modules on the front end, with a thin shim in `store.js` that routes user-related reads/writes to Supabase when env vars are set and to localStorage otherwise. No build step. Specs: `2026-08-04-auth-identity-design.md` (A + D) and `2026-08-04-approval-workflow-design.md` (B).

**Tech Stack:** Supabase (Postgres, Auth, RLS, triggers), `@supabase/supabase-js` v2 loaded via esm.sh CDN, vanilla ES modules, Vercel hosting (env vars for prod).

## Global Constraints

These come from the spec and from AGENTS.md / the existing prototype. Every task implicitly honours them.

- **No build step, no bundler, no npm runtime deps installed locally.** Supabase JS comes from `https://esm.sh/@supabase/supabase-js@2` via a `<script type="module">` tag. No `package.json`, no `node_modules/`.
- **Vanilla ES modules.** All new code is `<script type="module">` ESM with `import`/`export`. No transpilation.
- **CSS class palette:** `.card`, `.kicker`, `.badge`, `.display`, `.btn`, `.muted`, `.section-head`. Re-use existing styles; do not introduce new utility classes.
- **Branch:** all work happens on `feature/auth-identity`. Commit messages use `feat: …`, `test: …`, `docs: …`, `fix: …`, `chore: …` prefixes.
- **Smoke test:** `node app/smoke.mjs` must pass before any task is declared done. Extend the test for each new behaviour.
- **Env vars:** `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` set via inline `<script>` in `app/index.html`; documented in `.env.example`. Production values come from Vercel's env-var UI. `SUPABASE_SERVICE_ROLE_KEY` is server-side only and never appears in this repo.
- **Demo data stays local.** `app/js/data.js` is unchanged. Live (`window.SUPABASE_URL` set) and local (unset) configurations both work; local falls back to localStorage + seeds.
- **RLS is the security model.** Every new table has RLS enabled; client code never uses the service-role key.
- **Store.js is the single seam.** All user-related reads/writes go through new exported functions in `store.js`; views call them, never `supabase.from(...)` directly.
- **Approval-criteria text and welcome copy are ⏳** (awaiting ITC leadership workshop). The implementation uses placeholders that the workshop fills in later — the data model supports the real text from day one.

## File Structure

**New files:**

- `supabase/migrations/20260804000000_profiles.sql` — A: profiles table, first-sign-in trigger, `touch_updated_at` trigger.
- `supabase/migrations/20260804000001_applications.sql` — B: applications table + `touch_updated_at` trigger.
- `supabase/migrations/20260804000002_audit_notifications.sql` — B: `role_changes`, `notifications`, `record_role_change` trigger.
- `supabase/migrations/20260804000003_rls.sql` — A + B: RLS policies for `profiles`, `applications`, `role_changes`, `notifications`.
- `app/js/config.js` — A: read `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY`; export a single `supabase` client (or `null` when unset).
- `app/js/auth.js` — A + B: small wrapper that re-exports `supabase.auth` + post-sign-in redirect helper.
- `app/js/runbook.js` — A + B: console-logged runbook summary on first load when running with `SUPABASE_URL` set (dev aid; not shipped to prod).
- `docs/runbooks/live-auth.md` — A + B: operational runbook (recover first-sign-in race, backfill profiles, second-admin bootstrap, teardown).

**Modified files:**

- `app/index.html` — A: inline `<script>` setting env vars (placeholder values for local dev), `<script type="module">` loading Supabase from esm.sh, `<script type="module" src="js/config.js">` before `js/app.js`.
- `app/js/store.js` — A + B: thin entry-point shim that routes user-related functions through Supabase when configured; new exports `getCurrentUser`, `signInWithGoogle`, `signOutLive`, `listProfiles`, `updateProfileRole`, `getMyApplication`, `saveMyApplication`, `listMyNotifications`, `markNotificationRead`. LocalStorage equivalents stay for local-dev parity.
- `app/js/views.js` — A + B + D: new `viewAccount` (replaces frictionless email with Google button when live), `viewApply`, `viewAdminUsers`, `viewNotifications`. Existing views continue to read `currentUser()`; new admin route uses `listProfiles()`.
- `app/js/app.js` — A + B + D: new routes `account` (refactor), `apply`, `admin/users`, `notifications`. Post-sign-in redirect to `/apply` for pending users without an application. Admin nav entry visible when role is admin+.
- `app/smoke.mjs` — A + B + D: extend with mocks for `window.supabase`, tests for the new views and the shim behaviour.
- `app/smoke.mjs` (continued) — A: tests for the OAuth-button / frictionless-email branching on the Account screen.
- `app/smoke.mjs` (continued) — B: tests for viewApply string output and the redirect-to-apply logic.
- `app/smoke.mjs` (continued) — D: tests for viewAdminUsers string output.
- `.env.example` — A: documents `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (with a comment that the last is server-only).
- `README.md` — A: short paragraph under a new "Live deployment" section pointing to the runbook.

**Out of scope for this plan** (deferred per spec):

- Migrating bookings / activities / donations to Postgres (sub-project C).
- Email / WhatsApp / push channels and policy text (sub-project E).
- Apple Sign-In or other providers.

---

## Task 1: Supabase migrations — profiles + first-sign-in bootstrap

**Files:**
- Create: `supabase/migrations/20260804000000_profiles.sql`

**Interfaces:**
- Consumes: nothing (first migration).
- Produces: `public.profiles` table, `public.handle_new_user()` function and `on_auth_user_created` trigger, `public.touch_updated_at()` function and `profiles_touch_updated_at` trigger.

- [ ] **Step 1: Create the migration directory and file**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write the profiles migration**

Copy the `Data model` section SQL from `docs/superpowers/specs/2026-08-04-auth-identity-design.md` (the `create table public.profiles …`, `handle_new_user()` function, `on_auth_user_created` trigger, `touch_updated_at()` function, `profiles_touch_updated_at` trigger) into `supabase/migrations/20260804000000_profiles.sql`. Do not modify any SQL; copy verbatim.

- [ ] **Step 3: Apply the migration to the Supabase project**

Either via the Supabase dashboard SQL editor (paste and run), or via `supabase db push` if the CLI is configured. Expected output: the editor reports success and lists `public.profiles` and the two triggers.

- [ ] **Step 4: Verify the migration in SQL**

In the Supabase SQL editor, run:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;
```

Expected: eight rows (`id`, `email`, `full_name`, `avatar_url`, `role`, `created_at`, `updated_at`) plus any system columns. Confirm the `role` check constraint is present:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'c';
```

Expected: a row named `profiles_role_check` with the `('pending','member','admin','super_admin')` clause.

- [ ] **Step 5: Verify the trigger fires on a dummy user insert**

This step uses the Supabase dashboard's "Authentication → Users → Add user" with a throwaway email. After adding, run:

```sql
select email, role from public.profiles;
```

Expected: one row, role = `super_admin` (because it is the first user, and the first-sign-in rule fires). If you accidentally run this step twice and now have two users, ask the owner before deleting one — deleting an auth.users row cascades to the profile.

- [ ] **Step 6: Reset to a clean state for downstream tasks**

If you created a dummy user in Step 5, delete it via Authentication → Users → Delete. The cascading delete should remove the matching profile row. Confirm with:

```sql
select count(*) from public.profiles;  -- expect 0
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260804000000_profiles.sql
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(supabase): profiles table + first-sign-in bootstrap trigger"
```

---

## Task 2: Supabase migrations — applications, audit log, notifications

**Files:**
- Create: `supabase/migrations/20260804000001_applications.sql`
- Create: `supabase/migrations/20260804000002_audit_notifications.sql`

**Interfaces:**
- Consumes: `public.profiles` (FK target).
- Produces: `public.applications`, `public.role_changes`, `public.notifications` tables; `record_role_change()` trigger.

- [ ] **Step 1: Write the applications migration**

Copy the `applications` portion of the `Data model` section from `docs/superpowers/specs/2026-08-04-approval-workflow-design.md` into `supabase/migrations/20260804000001_applications.sql`. Verbatim, including the `applications_minor_guardian` check constraint.

- [ ] **Step 2: Write the audit + notifications migration**

Copy the `role_changes`, `notifications`, `record_role_change()` function and `profiles_audit_role_change` trigger from the same spec section into `supabase/migrations/20260804000002_audit_notifications.sql`. Verbatim.

- [ ] **Step 3: Apply both migrations**

Apply `20260804000001` then `20260804000002`. Each should succeed.

- [ ] **Step 4: Verify tables and constraints**

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','applications','role_changes','notifications')
order by table_name;
```

Expected: four rows.

```sql
select conname from pg_constraint
where conrelid = 'public.applications'::regclass and contype = 'c';
```

Expected: row named `applications_minor_guardian`.

- [ ] **Step 5: Smoke-test the audit trigger via SQL**

```sql
-- Create a temporary first user (becomes super_admin).
insert into auth.users (id, email) values (gen_random_uuid(), 'temp1@example.test');
-- Manually create their profile.
insert into public.profiles (id, email, role)
values ((select id from auth.users where email = 'temp1@example.test'),
        'temp1@example.test', 'super_admin');
-- Insert a second user + profile.
insert into auth.users (id, email) values (gen_random_uuid(), 'temp2@example.test');
insert into public.profiles (id, email, role)
values ((select id from auth.users where email = 'temp2@example.test'),
        'temp2@example.test', 'pending');
-- Promote the second to member; this should fire the audit trigger.
update public.profiles
   set role = 'member'
 where email = 'temp2@example.test';

select email, old_role, new_role from public.role_changes rc
  join public.profiles p on p.id = rc.profile_id
 order by rc.created_at desc limit 5;
```

Expected: one row, `temp2@example.test`, `pending` → `member`.

```sql
select p.email, n.kind, n.title from public.notifications n
  join public.profiles p on p.id = n.profile_id
 order by n.created_at desc limit 5;
```

Expected: one row for `temp2@example.test`, kind = `welcome`.

- [ ] **Step 6: Clean up the temp users**

```sql
delete from auth.users where email in ('temp1@example.test', 'temp2@example.test');
select count(*) from public.profiles;          -- expect 0
select count(*) from public.role_changes;      -- expect 0
select count(*) from public.notifications;     -- expect 0
```

Expected: all zero.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260804000001_applications.sql \
        supabase/migrations/20260804000002_audit_notifications.sql
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(supabase): applications, role_changes, notifications + audit trigger"
```

---

## Task 3: Supabase migrations — RLS policies

**Files:**
- Create: `supabase/migrations/20260804000003_rls.sql`

**Interfaces:**
- Consumes: all four tables from Tasks 1 and 2.
- Produces: RLS enabled on all four; policies per spec.

- [ ] **Step 1: Write the RLS migration**

Concatenate, in this order, the RLS blocks from both specs into `supabase/migrations/20260804000003_rls.sql`:

1. From `2026-08-04-auth-identity-design.md` — `Row-level security` section (`profiles` policies: `self read`, `admin read all`, `self update non-role`, `admin approve pending`, `super_admin update all`; the `enable row level security` line; the no-INSERT / no-DELETE comments).
2. From `2026-08-04-approval-workflow-design.md` — `Row-level security` section (`applications` policies: `self read application`, `self insert application`, `self update application`, `admin read all applications`; `role_changes` policies: `admin read role_changes`; `notifications` policies: `self read notifications`, `self mark notification read`; the corresponding `enable row level security` lines).

Keep every `coalesce(...)` exactly as written; do not refactor.

- [ ] **Step 2: Apply the migration**

Apply via the SQL editor or `supabase db push`. Should succeed.

- [ ] **Step 3: Verify RLS is enabled on every table**

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('profiles','applications','role_changes','notifications')
  and relnamespace = 'public'::regnamespace
order by relname;
```

Expected: every row has `relrowsecurity = true` and `relforcerowsecurity = false`.

- [ ] **Step 4: Verify the policy list**

```sql
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Expected: at minimum the following policies (use this as the spec to count against):

| Table | Policies |
|---|---|
| `profiles` | `self read`, `admin read all`, `self update non-role`, `admin approve pending`, `super_admin update all` |
| `applications` | `self read application`, `self insert application`, `self update application`, `admin read all applications` |
| `role_changes` | `admin read role_changes` |
| `notifications` | `self read notifications`, `self mark notification read` |

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260804000003_rls.sql
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(supabase): RLS policies for profiles, applications, role_changes, notifications"
```

---

## Task 4: Env-var loading and Supabase client init

**Files:**
- Create: `app/js/config.js`
- Create: `.env.example`
- Modify: `app/index.html` (add three `<script>` tags: env vars, Supabase CDN, `config.js`)

**Interfaces:**
- Consumes: `window.SUPABASE_URL`, `window.SUPABASE_ANON_KEY` (set by an inline script in `index.html`); `window.supabase` (loaded from CDN).
- Produces: `import { supabase } from "./config.js"` — a `SupabaseClient | null` value (`null` when env vars are missing).

- [ ] **Step 1: Create `app/js/config.js`**

```javascript
// app/js/config.js
// Reads env vars injected via inline <script> in index.html and returns a
// configured Supabase client, or null when running without Supabase (local
// prototype). Exposes a single `supabase` named export so call-sites import
// it the same way regardless of configuration.

export const config = {
  url: typeof window !== "undefined" ? window.SUPABASE_URL || null : null,
  anonKey: typeof window !== "undefined" ? window.SUPABASE_ANON_KEY || null : null,
};

export const supabase = config.url && config.anonKey && window.supabase
  ? window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "itc.supabase.session",
      },
    })
  : null;

export const isLive = supabase !== null;
```

- [ ] **Step 2: Create `.env.example`**

```
# Copy to your local environment (Vercel uses its own env-var UI for prod).

# Public: shipped to the browser. Safe to commit the values you use in
# production; RLS protects the data behind them.
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-PUBLIC-ANON-KEY

# Server-side only. NEVER commit, NEVER expose to the browser.
# Used by future admin scripts only.
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 3: Update `app/index.html`**

Add three new tags. Place the env-var script and the Supabase CDN script in `<head>` before the existing `styles.css` link is fine; place `js/config.js` before `js/app.js` at the bottom of `<body>`.

```html
  <link rel="stylesheet" href="styles.css">
  <script>
    // Replace these placeholder values with real ones for live deployment.
    // Vercel injects these via its env-var UI in production; locally you can
    // edit this block or wrap it with a build-time substitution.
    window.SUPABASE_URL = "";
    window.SUPABASE_ANON_KEY = "";
  </script>
  <script type="module" src="https://esm.sh/@supabase/supabase-js@2"></script>
</head>
```

```html
  <script type="module" src="js/config.js"></script>
  <script type="module" src="js/app.js"></script>
```

- [ ] **Step 4: Smoke test — `supabase` is null when env vars are empty**

Append to `app/smoke.mjs`:

```javascript
// --- Supabase config (no env vars set) ---
const cfg = await import("./js/config.js");
if (cfg.supabase !== null) {
  failures++;
  console.error("FAIL config: supabase should be null when env vars unset");
} else {
  console.log("ok  config: supabase is null when env vars unset");
}
if (cfg.isLive !== false) {
  failures++;
  console.error("FAIL config: isLive should be false when env vars unset");
} else {
  console.log("ok  config: isLive is false when env vars unset");
}
```

Run: `cd app && node smoke.mjs`
Expected: both `ok` lines appear; `failures` count does not increase.

- [ ] **Step 5: Smoke test — `supabase` is a client when env vars are set and the CDN script loaded**

Append to `app/smoke.mjs` (after the Step 4 block):

```javascript
// --- Supabase config (env vars set, CDN stubbed) ---
const memSupa = { createClient: (u, k, opts) => ({ __client: true, url: u, key: k, opts }) };
globalThis.window = globalThis.window || {};
// Persist any existing window.supabase so we can restore it.
const _origSupa = window.supabase;
window.supabase = memSupa;
window.SUPABASE_URL = "https://test.supabase.co";
window.SUPABASE_ANON_KEY = "test-anon-key";
// Re-import config fresh — ES module cache will not re-run the module, so
// instead we re-evaluate by appending a query string.
const cfg2 = await import("./js/config.js?v=2");
if (!cfg2.supabase || !cfg2.supabase.__client) {
  failures++;
  console.error("FAIL config: supabase should be a client when env vars set");
} else {
  console.log("ok  config: supabase client created with provided url/key");
}
if (cfg2.isLive !== true) {
  failures++;
  console.error("FAIL config: isLive should be true when env vars set");
} else {
  console.log("ok  config: isLive is true when env vars set");
}
// Restore.
window.supabase = _origSupa;
delete window.SUPABASE_URL;
delete window.SUPABASE_ANON_KEY;
```

Run: `cd app && node smoke.mjs`
Expected: four `ok` lines total from Steps 4 and 5; `failures` unchanged from before Step 4.

- [ ] **Step 6: Commit**

```bash
git add app/js/config.js .env.example app/index.html app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat: supabase client init from window env vars"
```

---

## Task 5: store.js shim — auth helpers (A)

**Files:**
- Modify: `app/js/store.js` — add new exports; do not remove existing exports.

**Interfaces:**
- Consumes: `supabase` from `./config.js`.
- Produces:
  - `getCurrentUser()` → `Promise<{ id: string, email: string, role: 'pending'|'member'|'admin'|'super_admin', profile: object } | null>`
  - `signInWithGoogle()` → `Promise<void>` — triggers OAuth redirect.
  - `signOutLive()` → `Promise<void>` — clears Supabase session.

The existing `currentUser()` (localStorage-based) stays; the new helpers are added alongside.

- [ ] **Step 1: Add the import and the live-mode gate at the top of `store.js`**

After the existing imports from `./data.js`, add:

```javascript
import { supabase, isLive } from "./config.js";

// Local-storage user → in-memory cached live profile for the session.
let liveProfile = null;
let liveProfileFetchedAt = 0;
const LIVE_PROFILE_TTL_MS = 30_000;
```

- [ ] **Step 2: Add `getCurrentUser`**

Insert after the existing `currentUser()` export (around line 187):

```javascript
export async function getCurrentUser() {
  if (!isLive || !supabase) return currentUser();
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !sessData.session) return null;
  const authUser = sessData.session.user;
  // Cache the profile fetch for the session to avoid hammering the DB.
  if (!liveProfile || Date.now() - liveProfileFetchedAt > LIVE_PROFILE_TTL_MS) {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profErr) return null;
    liveProfile = prof || {
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata?.full_name || null,
      avatar_url: authUser.user_metadata?.avatar_url || null,
      role: "pending",
    };
    liveProfileFetchedAt = Date.now();
  }
  return {
    id: liveProfile.id,
    email: liveProfile.email,
    role: liveProfile.role,
    profile: liveProfile,
  };
}
```

- [ ] **Step 3: Add `signInWithGoogle`**

```javascript
export async function signInWithGoogle() {
  if (!isLive || !supabase) {
    throw new Error("signInWithGoogle requires SUPABASE_URL and SUPABASE_ANON_KEY");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/app/` },
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Add `signOutLive`**

```javascript
export async function signOutLive() {
  if (!isLive || !supabase) return signOut();
  liveProfile = null;
  liveProfileFetchedAt = 0;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
```

- [ ] **Step 5: Extend `signOut` to also clear live state**

Modify the existing `signOut` (around line 211) to reset the live cache:

```javascript
export function signOut() {
  liveProfile = null;
  liveProfileFetchedAt = 0;
  state.sessionUserId = null;
  save();
}
```

- [ ] **Step 6: Smoke test — getCurrentUser falls back to localStorage when not live**

Append to `app/smoke.mjs`:

```javascript
// --- store.getCurrentUser fallback (local mode) ---
store.signOut();
const localUser = await store.getCurrentUser();
const localCu = store.currentUser();
if (!localUser || localUser.id !== localCu.id) {
  failures++;
  console.error("FAIL getCurrentUser: should mirror currentUser() in local mode");
} else {
  console.log("ok  getCurrentUser: mirrors currentUser() in local mode");
}
```

Run: `cd app && node smoke.mjs`
Expected: `ok` line; failures unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/js/store.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(store): supabase-backed getCurrentUser, signInWithGoogle, signOutLive"
```

---

## Task 6: Account screen — Google sign-in button (A)

**Files:**
- Modify: `app/js/views.js` — refactor `viewAccount` to branch on `isLive`.

**Interfaces:**
- Consumes: `getCurrentUser`, `signInWithGoogle` from `store.js`; `isLive` from `config.js`.
- Produces: a string from `viewAccount()` that contains a "Continue with Google" button when live and the existing email field when local.

- [ ] **Step 1: Read the current `viewAccount`**

Open `app/js/views.js`. Find the `viewAccount` function (search for `export function viewAccount`). Note its current structure so the rewrite preserves copy and class names.

- [ ] **Step 2: Add `isLive` import at the top of `views.js`**

```javascript
import { isLive } from "./config.js";
```

- [ ] **Step 3: Branch `viewAccount` on `isLive`**

Replace the existing `viewAccount` body with:

```javascript
export function viewAccount() {
  const cu = currentUser();
  if (cu) return viewAccountSignedIn(cu);
  if (isLive) return viewAccountSignInLive();
  return viewAccountSignInLocal();
}

function viewAccountSignInLive() {
  return `
    <section class="card">
      <p class="kicker">Account</p>
      <h2 class="display">Sign in</h2>
      <p class="muted">Use your Google account to sign in to Island Training Club. New here? You'll be guided through a short application after sign-in.</p>
      <button class="btn btn-primary" data-action="sign-in-google">Continue with Google</button>
    </section>
  `;
}

function viewAccountSignInLocal() {
  // The existing email-only sign-in UI — preserve verbatim from the current
  // viewAccount implementation. The seed accounts (owner@itc.hk, etc.)
  // continue to work in local dev.
  /* …existing email sign-in markup… */
}
```

The local-mode function body must be the same string the existing `viewAccount` returns when no user is signed in. Copy it verbatim.

- [ ] **Step 4: Wire the button click in `app.js`**

In `app/js/app.js`, find the existing click-delegation handler (search for `data-action`). Add:

```javascript
if (target.matches('[data-action="sign-in-google"]')) {
  import("./store.js").then(({ signInWithGoogle }) => signInWithGoogle());
  return;
}
```

- [ ] **Step 5: Smoke test — Account view shows the Google button in live mode**

Append to `app/smoke.mjs`:

```javascript
// --- viewAccount live-mode branch ---
// Stub isLive via a re-import with a different query string is not enough
// because views.js captures isLive at module load. Instead, patch the
// module's named export by mutating the cache.
const viewsMod = await import("./js/views.js?v=account-live");
// The views module re-reads isLive inside viewAccount(), so flipping the
// config module's isLive is sufficient.
globalThis.window = globalThis.window || {};
const cfgMod = await import("./js/config.js");
const _origIsLive = cfgMod.isLive;
Object.defineProperty(cfgMod, "isLive", { value: true, configurable: true });
const liveHtml = viewsMod.viewAccount();
if (!liveHtml.includes("Continue with Google")) {
  failures++;
  console.error("FAIL viewAccount (live): should contain Continue with Google");
} else {
  console.log("ok  viewAccount (live): contains Continue with Google");
}
Object.defineProperty(cfgMod, "isLive", { value: _origIsLive, configurable: true });
```

Run: `cd app && node smoke.mjs`
Expected: `ok` line.

- [ ] **Step 6: Commit**

```bash
git add app/js/views.js app/js/app.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(account): google sign-in button in live mode; keep email fallback locally"
```

---

## Task 7: First-sign-in bootstrap — verification (A)

**Files:** none (Task 1 produced the trigger; this task is verification + ops).

**Interfaces:** the `auth.users → profiles` trigger from Task 1.

- [ ] **Step 1: Sign in with two Google accounts on the staging deployment**

Use two distinct Google accounts. The owner should be first. If you accidentally use a non-owner account first, abort and follow the recovery snippet in `docs/runbooks/live-auth.md` (added in Task 13).

- [ ] **Step 2: Verify in Supabase SQL**

```sql
select email, role from public.profiles order by created_at;
```

Expected: exactly two rows. The first is `super_admin`, the second is `pending`.

- [ ] **Step 3: Document a third-admin bootstrap path**

This is a documentation step; implementation of the SQL snippet goes into the runbook in Task 13.

- [ ] **Step 4: No commit (no code changes in this task)**

If the verification in Step 2 fails, fix the trigger from Task 1 and amend Task 1's commit.

---

## Task 8: Admin panel — list + approve (D)

**Files:**
- Modify: `app/js/store.js` — add `listProfiles`, `updateProfileRole`.
- Modify: `app/js/views.js` — add `viewAdminUsers`.
- Modify: `app/js/app.js` — wire `/admin/users` route and click handlers.
- Modify: `app/smoke.mjs` — tests for the view and the role-mutation flow.

**Interfaces:**
- `listProfiles()` → `Promise<Array<ProfileRow>>` — admin/super_admin only; throws on RLS denial.
- `listRoleChanges()` → `Promise<Array<RoleChangeRow>>` — admin/super_admin only; latest change first.
- `updateProfileRole(profileId, newRole, reason?)` → `Promise<void>` — admin can only set role to `'member'` when current role is `'pending'`; super_admin can set any role.
- `viewAdminUsers()` → string — HTML with pending and members lists.

- [ ] **Step 1: Add `listProfiles` to store.js**

```javascript
export async function listProfiles() {
  if (!isLive || !supabase) return allUsers();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 2: Add `listRoleChanges` to store.js**

```javascript
export async function listRoleChanges() {
  if (!isLive || !supabase) return [];
  const { data, error } = await supabase
    .from("role_changes")
    .select("*, changed_by_profile:changed_by(email, full_name)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 3: Add `updateProfileRole` to store.js**

```javascript
export async function updateProfileRole(profileId, newRole, reason) {
  if (!isLive || !supabase) {
    setRole(profileId, newRole);
    return;
  }
  const updates = { role: newRole };
  const { error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", profileId);
  if (error) throw error;
  // The DB trigger writes role_changes + welcome notification automatically.
  // `reason` is logged client-side to the console for now; a future Task
  // adds a reason field to the audit log via an RPC. ⏳
  if (reason) console.info("role update reason:", reason);
}
```

- [ ] **Step 4: Add `viewAdminUsers` to views.js**

```javascript
export async function viewAdminUsers() {
  const cu = await getCurrentUser();
  if (!cu || !["admin", "super_admin"].includes(cu.role)) {
    return `<section class="card"><p class="muted">You don't have access to this page.</p></section>`;
  }
  const [profiles, audit] = await Promise.all([listProfiles(), listRoleChanges()]);
  const latestByProfile = new Map();
  for (const row of audit) {
    if (!latestByProfile.has(row.profile_id)) latestByProfile.set(row.profile_id, row);
  }
  const pending = profiles.filter((p) => p.role === "pending");
  const members = profiles.filter((p) => p.role !== "pending");
  const counts = {
    pending: pending.length,
    member: profiles.filter((p) => p.role === "member").length,
    admin: profiles.filter((p) => p.role === "admin").length,
    super: profiles.filter((p) => p.role === "super_admin").length,
  };
  return `
    <section class="card">
      <p class="kicker">Admin</p>
      <h2 class="display">Users</h2>
      <p class="muted">${counts.pending} pending · ${counts.member} members · ${counts.admin} admins · ${counts.super} super admin</p>
    </section>
    ${pendingSection(pending, cu)}
    ${membersSection(members, cu, latestByProfile)}
  `;
}

function pendingSection(rows, cu) {
  if (rows.length === 0) {
    return `<section class="card"><p class="muted">No pending applicants.</p></section>`;
  }
  return `
    <section class="card">
      <h3 class="section-head">Pending applicants</h3>
      ${rows.map((p) => `
        <div class="row" data-profile-id="${p.id}">
          <img class="avatar" src="${p.avatar_url || ""}" alt="">
          <div class="row-body">
            <strong>${escapeHtml(p.full_name || p.email)}</strong>
            <span class="muted">${escapeHtml(p.email)} · joined ${fmtDate(p.created_at)}</span>
          </div>
          ${cu.role === "admin" || cu.role === "super_admin"
            ? `<button class="btn btn-primary" data-action="approve" data-id="${p.id}">Approve</button>`
            : ""}
        </div>
      `).join("")}
    </section>
  `;
}

function membersSection(rows, cu, latestByProfile) {
  if (rows.length === 0) {
    return `<section class="card"><p class="muted">No members yet.</p></section>`;
  }
  return `
    <section class="card">
      <h3 class="section-head">Members & admins</h3>
      ${rows.map((p) => renderMemberRow(p, cu, latestByProfile.get(p.id))).join("")}
    </section>
  `;
}

function renderMemberRow(p, cu, lastChange) {
  const isSelf = p.id === cu.id;
  const actions = [];
  if (!isSelf && cu.role === "super_admin") {
    if (p.role === "member") actions.push(`<button class="btn" data-action="promote" data-id="${p.id}">Promote to admin</button>`);
    if (p.role === "admin")  actions.push(`<button class="btn" data-action="demote"  data-id="${p.id}">Demote to member</button>`);
    if (p.role !== "super_admin") actions.push(`<button class="btn btn-danger" data-action="revoke" data-id="${p.id}">Revoke</button>`);
  }
  const auditLine = lastChange
    ? `<span class="muted">Last change: ${escapeHtml(lastChange.old_role)} → ${escapeHtml(lastChange.new_role)} on ${fmtDate(lastChange.created_at)}${lastChange.changed_by_profile ? ` by ${escapeHtml(lastChange.changed_by_profile.full_name || lastChange.changed_by_profile.email)}` : ""}${lastChange.reason ? ` — “${escapeHtml(lastChange.reason)}”` : ""}</span>`
    : "";
  return `
    <div class="row" data-profile-id="${p.id}">
      <img class="avatar" src="${p.avatar_url || ""}" alt="">
      <div class="row-body">
        <strong>${escapeHtml(p.full_name || p.email)}</strong>
        <span class="muted">${escapeHtml(p.email)} · ${escapeHtml(p.role)} · joined ${fmtDate(p.created_at)}</span>
        ${auditLine}
        ${isSelf ? `<span class="muted">You can't change your own role.</span>` : ""}
      </div>
      <div class="row-actions">${actions.join("")}</div>
    </div>
  `;
}
```

`escapeHtml`, `fmtDate` already exist in `data.js` and `views.js`; import what you need.

- [ ] **Step 5: Wire `/admin/users` route and click handlers in app.js**

```javascript
// Add to the router switch:
if (hash === "#/admin/users") {
  document.getElementById("view").innerHTML = await views.viewAdminUsers();
  return;
}

// Add to the click handler:
async function adminAction(target, role, successMsg) {
  const id = target.dataset.id;
  try {
    await store.updateProfileRole(id, role);
    toast(successMsg);
    route();
  } catch (err) {
    toast(err.message || "Action failed");
  }
}
if (target.matches('[data-action="approve"]')) {
  adminAction(target, "member", "Approved.");
  return;
}
if (target.matches('[data-action="promote"]')) {
  adminAction(target, "admin", "Promoted to admin.");
  return;
}
if (target.matches('[data-action="demote"]')) {
  adminAction(target, "member", "Demoted to member.");
  return;
}
if (target.matches('[data-action="revoke"]')) {
  const id = target.dataset.id;
  const profile = await store.listProfiles().then((all) => all.find((p) => p.id === id));
  const typed = window.prompt(`Type the user's email to confirm revocation: ${profile?.email || ""}`);
  if (typed !== profile?.email) return;
  try {
    await store.updateProfileRole(id, "pending");
    toast("Revoked.");
    route();
  } catch (err) {
    toast(err.message || "Revoke failed");
  }
  return;
}
```

- [ ] **Step 6: Show "Admin" in the bottom nav for admin+ roles**

In `app.js`, where the bottom nav is rendered (search for `bottom-nav` or `renderNav`), add a conditional entry:

```javascript
const cu = await getCurrentUser();
if (cu && ["admin", "super_admin"].includes(cu.role)) {
  navItems.push({ label: "Admin", hash: "#/admin/users" });
}
```

- [ ] **Step 7: Smoke test — viewAdminUsers string output for an admin viewer**

Append to `app/smoke.mjs`. Stub `getCurrentUser`, `listProfiles`, and `updateProfileRole`:

```javascript
// --- viewAdminUsers smoke ---
const storeStub = await import("./js/store.js");
const _origGetCu = storeStub.getCurrentUser;
const _origList  = storeStub.listProfiles;
const _origUpd   = storeStub.updateProfileRole;
storeStub.getCurrentUser = async () => ({ id: "u-admin", role: "admin" });
storeStub.listProfiles   = async () => ([
  { id: "u-admin",  email: "admin@itc.hk", full_name: "Admin", avatar_url: "", role: "admin", created_at: "2026-01-01" },
  { id: "u-pend",   email: "new@itc.hk",   full_name: "New Applicant", avatar_url: "", role: "pending", created_at: "2026-08-01" },
  { id: "u-member", email: "mem@itc.hk",   full_name: "Member", avatar_url: "", role: "member", created_at: "2026-07-01" },
]);
const adminHtml = await viewsMod.viewAdminUsers();
if (!adminHtml.includes("Pending applicants") || !adminHtml.includes("Approve") || !adminHtml.includes("1 pending · 1 members · 1 admins · 0 super admin")) {
  failures++;
  console.error("FAIL viewAdminUsers: missing sections");
} else {
  console.log("ok  viewAdminUsers: contains pending list, approve, summary");
}
// Restore.
storeStub.getCurrentUser = _origGetCu;
storeStub.listProfiles   = _origList;
storeStub.updateProfileRole = _origUpd;
```

Run: `cd app && node smoke.mjs`
Expected: `ok` line.

- [ ] **Step 8: Smoke test — viewAdminUsers blocks non-admins**

```javascript
storeStub.getCurrentUser = async () => ({ id: "u-member", role: "member" });
const memberHtml = await viewsMod.viewAdminUsers();
if (!memberHtml.includes("don't have access")) {
  failures++;
  console.error("FAIL viewAdminUsers: should block non-admins");
} else {
  console.log("ok  viewAdminUsers: blocks non-admins");
}
storeStub.getCurrentUser = _origGetCu;
```

Run: `cd app && node smoke.mjs`
Expected: new `ok` line; total failures unchanged from Step 7.

- [ ] **Step 9: Smoke test — viewAdminUsers surfaces the latest audit row**

```javascript
storeStub.getCurrentUser = async () => ({ id: "u-admin", role: "admin" });
storeStub.listProfiles = async () => ([
  { id: "u-member", email: "mem@itc.hk", full_name: "Member", avatar_url: "", role: "member", created_at: "2026-07-01" },
]);
const _origLrc = storeStub.listRoleChanges;
storeStub.listRoleChanges = async () => ([
  { profile_id: "u-member", old_role: "pending", new_role: "member",
    created_at: "2026-08-01T00:00:00Z", reason: null,
    changed_by_profile: { email: "admin@itc.hk", full_name: "Admin" } },
]);
const auditHtml = await viewsMod.viewAdminUsers();
if (!auditHtml.includes("Last change") || !auditHtml.includes("pending → member") || !auditHtml.includes("by Admin")) {
  failures++;
  console.error("FAIL viewAdminUsers: should surface latest audit row");
} else {
  console.log("ok  viewAdminUsers: surfaces latest audit row");
}
storeStub.listRoleChanges = _origLrc;
```

Run: `cd app && node smoke.mjs`
Expected: new `ok` line.

- [ ] **Step 10: Commit**

```bash
git add app/js/store.js app/js/views.js app/js/app.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(admin): /admin/users list, approve/promote/demote/revoke actions"
```

---

## Task 9: Application form (B)

**Files:**
- Modify: `app/js/store.js` — add `getMyApplication`, `saveMyApplication`.
- Modify: `app/js/views.js` — add `viewApply`.
- Modify: `app/js/app.js` — wire `/apply` route and submit handler.
- Modify: `app/smoke.mjs` — tests.

**Interfaces:**
- `getMyApplication()` → `Promise<ApplicationRow | null>`
- `saveMyApplication(form)` → `Promise<void>` — inserts or updates the row keyed to `auth.uid()`.
- `viewApply()` → string — the form HTML (or "Awaiting review" state if already submitted and still pending).

- [ ] **Step 1: Add `getMyApplication` and `saveMyApplication` to store.js**

```javascript
export async function getMyApplication() {
  if (!isLive || !supabase) return null;
  const cu = await getCurrentUser();
  if (!cu) return null;
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("profile_id", cu.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveMyApplication(form) {
  if (!isLive || !supabase) {
    throw new Error("saveMyApplication requires live mode");
  }
  const cu = await getCurrentUser();
  if (!cu) throw new Error("Not signed in");
  const isMinor = computeIsMinor(form.date_of_birth);
  const row = {
    profile_id: cu.id,
    mobile: form.mobile,
    date_of_birth: form.date_of_birth,
    is_minor: isMinor,
    guardian_name: isMinor ? form.guardian_name : null,
    guardian_phone: isMinor ? form.guardian_phone : null,
    emergency_name: form.emergency_name,
    emergency_phone: form.emergency_phone,
    heard_source: form.heard_source,
    heard_detail: form.heard_detail || null,
    preferred_name: form.preferred_name || null,
    photo_consent: !!form.photo_consent,
    waiver_accepted_at: new Date().toISOString(),
    privacy_accepted_at: new Date().toISOString(),
    guidelines_accepted_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("applications").upsert(row);
  if (error) throw error;
}

function computeIsMinor(dob) {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age < 18;
}
```

- [ ] **Step 2: Add `viewApply` to views.js**

```javascript
export async function viewApply() {
  const cu = await getCurrentUser();
  if (!cu) return `<section class="card"><p class="muted">Please sign in first.</p></section>`;
  if (cu.role !== "pending") {
    return `<section class="card"><p class="muted">Your application has already been processed.</p></section>`;
  }
  const existing = await store.getMyApplication();
  if (existing) {
    return `
      <section class="card">
        <p class="kicker">Application</p>
        <h2 class="display">Awaiting review</h2>
        <p class="muted">Your application was submitted on ${fmtDate(existing.submitted_at)}. An admin will review it shortly.</p>
      </section>
    `;
  }
  return applyFormHtml();
}

function applyFormHtml() {
  return `
    <section class="card">
      <p class="kicker">Application</p>
      <h2 class="display">Tell us about you</h2>
      <p class="muted">We collect this so the team can approve your application and reach you in an emergency.</p>
      <form data-form="apply" class="form-grid">
        ${textField("mobile", "Mobile / WhatsApp number", true)}
        ${dateField("date_of_birth", "Date of birth", true)}
        <div data-minor-only hidden>
          ${textField("guardian_name", "Guardian name", true)}
          ${textField("guardian_phone", "Guardian phone", true)}
        </div>
        ${textField("emergency_name", "Emergency contact name", true)}
        ${textField("emergency_phone", "Emergency contact phone", true)}
        ${selectField("heard_source", "How did you hear about ITC?", ["friend","family","search","social","event","other"], true)}
        ${textField("heard_detail", "Detail (optional)", false)}
        ${textField("preferred_name", "Preferred name (optional)", false)}
        <label class="check"><input type="checkbox" name="photo_consent"> I consent to photos/videos of me being used on ITC channels. (Optional)</label>
        <label class="check"><input type="checkbox" name="waiver" required> I accept the participation waiver. (⏳ text pending ITC review)</label>
        <label class="check"><input type="checkbox" name="privacy" required> I accept the privacy policy. (⏳ text pending ITC review)</label>
        <label class="check"><input type="checkbox" name="guidelines" required> I accept the community guidelines. (⏳ text pending ITC review)</label>
        <button class="btn btn-primary" type="submit">Submit application</button>
      </form>
    </section>
  `;
}

function textField(name, label, required) {
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(label)}${required ? " *" : ""}</span>
      <input type="text" name="${name}" ${required ? "required" : ""}>
    </label>
  `;
}

function dateField(name, label, required) {
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(label)}${required ? " *" : ""}</span>
      <input type="date" name="${name}" ${required ? "required" : ""}>
    </label>
  `;
}

function selectField(name, label, options, required) {
  return `
    <label class="field">
      <span class="field-label">${escapeHtml(label)}${required ? " *" : ""}</span>
      <select name="${name}" ${required ? "required" : ""}>
        ${options.map((o) => `<option value="${o}">${escapeHtml(o)}</option>`).join("")}
      </select>
    </label>
  `;
}
```

- [ ] **Step 3: Wire `/apply` route and submit handler in app.js**

```javascript
// Router:
if (hash === "#/apply") {
  document.getElementById("view").innerHTML = await views.viewApply();
  wireApplyForm();
  return;
}

// Submit handler:
async function wireApplyForm() {
  const form = document.querySelector('[data-form="apply"]');
  if (!form) return;
  const dob = form.querySelector('[name="date_of_birth"]');
  const minorBlock = form.querySelector('[data-minor-only]');
  dob.addEventListener("change", () => {
    const age = computeAge(dob.value);
    minorBlock.hidden = !(age < 18);
    minorBlock.querySelectorAll("input").forEach((el) => el.required = !minorBlock.hidden);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.photo_consent = !!fd.get("photo_consent");
    try {
      await store.saveMyApplication(payload);
      route();
    } catch (err) {
      toast(err.message);
    }
  });
}

function computeAge(dob) {
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}
```

- [ ] **Step 4: Smoke test — viewApply string for a pending user with no application**

```javascript
// --- viewApply smoke (pending, no application) ---
const _origGetMy = storeStub.getMyApplication;
storeStub.getCurrentUser = async () => ({ id: "u-pending", role: "pending" });
storeStub.getMyApplication = async () => null;
const applyHtml = await viewsMod.viewApply();
if (!applyHtml.includes("Tell us about you") || !applyHtml.includes('data-form="apply"')) {
  failures++;
  console.error("FAIL viewApply: should render empty form for pending with no application");
} else {
  console.log("ok  viewApply: renders form for pending with no application");
}
storeStub.getMyApplication = _origGetMy;
```

Run: `cd app && node smoke.mjs`
Expected: `ok` line.

- [ ] **Step 5: Smoke test — viewApply string for a pending user who has submitted**

```javascript
storeStub.getMyApplication = async () => ({ submitted_at: "2026-08-01T00:00:00Z" });
const submittedHtml = await viewsMod.viewApply();
if (!submittedHtml.includes("Awaiting review")) {
  failures++;
  console.error("FAIL viewApply: should show Awaiting review when application exists");
} else {
  console.log("ok  viewApply: shows Awaiting review when application exists");
}
storeStub.getMyApplication = _origGetMy;
```

Run: `cd app && node smoke.mjs`
Expected: `ok` line.

- [ ] **Step 6: Commit**

```bash
git add app/js/store.js app/js/views.js app/js/app.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(apply): /apply form for pending users; submit saves to public.applications"
```

---

## Task 10: Post-sign-in redirect to /apply (B)

**Files:**
- Modify: `app/js/app.js` — add a post-sign-in check that routes pending-without-application users to `/apply`.
- Modify: `app/js/store.js` — extend `getCurrentUser` cache invalidation on sign-in event (already implicit via the live profile cache TTL; verify).

**Interfaces:** the OAuth callback flow ends at `route()`; the new logic happens after `getCurrentUser` succeeds.

- [ ] **Step 1: Add the redirect helper in app.js**

```javascript
async function maybeRedirectToApply() {
  if (!isLive) return;  // local mode: nothing to do
  const cu = await store.getCurrentUser();
  if (!cu || cu.role !== "pending") return;
  const app = await store.getMyApplication();
  if (!app && window.location.hash !== "#/apply") {
    window.location.hash = "#/apply";
  }
}
```

- [ ] **Step 2: Call it after the OAuth callback resolves**

The Supabase client surfaces `SIGNED_IN` and `SIGNED_OUT` events on `supabase.auth.onAuthStateChange`. Register a listener at boot:

```javascript
import { supabase, isLive } from "./config.js";

if (isLive && supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") maybeRedirectToApply();
  });
}
```

Place this near the top of `app.js`, after the imports.

- [ ] **Step 3: Also call it on initial page load**

In `app.js`'s boot function (search for the function that calls `route()` for the first time), after `route()`:

```javascript
await maybeRedirectToApply();
```

- [ ] **Step 4: Smoke test — maybeRedirectToApply routes pending-without-application to #/apply**

```javascript
// --- redirect-to-apply smoke ---
const _origHash = window.location.hash;
window.location.hash = "#/home";
const _origGetCu2 = storeStub.getCurrentUser;
const _origGetMy2 = storeStub.getMyApplication;
storeStub.getCurrentUser = async () => ({ id: "u-pend", role: "pending" });
storeStub.getMyApplication = async () => null;
// Reach into the module to call the helper.
const appMod = await import("./js/app.js?v=redirect");
await appMod.maybeRedirectToApply();
if (window.location.hash !== "#/apply") {
  failures++;
  console.error("FAIL redirect: should set hash to #/apply");
} else {
  console.log("ok  redirect: routes pending-without-application to /apply");
}
window.location.hash = _origHash;
storeStub.getCurrentUser = _origGetCu2;
storeStub.getMyApplication = _origGetMy2;
```

> **Note:** exporting `maybeRedirectToApply` from `app.js` is necessary for the smoke test. Add `export` to the declaration.

Run: `cd app && node smoke.mjs`
Expected: `ok` line.

- [ ] **Step 5: Commit**

```bash
git add app/js/app.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(apply): redirect pending users without application to /apply after sign-in"
```

---

## Task 11: Notifications view + welcome badge (B)

**Files:**
- Modify: `app/js/store.js` — add `listMyNotifications`, `markNotificationRead`.
- Modify: `app/js/views.js` — add `viewNotifications`, `unreadBadge`.
- Modify: `app/js/app.js` — wire `/notifications` route and badge.
- Modify: `app/smoke.mjs` — tests.

**Interfaces:**
- `listMyNotifications()` → `Promise<Array<NotificationRow>>` — own row only.
- `markNotificationRead(id)` → `Promise<void>`.
- `viewNotifications()` → string.
- `unreadBadge()` → string — empty when no unread; otherwise `<span class="badge">N</span>`.

- [ ] **Step 1: Add `listMyNotifications` and `markNotificationRead` to store.js**

```javascript
export async function listMyNotifications() {
  if (!isLive || !supabase) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id) {
  if (!isLive || !supabase) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Add `viewNotifications` to views.js**

```javascript
export async function viewNotifications() {
  const rows = await store.listMyNotifications();
  if (rows.length === 0) {
    return `<section class="card"><p class="muted">No notifications.</p></section>`;
  }
  return `
    <section class="card">
      <p class="kicker">Notifications</p>
      ${rows.map((n) => `
        <div class="row ${n.read_at ? "" : "row-unread"}" data-notification-id="${n.id}" data-action="notification-open">
          <div class="row-body">
            <strong>${escapeHtml(n.title)}</strong>
            <span class="muted">${escapeHtml(n.body)}</span>
            <span class="muted">${fmtDate(n.created_at)}</span>
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

export async function unreadBadge() {
  const rows = await store.listMyNotifications();
  const n = rows.filter((r) => !r.read_at).length;
  return n > 0 ? `<span class="badge">${n}</span>` : "";
}
```

- [ ] **Step 3: Wire `/notifications` route and badge in app.js**

```javascript
// Router:
if (hash === "#/notifications") {
  document.getElementById("view").innerHTML = await views.viewNotifications();
  return;
}

// Click handler:
if (target.matches('[data-action="notification-open"]')) {
  const id = target.closest("[data-notification-id]").dataset.notificationId;
  store.markNotificationRead(id).then(() => route());
  return;
}

// Bottom nav: add Notifications link for signed-in users (any role), with
// the unread badge as part of the label.
if (cu) {
  const badge = await views.unreadBadge();
  navItems.push({ label: `Notifications ${badge}`, hash: "#/notifications" });
}
```

- [ ] **Step 4: Smoke test — viewNotifications renders and marks unread**

```javascript
// --- viewNotifications smoke ---
const _origListN = storeStub.listMyNotifications;
const _origMark = storeStub.markNotificationRead;
storeStub.listMyNotifications = async () => ([
  { id: "n1", title: "Welcome", body: "Approved.", created_at: "2026-08-01T00:00:00Z", read_at: null },
  { id: "n2", title: "Old", body: "Old news.", created_at: "2026-07-01T00:00:00Z", read_at: "2026-07-02T00:00:00Z" },
]);
const notifHtml = await viewsMod.viewNotifications();
if (!notifHtml.includes("Welcome") || !notifHtml.includes("Old") || !notifHtml.includes("row-unread")) {
  failures++;
  console.error("FAIL viewNotifications: missing rows or unread class");
} else {
  console.log("ok  viewNotifications: renders rows with unread class");
}
const badge = await viewsMod.unreadBadge();
if (!badge.includes("1")) {
  failures++;
  console.error("FAIL unreadBadge: should show count of 1");
} else {
  console.log("ok  unreadBadge: shows unread count");
}
storeStub.listMyNotifications = _origListN;
storeStub.markNotificationRead = _origMark;
```

Run: `cd app && node smoke.mjs`
Expected: two `ok` lines.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/js/views.js app/js/app.js app/smoke.mjs
git -c user.email='selesli@local' -c user.name='selesli' commit -m "feat(notifications): /notifications view + unread badge on bottom nav"
```

---

## Task 12: End-to-end smoke verification

**Files:** none (this task runs existing smoke tests and verifies the full flow manually).

- [ ] **Step 1: Run the full smoke test**

```bash
cd app && node smoke.mjs
```

Expected: zero failures. The script prints a summary at the bottom; verify `failures` is `0`.

- [ ] **Step 2: Manual staging check — full sign-up → approve → welcome flow**

In order:

1. Sign in with a fresh Google account on the staging deployment.
2. Confirm you land on `/apply`.
3. Submit the form.
4. Confirm you land on home with "Awaiting review" copy gone (now on `/apply` shows "Awaiting review").
5. Sign out.
6. Sign in as the super_admin account.
7. Visit `/admin/users`. Confirm the new applicant appears in the pending list.
8. Click **Approve**.
9. Sign out. Sign in as the new applicant.
10. Confirm `/notifications` shows the welcome notification.
11. Mark it read. Confirm the badge updates.

- [ ] **Step 3: Verify role_changes audit row exists**

In the Supabase SQL editor:

```sql
select p.email, rc.old_role, rc.new_role, rc.created_at
from public.role_changes rc
join public.profiles p on p.id = rc.profile_id
order by rc.created_at desc limit 5;
```

Expected: at least one row for the new applicant, `pending → member`.

- [ ] **Step 4: No commit (verification only)**

If any step fails, file a fix in the relevant earlier task and amend that task's commit.

---

## Task 13: Operational runbook

**Files:**
- Create: `docs/runbooks/live-auth.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Create the runbook file**

```markdown
# Live Auth — Operational Runbook

This runbook covers the day-to-day operations of the live Supabase auth +
identity + admin panel + approval workflow stack on `feature/auth-identity`.

## Vercel env vars

Set in the Vercel project settings → Environment Variables:

- `SUPABASE_URL` — the project URL (e.g. `https://xyz.supabase.co`).
- `SUPABASE_ANON_KEY` — the project's anon key, safe to ship to the browser.

After updating env vars, redeploy. The placeholder values in `app/index.html`
are only used when no env vars are injected.

## Local development

For local dev, edit `app/index.html`'s inline `<script>` block to set
`window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` to your dev Supabase
project's values. Refresh the page after changes.

## First-sign-in caveat

The first Google sign-in on the live deployment becomes `super_admin`.
The owner must be literally first. If anyone else signs in first, recover
with:

```sql
update public.profiles
   set role = 'super_admin'
 where email = '<owner email>';
```

## Promote a second admin

Two paths:

- Via the admin panel: a super_admin signs in → `/admin/users` → find the
  member → **Promote to admin**. The DB trigger logs the change in
  `role_changes` automatically.
- Via SQL (when no super_admin exists yet):

```sql
update public.profiles
   set role = 'admin'
 where email = '<email>';
```

## Backfill profiles

If the trigger is added after some users already exist, run once:

```sql
insert into public.profiles (id, email, full_name, avatar_url, role)
select u.id, u.email,
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'avatar_url',
       'pending'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);
```

## Inspect audit log

```sql
select p.email, rc.old_role, rc.new_role, rc.reason, rc.created_at
from public.role_changes rc
join public.profiles p on p.id = rc.profile_id
order by rc.created_at desc;
```

## Inspect pending applications

```sql
select p.email, a.mobile, a.date_of_birth, a.is_minor, a.submitted_at
from public.applications a
join public.profiles p on p.id = a.profile_id
where p.role = 'pending'
order by a.submitted_at;
```

## Tear down and reseed the local project

```bash
supabase db reset                 # drops everything; replays migrations
supabase db push                  # pushes migrations to remote
```

## Edit placeholder copy

Until the ITC leadership workshop fills in the policy text, placeholder
copy lives in:

- `app/js/views.js` — `applyFormHtml()` (waiver / privacy / guidelines
  checkbox labels).
- `supabase/migrations/20260804000002_audit_notifications.sql` — the
  welcome notification title and body inside `record_role_change()`.

To update the welcome notification on already-deployed databases:

```sql
update public.notifications
   set body = '<new body text>'
 where kind = 'welcome' and read_at is null;
```

## Migrations

All schema lives in `supabase/migrations/` and is replayed in order by
`supabase db push`. Never edit a migration after it has been applied to
a shared environment — add a new one instead.

## ⏳ Awaiting ITC leadership workshop

The following copy is placeholdered until the workshop lands:

- Waiver acceptance text.
- Privacy policy text.
- Community guidelines text.
- Welcome notification body.
- Approval criteria wording (plausible, non-abusive).
- Hong Kong phone regex in `app/js/store.js` `saveMyApplication`.

The data model supports the real text from day one. Updating the text is
a small SQL or HTML edit per the Edit-placeholder-copy section above.
```

- [ ] **Step 2: Add a short pointer in `README.md`**

Find a good spot (after the existing project description). Add:

```markdown
## Live deployment

This prototype has a live Supabase-backed auth + admin panel + approval
workflow on the `feature/auth-identity` branch. To deploy, see
[`docs/runbooks/live-auth.md`](docs/runbooks/live-auth.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/live-auth.md README.md
git -c user.email='selesli@local' -c user.name='selesli' commit -m "docs: live auth operational runbook + README pointer"
```

---

## Task 14: Open the PR

**Files:** none (PR creation).

- [ ] **Step 1: Confirm the smoke test still passes**

```bash
cd app && node smoke.mjs
```

Expected: zero failures.

- [ ] **Step 2: Push the branch**

```bash
git push origin feature/auth-identity
```

- [ ] **Step 3: Open the PR**

Visit https://github.com/syseles/island-training-club-app/pull/new/feature/auth-identity

PR title: `Auth & identity + approval workflow + admin panel (A + B + D)`

PR body should reference both specs (`2026-08-04-auth-identity-design.md` and `2026-08-04-approval-workflow-design.md`) and note that:
- The data model + RLS + triggers are deployed in three migrations.
- Approval criteria text and policy copy are ⏳ awaiting the ITC leadership workshop.
- C (persistence migration) and E (policy & notifications) remain out of scope.

- [ ] **Step 4: No further commits until review**

Wait for owner review. Address feedback by amending or adding commits on the same branch.