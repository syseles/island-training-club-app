# Skip Cancelled Social Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ensure the Community card selects the earliest upcoming non-cancelled Socials event.

**Architecture:** Keep `store.nextSocialSession()` as the single selection seam. Exclude cancelled sessions before applying the existing Hong Kong rolling seven-day start-time window. Preserve cancelled event records; a future repost should create a new one-off event rather than reverse cancellation state.

**Tech Stack:** Vanilla ES modules, localStorage-backed store, Node smoke tests.

**Spec:** User report from the Community preview: skip the cancelled 5 September Social and show the next available Social.

## Global Constraints

- Keep the implementation on `feature/rsvp-events`.
- Include recurring and one-off events categorized `Socials`.
- Preserve the rolling seven-day HKT event-start boundary.
- Do not restore cancelled records or alter cancellation history.
- Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, and `git diff --check` before completion.

---

### Task 1: Exclude cancelled Socials from the Community preview

**Files:**
- Modify: `app/js/store.js` in `nextSocialSession()`
- Test: `app/smoke.mjs` in Generic Socials preview coverage

**Interfaces:**
- Consumes: `upcomingSessions(8)` and existing `session.cancelled` decoration.
- Produces: `nextSocialSession()` returning the earliest non-cancelled Socials session in the existing rolling window, or `null`.

- [ ] **Step 1: Write the failing regression test**

In the existing generic Socials fixture, create a Social one day from today before the expected breakfast, cancel it with `store.cancelSessionWeek()`, then assert the breakfast remains selected:

```js
const cancelledSocial = await store.createOneOffEvent({
  name: "Cancelled Community Social",
  dateISO: datePlus(1),
  time: "07:30",
  durationMin: 90,
  location: "Central",
  mapsQuery: "Central, Hong Kong",
  category: "Socials",
  price: 0,
  capacity: 20,
});
store.cancelSessionWeek(cancelledSocial.id, "Venue unavailable");
```

Keep the existing `earliestSocial` assertion unchanged so the current implementation fails by selecting the cancelled event.

- [ ] **Step 2: Run the smoke test and verify it fails**

Run: `node app/smoke.mjs`

Expected: FAIL because `nextSocialSession()` currently accepts a cancelled Socials session.

- [ ] **Step 3: Implement the minimal selector fix**

Update the candidate predicate in `app/js/store.js`:

```js
if (session.category !== "Socials" || session.cancelled) return false;
```

Leave the HKT start-time calculation and rolling boundary unchanged.

- [ ] **Step 4: Run verification**

Run:

```bash
node app/smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
 git diff --check
```

Expected: all suites pass and `git diff --check` is clean.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/smoke.mjs docs/superpowers/plans/2026-09-05-skip-cancelled-social-preview.md
git commit -m "fix(community): skip cancelled social previews"
```

### Task 2: Repost policy recommendation

Do not implement uncancellation in this fix. An approved Admin may repost a cancelled Social only by creating a new one-off event with a new ID/date, preserving the cancelled event and any RSVP/refund/notification history. If the product later needs a one-click control, implement it as an Admin-only “Repost” action that copies event fields into the existing create-event flow and requires a new date/time confirmation.
