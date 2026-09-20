# Operational RSVP Dynamic Run IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each RSVP concurrency-harness invocation render unique SQL-safe activity/session IDs and make the source-only operational safety gate behaviorally prove the rendered setup, fixture semantics, and cleanup contracts without PostgreSQL.

**Architecture:** Keep the production harness as the single SQL renderer. The safety verifier will execute that harness through a controlled fake `psql`, capture every SQL payload crossing the process boundary for two complete invocations, and pass those captures to a focused Python validator. Adversarial copies of the real captures will prove each required invariant is load-bearing.

**Tech Stack:** Bash 3-compatible shell scripts, Python 3 standard library, fake `psql` process boundary, Git.

**Spec:** `/tmp/integration-final-approval-review.out` and the direct blocker instructions for this session.

## Global Constraints

- Template IDs are exactly `event-concurrency-paid-<token>` and `event-concurrency-rsvp-<token>` with a nonempty lowercase alphanumeric SQL-safe dynamic token.
- Session IDs remain exactly `activity_id-date`; all dates come from a future HKT-relative SQL query.
- Every setup, concurrent child, assertion, and cleanup `psql` call uses the invocation's exact activity/session IDs.
- Paid fixtures remain capacity `20`, price HKD `180`, `requires_rsvp=false`; RSVP fixtures remain uncapped, price HKD `0`, `requires_rsvp=true`.
- Cleanup remains bounded, kills/waits for children, deletes bookings before sessions before templates before users, and preserves the body exit status even if cleanup fails.
- PostgreSQL is unavailable; do not substitute a live/shared target.
- No Shop changes, dependencies, push, fast-forward, or production-readiness claim.

## File Structure

- `supabase/tests/operational_rsvp_concurrency.sh` — production concurrency harness and sole renderer of operational fixture SQL.
- `supabase/tests/verify_operational_rsvp_capture.py` — parse captured real `psql` payloads and enforce cross-invocation/run-level SQL contracts.
- `supabase/tests/verify_operational_backend_safety.sh` — fake-`psql` orchestration, real harness execution, mutation cases, gate/exit behavior tests.
- `.superpowers/sdd/2026-08-30-testing-feature-integration/harness-fix-report.md` — append final blocker implementation and evidence.

---

### Task 1: Behavioral Capture Gate (RED)

**Files:**
- Create: `supabase/tests/verify_operational_rsvp_capture.py`
- Modify: `supabase/tests/verify_operational_backend_safety.sh`

**Interfaces:**
- Consumes: fake-`psql` capture files whose first line is `MODE:<psql option>` and remaining bytes are the exact SQL argument/file content.
- Produces: validator CLI `python3 verify_operational_rsvp_capture.py <capture-dir> <capture-dir>` returning `0` only when both complete invocations and all cross-run invariants pass.

- [ ] **Step 1: Add a controlled fake `psql` and capture validator**

The fake must return `t` for the migration-presence probe, compute three future HKT dates for the date query, touch the holder ready-file when processing `-f`, return zero for normal SQL, and write every exact SQL payload to a unique capture file. The validator must strip SQL comments, parse actual template/session inserts and cleanup deletes, and validate exact IDs, dates, relationships, semantics, propagation, and child-first ordering.

- [ ] **Step 2: Execute the unchanged harness twice and verify RED**

Run:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: exit `1` because both unchanged invocations render fixed `event-concurrency-paid` / `event-concurrency-rsvp` IDs or because they do not match the required tokenized shape. Record the expected failure in `/tmp/integration-blocker-red-behavioral.out`.

---

### Task 2: Dynamic SQL-Safe Run Token (GREEN)

**Files:**
- Modify: `supabase/tests/operational_rsvp_concurrency.sh`
- Test: `supabase/tests/verify_operational_backend_safety.sh`

**Interfaces:**
- Consumes: process-local UTC timestamp, Bash PID, and Bash random values.
- Produces: a lowercase alphanumeric `run_token`, `event-concurrency-paid-${run_token}`, and `event-concurrency-rsvp-${run_token}` reused by every derived session ID and SQL payload.

- [ ] **Step 1: Generate and validate the token before fixture SQL**

Build the raw token from invocation-varying timestamp/PID/random inputs, sanitize it with `LC_ALL=C`, lowercase it, remove every character outside `[a-z0-9]`, and abort with exit `3` if sanitization somehow produces an empty token.

- [ ] **Step 2: Derive exact tokenized activity and session IDs**

Set:

