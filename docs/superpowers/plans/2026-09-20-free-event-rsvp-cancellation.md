# Free Event RSVP and Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, uncapped RSVP, attendee visibility, per-occurrence Admin cancellation, and reopening to every recurring and one-off free event.

**Architecture:** Materialize recurring free events as Supabase operational sessions and reuse the existing zero-price RSVP booking pipeline. Keep `kind: "free"` as presentation semantics and add `requiresRsvp` as the participation capability. Add an RSVP-specific transactional cancellation branch so free attendees are cancelled and notified rather than deferred.

**Tech Stack:** Vanilla JavaScript ES modules, localStorage prototype state, Supabase Postgres/RPC/RLS, Node smoke tests, Bash SQL safety checks.

**Spec:** `docs/superpowers/specs/2026-09-20-free-event-rsvp-cancellation-design.md`

## Global Constraints

- Work only on `feature/free-event-rsvp-cancellation`, based on `testing`; do not modify Shop behavior.
- RSVP remains optional: free events have no payment, checkout, capacity, waitlist, or attendance gate.
- Walk-ins remain welcome.
- Only approved `member`, `admin`, `superadmin`, and `super_admin` roles may RSVP or view attendee identities.
- Cancellation affects exactly one dated occurrence and requires a trimmed reason.
- Free/RSVP attendees are cancelled, never deferred.
- Reopening is allowed only before start; old RSVPs stay cancelled and members RSVP again.
- Time, venue, cancellation, and reopening notifications are in-app only and target the applicable RSVP cohort.
- Event timing uses the Hong Kong wall clock.
- `store.js` remains the only localStorage seam; persisted key removal requires a versioned migration.
- Existing Lunch, HYROX, paid booking, replacements, attendance, auth, avatar, and indemnity behavior must remain passing.
- Do not add npm dependencies, a build step, a service worker, Web Push, email, or SMS.

---

### Task 1: Define the free-event RSVP contract and local behavior

**Files:**
- Modify: `app/js/data.js`
- Modify: `app/js/store.js`
- Modify: `app/smoke.mjs`
- Modify: `app/rsvp-whos-coming-smoke.mjs`

**Interfaces:**
- Produces: `sessionRequiresRsvp(session): boolean` exported from `store.js`.
- Produces: free seed activities with `requiresRsvp: true`, `capacity: null`, and unchanged `kind: "free"`.
- Produces: local booking metadata `cancelledAt` and `cancelledSource: "member" | "session" | null`.
- Consumes: existing `rsvpSession`, `withdrawRsvp`, `cancelSessionWeek`, `repostRsvpEvent`, `attendeeCountFor`, and roster helpers.

- [ ] **Step 1: Add failing free-event contract tests**

Add assertions that each `wnt`, `run`, and `water` seed has `kind === "free"`, `requiresRsvp === true`, and no finite capacity. Add a local-mode flow that asserts:

```js
const session = store.upcomingSessions(14).find((item) => item.kind === "free");
assert.equal(store.sessionRequiresRsvp(session), true);
const booking = await store.rsvpSession(member.id, session);
assert.equal(booking.status, "confirmed");
assert.equal(booking.snapshot.price, 0);
assert.equal(store.attendeeCountFor(session), 1);
await store.withdrawRsvp(booking.id);
assert.equal(store.getBooking(booking.id).cancelledSource, "member");
```

Add a cancellation flow proving a confirmed free RSVP becomes `cancelledSource === "session"`, no future booking is created, only that occurrence is cancelled, reopening leaves the old row cancelled, and the member can RSVP again.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
node app/smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
```

Expected: failure because seeded free activities are not RSVP-enabled and `rsvpSession` rejects `kind: "free"`.

- [ ] **Step 3: Implement the shared participation predicate**

In `data.js`, add `requiresRsvp: true` and `capacity: null` to `wnt`, `run`, and `water`. In `store.js`, export:

```js
export function sessionRequiresRsvp(session) {
  return Boolean(session?.requiresRsvp || session?.kind === "rsvp");
}
```

Use the predicate in local RSVP, withdrawal, attendee count, and roster eligibility instead of checking `kind === "rsvp"` alone. Preserve the existing paid and Lunch branches.

- [ ] **Step 4: Implement local cancellation and reopening parity**

For free/RSVP occurrences, `cancelSessionWeek` must cancel active confirmed bookings in place, set `cancelledAt`/`cancelledSource: "session"`, notify those profiles once, and skip `deferTargetsFor`. `withdrawRsvp` sets source `member`. Generalize `repostRsvpEvent` to any RSVP-enabled zero-price occurrence, notify only rows cancelled by that session cancellation, and leave old rows inactive.

- [ ] **Step 5: Run focused tests**

Run the two Task 1 test commands. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/js/data.js app/js/store.js app/smoke.mjs app/rsvp-whos-coming-smoke.mjs
git commit -m "feat(events): add local RSVP behavior to free sessions"
```

