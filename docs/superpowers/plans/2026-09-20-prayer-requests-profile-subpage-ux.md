# Private Prayer Requests and Profile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace device-only prayer submissions with a private, approved-member Supabase workflow and simplify redundant Schedule, Profile, and Admin hierarchy.

**Architecture:** A new private `prayer_requests` table is inaccessible to browser roles directly; five security-definer RPCs enforce approved-member ownership, Admin role checks, anonymity redaction, status transitions, and withdrawal erasure. `app/js/store.js` remains the single frontend seam and provides matching v23 local-mode behavior, while existing async render/delegation patterns supply member and Admin views.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, vanilla JavaScript ES modules, string-template views, delegated DOM handlers, `localStorage` local mode, Node smoke tests, shell safety tests, rollback-scoped SQL integration tests.

**Spec:** `docs/superpowers/specs/2026-09-20-prayer-requests-profile-subpage-ux-design.md`

## Global Constraints

- Submission is restricted to profiles whose authoritative role is `member`, `admin`, or `super_admin`.
- An anonymous request remains owner-linked in storage but returns no owner ID, email, or stable identity field through the Admin RPC.
- Direct `public`, `anon`, and `authenticated` access to `public.prayer_requests` is revoked; browser access is RPC-only.
- Request text is trimmed and limited to 1–2,000 characters in both client and database validation.
- Status values are exactly `new`, `prayed_for`, `closed`, and `withdrawn`.
- Admin transitions are `new → prayed_for`, `new → closed`, and `prayed_for → closed`; Admins never edit request text.
- Members may close active requests and withdraw any non-withdrawn owned request, including a closed request.
- Withdrawal atomically clears request text, clears `closed_at`, records `withdrawn_at`, and removes the row from Admin output.
- Historical device-only prayers are preserved locally and never uploaded automatically.
- No public prayer feed, comments, leader notes, email, SMS, WhatsApp, Web Push, or service worker.
- Supabase remains authoritative in live mode; never fall back to local prayer data after a live RPC failure.
- Apply and verify the database migration before deploying dependent frontend code.
- Do not replay historical production migrations blindly; apply and record only the reviewed new migration.
- Do not add Shop, merchandise, catalog, cart, or product imagery behavior.
- Do not add dependencies or a build step.

---

### Task 1: Private prayer-request database boundary

**Files:**
- Create: `supabase/migrations/20260921000001_prayer_requests.sql`
- Create: `supabase/tests/prayer_requests_integration.sql`
- Create: `supabase/tests/prayer_requests_safety.sh`

**Interfaces:**
- Consumes: `auth.uid()`, `public.profiles(id, full_name, role)`, authenticated role grants.
- Produces:
  - `public.submit_prayer_request(p_request_text text, p_anonymous_to_leaders boolean)`
  - `public.list_my_prayer_requests()`
  - `public.set_my_prayer_request_state(p_request_id uuid, p_action text)`
  - `public.list_admin_prayer_requests()`
  - `public.set_admin_prayer_request_status(p_request_id uuid, p_status text)`
- Member row columns: `id`, `request_text`, `anonymous_to_leaders`, `status`, `created_at`, `updated_at`, `closed_at`, `withdrawn_at`.
- Admin row columns: `id`, `display_name`, `request_text`, `anonymous_to_leaders`, `status`, `created_at`, `updated_at`, `closed_at`—never `owner_id` or email.

- [ ] **Step 1: Write the static safety test before the migration**

Create `supabase/tests/prayer_requests_safety.sh` with `set -euo pipefail`. Resolve the repository root and fail unless the migration contains all of these exact security markers:

```bash
migration="$repo_root/supabase/migrations/20260921000001_prayer_requests.sql"
test -f "$migration"
grep -qi 'enable row level security' "$migration"
grep -qi 'revoke all on table public.prayer_requests from public, anon, authenticated' "$migration"
for fn in submit_prayer_request list_my_prayer_requests set_my_prayer_request_state list_admin_prayer_requests set_admin_prayer_request_status; do
  grep -qi "security definer" "$migration"
  grep -qi "revoke all on function public.$fn" "$migration"
done
! grep -Eqi 'grant (select|insert|update|delete).*prayer_requests.*authenticated' "$migration"
! grep -Eqi 'list_admin_prayer_requests[\s\S]*(owner_id|email)' "$migration"
echo 'prayer-request migration safety passed'
```