```bash
paid_activity="event-concurrency-paid-${run_token}"
rsvp_activity="event-concurrency-rsvp-${run_token}"
paid_session="${paid_activity}-${paid_date}"
rsvp_session_a="${rsvp_activity}-${rsvp_date_a}"
rsvp_session_b="${rsvp_activity}-${rsvp_date_b}"
```

Keep all existing SQL parameterization through these variables so setup, concurrent children, assertions, and cleanup share the exact values.

- [ ] **Step 3: Run the behavioral safety gate and verify GREEN**

Run:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: both real harness invocations complete against fake `psql`; the validator reports distinct run IDs and valid setup/cleanup SQL.

---

### Task 3: Adversarial and Exit-Preservation Proofs

**Files:**
- Modify: `supabase/tests/verify_operational_backend_safety.sh`
- Test: `supabase/tests/verify_operational_rsvp_capture.py`

**Interfaces:**
- Consumes: copies of one successful real capture.
- Produces: five mutation cases that each return validator exit `1`, plus a fake body/cleanup failure run that returns the original body exit.

- [ ] **Step 1: Generate adversarial copies from actual captured SQL**

Create deterministic capture mutations for: duplicate paid/RSVP activity IDs; a session ID not equal to activity-date; a static date query with HKT text only in a SQL comment; inverted paid/RSVP capacity/price/RSVP semantics; and cleanup reordered parent-first.

- [ ] **Step 2: Assert each mutation fails through the normal validator CLI**

Use the safety script's `run_case` helper to require exit `1` for every mutation. A mutation command that cannot find and alter its intended captured SQL must itself fail the safety suite.

- [ ] **Step 3: Prove original exit behavior with the actual harness**

Configure fake `psql` to return `7` at the mark-payment body call and `99` for cleanup SQL. Execute normal harness mode and assert the observed exit remains `7`; also assert cleanup SQL was captured.

- [ ] **Step 4: Re-run the operational safety gate**

Run:

```bash
bash supabase/tests/verify_operational_backend_safety.sh
```

Expected: all baseline gate cases, two real capture runs, five adversarial failures, and original-exit preservation pass.

---

### Task 4: Evidence, Full Regression, and Commit

**Files:**
- Modify: `.superpowers/sdd/2026-08-30-testing-feature-integration/harness-fix-report.md`
- Verify: all changed files and existing integration gates.

**Interfaces:**
- Consumes: fresh command output after final code changes.
- Produces: one scoped commit and an evidence report that clearly marks PostgreSQL runtime unavailable.

- [ ] **Step 1: Run six smoke suites**

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
TZ=Asia/Hong_Kong node app/smoke.mjs
TZ=Asia/Hong_Kong node app/live-auth-smoke.mjs
TZ=America/Los_Angeles node app/smoke.mjs
TZ=America/Los_Angeles node app/live-auth-smoke.mjs
```

- [ ] **Step 2: Run HTML, syntax, all safety, and diff/provenance gates**

Run `node app/test-html.mjs`; `node --check` for every tracked JS/MJS; `bash -n` for every tracked shell file; `python3 -m py_compile` for the new validator; every tracked `*_safety.sh`; feature ancestry and exact merge-parent checks; immutable migration comparisons for `00005`–`00008`; protected-file, conflict-marker, Shop-scope, retired-QR, stale-doc, forward-SQL-order, `git diff --check`, and status checks.

- [ ] **Step 3: Append the report with RED/GREEN and unavailable-runtime evidence**

Record the duplicate-ID false positive, behavioral RED, two-run capture proof, all five mutation proofs, body-exit `7` versus cleanup-exit `99`, six smoke summaries, syntax/safety/diff results, and unavailable `psql`/database/Docker constraints.

- [ ] **Step 4: Request a scoped code review and address any Critical/Important finding**

Review the blocker diff against `566bbee`, emphasizing fake-boundary fidelity, parser false positives/negatives, shell portability, cleanup exit handling, and bounded scope.

- [ ] **Step 5: Commit without push or fast-forward**

```bash
git add supabase/tests/operational_rsvp_concurrency.sh \
  supabase/tests/verify_operational_rsvp_capture.py \
  supabase/tests/verify_operational_backend_safety.sh \
  docs/superpowers/plans/2026-08-30-operational-rsvp-dynamic-run-ids.md \
  .superpowers/sdd/2026-08-30-testing-feature-integration/harness-fix-report.md
git commit -m "fix(integration): isolate RSVP concurrency harness runs"
```

Expected: one commit on `work/testing-latest-integration`, clean worktree, no push, and no Testing fast-forward.
