# Reopen Cancelled RSVP Event Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) but steps may be executed inline. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Admin reposting a cancelled RSVP event reopen the original session instead of creating a duplicate.

**Architecture:** Keep `store.repostRsvpEvent(sessionId)` as the UI action seam for compatibility, but make it clear the local cancellation override or call a live `reopen_operational_rsvp` RPC. The session ID remains unchanged. Previously cancelled RSVP bookings are not automatically restored; members may RSVP again.

**Tech Stack:** Vanilla ES modules, Supabase SQL RPCs, localStorage-backed store, Node smoke tests.

**Global Constraints**

- Only approved Admin/Super Admin users may reopen an event.
- Reopen only future cancelled RSVP sessions.
- Clear cancellation fields on the same session; do not create a new event.
- Keep existing cancelled booking records unchanged.
- Run local smoke, both live-auth timezone suites, and `git diff --check`.

---

### Task 1: Add failing local/live regression assertions

**Files:** `app/smoke.mjs`, `app/live-auth-smoke.mjs`

- [ ] Cancel a future RSVP fixture, assert the Admin action is present, invoke `store.repostRsvpEvent()`, and assert the original ID is active, not one-off, still RSVP, and no new event is created.
- [ ] Run the relevant suites and verify failure because the current implementation creates a new event.

### Task 2: Reopen the original event

**Files:** `app/js/store.js`, `app/js/operations.js`, `app/js/app.js`, `app/js/views.js`

- [ ] Clear only the local cancellation flag while preserving other session overrides.
- [ ] Add a live `reopen_operational_rsvp` RPC adapter and keep Admin confirmation/feedback wording accurate.
- [ ] Keep the action visible only while the RSVP session is cancelled; render restored events normally.

### Task 3: Add the live RPC migration

**File:** `supabase/migrations/20260905000002_reopen_rsvp_event.sql`

- [ ] Add an Admin-only SECURITY DEFINER RPC that locks the session, verifies it is a future cancelled RSVP, clears `cancelled_at`, `cancelled_by`, `cancelled_source`, and `cancel_reason`, and returns the same row.

### Task 4: Verify and commit

```bash
cd .worktrees/rsvp-events
node app/smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
git diff --check
git add app/js/store.js app/js/operations.js app/js/app.js app/js/views.js app/smoke.mjs app/live-auth-smoke.mjs supabase/migrations/20260905000002_reopen_rsvp_event.sql docs/superpowers/plans/2026-09-05-rsvp-event-reopen.md
git commit -m "fix(admin): reopen cancelled RSVP events"
```
