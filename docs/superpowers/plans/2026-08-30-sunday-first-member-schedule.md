# Sunday-First Member Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the member-facing Schedule use Sunday–Saturday weeks while preserving Monday-based Home and Admin semantics.

**Architecture:** Add a general pure `sundayOf(date)` boundary helper in `data.js` and a pure Schedule selection helper in `views.js`. Make both rendering and app week navigation consume those helpers so the visible range, selected fallback, and navigation agree.

**Tech Stack:** Plain JavaScript ES modules, string-template views, Node smoke tests.

## Global Constraints

- Work on `feature/update-existing` only.
- Change only member-facing Schedule behaviour and its regression coverage.
- Keep Home and Admin payment-duty/operational week calculations Monday-based.
- Do not modify, delete, stage, or commit any pre-existing untracked file.
- Add no dependencies, build step, or localStorage schema changes.
- Stage intended paths explicitly; never use `git add -A`.

---

### Task 1: Specify Sunday boundaries and Schedule navigation

**Files:**
- Modify: `app/smoke.mjs`
- Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: existing `data`, `views`, and `views.scheduleState` smoke-test imports
- Produces: failing behaviour checks for `data.sundayOf(date)` and `views.scheduleSelectionForWeek(referenceDate, weekOffset)`

- [ ] **Step 1: Write failing boundary and navigation tests**

Add literal assertions for:

```js
data.isoDate(data.sundayOf(data.parseISO("2026-08-09"))) === "2026-08-09"
data.isoDate(data.sundayOf(data.parseISO("2026-08-10"))) === "2026-08-09"
data.isoDate(data.sundayOf(data.parseISO("2026-08-15"))) === "2026-08-09"
views.scheduleSelectionForWeek(data.parseISO("2026-08-12"), 0) === "2026-08-12"
views.scheduleSelectionForWeek(data.parseISO("2026-08-12"), 1) === "2026-08-16"
views.scheduleSelectionForWeek(data.parseISO("2026-08-12"), -1) === "2026-08-02"
views.scheduleSelectionForWeek(data.parseISO("2026-08-09"), 1) === "2026-08-16"
```

Also render the current and a non-current Schedule week and assert the literal Sunday-first labels, the Sunday “Week of” date, today selected in offset zero, and Sunday selected outside offset zero.

- [ ] **Step 2: Run the smoke test to verify RED**

Run: `node app/smoke.mjs`

Expected: FAIL because `data.sundayOf` and/or `views.scheduleSelectionForWeek` do not exist and the rendered Schedule remains Monday-first.

- [ ] **Step 3: Preserve the red output for the implementation checkpoint**

Confirm the failure names the missing Sunday-first behaviour rather than a syntax or fixture error.

---

### Task 2: Implement one Sunday-first Schedule contract

**Files:**
- Modify: `app/js/data.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`

**Interfaces:**
- Consumes: `addDays(date, count)`, `todayLocal()`, `isoDate(date)`, and `scheduleState.weekOffset`
- Produces: `sundayOf(date): Date` and `scheduleSelectionForWeek(referenceDate = todayLocal(), weekOffset = 0): string`

- [ ] **Step 1: Add the minimal pure Sunday helper**

Implement beside `mondayOf`:

```js
export function sundayOf(date) {
  return addDays(new Date(date.getTime()), -date.getDay());
}
```

- [ ] **Step 2: Make Schedule rendering Sunday-first**

Import `sundayOf` in `views.js`. Add `scheduleSelectionForWeek`, derive the visible start with:

```js
const weekStart = addDays(sundayOf(referenceDate), weekOffset * 7);
```

Return today for offset zero and `weekStart` for non-zero offsets. Use that helper for a missing selection, generate sessions and cells from the Sunday `weekStart`, render labels in `Sun` through `Sat` order, and display that Sunday in “Week of”. Do not change `viewHome()` or Admin calculations.

- [ ] **Step 3: Make app navigation use the same fallback**

After incrementing `scheduleState.weekOffset`, set:

```js
scheduleState.selected = views.scheduleSelectionForWeek(todayLocal(), scheduleState.weekOffset);
```

Remove only imports made unused by this Schedule navigation refactor.

- [ ] **Step 4: Update Schedule-only test calculations**

Change booked-session Schedule offset setup from `mondayOf` to `sundayOf`. Leave Home test calculations on `mondayOf`.

- [ ] **Step 5: Run smoke to verify GREEN**

Run: `node app/smoke.mjs`

Expected: all smoke tests pass, including explicit Sunday boundary and navigation messages.

- [ ] **Step 6: Refactor names without changing behaviour**

Use `weekStart` rather than a weekday-specific local variable throughout the Schedule renderer. Re-run `node app/smoke.mjs` after refactoring.

---

### Task 3: Verify and commit only intended files

**Files:**
- Modify: `app/js/data.js`
- Modify: `app/js/views.js`
- Modify: `app/js/app.js`
- Modify: `app/smoke.mjs`
- Create: `docs/superpowers/specs/2026-08-30-sunday-first-member-schedule-design.md`
- Create: `docs/superpowers/plans/2026-08-30-sunday-first-member-schedule.md`

**Interfaces:**
- Consumes: completed Sunday-first implementation
- Produces: one verified commit with only the six intended paths

- [ ] **Step 1: Run full requested verification**

Run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
node --check app/js/data.js
node --check app/js/views.js
node --check app/js/app.js
node --check app/smoke.mjs
node --check app/live-auth-smoke.mjs
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Review scope and untracked preservation**

Run `git diff -- app/js/data.js app/js/views.js app/js/app.js app/smoke.mjs docs/superpowers/specs/2026-08-30-sunday-first-member-schedule-design.md docs/superpowers/plans/2026-08-30-sunday-first-member-schedule.md`, compare `git ls-files --others --exclude-standard` with the pre-change snapshot, and verify no Home/Admin week calculation changed.

- [ ] **Step 3: Stage explicit paths and inspect the index**

```bash
git add app/js/data.js app/js/views.js app/js/app.js app/smoke.mjs docs/superpowers/specs/2026-08-30-sunday-first-member-schedule-design.md docs/superpowers/plans/2026-08-30-sunday-first-member-schedule.md
git diff --cached --check
git diff --cached --name-status
```

Expected: exactly the six intended paths; no `.superpowers` or unrelated image/document path.

- [ ] **Step 4: Commit without pushing or merging**

```bash
git commit -m "feat(schedule): start member weeks on Sunday"
```

- [ ] **Step 5: Record final evidence**

Capture `git rev-parse HEAD`, `git show --stat --oneline --summary HEAD`, `git status --short --untracked-files=all`, and the exact untouched pre-existing untracked list for the final response.
