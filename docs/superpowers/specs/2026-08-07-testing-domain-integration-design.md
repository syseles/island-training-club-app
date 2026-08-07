# Testing Domain Integration Design

**Date:** 2026-08-07  
**Target:** `testing`  
**Integration branch:** `work/testing-feature-integration`

## Source Tips

The integration uses these immutable source tips:

- Testing baseline: `testing@43487254ff28a75ec4a0ac49ebbb71d2ff9b9936`
- Shared Auth/Payment baseline: `feature/payment-system@720dc732944dac692334e885db2d9418d024d9bc`
- Notifications domain: `feature/notification@5842839e08f5e486f4b9e175232acec3cb347eb2`
- Giving domain: `feature/giving-page@3ef00adc4efb327826d5308b20610bc18a9102db`
- Community domain: `feature/community-page@40bb7c2acb5ee0a7460f840e73b283cfebce4d31`

The remote branch is named `feature/notification` (singular). No branch named `feature/notifications` exists.

## Goal

Produce one verified `testing` candidate that preserves the latest visual design and underlying data behavior from Payment, Notifications, Giving, and Community. Git conflict resolution must follow domain ownership rather than selecting whole shared files from one branch.

## Integration Strategy

Build on `testing` so the final update is a normal fast-forward. Use the latest Payment branch as the shared Auth, Account, Admin, routing, and operational baseline, then compose the latest domain-owned behavior from the other feature branches.

Do not merge the long-lived feature branches together or rewrite their histories. Their tips remain unchanged. The integration branch receives reconciled source and tests, and only updates `testing` after explicit approval.

## Domain Ownership

### Shared Auth and Payment — Payment owns

Payment owns:

- Google OAuth and Supabase client boot.
- Pending-by-default identity and application approval.
- Account/Profile shell and privacy/indemnity editing.
- Async route generations, busy controls, focus, and error feedback.
- Reservations, bookings, PayMe/FPS commitment, queues, interest, collectors, duty, payouts, receipts, deferral, session overrides, and Payment Admin Ops.
- The signed-out Home Google CTA.

Payment operational data remains in `localStorage`, keyed by the authenticated Supabase profile UUID.

### Notifications — Notification owns

Notification owns:

- The top-bar notification bell, unread count, active state, and accessible label.
- Notification inbox visuals, unread rows, kind badges, relative/HKT timestamps, role-aware filters, empty states, and row destinations.
- Notification cache/generation safety and mark-read behavior.
- Admin operational notification database functions, read privileges, migrations `20260805000008` through `20260805000010`, SQL integration test, and safety script.

Notifications use the top bar, not an additional bottom-navigation item.

### Giving — Giving owns

Giving owns:

- Signed-in Giving bottom-navigation item and route.
- Approved-member access gate; pending and declined profiles cannot give.
- Campaign page visuals, progress, gift flow/history, donor ID behavior, and stale-generation protection.
- Admin campaign management and serialized campaign/gift actions.
- Giving campaign and donor migrations `20260805000011_giving_campaigns.sql` and `20260806000001_donor_id.sql` plus SQL integration/safety scripts.

### Community — Community owns

Community owns:

- Community landing visuals and ordering.
- Community pulse and personalized content.
- Anniversary milestone/announcement presentation.
- Prayer, fellowship, meal, announcement, and About subpages.
- The latest Community seed helpers and local prayer behavior.

Community does not replace shared Auth, Account, Admin, Payment, Notification, or Giving behavior in the same files.

### Testing — Testing owns acceptance

Testing owns:

- Empty local startup and retired-demo cleanup guarantees.
- Cross-domain regression coverage.
- The requirement that all combined routes, state actions, migrations, syntax checks, and safety scripts pass before updating `testing`.

## Combined Navigation and Admin

The bottom navigation is composed as follows:

- Home
- Schedule
- Community
- Giving, signed-in only
- Account/Profile
- Admin, Admin/Super Admin only

Notifications are accessed through the latest Notification top-bar bell. This avoids adding a seventh bottom-navigation item and preserves Notification’s latest visual behavior.

The combined Admin tabs are:

- Approvals
- Members
- Activities
- Giving
- Payments / Ops

