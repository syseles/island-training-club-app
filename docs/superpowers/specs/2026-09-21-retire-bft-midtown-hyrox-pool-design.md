# Retire the BFT and Midtown HYROX Pool

**Date:** 21 September 2026
**Status:** Approved design
**Branch:** `feature/retire-hyrox-pool`

## Summary

Island ECC becomes the only active HYROX session in the live app. The existing Island ECC wording and direct paid-session workflow remain unchanged.

The BFT Causeway Bay and Midtown28 shared pool is retired end-to-end. Its test records remain in Supabase for database-level audit, but the browser cannot read or mutate them and the live app does not render them. The retirement is delivered with a forward-only database migration followed by frontend removal and production acceptance.

## Confirmed decisions

- Island ECC is the sole active HYROX product.
- Island ECC keeps its current wording, location, direct booking, payment, waitlist, attendance, replacement, and receipt behavior.
- Existing BFT/Midtown records belong to testing, not genuine future member activity.
- BFT/Midtown records remain physically present in Supabase but are hidden from the live app.
- No cancellation or retirement notifications are sent.
- Historical migrations are not edited, replayed selectively, or repaired.
- Shop, Giving, merchandise, and product imagery are outside scope.

## Goals

1. Remove every active BFT/Midtown and shared-pool entry point from member and Admin UI.
2. Prevent new pool cycles, sessions, bookings, queues, payments, allocations, reminders, and replacements.
3. Make retained pool test records unreadable and immutable through browser roles.
4. Preserve the complete Island ECC direct paid-session workflow.
5. Keep existing database rows available to trusted database operators.
6. Migrate local prototype state safely from v23 without allowing stale pool records to reappear.

## Non-goals

- Renaming or redesigning Island ECC.
- Deleting or exporting retained pool test data.
- Migrating BFT/Midtown bookings to Island ECC.
- Sending member notifications.
- Dropping shared-pool tables or historical migration files.
- Refactoring unrelated paid-session, Giving, free-event, avatar, prayer, or Shop behavior.

## Product behavior

### Home and Schedule

- Home and Schedule show Island ECC as the only HYROX session.
- The `BFT + Midtown Pool` card is removed.
- BFT and Midtown child sessions never render as standalone sessions.
- Venue preference, allocation, fallback, switch-queue, and Midtown-interest language is absent.
- Existing free events and non-HYROX paid sessions are unchanged.

### Activity, booking, and payment routes

- Island ECC continues to use the existing direct paid-session reservation flow.
- Old BFT/Midtown activity routes render a neutral retired state: `This session is no longer available.`
- Old pool booking, payment, receipt, and replacement deep links do not reveal retained records. They render the same neutral state or the existing safe not-found state, depending on the route contract.
- No route silently redirects a retired pool record to Island ECC.

### Profile, History, and Notifications

- Pool bookings, reservations, receipts, replacement requests, and related notifications are excluded from all member-facing lists and counts.
- Retired rows cannot affect Profile statistics, `My Week`, booking badges, unread counts, or payment totals.
- Island ECC history and receipts remain visible normally.

### Admin

Admin Activities and Payments remove:

- pooled weekly setup and provisioning,
- venue-plan and allocation controls,
- BFT/Midtown financial rosters,
- venue-switch queues,
- Midtown open/close and interest controls,
- pooled waitlists and pooled attendance controls,
- collector reminder controls tied to a pool cycle.

Island ECC retains direct session administration, financial status, waitlist, attendance, replacement, and receipt controls.

## Retirement identity

The retirement boundary uses exact canonical identifiers:

- `hyrox-bft`
- `hyrox-midtown`
- pool cycles and rows linked through `hyrox_cycle_id`
- pool session IDs linked by authoritative activity/session relationships

Substring-only classification is not authoritative. The browser and database use canonical columns and relationships so unrelated activity names cannot be hidden accidentally.

`hyrox-quarry-bay` is explicitly excluded from retirement and remains active as Island ECC.

## Backend design

### Forward migration

A new migration, with a unique version after `20260921000002`, establishes the authoritative retirement boundary.

It will:

1. Assert that the Island ECC template exists and is not one of the retired IDs.
2. Set the BFT and Midtown activity templates inactive.
3. Prevent `ensure_hyrox_cycles` and any scheduling path from creating new pool cycles or child sessions.
4. Remove `anon` and `authenticated` execution rights from pool-only RPCs, including reservation, pool waitlist, venue choice/allocation, switch queues, pool cancellation, deadline sweeps, and pool reminder entry points.
5. Add explicit retired-record rejection to shared mutation RPCs that must remain available for Island ECC, such as generic payment, attendance, replacement, and session administration functions.
6. Remove browser read access to pool-cycle and venue-switch tables.
7. Exclude retired sessions and pool-linked rows from browser-readable operational policies and RPC result sets.
8. Preserve trusted database-owner access and leave all retained rows unchanged.

### Browser-readable data

Browser roles must not obtain retired records through:

- direct table reads,
- operational session hydration,
- member booking/history/receipt queries,
- Admin member/payment/attendance queries,
- replacement queries,
- notification queries or destination resolution,
- Realtime subscriptions.

Security-definer functions must apply retirement filtering internally; callers cannot opt out with parameters.

### Mutation denial

Pool-specific functions are no longer executable by browser roles. Shared functions reject a target when the authoritative session activity is retired or the booking has a pool-cycle relationship.

The rejection happens before writes, notifications, audit side effects, or queue reconciliation. Island ECC targets continue through the existing code path unchanged.

### No notifications

