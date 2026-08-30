# Semantic Notification Routing Design

## Goal

Make every known notification open the most relevant app page instead of falling back to Profile. In particular, `Booking reserved` must open the existing payment page for the exact booking that generated the notification, while `RSVP confirmed` must open Activity Details for its exact dated session.

## Root cause

Notification rows support an optional `destination` column, and the Inbox already respects valid explicit `#/…` destinations. Several Supabase notification producers still insert only `profile_id`, `kind`, `title`, and `body`. `notificationDestination()` therefore receives no explicit route and falls back to `#/account` for personal notification kinds.

The booking reservation RPC has the new booking ID at notification creation time but does not store `#/pay/<booking-id>`. The screenshot’s row consequently renders `data-destination="#/account"` even though its message prompts immediate payment.

## Architecture

Semantic routing is assigned at the database notification-insert boundary, where the related booking/session mutation from the same transaction is visible. A new migration adds one `BEFORE INSERT` routing trigger for Supabase notifications. Existing local prototype producers continue passing their existing links through the store seam; any missing local destinations are corrected at their source.

The Inbox remains a renderer and router, not an entity-matching engine. It will:

1. Prefer a valid explicit `destination` beginning with `#/`.
2. Use kind-level fallback routes only when no explicit destination exists.
3. Fall back safely to `#/account` for unknown kinds.
4. Render only rows whose `read_at` is null.
5. On activation, persist `read_at`, remove the row from the current notification window and update the unread count, then navigate. A failed read leaves the row and route in place.

Read rows remain in the database for audit; the UI never deletes them. No generic entity-type or entity-ID columns are added.

## Routing map

### Member booking and RSVP

- `operational_booking_reserved` → `#/pay/<booking-id>`
- `operational_rsvp_confirmed` → `#/activity/<session-id>`
- `operational_payment_approved` → `#/booking/<booking-id>`
- `operational_session_deferred` → `#/booking/<new-booking-id>`
- `operational_session_cancelled_no_defer` → `#/activity/<cancelled-session-id>`
- Local `midtown-open`, `payment-reminder`, and `waitlist-promoted` → `#/pay/<booking-id>`
- Local `payment-confirmed`, `hold-released`, and `deferred` → related Booking Details
- Local `reservation-expired` → related Activity Details

### Admin operations

- `operational_payment_marked` → `#/admin/payments`
- `operational_gym_finalized` → `#/admin/payments`
- `operational_session_cancelled` → `#/activity/<session-id>`
- `operational_session_venue_updated` → its existing explicit related Activity Details destination
- `admin_application_submitted` → `#/admin/approvals`
- `admin_application_approved`, `admin_application_declined`, `admin_role_promoted`, `admin_role_demoted`, `admin_membership_revoked`, and legacy `admin_role_changed` → `#/admin/members`

### Account and community

- `welcome` → `#/account`
- `giving_campaign_published` → `#/giving`
- Unknown kinds without valid explicit destinations → `#/account`

## Supabase migration

Use `supabase/migrations/20260829000007_notification_destinations.sql`. Because migration `00007` is known undeployed, this refinement amends it rather than adding a later migration. Migration numbers `00005` and `00006` remain reserved by the Admin assigned-collector payout RPC and the RSVP six-argument lunch venue RPC respectively.

The migration will add a focused security-definer resolver and a `BEFORE INSERT` trigger on `public.notifications`. The trigger:

- Leaves any valid explicit destination unchanged.
- Assigns stable routes directly from notification kind.
- Resolves reservation/RSVP creation from a same-profile booking whose `reserved_at` matches the notification transaction time; reservations use the booking ID and RSVPs use that booking's session ID.
- Resolves payment approval from a same-profile booking whose `paid_at` matches the transaction time.
- Resolves deferral from the newly created same-profile booking in that transaction.
- Resolves session cancellation from the session whose `cancelled_at` matches the transaction time.
- Returns null rather than guessing when the related row is absent or ambiguous.

