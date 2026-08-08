# Task 1 Report — Missing-Schema Admin State on Giving Source

## Status

**GREEN** — Source fix landed on `feature/giving-page` at `4044237`. View boundaries now translate a single, exact PostgREST signal (`PGRST205`) into a clear "Giving setup required" panel that names the two outstanding migrations. The store stays authoritative (no swallowing, no fake data, no remote migration), and every other error continues to reject so callers can react.

## Commit

```
4044237 fix(giving): explain missing campaign schema
1464add docs(giving): plan missing-schema Admin state
```

Commit is local only; not pushed.

## TDD evidence

### RED — before the source fix

`node app/live-auth-smoke.mjs` aborted with the injected schema-missing error reaching the top of the event loop:

```
ok  live Giving store mapping, checked mutations, transitions, and role guards
node:internal/modules/run_main:105
    triggerUncaughtException(
    ^
{
  code: 'PGRST205',
  message: "Could not find the table 'public.giving_campaigns' in the schema cache"
}
```

The new failing assertions confirmed the missing boundary:
- `await views.viewAdmin("giving")` propagated `{ code: "PGRST205", … }` instead of rendering setup copy.
- `await views.viewAdminCampaign("new")` reached the same dead end.

### GREEN — after the source fix

```
=== node app/smoke.mjs ===
ok  resetLocalData restores the clean baseline
All smoke tests passed.

=== node app/live-auth-smoke.mjs ===
ok  live Giving store mapping, checked mutations, transitions, and role guards
ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock
ok  live application read failures are caught and shown once across async render flows
ok  live OAuth session renders signed and visitor notification chrome safely
ok  live profile renders valid account metadata
ok  live indemnity renders from the application waiver state
ok  live approved/admin missing-application Profile sections render unavailable cards

=== bash supabase/tests/verify_giving_campaigns_safety.sh ===
PASS: safe empty target is accepted
PASS: explicit acknowledgement is required
PASS: existing profiles are rejected
PASS: existing auth users are rejected
PASS: unexpected public objects are rejected
Giving campaign verifier safety checks passed.

=== node --check ===
syntax OK

=== git diff --check ===
diff OK
```

## Test summary

### `app/live-auth-smoke.mjs`

- Added `let givingCampaignListError = null;` next to the existing Giving fake state so the new view-boundary tests can drive the `.order()` response.
- Rewrote the `.order()` branch of the `giving_campaigns` fake to honor `givingCampaignListError`:
  - `data: givingCampaignListError ? null : structuredClone(givingCampaignRows)`
  - `error: givingCampaignListError`
- After the approved Super Admin is hydrated and the Members filters are reset, the new block:
  - Injects `PGRST205` and asserts `viewAdmin("giving")` returns the setup panel that contains the two migration filenames and excludes every campaign authoring affordance (`+ Create campaign`, `form-campaign`, `campaign-row`, `Publish campaign`, `Close campaign`).
  - Injects `PGRST205` and asserts `viewAdminCampaign("new")` returns the same setup panel so deep-linking cannot slip into the form.
  - Switches to a `42501` (permission denied) error and asserts `viewAdmin("giving")` still rejects with the original message, proving the catch is exact.
  - Resets `givingCampaignListError = null` so downstream tests continue.

### `app/smoke.mjs`

- Added two local-mode assertions under the Admin section, after the Members filter reset:
  - Empty Admin Giving still shows the `"No Giving campaigns yet."` empty state plus the `+ Create campaign` action (the existing authoring affordance is preserved).
  - Seeding a closed campaign and re-rendering keeps that history visible (title and `"closed"` badge present) and re-exposes `+ Create campaign` because every open slot is closed.
  - The fixture campaign is popped before subsequent tests so they observe the original baseline.

### `app/js/views.js`

- New helper `isGivingSchemaMissing(error)` keyed on the exact `.code === "PGRST205"` PostgREST signal.
- New `adminGivingSetupRequired()` renderer returns a self-contained card naming the two migrations (`20260805000011_giving_campaigns.sql`, `20260806000001_donor_id.sql`) with no buttons, no fake campaigns, and a short follow-up message.
- `viewAdmin("giving")` now wraps only `store.listGivingCampaigns()` in a `try/catch` that rethrows anything that is not a missing-schema signal.
- `viewAdminCampaign(id)` wraps only the leading `store.listGivingCampaigns()` call so deep-linking into the new/edit form also lands on the setup panel when the table is missing; other errors still reject, the campaign lookup still runs against the populated list, and the existing "close current campaign before creating another" guard still works.

## Concerns / notes

- The store seam (`store.listGivingCampaigns()`) was deliberately not weakened. It still throws the original Supabase error so callers above the view boundary can react. Only the two view boundaries (`viewAdmin` for the `giving` tab and `viewAdminCampaign`) translate the exact `PGRST205` signal into setup copy; nothing else is changed.
- Other Postgres/PostgREST codes (e.g. `42501`, network errors, `PGRST116` for zero rows) are not silenced — the test asserts `permission denied` still rejects so any future regression that broadens the catch will fail.
- The setup card deliberately has no buttons (per the brief) so an admin cannot accidentally create local-only campaign state while the deployed schema is broken.
- `git diff --check` is clean. All `node --check` syntax checks pass. `verify_giving_campaigns_safety.sh` confirms the database verifier still agrees with the store contract.
- The smoke fixture for the closed campaign is restored (`store.campaigns().pop()`) so downstream sections observe the original empty baseline; if a future test relies on the seeded closed row, this would need to be revisited.

## Report path

`/Users/selesli/projects/island-training-club-app/.worktrees/giving-cleanup/.superpowers/sdd/2026-08-07-admin-giving-schema-state/task-1-report.md`

## Review-fix evidence (2026-08-07)

- Replaced the false-positive `localClosedGivingHtml.includes("closed")` check with the exact rendered badge assertion `<span class="badge neutral">closed</span>`; title and `+ Create campaign` checks remain.
- RED mutation: changing the closed badge class from `neutral` to `danger` caused `node app/smoke.mjs` to fail as expected.
- GREEN: restoring the implementation passed `node app/smoke.mjs` and `node app/live-auth-smoke.mjs`.
- Syntax and hygiene checks passed: `node --check app/smoke.mjs`, `node --check app/js/views.js`, and `git diff --check`.

