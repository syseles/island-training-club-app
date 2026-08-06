# Admin Operational Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver database-generated Admin operational notifications and a semantic top-bar Notification experience on `feature/notification`.

**Architecture:** Postgres trigger functions fan out trusted operational events to current Admin/Super Admin profiles using the existing notifications table. The client maps stable kinds to routes, formats deterministic relative/HKT time, moves Notifications from bottom navigation to a top-bar bell, and reuses shared generation-safe route/busy/error helpers.

**Tech Stack:** Vanilla ES modules, HTML/CSS, Supabase/Postgres triggers and RLS, Node smoke tests

## Global Constraints

- Work on `feature/notification`, based on the completed `feature/auth-identity` shared UI/Admin baseline.
- Generate notifications for application submitted, application approved/declined, and promote/demote/revoke only.
- Do not notify when a profile exists without a submitted application.
- Deliver operational events to every current Admin and Super Admin, including the actor.
- Preserve existing role-change audit records and member welcome notifications.
- Use a new additive rerunnable migration; do not edit applied migrations.
- Remove Notifications from bottom navigation only after the top-bar bell works.
- Do not add Giving, Shop, campaign, merchandise, email, push, or npm dependencies.
- Preserve unrelated untracked files.

---

### Task 1: Generate Trusted Admin Operational Notifications

**Files:**
- Create: `supabase/migrations/20260805000008_admin_operational_notifications.sql`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `public.profiles`, `public.applications`, `public.notifications`, `public.role_changes`, and existing `public.record_role_change()`.
- Produces: one fan-out event per Admin/Super Admin for first submission and supported role transitions.

- [ ] **Step 1: Add failing SQL contract tests**

Read the new migration in `app/smoke.mjs` and assert stable kinds and safeguards:

```js
for (const kind of [
  "admin_application_submitted",
  "admin_application_approved",
  "admin_application_declined",
  "admin_role_promoted",
  "admin_role_demoted",
  "admin_membership_revoked",
]) {
  if (!adminNotificationsSql.includes(`'${kind}'`)) throw new Error(`missing Admin notification kind: ${kind}`);
}
for (const contract of [
  "OLD.submitted_at is null",
  "NEW.submitted_at is not null",
  "role in ('admin', 'super_admin')",
  "insert into public.role_changes",
  "'welcome'",
  "security definer",
  "set search_path = public",
  "drop trigger if exists",
]) {
  if (!adminNotificationsSql.includes(contract)) throw new Error(`missing Admin notification SQL contract: ${contract}`);
}
```

Also assert there is no event for profile bootstrap without application submission.

- [ ] **Step 2: Run smoke and verify red state**

Run: `node app/smoke.mjs`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the rerunnable application-submission trigger**

Create `20260805000008_admin_operational_notifications.sql` with:

```sql
create or replace function public.notify_admins_application_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  applicant_name text;
  should_notify boolean := false;
begin
  if TG_OP = 'INSERT' then
    should_notify := NEW.submitted_at is not null;
  elsif TG_OP = 'UPDATE' then
    should_notify := OLD.submitted_at is null and NEW.submitted_at is not null;
  end if;

  if not should_notify then return NEW; end if;

  select coalesce(nullif(full_name, ''), email, 'A member')
    into applicant_name
    from public.profiles
   where id = NEW.profile_id;

  insert into public.notifications (profile_id, kind, title, body)
  select id,
         'admin_application_submitted',
         'Membership application submitted',
         applicant_name || ' submitted a membership application.'
    from public.profiles
   where role in ('admin', 'super_admin');

  return NEW;
end;
$$;

drop trigger if exists applications_notify_admins_submitted on public.applications;
create trigger applications_notify_admins_submitted
  after insert or update of submitted_at on public.applications
  for each row execute function public.notify_admins_application_submitted();
```

This creates no event for a profile alone and no duplicate when other fields of a submitted application change.

- [ ] **Step 4: Replace `record_role_change()` compatibly**

Use `create or replace function public.record_role_change()` with the existing audit insert and welcome insert preserved. Resolve target and actor names; classify exactly:

```sql
case
  when OLD.role = 'pending' and NEW.role = 'member' then 'admin_application_approved'
  when OLD.role = 'pending' and NEW.role = 'declined' then 'admin_application_declined'
  when OLD.role = 'member' and NEW.role = 'admin' then 'admin_role_promoted'
  when OLD.role = 'admin' and NEW.role = 'member' then 'admin_role_demoted'
  when OLD.role in ('member', 'admin') and NEW.role = 'pending' then 'admin_membership_revoked'
  else null
end
```

Map each classified kind exactly:

```sql
case event_kind
  when 'admin_application_approved' then
    event_title := 'Application approved';
    event_body := target_name || ' was approved by ' || actor_name || '.';
  when 'admin_application_declined' then
    event_title := 'Application declined';
    event_body := target_name || ' was declined by ' || actor_name || '.';
  when 'admin_role_promoted' then
    event_title := 'Member promoted';
    event_body := actor_name || ' promoted ' || target_name || ' from Member to Admin.';
  when 'admin_role_demoted' then
    event_title := 'Admin demoted';
    event_body := actor_name || ' changed ' || target_name || ' from Admin to Member.';
  when 'admin_membership_revoked' then
    event_title := 'Membership revoked';
    event_body := actor_name || ' revoked ' || target_name || '’s member access.';
end case;
```

