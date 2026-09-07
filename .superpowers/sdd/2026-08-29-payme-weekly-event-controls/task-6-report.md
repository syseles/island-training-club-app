# Task 6 Report: Keep operational sessions visible when payout enrichment degrades

## Status

Implemented and self-reviewed in the `feature/admin-ops` worktree.

Assigned collector payout enrichment now degrades independently. Core operational sessions, templates, bookings, queues, receipts, assignments, direct payout rows, and venue overrides still hydrate when the optional assigned-payout RPC is unavailable or rejects the caller. Successful enrichment still merges assigned collector payout rows and clears the payout-only status error.

The payout form now captures native `FormData` before `withBusyControl()` disables its inputs.

## Changes

- `app/js/operations.js`
  - Added always-settling `fetchAssignedPayoutRows()`.
  - Removed assigned-payout enrichment from the fatal core-result loop.
  - Preserved direct RLS-visible payout rows and successful assigned-row enrichment.
  - Added cache payload/status field `payoutError`, cleared on successful enrichment.
- `app/js/app.js`
  - Captures payout `FormData` before disabling all payout controls.
- `app/js/store.js`
  - Forwards the brief's `{ force: true }` option to operational hydration so isolated forced-hydration tests execute the RPC instead of returning the loaded cache.
- `app/live-auth-smoke.mjs`
  - Covers function-unavailable, permission-denied, and membership-required payout RPC failures.
  - Covers anonymous, pending, and declined operational roles.
  - Covers Admin paid controls, core status isolation, successful recovery, direct payout rows, and assigned payout enrichment.
  - Makes the focused payout `FormData` fixture omit disabled controls like native browser behavior.

## TDD Evidence

### RED: forced hydration contract

Command:

```bash
node app/live-auth-smoke.mjs
```

Observed failure before changing `app/js/store.js`:

```text
AssertionError: function unavailable test must exercise a forced assigned-payout hydration
1 !== 2
```

This proved `store.hydrateLiveOperations({ force: true })` did not forward `force`. The minimal seam fix forwards the option.

### RED: payout RPC incorrectly aborted core hydration

Command:

```bash
node app/live-auth-smoke.mjs
```

Observed failure after forced hydration was active and before changing `app/js/operations.js`:

```text
Error: Could not find the function public.get_assigned_collector_payout_profiles without parameters in the schema cache
    at operationalProblem (.../app/js/operations.js:286:10)
    at .../app/js/operations.js:377:25
    at async Module.hydrateOperationalState (.../app/js/operations.js:386:12)
    at async Module.hydrateLiveOperations (.../app/js/store.js:92:3)
```

This was the expected product RED: the optional RPC error participated in the fatal hydration loop.

### GREEN: degraded hydration and recovery

Command:

```bash
node app/live-auth-smoke.mjs
```

Observed after isolating enrichment:

```text
ok  payout RPC degradation preserves sessions and successful enrichment recovers
```

The suite also completed with exit code 0.

### RED: browser-faithful payout form

Command:

```bash
node app/live-auth-smoke.mjs
```

Observed after the fake omitted disabled controls and before changing `app/js/app.js`:

```text
AssertionError: Expected values to be strictly deep-equal:
actual:   { p_profile_id: 'live-user-1', p_payme_link: '', p_fps_phone: '' }
expected: { p_profile_id: 'live-user-1', p_payme_link: 'https://payme.hsbc.com.hk/1/rejected-live', p_fps_phone: '' }
```

At the assertion point, both payout input and submit controls were disabled and the RPC remained pending. This proved `FormData` was being created too late.

### GREEN: payout payload captured before disable

Command:

```bash
node app/live-auth-smoke.mjs
```

Observed after moving the snapshot:

```text
ok  rejected live payout preserves prior cache and restores its busy form
ok  successful live payout persists only after RPC settlement
```

The suite completed with exit code 0.

## Full Verification

Commands run:

```bash
node app/smoke.mjs
node app/live-auth-smoke.mjs
bash supabase/tests/verify_operational_backend_safety.sh
git diff --check
```

Results:

- `node app/smoke.mjs`: exit 0; `All smoke tests passed.`
- `node app/live-auth-smoke.mjs`: exit 0, including degraded hydration and payout form regressions.
- Backend safety verifier: exit 0; `Safety verifier passed: gate rejects unsafe conditions.` No disposable database URL was configured, so this verified refusal gates only.
- `git diff --check`: exit 0 with no output.

## Self-Review

No Critical or Important findings.

Verified against the brief:

- Assigned payout RPC failures populate only `payoutError`; core `error` remains null.
- Core operational table errors remain in the fatal loop and are not suppressed.
- Direct RLS-visible payout rows remain hydrated during payout enrichment degradation.
- Successful assigned payout enrichment remains available and clears prior `payoutError`.
- Paid and RSVP sessions remain in the operational schedule source for anonymous, pending, declined, and approved identities.
- Admin Activities retains paid-session controls for all three enrichment failure modes.
- Payout `FormData` is captured before controls disable; the form remains the busy key and all inputs/buttons remain disabled while pending.

Pi did not expose a subagent tool, so the requested review was performed directly against the complete diff and requirements.

## Concern / Deployment Note

Do not infer that migration `00005` is deployed. Graceful degradation keeps sessions and Admin paid controls available without the RPC, but cold-member assigned collector payout enrichment still requires the deployed migration and its permissions.
