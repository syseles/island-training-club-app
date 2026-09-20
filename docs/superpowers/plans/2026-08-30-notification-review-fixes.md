# Notification Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix local notification Inbox/read persistence and make guarded operational SQL integration fixtures time-stable without changing exact payment/RSVP routing.

**Architecture:** Adapt existing local notification rows only at `app/js/store.js`, mapping `read/link/createdAt` to the live-shaped fields consumed by views while retaining all original fields and persisting the existing `read` boolean. Replace reserve/queue/defer scenarios that depend on future dates with deterministic Saturday fixtures calculated from Hong Kong local time; leave intentional cancelled-session precedence fixtures intact and derive route copy from PL/pgSQL variables.

**Tech Stack:** Vanilla ES modules, localStorage state, Node smoke tests, PostgreSQL/PLpgSQL integration tests.

**Spec:** `/tmp/notification-review.out` and the user’s review-fix request.

## Global Constraints

- Work only on `feature/notification-routing` in the existing isolated worktree.
- Test first and observe each regression fail before production/test-fixture implementation.
- Do not change the localStorage shape or `STATE_VERSION`; use existing notification fields.
- Paid notifications retain exact `#/pay/<booking-id>` destinations; RSVP retains exact `#/activity/<session-id>`.
- Preserve cancellation precedence scenarios, RLS, migration behavior, and notification copy.
- Produce one fix commit, append `.superpowers/sdd/2026-08-29-semantic-notification-routing/refinement-report.md`, and do not push or merge.

---

### Task 1: Local notification normalization and read persistence

**Files:**
- Modify: `app/smoke.mjs`
- Modify: `app/js/store.js`

**Interfaces:**
- Consumes: existing local rows `{ id, userId, kind, title?, body?, message?, link, read, createdAt }`.
- Produces: `listMyNotifications(): Promise<Array>` rows retaining original fields plus `body`, `read_at`, `destination`, and `created_at`.
- Produces: `markNotificationRead(id)` persisting only the existing row’s `read = true`.

- [ ] **Step 1: Add a local regression in `app/smoke.mjs`**

Use the existing payment-marked notification, give the fixture a title/message, sign in as its owner, and assert that `listMyNotifications()` preserves identity/copy, exposes its exact `link` as `destination`, returns one unread row/count, and renders that destination in Inbox. Mark it read, reload local state, and assert `read_at` is truthy, the unread count is zero, and Inbox hides the clicked row.

- [ ] **Step 2: Run RED**

Run: `node app/smoke.mjs`

Expected: FAIL because local `listMyNotifications()` returns `[]`.

- [ ] **Step 3: Implement the minimal store adapter**

Add a private local-row normalizer that spreads the original row and maps:

```js
{
  body: row.body ?? row.message ?? "",
  read_at: row.read ? normalizedCreatedAt : null,
  destination: row.link,
  created_at: normalizedCreatedAt,
}
```

Use it in local `listMyNotifications()` for the current user. In local `markNotificationRead(id)`, find an unread row owned by the current user, set `read = true`, call existing `save()`, and return normalized `{ id, read_at }` evidence. Do not add fields to persisted rows.

- [ ] **Step 4: Run GREEN**

Run: `node app/smoke.mjs`

Expected: PASS, including the new local Inbox/count/read persistence line.

---

### Task 2: HKT-relative guarded SQL fixtures

**Files:**
- Modify: `app/smoke.mjs`
- Modify: `supabase/tests/operational_backend_integration.sql`

**Interfaces:**
- Produces: deterministic fixture dates based on `(current_timestamp at time zone 'Asia/Hong_Kong')::date`, snapped to a Saturday at least two weeks ahead.
- Produces: IDs by concatenating activity IDs with generated `YYYY-MM-DD` dates, satisfying `operational_sessions.id = activity_id || '-' || session_date`.

- [ ] **Step 1: Add a time-stability source contract**

Assert the operational integration source declares the HKT base date/session variables and no longer performs guarded paid/RSVP calls against stale literal 2026 session IDs. Keep explicit assertions that the cancelled static fixture remains for cancellation precedence.

- [ ] **Step 2: Run RED**

Run: `node app/smoke.mjs`

Expected: FAIL because the SQL suite still reserves literal `hyrox-2026-*` / `lunch-2026-*` sessions.

- [ ] **Step 3: Replace future-dependent scenarios with generated Saturdays**

At the start of the transaction, create one temp fixture table containing HKT-relative dates and exact paid, Midtown, lunch, target, final-window, and later no-target session IDs. Update all reserve, queue, and defer calls affected by future guards to read those IDs into PL/pgSQL variables. Generate the required windows from those dates.

Keep the deliberately pre-cancelled static 15 August fixture for `Session is cancelled` precedence. Move the closed-session queue/reserve checks to generated Midtown IDs so they continue reaching `Session is not open` instead of the future guard.

- [ ] **Step 4: Derive scoped notification copy/routes from variables**

For payment-marked, gym-finalized, deferral, and cancellation assertions, build body/destination values from the generated date/session variables. Keep exact paid `#/pay/<booking-id>` and RSVP `#/activity/<session-id>` assertions.

- [ ] **Step 5: Audit remaining static guarded calls**

Search every `reserve_operational_session`, `join_operational_queue`, and `defer_operational_booking` call. Confirm only the intentionally cancelled precedence call may use an expired static session; every other future-guarded call uses generated fixture variables.

- [ ] **Step 6: Run available SQL checks**

Run safety verification and, if credentials/tools exist, the disposable operational verifier. A missing database remains a reported concern, not a claimed pass.

---

### Task 3: Report, full verification, and one commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-29-semantic-notification-routing/refinement-report.md`

- [ ] **Step 1: Append the independent-review fixes and RED/GREEN evidence**

Record local seam behavior, HKT-relative fixtures, preserved cancellation precedence, exact payment/RSVP routes, checks, and any database-execution limitation.

- [ ] **Step 2: Run full verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_admin_notifications.sh
bash supabase/tests/verify_admin_notifications_safety.sh
bash supabase/tests/verify_giving_campaigns.sh
bash supabase/tests/verify_giving_campaigns_safety.sh
bash supabase/tests/verify_operational_backend.sh
bash supabase/tests/verify_operational_backend_safety.sh
node --check app/js/app.js
node --check app/js/store.js
node --check app/js/data.js
node --check app/js/views.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
git diff --check
git status --short --branch
```

Run live/database verifiers only according to their documented environment requirements and report unavailable infrastructure precisely.

- [ ] **Step 3: Commit once**

```bash
git add app/js/store.js app/smoke.mjs supabase/tests/operational_backend_integration.sql \
  .superpowers/sdd/2026-08-29-semantic-notification-routing/refinement-report.md \
  docs/superpowers/plans/2026-08-30-notification-review-fixes.md
git commit -m "fix(notifications): address independent review findings"
```

- [ ] **Step 4: Verify committed state**

Run `git status --short --branch`, `git log -1 --oneline`, and `git diff --check HEAD^..HEAD`. Do not push or merge.
