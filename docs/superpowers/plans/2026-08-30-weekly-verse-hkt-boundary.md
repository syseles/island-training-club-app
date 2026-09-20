# Weekly Verse HKT Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `weeklyVerse(date)` rotate deterministically at Sunday 00:00:00 Asia/Hong_Kong, independent of browser or host timezone.

**Architecture:** Format the supplied `Date` instant into Hong Kong calendar parts, convert those parts to an integer UTC calendar-day serial, and floor-divide from Sunday 2026-07-26 HKT. UTC is used only for DST-free calendar arithmetic; normalized modulo selects the unchanged verse array.

**Tech Stack:** Plain JavaScript ES modules and Node smoke tests.

## Global Constraints

- Work only on `feature/update-existing`; preserve the `weeklyVerse(date)` API and verse order.
- Keep the Sunday-first Schedule change and its tests intact.
- Do not modify, stage, or commit pre-existing untracked files; stage explicit intended paths only.
- Add no dependencies, build step, or state migration; do not push or merge.

## Approved Behaviour Spec

- The epoch is Hong Kong calendar Sunday `2026-07-26`, which selects `WEEKLY_VERSES[0]`.
- The selection changes exactly at `2026-07-25T16:00:00.000Z`, including on hosts set to Asia/Hong_Kong or America/Los_Angeles.
- A missing argument means the current instant, not browser-local midnight.
- Instants before the epoch use floor-based week indexing and normalized negative modulo.
- Announcement formatting and seeds remain unchanged by the verse refinement.

---

### Task 1: Add deterministic regression coverage

**Files:**
- Modify/Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: `weeklyVerse(date)` and `WEEKLY_VERSES`
- Produces: literal checks for the HKT boundary, cross-timezone determinism, pre-epoch rotation, and retained Sunday Schedule behaviour

- [ ] Add hand-checked assertions at one second and one millisecond before the epoch boundary, at the boundary, at the next weekly boundary, and for negative/wrapped pre-epoch indices.
- [ ] Spawn Node children with `TZ=Asia/Hong_Kong` and `TZ=America/Los_Angeles` for the same fixed instant and require the same literal verse reference.
- [ ] Run `TZ=America/Los_Angeles node app/smoke.mjs` and confirm RED because the current browser-local calculation selects the prior verse at the HKT boundary.

### Task 2: Implement integer HKT calendar arithmetic

**Files:**
- Modify: `app/js/data.js`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: a supplied `Date` instant, defaulting to `new Date()`
- Produces: the existing verse object selected from unchanged `WEEKLY_VERSES`

- [ ] Extract Hong Kong year/month/day parts with `Intl.DateTimeFormat(..., { timeZone: "Asia/Hong_Kong" })`.
- [ ] Convert HKT parts and the literal `2026-07-26` epoch to integer UTC day serials, use `Math.floor(dayDelta / 7)`, then normalize modulo.
- [ ] Leave announcement formatting and seeds unchanged.
- [ ] Run smoke under both required timezones and keep all Sunday Schedule assertions green.

### Task 3: Verify scope and commit intended paths only

**Files (3 final committed paths):**
- Modify: `app/js/data.js`
- Modify: `app/smoke.mjs`
- Create: `docs/superpowers/plans/2026-08-30-weekly-verse-hkt-boundary.md`

**Interfaces:**
- Produces: one local commit on `feature/update-existing`

- [ ] Run smoke and live-auth smoke under Asia/Hong_Kong and America/Los_Angeles, JavaScript syntax checks, and `git diff --check`.
- [ ] Review the working diff and compare the final untracked list with the recorded baseline.
- [ ] Stage only the three final committed paths listed above, inspect the cached diff, commit, and do not push or merge.