Use bounded function extraction rather than one whole-file regex for the final two checks, so a legitimate `owner_id` elsewhere in the migration does not create a false result.

- [ ] **Step 2: Write the rollback-scoped SQL integration test**

Create `supabase/tests/prayer_requests_integration.sql`. Wrap fixtures and assertions in `begin; … rollback;`. Create five unique `auth.users`/`public.profiles` fixtures: pending, member A, member B, Admin, and Super Admin. Add a helper block that sets authenticated claims using the same `request.jwt.claim.sub` pattern already used by `operational_backend_integration.sql`.

The test must raise on every failed condition and cover:

```sql
-- pending submit fails
-- member A submits one identified and one anonymous request
-- member B submits one identified request
-- member A list returns exactly A's two rows
-- member B cannot mutate A's row
-- authenticated direct SELECT/INSERT/UPDATE/DELETE on the table fails
-- Admin list returns identified display names but "Anonymous member" for the anonymous row
-- Admin function result has no owner_id or email column
-- member role cannot call list_admin_prayer_requests or set_admin_prayer_request_status
-- Admin: new -> prayed_for; Super Admin: prayed_for -> closed
-- repeated/illegal Admin transition fails
-- member A can withdraw both active and closed owned rows
-- withdrawal nulls request_text, clears closed_at, sets withdrawn_at
-- withdrawn rows remain in member history and disappear from Admin output
```

Use explicit `if … then raise exception` assertions rather than pgTAP so the file runs in the existing PostgreSQL container without an extra extension.

- [ ] **Step 3: Run both new tests and observe the expected RED failures**

Run:

```bash
bash supabase/tests/prayer_requests_safety.sh
```

Expected: non-zero because `20260921000001_prayer_requests.sql` does not exist.

After starting a disposable local Supabase database with the repository CLI, run:

```bash
docker exec supabase_db_island-training-club-app \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f /tmp/prayer_requests_integration.sql
```

Expected: non-zero because the table/RPCs do not exist.

- [ ] **Step 4: Implement the table and constraints**

Create the migration with:

```sql
create table public.prayer_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_text text,
  anonymous_to_leaders boolean not null default false,
  status text not null default 'new'
    check (status in ('new', 'prayed_for', 'closed', 'withdrawn')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  withdrawn_at timestamptz,
  status_changed_by uuid references public.profiles(id) on delete set null,
  constraint prayer_request_text_state check (
    (status = 'withdrawn' and request_text is null)
    or
    (status <> 'withdrawn' and request_text is not null
      and char_length(btrim(request_text)) between 1 and 2000)
  ),
  constraint prayer_request_closed_state check (
    (status = 'closed') = (closed_at is not null)
  ),
  constraint prayer_request_withdrawn_state check (
    (status = 'withdrawn') = (withdrawn_at is not null)
  )
);

create index prayer_requests_owner_created_idx
  on public.prayer_requests (owner_id, created_at desc);
create index prayer_requests_status_created_idx
  on public.prayer_requests (status, created_at asc);

alter table public.prayer_requests enable row level security;
revoke all on table public.prayer_requests from public, anon, authenticated;
```

Do not add permissive table policies. The service role/database owner remains the trusted operational escape hatch.

- [ ] **Step 5: Implement approved-role and Admin assertions**

Add private security-definer helpers that read the profile row for `auth.uid()` and raise `42501` unless the role is allowed. Pin `search_path = public`, revoke execution from `public`, `anon`, and `authenticated`, and call the helpers only from the five public RPCs.

Approved roles:

```sql
role in ('member', 'admin', 'super_admin')
```

Administrative roles:

```sql
role in ('admin', 'super_admin')
```

- [ ] **Step 6: Implement the five RPCs**

Use table-returning functions with explicit columns rather than returning `public.prayer_requests%rowtype`.

Submission must normalize once:

```sql
v_request_text := btrim(coalesce(p_request_text, ''));
if char_length(v_request_text) not between 1 and 2000 then
  raise exception 'Prayer request must be between 1 and 2000 characters.'
    using errcode = '22023';
end if;
```

Member transitions must lock with `for update`. Withdrawal must use one update:

