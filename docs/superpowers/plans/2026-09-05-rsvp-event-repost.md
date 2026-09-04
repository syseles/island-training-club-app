# RSVP Event Repost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an approved Admin repost a cancelled RSVP event as a new event without reversing the original cancellation.

**Architecture:** Add `store.repostRsvpEvent(sessionId)` as the single action seam. It validates a cancelled, future RSVP session and delegates to the existing one-off-event creation path with `requiresRsvp: true`; the new event receives a new ID while the cancelled source and its history remain unchanged. Extend the live creation RPC to persist the RSVP flag on the inactive event template.

**Tech Stack:** Vanilla ES modules, Supabase SQL RPCs, localStorage-backed store, Node smoke tests.

**Spec:** Admin needs a safe way to repost a cancelled RSVP Social from the existing Admin Activities controls.

> Superseded by `docs/superpowers/plans/2026-09-05-rsvp-event-reopen.md`: reposting now reopens the original session in place instead of creating a duplicate.

## Global Constraints

- Keep the implementation on `feature/rsvp-events`.
- Only approved Admin/Super Admin users may repost.
- Reposting creates a new event; it never clears cancellation metadata or restores prior RSVPs.
- Reposted events preserve RSVP behavior, price 0, category, date/time, venue, and capacity.
- No dependencies or build step.
- Run `node app/smoke.mjs`, both live-auth timezone suites, and `git diff --check` before completion.

---

### Task 1: Add the failing local repost contract

**Files:**
- Modify: `app/smoke.mjs` in local RSVP event coverage

**Interfaces:**
- Consumes: existing local `store.cancelSessionWeek()` and recurring RSVP lunch fixture.
- Produces: regression assertions for `store.repostRsvpEvent()` and Admin repost UI.

- [ ] **Step 1: Write the failing test**

Cancel the future local RSVP lunch, call `store.repostRsvpEvent(lunch.id)`, and assert the result is a distinct one-off RSVP event with the source details. Assert the Admin Activities view exposes the repost action for the cancelled source.

- [ ] **Step 2: Run the local smoke test**

Run: `cd .worktrees/rsvp-events && node app/smoke.mjs`

Expected: FAIL because `store.repostRsvpEvent` does not exist.

### Task 2: Implement local and live repost behavior

**Files:**
- Modify: `app/js/store.js`
- Modify: `app/js/operations.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/live-auth-smoke.mjs`
- Create: `supabase/migrations/20260905000001_rsvp_event_repost.sql`

**Interfaces:**
- `store.repostRsvpEvent(sessionId)` returns the newly created RSVP session.
- `store.createOneOffEvent(fields)` accepts `requiresRsvp: true` only with price 0.
- `operations.liveCreateEvent(payload)` sends `p_requires_rsvp` to the live RPC.

- [ ] **Step 1: Extend one-off creation**

Carry `requiresRsvp` through local and live creation. Local sessions use `kind: "rsvp"`; live templates persist `requires_rsvp = true`.

- [ ] **Step 2: Add the repost action**

Validate Admin authorization, cancelled state, RSVP kind, and not-started state. Copy the source fields into a new one-off event and preserve the original.

- [ ] **Step 3: Add Admin controls and delegated handler**

Show `Repost RSVP` only for cancelled RSVP sessions and invoke the store action after confirmation. Render the new event as RSVP rather than plain free attendance.

- [ ] **Step 4: Add the forward-only live migration**

Replace the nine-argument `create_operational_event` signature with a ten-argument version adding `p_requires_rsvp boolean default false`; validate price 0 for RSVP events and insert the flag into the inactive template.

- [ ] **Step 5: Add live mock/assertion coverage**

Teach the live smoke RPC mock to persist `requires_rsvp`, then cancel and repost a future RSVP fixture and assert the new session is a distinct RSVP event.

- [ ] **Step 6: Run verification**

Run:

```bash
cd .worktrees/rsvp-events
node app/smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
git diff --check
```

- [ ] **Step 7: Commit**

```bash
git add app/js/store.js app/js/operations.js app/js/views.js app/js/app.js app/smoke.mjs app/live-auth-smoke.mjs supabase/migrations/20260905000001_rsvp_event_repost.sql docs/superpowers/plans/2026-09-05-rsvp-event-repost.md
git commit -m "feat(admin): repost cancelled RSVP events"
```