Exactly one Admin tab has `aria-current="page"`. Notification administration remains in the role-aware notification inbox rather than a duplicate Admin tab.

## State and Migration Design

The integrated local state advances to **version 13** because branch-local versions 10–12 represent different domain changes.

Fresh state combines all owned collections:

- Payment: `sessionOverrides`, `queues`, `notifications`, `duty`, bookings, receipts.
- Giving: `campaigns`, `donations`.
- Community: `prayers`.
- Existing users and activities collections.

Migration to version 13 is shape-aware, not solely version-aware. It must safely accept persisted snapshots from Testing v9, Payment v10, Notification v11, and Giving v12:

1. Initialize every missing collection without deleting valid records.
2. Preserve Payment queues, duty, overrides, receipts, and genuine notifications.
3. Preserve genuine Giving campaigns and donations.
4. Preserve Community prayers.
5. Apply exact-sentinel retired-demo cleanup to identities and dependent Payment records.
6. Remove simulated `baseBooked` demand and known seed-owned transactions only.
7. Apply Giving v12 cleanup exactly: remove only the known seed donation IDs while retaining unmatched member gifts and genuine campaign records.
8. Set `state.version` to 13 only after all reconciliation succeeds.

Regression fixtures cover each source schema version and prove unmatched user-created records survive.

## Supabase Data Model

Retain the complete ordered migration chain from the Giving tip, which is the Notification schema plus Giving additions:

- Profiles, applications, audit notifications, and RLS.
- Profile preferences and application decision migrations.
- Admin operational notifications and read privileges.
- Giving campaigns and donor ID.

Payment continues using the same Supabase profile UUID but does not move Payment operational records into Supabase.

## Route and Action Composition

There is one router and one delegated handler per event type.

- Start with Payment’s async router and Payment operational actions.
- Add Notification’s top-bar hydration, filters, cache guards, and notification-open behavior.
- Add Giving’s route, campaign/gift forms, Admin campaign actions, and generation guards.
- Add Community’s latest routes/forms/actions without duplicating prayer handling.

Duplicate cases are removed. Shared controls use the existing busy/error helpers. Stale async views cannot overwrite the latest route or feedback state.

## Visual Composition

Use Payment’s Archivo-based shared tokens, app shell, cards, forms, Profile, and Payment surfaces. Copy the latest domain CSS blocks from Notification, Giving, and Community, resolving selector overlap by semantic ownership. Avoid wholesale stylesheet replacement.

The resulting visuals must match each source tip for its owned surface at mobile width while retaining accessible focus, live-region, contrast, and minimum-control-size behavior.

## Testing and Acceptance

Automated acceptance includes:

1. Testing baseline smoke expectations.
2. Payment smoke and live-auth contracts.
3. Notification inbox/filter/cache/read and notification SQL safety contracts.
4. Giving access/campaign/donor and Giving SQL safety contracts.
5. Community pulse/anniversary/prayer/fellowship contracts.
6. Cross-domain navigation and Admin-tab assertions.
7. Pending/declined users cannot reserve, queue, pay, or give.
8. Approved Supabase UUIDs own local Payment and live Giving records as designed.
9. Sign-out clears live identity while preserving device-local Payment state.
10. Migration fixtures from v9, v10, v11, and v12 preserve genuine records and reach v13.
11. All tracked JavaScript/MJS syntax checks, shell syntax checks, safety scripts, `git diff --check`, and retired-demo scans pass.

Because the prototype has no framework or build step, verification remains Node smoke scripts plus Supabase SQL/safety shell scripts.

## Delivery

Work occurs only on `work/testing-feature-integration`. Before delivery, present:

- Commit list and source-tip provenance.
- Conflict-resolution summary by domain.
- Complete verification output.
- Remaining manual Supabase/Vercel requirements.

After explicit approval, push without force from the integration branch to `origin/testing` and verify the remote SHA. Preserve every source feature branch unchanged.

## Out of Scope

- Updating `main`, `development`, Shop, or the source feature branches.
- Real Payment processing or moving Payment operations to Supabase.
- New Community, Giving, Notification, or Payment features beyond their source tips.
- Rewriting history, force-pushing, or deleting branches/worktrees.