```sql
update public.prayer_requests
   set status = 'withdrawn',
       request_text = null,
       closed_at = null,
       withdrawn_at = clock_timestamp(),
       updated_at = clock_timestamp(),
       status_changed_by = auth.uid()
 where id = p_request_id
   and owner_id = auth.uid()
   and status <> 'withdrawn';
```

Admin listing must redact in SQL:

```sql
case
  when r.anonymous_to_leaders then 'Anonymous member'
  else coalesce(nullif(btrim(p.full_name), ''), 'Member')
end as display_name
```

Exclude `withdrawn` and do not return owner UUID/email. Order `new`, `prayed_for`, then `closed`; active rows oldest first and closed rows newest first.

Grant only the five public RPC signatures to `authenticated` after revoking them from `public`, `anon`, and `authenticated`.

- [ ] **Step 7: Run safety, clean migration, and SQL integration GREEN**

Run:

```bash
bash supabase/tests/prayer_requests_safety.sh
supabase stop --no-backup || true
supabase start --yes -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

Confirm the startup log applies every migration once and ends with `20260921000001_prayer_requests.sql`.

Copy the integration file into the disposable database container and run it with `ON_ERROR_STOP=1`. Expected final output includes `ROLLBACK` and exits zero.

- [ ] **Step 8: Commit the backend boundary**

```bash
git add supabase/migrations/20260921000001_prayer_requests.sql \
  supabase/tests/prayer_requests_integration.sql \
  supabase/tests/prayer_requests_safety.sh
git commit -m "feat(prayer): add private request backend"
```

---

### Task 2: Store seam and v23 local parity

**Files:**
- Modify: `app/js/store.js:49,136-220,450-650,2824-2840`
- Modify: `app/smoke.mjs:225-310,3370-3390,6780-6890`
- Modify: `app/live-auth-smoke.mjs` Supabase RPC fixtures and prayer assertions

**Interfaces:**
- Consumes the five RPCs from Task 1.
- Produces:

```js
submitPrayerRequest({ request, anonymousToLeaders = false })
listMyPrayerRequests()
setMyPrayerRequestState(requestId, action) // "close" | "withdraw"
listAdminPrayerRequests()
setAdminPrayerRequestStatus(requestId, status) // "prayed_for" | "closed"
```

- Normalized frontend row:

```js
{
  id,
  request,                 // string or null after withdrawal
  anonymousToLeaders,
  status,
  createdAt,
  updatedAt,
  closedAt,
  withdrawnAt,
  displayName,             // Admin rows only
}
```

- [ ] **Step 1: Add failing local-mode and migration tests**

In `app/smoke.mjs`, replace the old `recordPrayer` assertion with tests that:

```js
await assert.rejects(
  () => store.submitPrayerRequest({ request: "Please pray" }),
  /approved member/i
);

const identified = await store.submitPrayerRequest({
  request: "  Please pray for recovery.  ",
  anonymousToLeaders: false,
});
assert.equal(identified.request, "Please pray for recovery.");
assert.equal(identified.status, "new");

const anonymous = await store.submitPrayerRequest({
  request: "A private concern",
  anonymousToLeaders: true,
});
assert.equal((await store.listMyPrayerRequests()).length, 2);
const adminRows = await store.listAdminPrayerRequests();
assert.equal(adminRows.find((row) => row.id === anonymous.id).displayName, "Anonymous member");
assert.equal("ownerId" in adminRows.find((row) => row.id === anonymous.id), false);
```

Add owner-isolation, pending/declined rejection, Admin status, close, closed withdrawal, text erasure, and Admin exclusion assertions. Add a v22 snapshot containing historical prayer rows and assert v23 preserves IDs/text while adding `status: "new"`, `anonymousToLeaders: false`, and timestamps.

- [ ] **Step 2: Add failing live-mode RPC contract tests**

Extend the existing Supabase mock in `app/live-auth-smoke.mjs` to record RPC names/parameters and return Task 1 column shapes. Assert:

```js
await store.submitPrayerRequest({ request: "Prayer", anonymousToLeaders: true });
// rpc: submit_prayer_request
// params: { p_request_text: "Prayer", p_anonymous_to_leaders: true }