Insert one row per profile currently in `('admin','super_admin')`. Resolve `actor_name` with `coalesce(nullif(full_name, ''), email, 'An administrator')`, and use the literal fallback `An administrator` if `auth.uid()` has no profile. Do not recreate the existing trigger because `create or replace` updates the function it already invokes.

- [ ] **Step 5: Verify and commit database behavior**

Run `node app/smoke.mjs`, SQL source checks, and `git diff --check`.

```bash
git add app/smoke.mjs supabase/migrations/20260805000008_admin_operational_notifications.sql
git commit -m "feat(db): add Admin operational notifications"
```

---

### Task 2: Add Deterministic Notification Time and Semantic Grouped Views

**Files:**
- Modify: `app/js/data.js`
- Modify: `app/js/views.js`
- Modify: `app/styles.css`
- Modify: `app/smoke.mjs`
- Modify: `app/live-auth-smoke.mjs`

**Interfaces:**
- Consumes: notification rows from `listMyNotifications()` and current user role.
- Produces: `notificationRelativeTime(value, now)`, `notificationHktTime(value)`, `notificationDestination(kind)`, and semantic grouped Notification HTML.

- [ ] **Step 1: Write failing pure-helper and render tests**

Add deterministic cases:

```js
const now = new Date("2026-08-05T06:40:00.000Z");
assert.equal(notificationRelativeTime("2026-08-05T06:39:45.000Z", now), "Just now");
assert.equal(notificationRelativeTime("2026-08-05T06:35:00.000Z", now), "5 minutes ago");
assert.equal(notificationRelativeTime("2026-08-05T04:40:00.000Z", now), "2 hours ago");
assert.equal(notificationRelativeTime("2026-08-04T06:40:00.000Z", now), "Yesterday");
assert.match(notificationHktTime("2026-08-05T06:32:00.000Z"), /5 Aug 2026, 2:32 PM HKT/);
```

Render Admin fixtures containing `admin_*` and `welcome`; assert headings `Club operations` and `My notifications`, operational rows appear only in the first section, member rows only in the second, each row is a `<button>`, unread rows include visible unread text/dot and exact/relative time. Render member fixtures and assert Club operations is omitted.

- [ ] **Step 2: Run tests and verify failure**

Run: `node app/smoke.mjs && node app/live-auth-smoke.mjs`

Expected: FAIL because helpers/grouped semantic rows are absent.

- [ ] **Step 3: Implement pure time and destination helpers**

In `data.js` export:

```js
export function notificationRelativeTime(value, now = new Date()) {
  const seconds = Math.max(0, Math.floor((now - new Date(value)) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export function notificationHktTime(value) {
  return `${new Intl.DateTimeFormat("en-HK", {
    timeZone: "Asia/Hong_Kong",
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value))} HKT`;
}

export function notificationDestination(kind) {
  if (kind === "admin_application_submitted") return "#/admin/approvals";
  if (kind.startsWith("admin_")) return "#/admin/members";
  return "#/account";
}
```

- [ ] **Step 4: Render grouped semantic Notification sections**

Update `viewNotifications(now = new Date())` to fetch once and split `kind.startsWith('admin_')`. Admin/Super Admin sees both sections; regular members see only My notifications. Render each row as:

```html
<button class="notification-row unread" type="button"
  data-action="notification-open"
  data-notification-id="..."
  data-notification-read="false"
  data-destination="#/admin/approvals">
  <span class="notification-unread" aria-label="Unread"></span>
  <span class="notification-copy">...</span>
  <span class="notification-time">
    <span>5 minutes ago</span><span>5 Aug 2026, 2:32 PM HKT</span>
  </span>
</button>
```

Escape all row values. Add proper page `<h1>`, padded section cards, section-specific empty states, 44px rows, wrapping, unread surface/dot/text, focus-visible integration, and reduced-motion-compatible transitions. Remove reliance on undefined `.row` classes.

- [ ] **Step 5: Verify and commit grouped views**

Run both smoke suites, syntax checks for data/views, and `git diff --check`.

```bash
git add app/js/data.js app/js/views.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(notifications): add grouped accessible timeline"
```

---

### Task 3: Move Notifications to the Top-Bar Bell

**Files:**
- Modify: `app/index.html`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/styles.css`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `listMyNotifications()`, current user, `ICONS.bell`, generation-safe `render()`.
- Produces: `notificationBellHTML(unreadCount, active)`, visitor-hidden `#top-notifications`, and bottom navigation without Notifications.

- [ ] **Step 1: Write failing bell/navigation tests**

Assert visitor header hides the bell and visitor bottom nav is unchanged. For signed-in fixtures assert:

