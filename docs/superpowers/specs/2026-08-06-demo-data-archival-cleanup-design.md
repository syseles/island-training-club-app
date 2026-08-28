# Demo Data Archival and Active-Branch Cleanup

**Date:** 2026-08-06  
**Status:** Approved design; implementation requires a reviewed plan

## Goal

Preserve the runnable prototype demo in a dedicated archive branch, then remove named demo accounts and fake operational data from every active branch without collapsing branch-specific work or deleting genuine user-created state.

## Confirmed scope

### Archive

Create and push `archive/demo` at commit `bd5e7cf` (`fix(giving): persist donor IDs in live profiles`). This is the latest integrated Auth, Notification, and Giving snapshot before Giving demo cleanup. It preserves the one-tap account experience, fake campaign, fake donations, and supporting historical documentation in a runnable branch.

Older payment and Shop demo variants remain reachable through their existing branch history after cleanup commits are added. This work does not rewrite Git history or force-push any branch.

### Active branches

Clean these branch tips:

- `main`
- `development`
- `feature/auth-identity`
- `feature/community-page`
- `feature/giving-page`
- `feature/notification`
- `feature/payment-system`
- `feature/shop-page`
- `feature/verse-pool`
- `testing`
- `fix/donor-id-save`

Remote-only branches receive local tracking branches before cleanup. Existing long-lived branch boundaries remain intact. Shop merchandise and catalog work stays only on `feature/shop-page`.

## Data classification

### Remove from runtime seed and UI

- Named local demo identities:
  - `owner@itc.hk` / `u-super`
  - `admin@itc.hk` / `u-admin`
  - `member@itc.hk` / `u-member`
  - Marco Santos / `u-pend-1`
  - Jenny Wu / `u-pend-2`
- Associated fake phone numbers, emergency contacts, donor ID, application dates, and role/status records.
- One-tap demo sign-in controls, demo toasts, demo guidance, and demo reset controls.
- Seeded HYROX bookings and receipts.
- Seeded Giving campaigns and donations.
- Simulated attendance and `baseBooked` demand.
- Fake payment collectors, PayMe/FPS details, duty assignments, queue entries, and operational notifications.
- Prefilled card number, expiry, and CVC values. The payment form remains an explicitly mocked prototype and accepts test input without charging.
- Generic fake announcements that use relative dates or report invented venue/fundraiser activity.
- README and current operational documentation that instruct users to use named demo accounts.

### Preserve as product configuration/content

- Intended activity definitions, schedules, descriptions, prices, capacities, and venues. Remove only simulated demand attached to them.
- Shop product configuration and product imagery on `feature/shop-page`.
- The approved “Island Training Club turns 2” anniversary story on `feature/community-page`.
- Leaders, culture, values, safety copy, community guidelines, and weekly verses.
- Real Supabase authentication, profiles, applications, notifications, campaigns, and other user-created database records.
- Local prototype application/sign-in behavior: a visitor may apply, and that newly created local user may sign in again by email. A clean local installation has no pre-authorized Admin; Admin demonstrations belong on `archive/demo`, while real Admin access comes from Supabase live mode.

### Tests and historical cleanup references

Automated tests may use synthetic fixtures, but fixtures must use neutral names, emails, and IDs such as `test-member@example.test` and `test-member-1`. Tests must not depend on accounts existing in fresh application state.

Versioned migrations may retain exact legacy IDs when needed to identify and remove persisted demo data safely. Such values are cleanup sentinels, not runtime seeds. Regression tests may repeat those sentinels to prove that only known demo records are removed.

Historical design/implementation documents containing the old demo workflow are preserved on `archive/demo`. On active branches, current README/runbook guidance is updated. Historical specs need not be rewritten solely to erase discussion of past architecture unless they expose runtime credentials or are presented as current instructions.

## Branch strategy

Use tailored commits rather than one universal cherry-pick because state versions and domain structures differ.

### Main lineage

Implement and verify the baseline cleanup on `main`. Merge or port that cleanup into:

- `feature/community-page`, preserving the approved anniversary story.
- `feature/verse-pool`, preserving its verse work.
- `testing`, preserving test-branch-specific work.

### Auth lineage

Implement and verify the modern identity cleanup on `feature/auth-identity`. Propagate it through existing ancestry:

