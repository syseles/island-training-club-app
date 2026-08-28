# Task 3 Report — Add the Supabase Schema and Live Consent Mapping

## Status
Completed in `/Users/selesli/projects/island-training-club-app/.worktrees/read-and-accept-docs`.

## Scope
- Added the additive Supabase migration for versioned HYROX indemnity fields.
- Extended live/local application mappings to carry structured waiver fields and `emergency_relationship`.
- Replaced timestamp-only live `acceptMyIndemnity()` behavior with structured, current-version-aware persistence.
- Updated local/live smoke coverage and the live-auth runbook.

## Files
- `supabase/migrations/20260827000001_hyrox_indemnity_fields.sql`
- `app/js/store.js`
- `app/smoke.mjs`
- `app/live-auth-smoke.mjs`
- `docs/runbooks/live-auth.md`

## RED evidence
Command:

```sh
node app/smoke.mjs
```

Observed failure before production changes:

```text
Error: Payment Auth baseline missing ../supabase/migrations/20260827000001_hyrox_indemnity_fields.sql
```

Command:

```sh
node app/live-auth-smoke.mjs
```

Observed failure before production changes:

```text
Error: membership patch leaked fields: date_of_birth,emergency_name,emergency_phone,guardian_name,guardian_phone,heard_detail,heard_source,is_minor,mobile,preferred_name
```

These failures confirmed the missing migration source and the missing live membership relationship mapping expected by the brief’s new assertions.

## GREEN evidence
Command:

```sh
node app/smoke.mjs
```

Observed success after implementation:

```text
ok  Payment Auth baseline foundation files exist
...
All smoke tests passed.
```

Command:

```sh
node app/live-auth-smoke.mjs
```

Observed success after implementation:

```text
ok  pending and declined live profiles cannot render Payment or Giving controls
ok  live member payout survives Admin sign-out, member sign-in, and local reload
ok  live Admin composes Supabase members with UUID-keyed local Payment Ops
ok  delegated release, deferral, and FPS copy controls execute prototype behavior
ok  delegated gym confirmation persists and rerenders confirmed state
ok  stale Giving lookups cannot mutate the owned live campaign cache
ok  live SIGNED_IN callback returns synchronously and defers hydration until after the auth lock
ok  live application read failures are caught and shown once across async render flows
ok  live OAuth session renders the signed-in home page
ok  live profile renders valid account metadata
ok  live indemnity renders from the application waiver state
ok  live approved/admin missing-application Profile sections render unavailable cards
ok  live Giving database and profile APIs coexist with Payment/Auth and Notifications
ok  live cancellation copy renders 'Session cancelled by ITC — <reason>' everywhere
```

## What changed
### `supabase/migrations/20260827000001_hyrox_indemnity_fields.sql`
- Added an additive migration for:
  - `waiver_signature_text`
  - `waiver_signed_at`
  - `waiver_form_version`
  - `emergency_relationship`
- Kept all new columns nullable so legacy live rows remain readable.

### `app/js/store.js`
- Extended `localApplication(user)` to expose:
  - `emergency_relationship`
  - `waiver_signature_text`
  - `waiver_signed_at`
  - `waiver_form_version`
- Extended `membershipPatch(form)` to accept `emergency_relationship` and require complete emergency-contact data.
- Updated the local branch of `updateMyMembershipDetails(form)` to persist `user.emergencyRelationship`.
- Updated `saveMyApplication(form)` to:
  - require the waiver checkbox
  - normalize structured waiver acceptance through `normalizeIndemnityAcceptance(...)`
  - persist the live waiver signature/date/version fields
  - persist `emergency_relationship`
  - use one deterministic `acceptedAt` ISO value across waiver/privacy/guidelines timestamps
- Replaced `acceptMyIndemnity()` with structured local/live behavior:
  - local mode delegates to `acceptIndemnity(user.id, payload)`
  - live mode maps the current application row into the Task 2 currentness interface
  - current v1 records remain idempotent
  - stale/missing structured live records patch all intended waiver fields together
- Extended `listPendingApplications()` so hydrated live approval data preserves:
  - `emergencyRelationship`
  - `indemnitySignature`
  - `indemnitySignedAt`
  - `indemnityFormVersion`

### `app/smoke.mjs`
- Added the new migration file to the foundation-file list.
- Added source assertions for all four additive indemnity columns.

### `app/live-auth-smoke.mjs`
- Extended the seeded live application fixture with:
  - `emergency_relationship`
  - `waiver_signature_text`
  - `waiver_signed_at`
  - `waiver_form_version`