---

### Task 2: Add the authoritative Supabase schema and transactional RPC behavior

**Files:**
- Create: `supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql`
- Create: `supabase/tests/free_event_rsvp_cancellation_safety.sh`
- Create: `supabase/tests/free_event_rsvp_cancellation_integration.sql`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: operational templates `wnt`, `run`, and `water` with `requires_rsvp = true`.
- Produces: `operational_bookings.cancelled_at timestamptz` and `cancellation_source text` constrained to `member | session` when present.
- Produces: updated `cancel_operational_session(text,text)`, `withdraw_operational_rsvp(uuid)`, and `reopen_operational_rsvp(text)` RPCs.
- Preserves: existing signatures used by `operations.js`.

- [ ] **Step 1: Write failing migration safety checks**

The safety script must assert the migration contains:

```bash
rg -q "'wnt'.*'run'.*'water'|activity_id in .*wnt" "$migration"
rg -q "requires_rsvp" "$migration"
rg -q "cancellation_source" "$migration"
rg -q "for update" "$migration"
rg -q "Asia/Hong_Kong" "$migration"
rg -q "operational_session_cancelled" "$migration"
rg -q "operational_rsvp_reopened" "$migration"
```

It must reject wildcard grants, direct anon/authenticated table mutation grants, and RSVP deferral in the RSVP branch.

- [ ] **Step 2: Run the safety script and verify failure**

Run:

```bash
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
```

Expected: failure because the migration does not exist.

- [ ] **Step 3: Create the migration schema changes and recurring templates**

The migration must expand template ID constraints, add cancellation metadata safely, seed/upsert `wnt`, `run`, and `water` with zero price/null capacity/RSVP required, set existing zero-price `event-%` templates to RSVP required, and invoke `ensure_operational_sessions(current_date, 16)` after templates exist.

Do not rewrite historical rows destructively. Backfill existing cancelled RSVP bookings conservatively only where the source can be proven; otherwise leave metadata null.

- [ ] **Step 4: Implement RSVP-aware member and Admin RPCs**

`withdraw_operational_rsvp` sets booking status, timestamp, and source `member` only for the caller’s active confirmed zero-price RSVP before Hong Kong start.

The cancellation dispatcher must lock the session, detect explicit `requires_rsvp`, and route zero-price RSVP sessions to an atomic branch that sets session cancellation fields, cancels only active confirmed RSVP rows with source `session`, and inserts linked per-profile notifications. It must return before paid deferral logic.

`reopen_operational_rsvp` must lock the cancelled session, reject started/non-RSVP occurrences, capture recipients whose booking `cancelled_at` matches the occurrence cancellation and source is `session`, clear the session cancellation fields, and insert one reopening notification per captured profile. Old bookings remain cancelled.

- [ ] **Step 5: Add disposable integration assertions**

The SQL integration test must prove unauthorized rejection, member RSVP and withdrawal, duplicate prevention, attendee privacy, cancellation without deferral, cancellation notification targeting, reopening recipient targeting, fresh RSVP after reopen, and unchanged future occurrence state. Wrap destructive setup in a transaction and roll it back.

- [ ] **Step 6: Run static safety and app smoke**

Run:

```bash
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
node app/smoke.mjs
```

