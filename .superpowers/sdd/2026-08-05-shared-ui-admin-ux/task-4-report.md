# Task 4 Report — Member Management and Canonical Admin Routing

## Status

Complete.

## Implementation

- Added unfiltered Approved, Pending, and Declined member counts.
- Added exported in-memory `adminMemberFilters` state with case-insensitive name/email search plus status and normalized-role filters.
- Added filter-aware empty copy and canonical `Member`, `Admin`, and `Super Admin` labels for local/live role spellings.
- Preserved pending/declined status rendering and Super Admin self-protection.
- Added confirmed role selects and separate destructive **Revoke access** controls for eligible approved users.
- Routed live changes through `updateProfileRole()` and local changes through `setRole()`, with shared busy/error behavior and awaited rerenders.
- Updated local `setRole()` so revocation truthfully returns access to pending status; this required the small additional `app/js/store.js` change beyond the brief's listed UI files.
- Redirected legacy `#/admin/users` to canonical `#/admin/members` and removed the unused legacy row/avatar renderer.
- Added responsive member summary, filter, role-action, and visually hidden label styles.

## TDD Evidence

### Red

After adding member fixtures and contracts, the smoke suites failed as expected on missing counts, filters, canonical role labels, and routing. The first live failure showed the old `3 approved · 2 pending` summary instead of the required labelled counts.

### Green

Passed:

```sh
node app/live-auth-smoke.mjs && node app/smoke.mjs
node --check app/js/views.js
node --check app/js/app.js
node --check app/js/store.js
node --check app/live-auth-smoke.mjs
node --check app/smoke.mjs
git diff --check
```

The full suite ended with `All smoke tests passed.`

## Self-review

- Counts use the unfiltered source, while rows combine all active filters.
- Search remains focused with its cursor restored after delegated rerenders.
- Forged delegated events are guarded by current Super Admin permission and self checks, in addition to hiding controls in the view.
- Cancelled promotion, demotion, and revocation confirmations make no store call.
- Select busy handling retains its options rather than replacing select text while pending.
- No Shop/Giving code was changed and no filter state is persisted.

## Commit

`feat(admin): improve member management UX`

## Concerns

None.

## Fix Round 1

### Status

Complete. The Medium false-success finding and delegated-test gaps are resolved.

### Changes

- Made local `setRole()` return the mutated user or throw for missing targets, non-approved targets, unsupported roles, and no-op role transitions. The local `updateProfileRole()` fallback now forwards that checked result.
- Kept revocation's existing approved-to-pending state rule and normalized the live `super_admin` spelling for local callers.
- Updated delegated revoke and role-select handlers to require confirmed local mutation before rerendering or showing success. Existing busy cleanup restores buttons/selects, and role-select errors restore the prior value.
- Added delegated local regressions for stale role targets and rejected revokes with restored controls and no success toast.
- Added successful local/live promotion, demotion, and revoke dispatch coverage, a rejected live stale-target case, direct invalid-transition contracts, and delegated filter checks proving no localStorage persistence.

### Verification

Passed:

```sh
node app/live-auth-smoke.mjs
node app/smoke.mjs
node --check app/js/views.js
node --check app/js/app.js
node --check app/js/store.js
node --check app/live-auth-smoke.mjs
node --check app/smoke.mjs
git diff --check
```

### Concerns

None.