await store.setMyPrayerRequestState(PRAYER_ID, "withdraw");
// rpc: set_my_prayer_request_state
// params: { p_request_id: PRAYER_ID, p_action: "withdraw" }
```

Cover all five RPC names, safe row normalization, live failure propagation, and no fallback to `state.prayers` after a rejected RPC.

- [ ] **Step 3: Run the focused smoke suites RED**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: failures because `submitPrayerRequest` and the other new store exports do not exist and `STATE_VERSION` is still 22.

- [ ] **Step 4: Implement v23 migration and local helpers**

Set `STATE_VERSION = 23`. In `migrate()`, preserve every prayer and normalize only missing fields:

```js
if (v < 23) {
  state.prayers = state.prayers.map((row) => ({
    ...row,
    status: ["new", "prayed_for", "closed", "withdrawn"].includes(row.status)
      ? row.status : "new",
    anonymousToLeaders: row.anonymousToLeaders === true,
    createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(row.updatedAt))
      ? Number(row.updatedAt)
      : Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : Date.now(),
    closedAt: row.status === "closed" ? row.closedAt ?? row.updatedAt ?? row.createdAt ?? Date.now() : null,
    withdrawnAt: row.status === "withdrawn" ? row.withdrawnAt ?? row.updatedAt ?? Date.now() : null,
    request: row.status === "withdrawn" ? null : String(row.request ?? "").trim(),
  }));
}
```

Add local role guards based on `currentUser()?.status === "approved"` and normalized role. Local Admin results must omit `userId`/`ownerId`, label anonymous or ownerless legacy rows `Anonymous member`, and exclude withdrawn rows.

- [ ] **Step 5: Implement live RPC actions and normalization**

Use `isLive()`/`supabase` branching in each exported async action. Validate UUID-shaped IDs for live mutations, exact actions/statuses, and 1–2,000 trimmed characters before calling Supabase. Convert snake_case response columns to the normalized row shape.

For list RPCs:

```js
const { data, error } = await supabase.rpc("list_my_prayer_requests");
if (error) throw new Error("Prayer requests could not be loaded. Please try again.");
return (data || []).map(memberPrayerRow);
```

Use operation-specific safe messages for submit, load, withdraw/close, Admin load, and Admin status update. Do not call `save()` for live-mode rows.

- [ ] **Step 6: Run store tests GREEN**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: all existing checks plus new prayer contracts pass.

- [ ] **Step 7: Commit the store seam**

```bash
git add app/js/store.js app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(prayer): add member and admin store actions"
```

---

### Task 3: Approved-member prayer page and history

**Files:**
- Modify: `app/js/views.js:1075-1220`
- Modify: `app/js/app.js:525-535,1695-1740` and delegated click-action switch
- Modify: `app/styles.css` Community/prayer sections
- Modify: `app/smoke.mjs:1880-2030`
- Modify: `app/live-auth-smoke.mjs` prayer form/action behavior

**Interfaces:**
- Consumes member store actions from Task 2.
- Produces async `viewCommunity(section)` for the prayer route and member controls:
  - form ID `form-prayer`;
  - checkbox `name="anonymousToLeaders"`;
  - action buttons `data-action="close-prayer-request"` and `data-action="withdraw-prayer-request"` with `data-prayer` UUID/local ID.

- [ ] **Step 1: Write failing member-view tests**

Update `app/smoke.mjs` to await `views.viewCommunity(section)` everywhere. Assert:

- visitors, pending, and declined users see an approved-member gate and no `form-prayer`;
- approved users see the form, 2,000-character limit, anonymity checkbox, and private Admin copy;
- `Prototype:` and the optional name input are absent;
- member rows show request, date, anonymity choice, and mapped labels `New`, `Prayed for`, `Closed`, `Withdrawn`;
- close appears only for `new`/`prayed_for`;
- withdraw appears for every non-withdrawn row;
- withdrawn rows render no historical request text.

Add live-auth interaction assertions that a rejected submit keeps the textarea value and displays an inline error without a success toast.

- [ ] **Step 2: Run member UI tests RED**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: direct synchronous Community assumptions and old form copy fail.

- [ ] **Step 3: Make Community rendering async only where needed**

Change the route dispatcher to:

```js
case "community":
  out = await views.viewCommunity(arg);
  break;
```

Export `async function viewCommunity(section)`. Return existing synchronous strings normally; for `prayers`, await `communityPrayers()`. Update all tests/callers to await the public view function.

- [ ] **Step 4: Implement member gating, form, and history**

In `communityPrayers()`:

```js
const user = store.currentUser();
const approved = user?.status === "approved"
  && ["member", "admin", "superadmin", "super_admin"].includes(user.role);
