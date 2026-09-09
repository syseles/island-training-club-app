# Manual HYROX Replacement Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-use WhatsApp-shareable HYROX replacement workflow in which an approved friend accepts the place and an Admin confirms the handover without changing payment ownership.

**Architecture:** Add an additive replacement-request table and booking effective-attendee fields in Supabase, with narrow locked RPCs for create, claim, decline, cancel, and Admin confirm/reject. Mirror the lifecycle in localStorage, resolve the effective attendee separately from the payer/receipt owner, and expose member/invitation/Admin Payments UI through the existing route, notification, and authorization seams.

**Tech Stack:** Vanilla ES modules, string-template views, localStorage migration, Supabase/PostgreSQL migrations and SECURITY DEFINER RPCs, in-app notifications, user-initiated WhatsApp links, Node smoke suites.

**Spec:** `docs/superpowers/specs/2026-09-09-hyrox-replacement-workflow-design.md`

## Global Constraints

- Apply to all paid HYROX bookings: pooled BFT/Midtown and direct Island ECC/Quarry Bay.
- A replacement keeps the same booking, session, venue, payment, and receipt.
- The original member remains payer of record; no refund or payment transfer occurs.
- A private invitation is single-use and claimable by the first approved ITC member who accepts it.
- The original member remains the effective attendee until Admin confirmation.
- A replacement cannot change the HYROX date, session, venue, allocation, payment amount, receipt owner, or collector assignment.
- Invitations expire at the earlier of 24 hours after creation or concrete session start.
- Live Supabase is authoritative; live errors never fall back to local replacement state.
- Admin views show display names only; never expose email, phone, donor ID, raw token, payment reference, or unrelated profile data.
- WhatsApp is only a user-initiated share target; no outbound WhatsApp/email delivery is added.
- Store all raw localStorage access in `app/js/store.js`.
- Advance local state additively; preserve existing bookings, queues, payments, receipts, allocations, notifications, and profiles.
- No new Admin tab, real payment processing, refunds, automatic attendance, public member directory, or Shop/Giving/RSVP changes.
- Every behavior change starts with a failing smoke or SQL assertion.
- Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs` after every JavaScript task.
- Never run `supabase db reset --linked`; SQL execution requires an explicitly acknowledged disposable database.

---

## File map

### Create

- `supabase/migrations/20260910000001_operational_replacement_requests.sql` — replacement table, booking fields, constraints, RLS, RPCs, notification writes.

### Modify

- `app/js/store.js` — state v23 migration, request records, effective-attendee resolver, local lifecycle.
- `app/js/operations.js` — live row mapping, token hashing, RPC adapters, authoritative refresh.
- `app/js/views.js` — member booking replacement state, invitation route, Admin Payments request section.
- `app/js/app.js` — replacement route and delegated create/share/accept/decline/cancel/confirm/reject actions.
- `app/styles.css` — replacement panel, status rows, mobile action layout.
- `app/smoke.mjs` — local lifecycle, privacy, effective attendee, migration, and copy tests.
- `app/live-auth-smoke.mjs` — live RPC payload, mapping, authorization, refresh, and failure tests.
- `docs/runbooks/operational-backend.md` — migration order and disposable SQL verification note.
- `README.md` — concise prototype capability note if the existing operations summary requires it.

---

### Task 1: Define local replacement state and shared eligibility rules

**Files:**
- Modify: `app/js/store.js` state shape, migration, booking constructors, selectors.
- Test: `app/smoke.mjs` near state migration and no-deferral tests.

**Interfaces:**
- Produces `replacementRequestForBooking(bookingId)`, `replacementRequestByToken(token)`, `effectiveAttendeeId(booking)`, `replacementEligible(booking, now)`, and local request statuses.
- `effectiveAttendeeId(booking)` returns `booking.replacementUserId || booking.userId`.
- `replacementEligible(booking, now = Date.now())` returns `{ ok: true, expiresAt }` or `{ ok: false, reason }`.

- [ ] **Step 1: Write failing tests**

```js
assert.equal(store.effectiveAttendeeId({ userId: "payer" }), "payer");
assert.equal(store.effectiveAttendeeId({ userId: "payer", replacementUserId: "friend" }), "friend");
assert.equal(store.replacementEligible({ status: "reserved" }, Date.now()).ok, false);
assert.equal(store.replacementEligible({ status: "attended" }, Date.now()).ok, false);
assert.equal(store.replacementEligible({
  status: "confirmed", snapshot: { kind: "paid", dateISO: "2099-01-10", time: "11:15" },
}, Date.now()).ok, true);
```

Add a v22 fixture with an existing booking and assert v23 adds only `replacementUserId`, `replacementConfirmedAt`, and `replacementConfirmedBy` as null plus an empty `replacementRequests` collection.

- [ ] **Step 2: Run RED**

Run `node app/smoke.mjs`.

Expected failure: missing effective-attendee/eligibility helpers or v23 migration fields.

- [ ] **Step 3: Implement minimal local seam**

Bump `STATE_VERSION` to 23. Add the fields to every booking constructor and initialize `state.replacementRequests = []` during migration. Reject reserved, attended, cancelled, expired, deferred, RSVP/free, started, and non-owner-ineligible records. Permit confirmed paid HYROX bookings, including pooled bookings with `sessionId === null`, until the calculated expiry.

- [ ] **Step 4: Run GREEN**

Run `node app/smoke.mjs`, syntax-check `app/js/store.js` and `app/smoke.mjs`, and run `git diff --check`.

- [ ] **Step 5: Commit**

```sh
git add app/js/store.js app/smoke.mjs
git commit -m "feat(replacements): add local eligibility and state migration"
```

---

### Task 2: Add Supabase replacement schema and locked RPCs

**Files:**
- Create: `supabase/migrations/20260910000001_operational_replacement_requests.sql`.
- Modify: `supabase/tests/operational_backend_integration.sql` with replacement cases.
- Test: `app/smoke.mjs` with static SQL contracts.

**Interfaces:**
- Table: `public.operational_booking_replacement_requests`.
- Booking fields: `replacement_profile_id`, `replacement_confirmed_at`, `replacement_confirmed_by`.
- RPCs:
  - `create_operational_replacement_request(uuid, text, timestamptz)`
  - `get_operational_replacement_invite(text)`
  - `accept_operational_replacement_request(text)`
  - `decline_operational_replacement_request(text)`
  - `cancel_operational_replacement_request(uuid)`
  - `admin_decide_operational_replacement(uuid, boolean, text)`

- [ ] **Step 1: Write failing SQL contract assertions**

Assert the migration contains:

```text
operational_booking_replacement_requests
replacement_profile_id
replacement_confirmed_at
replacement_confirmed_by
create_operational_replacement_request
get_operational_replacement_invite
accept_operational_replacement_request
decline_operational_replacement_request
cancel_operational_replacement_request
admin_decide_operational_replacement
security definer
set search_path = public
for update
revoke all
```

Add SQL integration cases for owner-only creation, approved-member claim, first-claim locking, duplicate-session rejection, Admin-only decision, payment/receipt preservation, and replacement fields after confirmation.

- [ ] **Step 2: Run RED**

Run `node app/smoke.mjs`.

Expected failure: missing migration file and SQL contract markers.

- [ ] **Step 3: Implement the migration**

Create the table with UUID request ID, booking/profile foreign keys, token hash, constrained status, lifecycle timestamps, actor IDs, expiry, and reason. Add a partial unique index for one active request per booking and a unique token-hash index. Add nullable replacement fields to `operational_bookings` and a consistency check requiring the effective replacement audit fields only after a confirmed replacement.

Each SECURITY DEFINER function must set a fixed `search_path`, lock request and booking rows before validation, re-check session start/cancellation/booking status, and revoke execution from `public` and `anon` before granting only the required authenticated role. The Admin decision function must set `replacement_profile_id` only on confirmation and must not alter payment, receipt, session, allocation, or booking payer fields.

Use `coalesce(replacement_profile_id, profile_id)` only for effective attendee reads. Keep `profile_id` as payer/booking owner.

- [ ] **Step 4: Run static and conditional SQL checks**

Run `node app/smoke.mjs`, `node --check app/smoke.mjs`, and `git diff --check`. Do not execute the destructive SQL verifier unless `ITC_OPERATIONS_TEST_DATABASE_URL` is explicitly supplied for disposable infrastructure.

- [ ] **Step 5: Commit**

```sh
git add supabase/migrations/20260910000001_operational_replacement_requests.sql supabase/tests/operational_backend_integration.sql app/smoke.mjs
git commit -m "feat(replacements): add live request schema and RPCs"
```

---

### Task 3: Implement the live operations bridge

**Files:**
- Modify: `app/js/operations.js`.
- Test: `app/live-auth-smoke.mjs` and `app/smoke.mjs`.

**Interfaces:**
- `hashReplacementToken(token)` → Promise<string> using Web Crypto SHA-256.
- `liveCreateReplacementRequest(bookingId, tokenHash, expiresAt)` → Promise<request>.
- `liveReplacementInvite(tokenHash)` → Promise<redacted invite>.
- `liveAcceptReplacement(tokenHash)` and `liveDeclineReplacement(tokenHash)` → Promise<request>.
- `liveCancelReplacement(requestId)` → Promise<request>.
- `liveDecideReplacement(requestId, confirm, reason)` → Promise<request>.

- [ ] **Step 1: Write failing live/mock tests**

Add fake Supabase assertions for exact RPC names and payloads, SHA-256 token hashing, mapped lifecycle timestamps/status, and authoritative cache refresh after acceptance and Admin confirmation. Add a rejected live RPC case proving the prior cache remains unchanged and the error is preserved.

- [ ] **Step 2: Run RED**

Run `node app/live-auth-smoke.mjs`.

Expected failure: missing operations functions or RPC calls.

- [ ] **Step 3: Implement the bridge**

Map replacement rows without exposing token hashes to views. Route all live mutations through the existing operational RPC wrapper so success refreshes the authoritative booking/request cache before resolving. Ensure live failures do not write local replacement records.

- [ ] **Step 4: Run GREEN**

Run both smoke suites, syntax-check `app/js/operations.js`, and run `git diff --check`.

- [ ] **Step 5: Commit**

```sh
git add app/js/operations.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(replacements): bridge live request mutations"
```

---

### Task 4: Implement local request lifecycle and effective-attendee selectors

**Files:**
- Modify: `app/js/store.js`.
- Test: `app/smoke.mjs`.

**Interfaces:**
- `createReplacementRequest(bookingId, now = Date.now())` → request plus raw local token.
- `replacementInviteForToken(token)` → redacted invite or null.
- `acceptReplacement(token, now = Date.now())` → request.
- `declineReplacement(token, now = Date.now())` → request.
- `cancelReplacement(requestId, now = Date.now())` → request/null.
- `decideReplacement(requestId, confirm, reason, now = Date.now())` → request.
- `effectiveAttendeeForBooking(booking)` → user or null.

- [ ] **Step 1: Write failing local lifecycle tests**

Cover:

- owner creates one request and receives a token;
- repeated create is rejected while active;
- approved friend claims once;
- second claimant is rejected;
- friend declines;
- owner cancels before claim;
- expiry and session start reject claim;
- same-session existing booking rejects claim;
- member cannot Admin-confirm;
- Admin confirmation sets replacement fields while preserving payer, payment, receipt, session, venue, and price;
- Admin rejection leaves the original effective attendee;
- `effectiveAttendeeId` changes only after confirmation.

- [ ] **Step 2: Run RED**

Run `node app/smoke.mjs` and verify the first missing lifecycle function is the expected failure.

- [ ] **Step 3: Implement local lifecycle**

Mirror live status transitions and error messages. Store local raw tokens only in prototype state for deterministic smoke testing; production/live rows store only token hashes. Add in-app notifications for claim, acceptance, rejection, and confirmation using existing `notify()` and route destinations.

- [ ] **Step 4: Run GREEN**

Run `node app/smoke.mjs`, including profile/booking/attendance assertions, then syntax-check `app/js/store.js`.

- [ ] **Step 5: Commit**

```sh
git add app/js/store.js app/smoke.mjs
git commit -m "feat(replacements): implement local request lifecycle"
```

---

### Task 5: Add replacement invitation routing and member actions

**Files:**
- Modify: `app/js/app.js`, `app/js/views.js`, `app/js/operations.js`, `app/js/store.js`.
- Modify: `app/smoke.mjs`, `app/live-auth-smoke.mjs`.
- Modify: `app/styles.css`.

**Interfaces:**
- Route: `#/replacement/<token>`.
- View: `viewReplacementInvite(token)` returns the redacted invitation state or a non-sensitive invalid/expired state.
- Share helper: `replacementShareUrl(token)` returns the app-relative invite URL.