- Updated the live application-submit payload to include structured waiver inputs.
- Updated the live membership-details patch assertions to require `emergency_relationship` and forbid it from privacy-only patches.
- Replaced the old timestamp-only `acceptMyIndemnity()` assertions with structured idempotent/create-path coverage.

### `docs/runbooks/live-auth.md`
- Added `20260827000001_hyrox_indemnity_fields.sql` to the ordered migration guidance.
- Documented that the migration is additive and must be applied before deploying UI that writes the new columns.

## Constraints honored
- No CSS changed.
- No broader UI redesign beyond the live data contract.
- Reused `INDEMNITY_VERSION`, `normalizeIndemnityAcceptance(...)`, and `isIndemnityCurrent(...)` from Tasks 1 and 2.

## Concerns
1. The runbook now documents the migration ordering, but applying the new migration to the real remote Supabase project remains a manual deployment step.
2. Live verification here is smoke-level and fake-Supabase based; the task did not include a real hosted Supabase environment check.

---

## Review Fix Follow-up — live UI/handler compatibility

### Scope
Addressed the Task 3 review findings without broad UI refinement:
- restored live apply compatibility with the structured waiver fields already required by `saveMyApplication()`
- made legacy live waiver rows stale/re-signable instead of implicitly current
- extended live smoke coverage to check rendered field names and legacy live rendering, not just direct store calls

### Root cause verified
The review findings matched the runtime code paths:
1. `app/js/store.js` already required live `emergency_relationship`, `waiver_signature_text`, and `waiver_signed_at`, but `viewApplyLive()` did not render those inputs.
2. `app/js/app.js` submitted live indemnity re-acceptance with `await store.acceptMyIndemnity()` and no payload, so any live stale row could not provide the structured signature/date/relationship contract.
3. `app/js/views.js` treated any live row with `waiver_accepted_at` as current because `indemnityState()` used `if (isLive() || store.isIndemnityCurrent(user))`, which bypassed structured-currentness checks for live users.
4. `hydrateLiveUser()` did not hydrate `emergency_relationship`, `waiver_signature_text`, `waiver_signed_at`, or `waiver_form_version`, so even if the store carried them, live Profile rendering could not evaluate them correctly.

### RED evidence
After adding the new smoke assertions first, `node app/live-auth-smoke.mjs` failed on the missing live re-sign handler contract:

```text
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /await store\.acceptMyIndemnity\(\{/.
```

That confirmed the review item before changing production code.

### Production changes
#### `app/js/views.js`
- Hydrated these live application fields into the Profile view model:
  - `emergencyRelationship`
  - `indemnitySignature`
  - `indemnitySignedAt`
  - `indemnityFormVersion`
- Changed live/current indemnity evaluation to use `store.isIndemnityCurrent(user)` for live and local alike.
- Added the missing live apply inputs required by the existing store contract:
  - `name="emergency_relationship"`
  - `name="waiver_signature_text"`
  - `name="waiver_signed_at"`
- Added the minimal live Profile > Indemnity re-sign form fields:
  - `name="signature"`
  - `name="signedAt"`
  - `name="emergencyRelationship"`

#### `app/js/app.js`
- Updated the live `form-indemnity` submit path to pass the structured payload into `store.acceptMyIndemnity({ ... })` using the rendered live form fields.
- Kept local indemnity behavior unchanged apart from sharing the already-created `FormData` instance.

#### `app/live-auth-smoke.mjs`
- Added source-level assertions that the live indemnity submit handler now passes structured payload fields.
- Added rendered live apply assertions for:
  - `emergency_relationship`
  - `waiver_signature_text`
  - `waiver_signed_at`
- Added draft-resume assertions proving those live fields are preserved in the rendered form.
- Added legacy live row coverage proving that a row with `waiver_accepted_at` but missing structured fields:
  - renders as legacy/stale on the Profile summary
  - renders the live re-sign form on Profile > Indemnity
  - exposes the expected live re-sign field names
- Kept the existing direct store acceptance assertions to verify the patch payload persisted to the application row.

### GREEN evidence
Commands:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
```

Observed result:
- `app/smoke.mjs`: `All smoke tests passed.`
- `app/live-auth-smoke.mjs`: completed successfully with the live regression markers, including the indemnity/profile checks.

### Constraints honored
- No CSS changes.
- No HYROX detail/checkout gate changes.
- No migration/store-schema shape changes beyond the already-established Task 3 data contract.

### Remaining concern
This follow-up restores the live UI/handler contract and stale legacy handling, but the live application/Profile layouts are still intentionally minimal. Later Task 4/Task 5 refinement can improve copy/layout without changing the now-covered runtime contract.