```

Return public description plus a member gate when false. When true, call `await store.listMyPrayerRequests()` and render the form and **My Prayer Requests**. Use a dedicated status-label map and escape every request/display string. Copy must be:

> Requests are shared privately with ITC Admins and are never posted publicly.

Use `maxlength="2000"` and an unchecked checkbox labelled **Hide my identity from ITC leaders**.

- [ ] **Step 5: Implement submit, close, and withdraw handlers**

Make `form-prayer` await `store.submitPrayerRequest()` inside `withBusyControl`. On error call `showInlineFormError` and do not clear/navigate. On success toast **Prayer request sent privately** and re-render the same Prayer route.

For click actions:

```js
case "close-prayer-request":
  await store.setMyPrayerRequestState(button.dataset.prayer, "close");
  toast("Prayer request closed");
  await renderWithFeedback();
  break;

case "withdraw-prayer-request":
  if (!confirm("Withdraw this request? Its text will be permanently removed.")) return;
  await store.setMyPrayerRequestState(button.dataset.prayer, "withdraw");
  toast("Prayer request withdrawn");
  await renderWithFeedback();
  break;
```

Use busy controls and safe error toasts. Do not optimistically remove rows.

- [ ] **Step 6: Add focused responsive styling**

Reuse `.card`, `.badge`, `.btn`, `.muted`, and spacing tokens. Add only prayer-specific grid/action rules needed to keep buttons at least 44 px high, stack actions at 375 px, and prevent long request text overflow (`overflow-wrap: anywhere`). Do not introduce new fonts/colors.

- [ ] **Step 7: Run member UI tests GREEN**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/test-html.mjs
```

Expected: all pass; malformed HTML checker reports no errors.

- [ ] **Step 8: Commit member experience**

```bash
git add app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(prayer): show private member request history"
```

---

### Task 4: Profile, Schedule, and Admin shell hierarchy cleanup

**Files:**
- Modify: `app/js/views.js:470-525,1260-1950,2560-2640`
- Modify: `app/styles.css:1750-1785` only if heading spacing needs adjustment
- Modify: `app/smoke.mjs:2500-2760` and Schedule assertions

**Interfaces:**
- Produces `profileSubpageHeader({ backHref, backLabel, title })` returning one back link and one `h1`.
- Preserves every existing route, form ID, control, and title-cased Profile heading.

- [ ] **Step 1: Write failing hierarchy assertions**

Add helper assertions in `app/smoke.mjs` that render each Profile route and verify:

```js
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.doesNotMatch(html, /<div class="kicker mt16">Profile ·/);
assert.match(html, /class="back-link"/);
```

Expected headings:

- `Membership Details`
- `Edit Membership Details`
- `Indemnity`
- `Payments & Receipts`
- `Privacy & Notifications`
- `Edit Privacy & Notifications`
- existing Bookings/History title-cased heading

Assert `viewAdmin()` contains `href="#/account"`, text `← Profile`, one `Admin Tools` `h1`, and neither the `Admin` kicker nor `Club Operations`. Assert Schedule no longer includes **Free sessions are open to everyone**.

- [ ] **Step 2: Run hierarchy tests RED**

```bash
node app/smoke.mjs
```

Expected: repeated Profile kickers, duplicate edit titles, missing Admin back link, and Schedule footer fail.

- [ ] **Step 3: Add and apply the Profile subpage header helper**

Add:

```js
function profileSubpageHeader({ backHref = "#/account", backLabel = "Profile", title }) {
  return `
    <a class="back-link" href="${esc(backHref)}">← ${esc(backLabel)}</a>
    <h1 class="display sm mt16">${esc(title)}</h1>`;
}
```

Use it in the missing-application state, details, details edit, Indemnity, Payments & Receipts, Privacy, Privacy edit, and bookings/history. Remove only repeated Profile kickers/headings; keep banners and explanatory copy.

- [ ] **Step 4: Simplify Admin and Schedule hierarchy**

Change the Admin shell prefix to:

```html
<a class="back-link" href="#/account">← Profile</a>
<h1 class="display mt16">Admin Tools</h1>
```

Keep the tab nav immediately after it. Remove the Schedule footer paragraph entirely; do not replace it with another global explanation.

