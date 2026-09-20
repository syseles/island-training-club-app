# Final Approval Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final approval review’s timezone, rendered-SQL validation, and per-run UUID isolation gaps without changing production migrations.

**Architecture:** Keep application behavior unchanged and correct only the local smoke fixture plus operational test infrastructure. Validate the real concurrency harness at its captured `psql` SQL boundary, including exact paid lock targeting, UUID relationships, cross-run uniqueness, adversarial mutations, and cleanup behavior.

**Tech Stack:** Vanilla Node.js smoke tests, Bash harnesses, Python 3 capture validation, PostgreSQL SQL rendered through fake `psql`.

**Spec:** `/tmp/integration-final-approval-review2.out`

## Global Constraints

- Test-first: observe each requested regression fail before its implementation passes.
- Do not edit production migrations; preserve `20260829000005` through `20260829000008` byte-for-byte.
- Preserve paid/RSVP fixture semantics, bounded concurrency, child-first cleanup, and original exit status.
- Run six local/live smoke variants, HTML/syntax checks, every safety script, harness capture validation, and diff checks.
- PostgreSQL runtime is unavailable; make no database-runtime or production-readiness claim.
- Commit locally only; do not push or fast-forward `testing`.

---

### Task 1: HKT-anchored generic Social smoke fixture

**Files:**
- Modify/Test: `app/smoke.mjs`

**Interfaces:**
- Consumes: `data.todayHktISO()`, `data.parseISO()`, `data.addDays()`, `data.isoDate()`.
- Produces: Generic Social dates anchored to the HKT calendar contract under every host timezone.

- [ ] Run `TZ=America/Los_Angeles node app/smoke.mjs` and capture the existing date-contract failure.
- [ ] Replace the generic Social block’s `todayLocal()` anchor with `parseISO(todayHktISO())` and assert that day zero equals the HKT ISO date before creating fixtures.
- [ ] Re-run the Los Angeles local smoke and confirm the rolling-window semantics pass.

### Task 2: Exact paid `FOR SHARE` lock validation

**Files:**
- Modify/Test: `supabase/tests/verify_operational_backend_safety.sh`
- Modify: `supabase/tests/verify_operational_rsvp_capture.py`

**Interfaces:**
- Consumes: captured setup SQL and the holder connection’s real `SELECT ... FOR SHARE` SQL.
- Produces: validation that the one paid lock literal equals the setup’s paid session, not merely any setup session.

- [ ] Add a `wrong-paid-lock-target` mutation that changes only the holder call from the paid session to a valid RSVP session and expect validator exit 1.
- [ ] Run operational safety and confirm the mutation is incorrectly accepted before the validator fix.
- [ ] Parse exactly one captured operational-session `FOR SHARE` call and compare its SQL literal with the paid session derived from setup semantics.
- [ ] Re-run operational safety and confirm both the new adversary and all existing exact-semantics mutations pass their expected gates.

### Task 3: Token-derived per-run UUID isolation

**Files:**
- Modify/Test: `supabase/tests/verify_operational_backend_safety.sh`
- Modify: `supabase/tests/verify_operational_rsvp_capture.py`
- Modify: `supabase/tests/operational_rsvp_concurrency.sh`

**Interfaces:**
- Consumes: one run token and captured auth user/profile/booking SQL.
- Produces: six distinct valid token-derived UUIDs per run; exact propagation through setup, authenticated connections, booking mutations, and cleanup; distinct UUID sets across two runs.

- [ ] Extend capture validation to parse valid auth/profile/booking UUID relationships and reject UUID overlap across the two captures; run safety to observe fixed harness UUIDs fail.
- [ ] Generate a 32-hex per-run token and derive three member/profile UUIDs plus three booking UUIDs from it; propagate existing variables through all SQL and cleanup.
- [ ] Add a `cross-run-uuid-collision` mutation that rewrites one captured run to the other run’s valid UUID set and require validator exit 1.
- [ ] Re-run operational safety and Python/shell syntax checks.

### Task 4: Evidence and final verification

**Files:**
- Modify: `.superpowers/sdd/2026-08-30-testing-feature-integration/final-fix-report.md`
- Modify as appropriate: `.superpowers/sdd/2026-08-30-testing-feature-integration/harness-fix-rereview.md`

**Interfaces:**
- Produces: accurate RED/GREEN evidence, current check matrix, and remaining PostgreSQL/deployment caveats.

- [ ] Record the timezone RED, paid-lock false-positive RED, fixed-UUID RED, adversarial mutation proof, and implementation scope.
- [ ] Run local/live smoke under default, `Asia/Hong_Kong`, and `America/Los_Angeles`; run HTML, JS/MJS, shell, and Python syntax; run all safety scripts; inspect immutable migrations and `git diff --check`/final diff.
- [ ] Confirm PostgreSQL remains unavailable, inspect status, commit the approved files locally, and report the commit/checks/remaining concerns without pushing or updating `testing`.