Expected: pass. Record disposable database integration as unexecuted unless both `ITC_AVATAR_TEST_DATABASE_URL` (or a new explicitly named reset-safe URL) and the reset acknowledgement are supplied.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql supabase/tests/free_event_rsvp_cancellation_safety.sh supabase/tests/free_event_rsvp_cancellation_integration.sql app/smoke.mjs
git commit -m "feat(events): add authoritative free RSVP sessions"
```

---

### Task 3: Hydrate live free sessions without duplicates

**Files:**
- Modify: `app/js/operations.js`
- Modify: `app/js/store.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Produces: normalized live sessions with `requiresRsvp: boolean`.
- Produces: `kind: "free"` for `wnt`, `run`, `water`, and zero-price `event-*`; Lunch remains `kind: "rsvp"`.
- Consumes: Task 2 operational templates and generated sessions.

- [ ] **Step 1: Add failing live hydration tests**

Extend the live-auth fixture with `wnt`, `run`, and `water` templates and dated sessions. Assert:

```js
const freeSessions = store.upcomingSessions(21).filter((s) => ["wnt", "run", "water"].includes(s.activityId));
assert.equal(freeSessions.length, 3);
assert.ok(freeSessions.every((s) => s.kind === "free" && s.requiresRsvp));
assert.equal(new Set(freeSessions.map((s) => s.id)).size, freeSessions.length);
```

Also assert a new zero-price one-off is returned as `kind: "free"`, `requiresRsvp: true`, and null capacity.

- [ ] **Step 2: Run live-auth smoke and verify failure**

Run `node app/live-auth-smoke.mjs`. Expected: duplicate/missing free sessions or wrong kind/RSVP capability.

- [ ] **Step 3: Normalize template and session capability**

Map `requires_rsvp` to `requiresRsvp`. Keep Lunch’s RSVP presentation; map the three recurring free IDs and zero-price `event-*` IDs to `kind: "free"`. Ensure one-off creation sends `p_requires_rsvp: true` whenever price is zero and sends null capacity for free events.

- [ ] **Step 4: Remove live-mode local free occurrence generation**

In `upcomingSessions`, use operational sessions as the sole live occurrence source. Merge seed presentation fields by `activityId`, not by generating a second occurrence. Keep local-mode recurrence generation unchanged.

- [ ] **Step 5: Run hydration and regression tests**

Run:

```bash
node app/live-auth-smoke.mjs
node app/smoke.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/js/operations.js app/js/store.js app/live-auth-smoke.mjs app/smoke.mjs
git commit -m "feat(events): hydrate authoritative free RSVP sessions"
```

---

### Task 4: Add member RSVP controls and attendee lists to free events

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/rsvp-whos-coming-smoke.mjs`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `store.sessionRequiresRsvp(session)` and existing `store.rsvpSession`, `store.withdrawRsvp`, attendee-name/avatar resolver, and duplicate-submit guards.
- Produces: **I’m coming**, **Can’t make it**, and member-only **Who’s coming** UI for free events.

- [ ] **Step 1: Add failing rendering and interaction tests**

Assert that an upcoming free session renders the Free badge, walk-in copy, **I’m coming**, and no checkout/payment/capacity copy. After RSVP, assert the page renders going state, **Can’t make it**, and roster names. Assert visitor/pending views omit controls and attendee identities. Assert cancelled/started views omit RSVP actions.

- [ ] **Step 2: Run focused UI smoke and verify failure**

Run:

```bash
node app/rsvp-whos-coming-smoke.mjs
node app/smoke.mjs
```

Expected: free sessions still render only calendar/directions actions.

- [ ] **Step 3: Generalize member event rendering**

Replace `kind === "rsvp"` participation checks with `sessionRequiresRsvp`. Keep Free badge/copy for `kind: "free"`; add concise “RSVP helps the team plan; walk-ins are welcome” copy. Reuse the current roster avatar markup and approved-role boundary.

- [ ] **Step 4: Generalize delegated RSVP actions**

Route free-event **I’m coming** and withdrawal through the existing handlers. Preserve route, suppress duplicate submits, show busy/error status, and refresh the occurrence, count, roster, and notification state on success.

- [ ] **Step 5: Run focused and full app smoke**

Run the Task 4 commands. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/js/views.js app/js/app.js app/rsvp-whos-coming-smoke.mjs app/smoke.mjs
git commit -m "feat(events): add free event RSVP experience"
```

---

### Task 5: Extend Admin cancellation, reopening, and targeted change notifications