- [ ] **Step 5: Run hierarchy and regression tests GREEN**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/test-html.mjs
```

Expected: all pass and all existing Profile forms/actions remain reachable.

- [ ] **Step 6: Commit the hierarchy cleanup**

```bash
git add app/js/views.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "refactor(profile): simplify subpage hierarchy"
```

---

### Task 5: Admin prayer queue and status operations

**Files:**
- Modify: `app/js/views.js:2560-2640` plus Admin helpers
- Modify: `app/js/app.js` delegated Admin status actions
- Modify: `app/styles.css` Admin prayer cards/groups
- Modify: `app/smoke.mjs` Admin view assertions
- Modify: `app/live-auth-smoke.mjs` Admin RPC interaction assertions

**Interfaces:**
- Consumes `listAdminPrayerRequests()` and `setAdminPrayerRequestStatus()` from Task 2.
- Adds canonical Admin tab `prayers` and route `#/admin/prayers`.
- Adds controls:
  - `data-action="mark-prayer-prayed"`
  - `data-action="close-admin-prayer"`
  - `data-prayer="<id>"`

- [ ] **Step 1: Write failing Admin queue tests**

Assert `viewAdmin("prayers")`:

- is denied for non-Admins by the existing redirect;
- adds **Prayer Requests** between Activities and Giving;
- groups rows under New, Prayed for, and Closed;
- shows identified display names;
- shows `Anonymous member` and no owner UUID/email for anonymous rows;
- never includes withdrawn rows;
- renders no textarea/input capable of editing request text;
- shows **Mark as prayed for** on `new` rows and **Close** on `new`/`prayed_for` rows only.

In live-auth smoke, assert busy-state duplicate suppression and exact calls:

```js
store.setAdminPrayerRequestStatus(id, "prayed_for")
store.setAdminPrayerRequestStatus(id, "closed")
```

- [ ] **Step 2: Run Admin tests RED**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: `prayers` is not a canonical Admin tab and no Admin prayer controls exist.

- [ ] **Step 3: Hydrate the Admin prayer tab**

Add `prayers` to the canonical tab list and tab labels. In `viewAdmin`, fetch prayer rows only for that tab:

```js
let prayerRows = [];
if (canonicalTab === "prayers") {
  prayerRows = await store.listAdminPrayerRequests();
}
```

Render a retryable error card if loading fails; do not show local or stale rows in live mode.

- [ ] **Step 4: Render status groups without identity leaks**

Add `adminPrayerRequests(rows)` that groups by exact status. Escape all values. New/prayed groups are oldest first; closed is newest first. Render closed as a `<details>` section to keep active work prominent. The template must use only `displayName`, never inspect an owner ID.

- [ ] **Step 5: Implement Admin status handlers**

Add delegated click cases using `withBusyControl`. Await the store mutation, toast only after success, and `await renderWithFeedback()`. Error copy: **Prayer request status could not be updated. Please try again.**

- [ ] **Step 6: Add responsive Admin styling**

Reuse Admin card and badge tokens. Keep status buttons full-width on small screens, preserve 44 px targets, and allow request text to wrap. Do not create a separate desktop-only table.