- [ ] **Step 1: Write failing route and member-view tests**

Assert:

- confirmed paid HYROX booking shows `I can’t attend — arrange a replacement`;
- pending request shows expiry/status and `Share via WhatsApp`;
- WhatsApp URL contains only the validated replacement route;
- booking details contain no email, phone, donor ID, token hash, or raw booking payload;
- invitation route shows accept/decline only to an authenticated approved recipient;
- explicit route survives sign-in handoff without being stored as the last ordinary route;
- invalid, expired, claimed, and unauthorized invites show safe errors;
- reserved, attended, free, RSVP, cancelled, started, and non-owner bookings show no replacement action.

- [ ] **Step 2: Run RED**

Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs`.

Expected failure: missing route/view/action markers.

- [ ] **Step 3: Implement the member route and actions**

Add route parsing before the generic not-found path. Preserve the transient replacement hash through authentication but do not put the bearer token into identity-scoped last-route persistence. Add delegated actions for create, WhatsApp share, accept, decline, and owner cancellation. Use the existing busy-control/toast patterns and preserve the current hash after mutation.

The WhatsApp action must use a user-initiated `wa.me/?text=` link with encoded copy such as:

```text
I have a HYROX spot available for Sat [date] at [venue]. If you’re an approved ITC member and can take it, accept it here: [private link]
```

Do not claim delivery or include payment details.

- [ ] **Step 4: Add responsive styles**

Use existing cards, badges, buttons, muted text, and section-head tokens. Keep primary actions at least 44px tall and stack the WhatsApp/accept/decline actions on small screens.

- [ ] **Step 5: Run GREEN**

Run both smoke suites, all relevant syntax checks, and `git diff --check`.

- [ ] **Step 6: Commit**

```sh
git add app/js/app.js app/js/views.js app/js/operations.js app/js/store.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(replacements): add member invite and acceptance flow"
```

---

### Task 6: Add Admin Payments replacement review and effective attendee rendering

**Files:**
- Modify: `app/js/views.js`, `app/js/app.js`, `app/js/store.js`.
- Modify: `app/smoke.mjs`, `app/live-auth-smoke.mjs`.
- Modify: `app/styles.css`.

**Interfaces:**
- Admin selector: `replacementRequestsForAdmin()` returns accepted/pending requests with display names only.
- Admin delegated action: `replacement-decision` with `data-request` and `data-confirmed`.
- Attendance and protected attendee-name selectors use the effective attendee resolver after confirmation.

- [ ] **Step 1: Write failing Admin/privacy tests**

Assert:

- Admin Payments shows accepted requests with original and replacement display names;
- Admin can confirm or reject;
- members cannot see the Admin request section or payment/queue data;
- Admin request rows exclude email, phone, donor ID, raw token, payment reference, and unrelated profile fields;
- after confirmation, the replacement appears in Expected arrivals and the original disappears;
- after confirmation, payment groups still classify the booking as Paid;
- receipts and payer-owned payment history remain associated with the original member;
- duplicate confirmation is idempotent;
- rejection leaves the original attendee and does not alter payment/receipt/allocation fields.

- [ ] **Step 2: Run RED**

Run `node app/smoke.mjs` and `node app/live-auth-smoke.mjs`.

Expected failure: missing Admin replacement rows or effective-attendee mapping.

- [ ] **Step 3: Implement Admin review UI and actions**

Add a compact disclosure section under Admin → Payments. Show status rows for `Pending Admin confirmation` and empty state. Use full display names only. Route actions through the existing busy/error/rerender pattern; do not optimistically replace roster names.

- [ ] **Step 4: Update effective attendee consumers**

Use `effectiveAttendeeId` for Admin attendance display, protected attendee names, and any member-visible confirmed attendee list. Keep `booking.userId/profile_id` for authorization, receipts, payment ownership, payment notifications, and payer history. Ensure an accepted-but-not-confirmed request does not change any roster.

- [ ] **Step 5: Run GREEN**

Run both smoke suites, syntax checks for `app/js/app.js`, `app/js/store.js`, `app/js/views.js`, `app/js/operations.js`, and `git diff --check`.

- [ ] **Step 6: Commit**

```sh
git add app/js/app.js app/js/store.js app/js/views.js app/js/operations.js app/styles.css app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "feat(replacements): add Admin confirmation and attendee handoff"
```

---

### Task 7: Documentation, SQL verification gate, and full regression review

**Files:**
- Modify: `README.md` and `docs/runbooks/operational-backend.md`.
- Review: all files changed since the replacement spec commit.

- [ ] **Step 1: Document the prototype boundary**

Add a concise README statement that manual HYROX replacements are recorded in-app, require approved-member acceptance and Admin confirmation, preserve the original payer/receipt, and do not move money. Add the migration to the documented Supabase order and explicitly state that WhatsApp is user-initiated sharing only.

- [ ] **Step 2: Run final automated verification**

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/app.js
node --check app/js/store.js
node --check app/js/views.js
node --check app/js/operations.js
node --check app/live-auth-smoke.mjs
node --check app/smoke.mjs
git diff --check
```

- [ ] **Step 3: Run SQL integration only with explicit disposable credentials**

If `ITC_OPERATIONS_TEST_DATABASE_URL` is explicitly supplied, run the repository’s guarded operational verifier with its required acknowledgement. Otherwise report SQL execution as not run; do not substitute a linked reset.

- [ ] **Step 4: Review privacy and scope**

Verify no member-facing view exposes Admin rosters, email, phone, donor ID, raw token, payment reference, or raw booking data. Verify no Shop, Giving, RSVP, or unrelated route changes were introduced.

- [ ] **Step 5: Commit documentation and verified fixes**

```sh
git add README.md docs/runbooks/operational-backend.md app/smoke.mjs app/live-auth-smoke.mjs
git commit -m "docs: document manual HYROX replacements"
```

- [ ] **Step 6: Request review before integration**

Review against `docs/superpowers/specs/2026-09-09-hyrox-replacement-workflow-design.md`, emphasizing token privacy, first-claim concurrency, Admin authorization, effective attendee versus payer ownership, expiry/session-start boundaries, pooled unallocated bookings, and live/local parity.