- Bell is a semantic 44×44 link to `#/notifications`.
- `aria-label` reports full unread count.
- Badge shows `3`, and 120 shows `99+`.
- Active Notification route has `aria-current="page"`.
- A count query error leaves a visible bell without count and does not toast/fail render.
- `NAV_ITEMS` no longer contains Notifications.

- [ ] **Step 2: Run focused tests and verify failure**

Run both smoke suites; expect failure on missing host/bell and remaining bottom item.

- [ ] **Step 3: Add the top-bar host and bell renderer**

Add before the avatar:

```html
<a id="top-notifications" class="top-icon-button" href="#/notifications" hidden></a>
```

Export:

```js
export function notificationBellHTML(unreadCount = 0, active = false) {
  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);
  return `${ICONS.bell}${unreadCount ? `<span class="notification-badge" aria-hidden="true">${visibleCount}</span>` : ""}`;
}
```

App code sets `hidden`, `aria-label`, and `aria-current`; HTML is decorative inside the labeled link. Style 44×44 target, badge, active state, and no layout shift.

- [ ] **Step 4: Hydrate counts without blocking render and remove bottom item**

Remove Notifications from `NAV_ITEMS`. In the current generation after user/nav/avatar render:

- Visitor: hide and clear bell.
- Signed in: show bell immediately with “Notifications”; asynchronously fetch rows.
- On success: count unread, render badge, set full accessible label.
- On failure: retain bell with no badge and no toast.
- Ignore stale generation results.

Update `NAV_FOR.notifications` so no bottom tab is marked; bell carries current state.

- [ ] **Step 5: Verify and commit navigation**

Run both smoke suites, app/views syntax, and `git diff --check`.

```bash
git add app/index.html app/js/views.js app/js/app.js app/styles.css app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(notifications): add top-bar unread bell"
```

---

### Task 4: Mark Read and Navigate Truthfully

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/app.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: semantic row datasets, `withBusyControl`, `renderWithFeedback`, `markNotificationRead(id)`.
- Produces: checked mark-read updates, no-op for already-read rows, truthful failure retention, and destination navigation.

- [ ] **Step 1: Write failing delegated behavior tests**

For unread operational row activation, assert it disables/becomes busy, sends one update, waits for success, navigates to `#/admin/approvals`, and subsequent header count drops. For already-read row, assert zero update calls and immediate destination navigation.

Inject update error and zero-row result; assert page/hash/count remain unchanged, row recovers, accessible error toast appears, and no destination render occurs. Double activation while pending invokes one update.

- [ ] **Step 2: Run live smoke and verify failure**

Run: `node app/live-auth-smoke.mjs`

Expected: FAIL because current handler always updates, does not navigate, and does not verify affected rows.

- [ ] **Step 3: Make store updates prove one row changed**

Change `markNotificationRead(id)` to:

```js
const { data, error } = await supabase
  .from("notifications")
  .update({ read_at: new Date().toISOString() })
  .eq("id", id)
  .is("read_at", null)
  .select("id, read_at")
  .single();
if (error) throw error;
if (!data?.id) throw new Error("Notification update conflict.");
return data;
```

RLS and the `read_at is null` predicate prevent foreign/repeated mutation.

- [ ] **Step 4: Implement checked activation flow**

In `notification-open`:

```js
const destination = el.dataset.destination || "#/account";
await withBusyControl(el, "Opening…", async () => {
  if (el.dataset.notificationRead !== "true") {
    await store.markNotificationRead(el.dataset.notificationId);
  }
  location.hash = destination;
  await renderWithFeedback();
});
```

Catch errors outside the work, restore via shared helper, keep hash/page/count unchanged, and toast `Failed to mark notification read` as an error. Because the row is a button with structured children, use a visual busy class/aria label rather than replacing all inner text; extend `withBusyControl` with an option or implement a row-safe wrapper without weakening existing callers.

- [ ] **Step 5: Verify and commit interaction**

Run both smoke suites, syntax checks, and `git diff --check`.

```bash
git add app/js/store.js app/js/app.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(notifications): open and mark events read"
```

---

### Task 5: Final Notification Regression Verification

**Files:**
- Verify all Notification and inherited Auth files; modify only for a discovered regression.

**Interfaces:**
- Consumes: complete Notification feature.
- Produces: fresh test, syntax, SQL, scope, and branch evidence.

- [ ] **Step 1: Run full verification**

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
for file in app/js/*.js app/*.mjs; do node --check "$file"; done
git diff --check
git status --short --branch
```

Expected: all pass; only known unrelated original-checkout files remain untracked.

- [ ] **Step 2: Inspect migration and feature scope**

```bash
git diff --stat c6e08ea..HEAD
git diff --check c6e08ea..HEAD
git log --oneline c6e08ea..HEAD
rg -n "admin_application_|admin_role_|admin_membership_revoked" supabase/migrations/20260805000008_admin_operational_notifications.sql
```

Expected: only Notification migration/client/tests plus this plan changed; no Giving/Shop code.

- [ ] **Step 3: Commit only if correction was required**

After rerunning Step 1, commit exact corrected files with:

```bash
git commit -m "fix(notifications): address integration regression"
```

Do not create an empty commit.