- [ ] **Step 7: Run Admin and full UI tests GREEN**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/test-html.mjs
```

Expected: all pass, including anonymous markup redaction.

- [ ] **Step 8: Commit Admin operations**

```bash
git add app/js/views.js app/js/app.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(admin): manage private prayer requests"
```

---

### Task 6: Runbook, backend-first rollout, and acceptance

**Files:**
- Modify: `README.md` prayer ownership summary
- Modify: `docs/runbooks/live-auth.md` private prayer deployment/acceptance/rollback section
- Modify: `app/smoke.mjs` runbook marker assertions

**Interfaces:**
- Consumes all Tasks 1–5.
- Produces an auditable deployment procedure and verified Testing candidate.

- [ ] **Step 1: Add failing documentation contract assertions**

In `app/smoke.mjs`, load the runbook and require these markers in order:

```js
[
  "Private prayer requests",
  "Apply and verify the backend migration",
  "Verify RPC grants and anonymous redaction",
  "Deploy the Testing frontend",
  "Complete authenticated member/Admin acceptance",
  "Promote the production frontend",
  "Withdrawal clears request text",
]
```

Run `node app/smoke.mjs`; expected failure because the runbook section does not exist.

- [ ] **Step 2: Document exact deployment and rollback commands**

Update `README.md` to place live prayer requests under Supabase ownership and local prayer data under local-mode compatibility only.

Add a runbook section with:

- migration filename and hash recording;
- `prayer_requests_safety.sh` command;
- disposable full-chain startup and rollback SQL integration command;
- read-only production queries for table, constraints, grants, and function signatures;
- backend-first order;
- Testing member/Admin acceptance matrix;
- frontend rollback safety;
- database rollback rule: revoke five RPCs first and preserve content pending an approved retention/export decision.

Explicitly warn that production migration history has drift and `supabase db push --include-all` must not be used.

- [ ] **Step 3: Run complete automated verification**

Run from repository root:

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/replacement-operations-smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
node app/test-html.mjs
bash supabase/tests/verify_operational_backend_safety.sh
bash supabase/tests/verify_profile_avatars_safety.sh
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
bash supabase/tests/prayer_requests_safety.sh
deno test --config supabase/functions/deno.json --allow-net \
  supabase/functions/_shared/*_test.ts \
  supabase/functions/process-profile-avatar/index_test.ts \
  supabase/functions/resolve-profile-avatars/index_test.ts \
  supabase/functions/moderate-profile-avatar/index_test.ts
deno fmt --check supabase/functions
deno lint --config supabase/functions/deno.json supabase/functions
git diff --check
```

Use `$HOME/.deno/bin/deno` if Deno is not on `PATH`. Expected: every command exits zero. The worktree is intentionally not clean yet because the runbook/test changes are committed in Step 5.

- [ ] **Step 4: Re-run the clean database chain and prayer integration**

Start a fresh local Supabase database without temporary migration renumbering. Confirm every migration version is unique and the new migration applies last. Run `prayer_requests_integration.sql` with `ON_ERROR_STOP=1`; expected `ROLLBACK` and exit zero.

Stop the local stack with:

```bash
supabase stop --no-backup
```

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/runbooks/live-auth.md app/smoke.mjs
git commit -m "docs(prayer): add private request rollout runbook"
test -z "$(git status --porcelain)"
```

- [ ] **Step 6: Request independent review before deployment**

Review the full diff from `origin/main` with emphasis on anonymous data returned by SQL, direct grants, transition races, withdrawal erasure, local/live authority, misleading success states, and Profile/Admin navigation. Resolve every Critical and Important finding, rerun affected tests, and commit fixes separately.

- [ ] **Step 7: Apply and record only the new migration**

First compare local and remote migration history. Because the production project has historical gaps, do not run an unqualified replay.

In Supabase Dashboard → project `krxbvgyolxvmzgysfjkj` → SQL Editor, verify the project reference in the browser, open `supabase/migrations/20260921000001_prayer_requests.sql` locally, paste the file unchanged, and execute it once. Save the local SHA-256 and the SQL Editor completion timestamp in the deployment notes; do not paste prayer fixture text or credentials into those notes.

After the schema/RPC read-only checks pass, record only the reviewed version:

```bash
supabase migration repair 20260921000001 --status applied \
  --project-ref krxbvgyolxvmzgysfjkj --yes
```

Immediately run read-only checks confirming:

- table RLS enabled;
- no browser-role table grants;
- only authenticated has execute on the five public RPCs;
- pending and member/Admin fixture acceptance behaves as tested;
- Admin anonymous output contains no identity columns.

Do not deploy frontend code if any backend check fails.

- [ ] **Step 8: Deploy Testing and complete authenticated acceptance**

Push the reviewed branch and open a PR to `testing`. Wait for Vercel success. On current mobile Safari and Chrome, execute every manual acceptance item from the spec with approved member A, member B, Admin, Super Admin, pending, and declined accounts.

Record request IDs/timestamps without recording prayer text in logs or screenshots. Verify:

- member A cannot see member B;
- anonymous Admin markup has no identifying value;
- withdrawal clears text after reload;
- failed requests never show success;
- Admin/Profile/browser back behavior is consistent;
- Schedule footer is absent;
- no heading clips at 375 px.

- [ ] **Step 9: Promote to main only after Testing acceptance**

Open a reviewed PR to `main`, wait for Vercel production success, then verify the canonical production root. Re-run authenticated prayer submission/list/Admin status/withdrawal with disposable acceptance copy, confirm Supabase remains authoritative, and delete the acceptance request through withdrawal so its text is cleared.
