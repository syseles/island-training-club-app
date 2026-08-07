# Testing Auth and Giving Regression Design

**Date:** 2026-08-07
**Target:** `testing`
**Baseline:** `a4345d2439012c209b8c9235bbb8860f2e82eae6`
**Reference:** `feature/auth-identity@bcce208c857f2295f02607b7c254205a7074243b`

## Goal

Restore the Auth-owned visitor Home and Admin navigation behavior that regressed during domain integration, while making Giving remain reachable when its Supabase schema has not yet been deployed. Do not restore fake users, campaigns, donations, or other demo data.

## Verified Root Causes

### Visitor Home

Testing currently renders one unconditional `My Week` section containing all upcoming sessions. This exposes paid and not-yet-open sessions to signed-out visitors. The Auth reference has status-aware behavior:

- Signed-out visitor: `This week — open to all`, free sessions only.
- Pending signed-in profile: `My Week`, free sessions only.
- Approved signed-in member: `My Week`, booked sessions only.

### Admin Navigation

Testing added an `Admin` item to the primary bottom navigation. The Auth reference deliberately excludes it and exposes the same route through `Profile → Admin Tools`. The Profile row already exists in Testing.

### Giving Availability

The older working Giving deployment corresponds to commit `8691e212102054a44280f8fb5452b18a5c4e85af`, which rendered a hardcoded demo campaign. Testing correctly removed that fake data and now reads `public.giving_campaigns` from Supabase.

The deployed Supabase REST API currently returns `PGRST205` because `public.giving_campaigns` is absent. This is a deployment-schema gap, not a router or membership-access regression.

## Design

### 1. Restore status-aware Home content

`viewHome()` will follow the Auth reference behavior:

- Visitors receive the heading `This week — open to all` and only sessions whose canonical `kind` is `free`.
- Pending profiles receive `My Week` and only free sessions.
- Approved profiles receive `My Week` and only their booked sessions.
- Existing visitor sign-in content, pending banner, booked-session highlighting, and empty states remain.

The exact punctuation uses the existing Auth copy: an em dash in `This week — open to all`.

### 2. Remove Admin from primary navigation

The primary bottom navigation will contain:

- Home
- Schedule
- Community
- Giving for signed-in profiles
- Account/Profile

It will never include an Admin item. Admin and Super Admin profiles continue to see `Admin Tools` as the first Profile row, linking to `#/admin`. Admin routes and Admin sub-tabs remain unchanged.

### 3. Graceful Giving schema fallback

`store.getActiveGivingCampaign()` will distinguish the known undeployed-schema condition from other database failures:

- `PGRST205` for missing `public.giving_campaigns`: return no active campaign.
- Existing table with no published row: return no active campaign.
- Any other Supabase error: throw normally so genuine authentication, RLS, network, or query failures are not hidden.

For either no-table or no-published-campaign result, approved members receive the existing Giving page shell and history, with member-facing copy:

- `No active Giving campaign at the moment`
- `Check back soon for the next opportunity to support the ITC community.`

Pending and declined profiles continue to receive the approved-members-only Giving access state.

Admin campaign management will not silently pretend the schema exists. Its current errors remain visible so deployment operators know the migration is required.

### 4. Database deployment remains explicit

The existing ordered migrations remain the source of truth:

- `20260805000011_giving_campaigns.sql`
- `20260806000001_donor_id.sql`

No seed campaign will be added. Documentation will state that restoring functional donations requires:

1. Applying the ordered migration chain to the deployed Supabase project.
2. Creating and publishing a real campaign through Admin Tools → Giving.
3. Running the credential-dependent Giving SQL verifier against a fresh disposable database before production deployment.

Until those steps are complete, the member Giving route remains reachable and displays the no-active-campaign state.

## Error Handling

- Missing Giving table is handled only by exact PostgREST code `PGRST205`.
- Other Giving query failures continue through the existing route feedback/error path.
- Home and navigation changes are synchronous rendering changes and introduce no new state.
- No localStorage version or shape change is required.

## Tests

### Smoke coverage

- Visitor Home includes `This week — open to all`.
- Visitor Home excludes `My Week`, paid sessions, and not-yet-open paid sessions.
- Pending Home includes `My Week`, includes free sessions, and excludes paid sessions.
- Approved Home includes `My Week` and only booked sessions.
- Admin primary navigation excludes `Admin` while Profile includes `Admin Tools` linking to `#/admin`.
- Giving no-campaign copy uses the approved wording.

### Live Auth coverage

- A `PGRST205` active-campaign response renders the no-active-campaign page.
- A valid empty published-campaign response renders the same state.
- A non-`PGRST205` query error remains rejected and visible.
- Existing active-campaign, generation-ownership, access-gating, Payment, Notification, and Auth tests remain green.

### Verification

Run:

```sh
node app/smoke.mjs
node app/live-auth-smoke.mjs
for f in $(git ls-files '*.js' '*.mjs'); do node --check "$f"; done
for f in $(git ls-files '*.sh' '*.bash'); do bash -n "$f"; done
for f in $(git ls-files '*_safety.sh'); do bash "$f"; done
git diff --check origin/testing...HEAD
git diff --check
```

Credential-dependent Supabase integration suites remain manual unless a disposable target is configured.

## Non-Goals

- Reintroducing the old hardcoded Giving campaign or seeded donations.
- Automatically creating or publishing a campaign.
- Applying remote Supabase migrations without database credentials and explicit deployment authorization.
- Changing Giving access for pending or declined profiles.
- Changing Admin routes, Admin tabs, Payment operations, notification behavior, or Community content.