The retirement migration performs no cancellation operation. It does not call cancellation RPCs, insert notifications, or change retained bookings into a cancelled state.

### Data retention

Existing templates, sessions, cycles, bookings, receipts, queues, replacements, and notifications remain stored. Only template activation and access/mutation boundaries change. Row counts for retained domain data must be identical before and after deployment.

## Frontend design

### Active data boundary

A shared exact-ID predicate classifies retired activities and pool-linked records. Live normalizers and selectors reject those rows before they enter active caches. This defence-in-depth layer prevents stale API responses, cached rows, or delayed Realtime events from restoring retired UI.

The frontend does not rely solely on rendering conditions.

### Removed active workflow

Remove active use of:

- shared-pool schedule cards,
- cycle registration and venue preference forms,
- BFT-only/both allocation presentation,
- venue selection and switch queues,
- pooled reservation/payment cards,
- Midtown interest/open controls,
- pool provisioning and deadline controls,
- pool-specific notification destinations,
- live cycle/queue hydration and subscriptions,
- delegated pool action handlers.

Compatibility helpers may remain only when required to migrate old local snapshots. They must not be reachable from active routes.

### Local prototype migration

Bump `STATE_VERSION` from 23 to 24 and add an explicit migration step.

The migration removes retired records from active local collections and derived counts while preserving state shape compatibility. It covers:

- BFT/Midtown activities and generated sessions,
- pool cycles and venue queues,
- pool-linked bookings and receipts,
- pool replacement requests,
- pool notifications and overrides,
- collector/duty references that target retired child sessions.

Fresh v24 state seeds only Island ECC for HYROX. Existing v9-v23 migration fixtures must still reach v24 without damaging genuine non-pool records.

### Retired routes

Route resolution checks canonical IDs before loading a record. Known retired activity IDs and retained pool references return the neutral retired state. Unknown IDs keep the existing not-found behavior.

### Documentation

Update current product documentation and runbooks so they describe Island ECC as the sole active HYROX session. Historical design and plan documents remain historical and are not rewritten.

## Deployment design

### Phase 1: read-only production inventory

Before any shared mutation, collect counts and identifiers for:

- BFT/Midtown templates,
- future and past sessions,
- pool cycles,
- bookings by state,
- receipts,
- cycle and venue queues,
- replacements,
- pool-related notifications.

Confirm that future pool records are the acknowledged test data. Record counts without request copy, member email, or other unnecessary identity data.

### Phase 2: backend

- Run migration safety and clean-chain tests.
- Apply only the new forward migration.
- Verify template state, grants, policies, function guards, Island ECC availability, and unchanged retained row counts.
- Record only the new migration version.

### Phase 3: frontend Testing

- Merge the tested frontend into `testing`.
- Verify the Testing deployment against the migrated backend.
- Complete authenticated member/Admin acceptance in Chrome and Safari at a mobile viewport.

### Phase 4: production

- Promote the exact accepted Testing snapshot to `main`.
- Wait for successful Vercel deployment.
- Verify canonical routing and the full Island ECC lifecycle with disposable fixtures.
- Recheck that retained pool row counts are unchanged and browser roles cannot retrieve them.

## Rollback

Rollback is a separate reviewed forward migration and frontend deployment. It may restore template activation, grants, policies, and pool UI if leadership reverses the decision.

No rollback edits historical migrations or reconstructs deleted data, because this design deletes no retained Supabase rows.

## Testing strategy

### Static and unit coverage

Tests must prove:

- no BFT/Midtown/pool controls or member copy remain in active views,
- no delegated active pool actions remain,
- exact retired-ID filtering does not hide Island ECC,
- old deep links return the retired state,
- v23 snapshots migrate to v24,
- fresh v24 state contains Island ECC but no active pool product,
- unrelated app behavior remains green.

### Database safety coverage

A static safety test validates:

- forward-only migration provenance,
- exact retired IDs,
- explicit Island ECC exclusion,
- browser grant removal,
- shared-function guards,
- no destructive `DELETE`/`TRUNCATE` of retained pool data,
- no notification-producing cancellation path.

### Rollback-scoped integration coverage

Authenticated integration tests run inside `BEGIN`/`ROLLBACK` and prove:

- retained pool rows still exist for trusted database access,
- `anon` and member/Admin browser roles cannot read pool cycles or queues,
- member/Admin pool mutations fail without side effects,
- generic shared mutations reject retired pool targets,
- no new pool cycle can be provisioned,
- no retirement notifications are created,
- Island ECC session listing, reservation, payment, confirmation, attendance, replacement, receipt, and waitlist paths still succeed.

### Application and deployment acceptance

Run all existing smoke, live-auth, avatar, replacement, RSVP, HTML, routing, Supabase safety, Deno, formatting, lint, and clean migration-chain checks.

Manual/automated deployment acceptance covers:

- visitor/member/Admin Home and Schedule,
- Profile history/counts and notifications,
- Admin Activities and Payments,
- old pool deep links,
- complete Island ECC direct paid-session lifecycle,
- no horizontal clipping at the accepted mobile viewport.

## Acceptance criteria

The work is complete when:

1. Island ECC is the only HYROX session visible or actionable in the live app.
2. No browser role can read or mutate retained pool-domain records.
3. No new pool records can be provisioned.
4. Existing pool-domain row counts remain unchanged.
5. No retirement notifications are emitted.
6. Island ECC passes its complete existing direct-session lifecycle.
7. Local v9-v23 snapshots migrate safely to v24.
8. All automated and deployment acceptance checks pass.
9. The production diff contains no Shop or unrelated feature work.