1. `feature/auth-identity`
2. `feature/notification`
3. `feature/giving-page`

Each downstream branch adds any domain-specific migration and test adjustments needed for its newer state version. Giving’s already-clean fresh campaigns/donations remain empty.

### Divergent branches

Apply tailored cleanup independently to:

- `development`
- `feature/payment-system`
- `feature/shop-page`
- `fix/donor-id-save`

Do not merge unrelated Shop, Payment, Giving, or Notification features into these branches merely to share cleanup code.

## Local state migration

Every affected branch must bump its own `STATE_VERSION` and add a migration step. Never delete state keys without migration.

The migration must:

1. Remove users only when their ID or normalized email matches the five known demo identities.
2. Clear `sessionUserId` only when it references a removed identity.
3. Remove known seed bookings, receipts, donations, campaigns, notifications, queues, duty assignments, and other records owned by or referencing removed identities.
4. Remove simulated `baseBooked` values while preserving activity edits.
5. Preserve all unmatched users and their records.
6. Initialize any missing arrays/objects defensively before filtering.
7. Remain idempotent.

Branch-specific schemas determine the exact dependent collections. Migration tests must include a mixed fixture containing known demo records and genuine user-created records, then prove that only demo records disappear.

Fresh state must contain:

- No users.
- No session user.
- No bookings, receipts, donations, campaigns, prayers, queues, notifications, or duty assignments unless the branch has intentional non-user product configuration requiring a non-empty structure.
- Preserved activity/product/content configuration as classified above.

## UI behavior after cleanup

### Local mode

- Visitor Account shows sign-in and membership application actions without demo shortcuts.
- Sign-in failure copy says no account was found and directs a visitor to apply; it does not suggest a demo profile.
- A newly submitted local application creates the only local identity involved in that flow.
- Pending guidance does not instruct the user to switch to a demo Admin.
- Profile does not display a “Reset demo data” action. If a local reset affordance remains necessary for prototype development, it must be renamed to a neutral development-only action and must not reintroduce seeds; default decision is to remove it.

### Live mode

Google sign-in and Supabase-backed role behavior are unchanged. No SQL migration inserts or deletes live users. Repository inspection found no Supabase migration that creates the named demo accounts. If matching accounts exist in a deployed Supabase project, deleting Auth users is a separate, explicitly reviewed operational action because it cannot be made safe from repository evidence alone.

## Documentation

Update README and active runbooks to state:

- Local mode starts empty.
- Apply through the membership flow to create a local pending profile.
- Administrative testing requires Supabase live mode or the archived demo branch.
- `archive/demo` is historical and must not be used as a production source branch.

Do not include fake credentials in active getting-started instructions.

## Verification contract

For every cleaned branch:

1. `node app/smoke.mjs` passes.
2. `node app/live-auth-smoke.mjs` passes when present and applicable.
3. All tracked JS/MJS syntax checks pass.
4. All tracked shell safety/syntax checks pass where present.
5. `git diff --check` passes.
6. Fresh-state tests prove zero seeded identities and zero fake operational records.
7. Migration tests prove known demo records are removed while genuine records survive.
8. Rendered Account HTML contains no one-tap demo controls or named demo emails.
9. A repository source scan finds no named demo email in runtime source, README, or current runbooks, except explicitly documented migration regression sentinels if required.
10. Branch-specific feature tests remain green.

Before each push, fetch the remote and confirm the branch is not behind. Do not force-push. Push `archive/demo` before the first cleanup branch so the runnable demo is preserved remotely.

## Commit and push policy

- Keep the archive branch creation separate from cleanup work.
- Use reviewable cleanup commits per branch or branch family.
- Do not commit unrelated untracked screenshots, brainstorm server artifacts, or the existing untracked HYROX design draft.
- Present the final branch/commit list and verification evidence before pushing cleanup branches.
- The approved archive may be pushed first as the safety checkpoint; all cleanup pushes require explicit final approval after review.

## Out of scope

- Rewriting or purging Git history.
- Force-pushing branches.
- Deleting deployed Supabase Auth users without a separate operational audit and approval.
- Replacing mocked payments with real payment processing.
- Removing intended product content merely because it is initialized from constants.
- Merging or deleting long-lived feature branches.