**Files:**
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/js/store.js`
- Modify: `app/js/operations.js`
- Modify: `app/live-auth-smoke.mjs`
- Modify: `app/smoke.mjs`
- Modify: `supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql`
- Modify: `supabase/tests/free_event_rsvp_cancellation_safety.sh`
- Modify: `supabase/tests/free_event_rsvp_cancellation_integration.sql`

**Interfaces:**
- Consumes: Task 2 cancellation/reopen RPCs and Task 1 capability predicate.
- Produces: per-occurrence cancel/reopen Admin controls and RSVP-targeted venue/time notifications.

- [ ] **Step 1: Add failing Admin and notification tests**

Assert every upcoming free/RSVP Admin card displays attendee count and cancellation form. After cancellation assert reason/state, no future occurrence cancellation, and a reopen action. Assert blank reason and post-start reopening fail. Verify cancellation, venue, time, and reopening notify active/affected RSVP members exactly once and do not notify visitors, withdrawn members, or unrelated approved members.

- [ ] **Step 2: Run app and live-auth smoke to verify failure**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: cancellation controls are limited to `kind === "rsvp"` and change notifications are not RSVP-targeted.

- [ ] **Step 3: Generalize Admin controls and handlers**

Render cancellation for all RSVP-enabled free/RSVP occurrences. Render reopening only when cancelled and before start. Keep reason input on failure, set `aria-busy`, disable duplicate submission, and preserve the current Admin route. Generalize the existing repost handler copy to **Reopen event**.

- [ ] **Step 4: Target local venue/time notifications**

In local mode, derive recipients from active confirmed bookings for the occurrence. Send one linked notification per recipient when the effective venue or start time changes; unchanged submissions create none. Preserve existing Admin audit notifications.

- [ ] **Step 5: Target live venue/time notifications transactionally**

Extend the migration’s venue/time RPC definitions so effective changes insert one destination-aware notification for each active confirmed RSVP profile. Do not notify unrelated members or emit duplicates for unchanged values. Preserve existing signatures and WNT meeting-point validation.

- [ ] **Step 6: Run safety, app, and live-auth tests**

Run:

```bash
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add app/js/views.js app/js/app.js app/js/store.js app/js/operations.js app/live-auth-smoke.mjs app/smoke.mjs supabase/migrations/20260920000001_free_event_rsvp_cancellation.sql supabase/tests/free_event_rsvp_cancellation_safety.sh supabase/tests/free_event_rsvp_cancellation_integration.sql
git commit -m "feat(admin): manage every free event occurrence"
```

---

### Task 6: Final integration, documentation, and deployment readiness

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/live-auth.md`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: deployment order, rollback guidance, authenticated acceptance checklist, and final regression evidence.

- [ ] **Step 1: Add failing documentation markers**

Add smoke assertions requiring the runbook to mention migration `20260920000001`, authoritative recurring free sessions, RSVP-aware cancellation without deferral, reopening semantics, in-app-only notifications, and frontend-after-database deployment order.

- [ ] **Step 2: Run app smoke and verify failure**

Run `node app/smoke.mjs`. Expected: missing runbook markers.

- [ ] **Step 3: Update README and live runbook**

Document the member/Admin behavior, migration and deployment order, generated-session verification queries, notification recipient checks, authenticated mobile acceptance, and access-first rollback. State explicitly that Web Push/service workers/phone sounds are deferred.

- [ ] **Step 4: Run complete verification**

Run:

```bash
node app/avatar-smoke.mjs
node app/smoke.mjs
node app/live-auth-smoke.mjs
node app/replacement-operations-smoke.mjs
node app/rsvp-whos-coming-smoke.mjs
bash supabase/tests/free_event_rsvp_cancellation_safety.sh
git diff --check
git status --short --branch
```

If a reset-safe disposable database is explicitly supplied, run the SQL integration wrapper with the reset acknowledgement; otherwise record it as unexecuted without claiming database integration passed.

- [ ] **Step 5: Review the branch against the approved spec**

Confirm every acceptance point in the spec maps to an automated check or a clearly listed authenticated manual check. Inspect the branch diff to ensure no Shop files, service worker, push subscription, direct browser table mutation, or unrelated refactor was introduced.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/runbooks/live-auth.md app/smoke.mjs
git commit -m "docs(events): add free RSVP deployment runbook"
```