Existing notification-producing function signatures, bodies, security-definer settings, search paths, authorization, booking/payment behavior, notification copy, grants, and transaction boundaries remain unchanged.

## Existing notification backfill

Backfill existing rows whose `destination` is null by calling the same resolver used by the insert trigger; never overwrite an explicit destination.

For booking-specific rows, the resolver matches an operational booking belonging to the same profile whose relevant booking timestamp falls within five seconds of `notifications.created_at`. It returns a route only when exactly one candidate exists in that window; zero or multiple candidates remain unchanged.

Backfill:

- `operational_booking_reserved` from `reserved_at` → `#/pay/<booking-id>`
- `operational_rsvp_confirmed` from `reserved_at` → `#/activity/<session-id>`
- `operational_payment_approved` from `paid_at` → `#/booking/<booking-id>`
- `operational_session_deferred` from the new booking’s `reserved_at` → `#/booking/<new-booking-id>`

Rows without a safe unique booking match retain null and use the kind-level fallback rather than risk routing to the wrong member transaction.

Backfill stable non-entity routes directly by kind: Admin application submissions to `#/admin/approvals`; Admin decision/role kinds to `#/admin/members`; payment-marked and gym-finalized kinds to `#/admin/payments`; Giving publication to `#/giving`; and Welcome to `#/account`. Do not infer session IDs from notification body copy for historical session-specific rows; those rows retain null and use the `#/schedule` kind fallback.

Read state (`read_at`) is preserved. Previously read rows receive corrected destinations just like unread rows.

## Fallback behavior

Expand the pure `notificationDestination(kind, destination)` mapping for known kinds that have stable section-level routes. Booking-specific kinds cannot derive an entity ID from kind alone, so their fallback is:

- unresolved `operational_booking_reserved` and member payment/deferral kinds → `#/account/payments`
- unresolved `operational_rsvp_confirmed` → `#/schedule`
- unresolved Admin payment/gym kinds → `#/admin/payments`
- unresolved session update/cancellation kinds → `#/schedule`

This ensures unmatched historical records still land in a relevant section rather than an unrelated generic Profile page.

## Security and privacy

- Only internal hash routes beginning with `#/` are accepted by the view helper.
- Destinations contain booking/session IDs already protected by existing route ownership and role checks.
- A member opening another member’s booking route still receives Booking not found.
- Backfill joins always require matching `profile_id` for member-owned bookings.
- The resolver is security-definer with a fixed `search_path`, is not executable by `public` or `anon`, and the migration does not alter notification RLS.

## Testing

### Pure and rendering coverage

Verify:

- Explicit valid destinations remain authoritative.
- Unknown/malformed destinations use safe fallbacks.
- Every stable known kind maps to its expected section.
- A rendered unread `operational_booking_reserved` row with `#/pay/<booking-id>` contains that exact `data-destination` and opens the same existing payment view.
- Read rows are excluded from every notification filter and an all-read result uses the empty state.
- A successful click persists `read_at`, removes the row and updates the count before assigning the destination hash.
- A failed read keeps the row and prevents navigation; a destination failure does not undo or misreport the successful read.

### Supabase migration coverage

Add SQL assertions covering:

- The insert trigger preserves explicit destinations and assigns a new reservation notification the exact booking payment route.
- RSVP confirmation points to exact dated Activity Details.
- Payment approval points to Booking Details.
- Payment marked and gym finalized point to Admin Payments.
- Deferral and cancellation point to their related booking/session routes.
- Admin and Giving notifications use their stable routes.
- Existing reservation and RSVP rows are backfilled only from same-profile uniquely matched bookings; ambiguous RSVP rows remain unresolved.
- Explicit destinations and `read_at` values are not overwritten.

Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, the notification and operational safety verifiers, syntax checks, relevant Supabase SQL tests available in the repository, and `git diff --check` before completion. The branch must contain executable application/migration changes—not documentation only—before notification routing is described as implemented. Do not claim live routing is fixed until migration `00007` is applied to Supabase.
