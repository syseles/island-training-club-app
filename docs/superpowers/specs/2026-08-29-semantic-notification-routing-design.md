# Semantic Notification Routing Design

## Goal

Make every known notification open the most relevant app page instead of falling back to Profile. In particular, `Booking reserved` must open the payment page for the exact booking that generated the notification.

## Root cause

Notification rows support an optional `destination` column, and the Inbox already respects valid explicit `#/…` destinations. Several Supabase notification producers still insert only `profile_id`, `kind`, `title`, and `body`. `notificationDestination()` therefore receives no explicit route and falls back to `#/account` for personal notification kinds.

The booking reservation RPC has the new booking ID at notification creation time but does not store `#/pay/<booking-id>`. The screenshot’s row consequently renders `data-destination="#/account"` even though its message prompts immediate payment.

## Architecture

Notification producers own semantic routing because they have authoritative related entity IDs at creation time. A new migration updates current Supabase producers to write explicit destinations. Existing local prototype producers continue passing their existing links through the store seam; any missing local destinations are corrected at their source.

The Inbox remains a renderer and router, not an entity-matching engine. It will continue to:

1. Prefer a valid explicit `destination` beginning with `#/`.
2. Use kind-level fallback routes only when no explicit destination exists.
3. Fall back safely to `#/account` for unknown kinds.

No generic entity-type or entity-ID columns are added.

## Routing map

### Member booking and RSVP

- `operational_booking_reserved` → `#/pay/<booking-id>`
- `operational_rsvp_confirmed` → `#/booking/<booking-id>`
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

Create `supabase/migrations/20260829000005_notification_destinations.sql`, after the latest RSVP migration.

The migration will update the latest active versions of notification-producing functions so destinations are written in the same transaction as their related event:

- Reservation/RSVP creation uses the returned booking ID.
- Payment approval uses the approved booking ID.
- Payment marked and gym finalized use the Admin Payments route.
- Deferral uses the newly created booking ID.
- Booking/session cancellation uses the related session ID.
- Admin application/role triggers and Giving publication use their stable section routes.

Function signatures, security-definer settings, search paths, authorization, booking/payment behavior, notification copy, grants, and transaction boundaries remain unchanged. Only destination insertion is added.

## Existing notification backfill

Backfill existing rows whose `destination` is null; never overwrite an explicit destination.

For booking-specific rows, match the notification to an operational booking belonging to the same profile whose relevant booking timestamp falls within five seconds of `notifications.created_at`. Update only notifications with exactly one candidate in that window; zero or multiple candidates remain unchanged.

Backfill:

- `operational_booking_reserved` from `reserved_at` → `#/pay/<booking-id>`
- `operational_rsvp_confirmed` from `reserved_at` → `#/booking/<booking-id>`
- `operational_payment_approved` from `paid_at` → `#/booking/<booking-id>`
- `operational_session_deferred` from the new booking’s `reserved_at` → `#/booking/<new-booking-id>`

Rows without a safe unique booking match retain null and use the kind-level fallback rather than risk routing to the wrong member transaction.

Backfill stable non-entity routes directly by kind: Admin application submissions to `#/admin/approvals`; Admin decision/role kinds to `#/admin/members`; payment-marked and gym-finalized kinds to `#/admin/payments`; Giving publication to `#/giving`; and Welcome to `#/account`. Do not infer session IDs from notification body copy for historical session-specific rows; those rows retain null and use the `#/schedule` kind fallback.

Read state (`read_at`) is preserved. Previously read rows receive corrected destinations just like unread rows.

## Fallback behavior

Expand the pure `notificationDestination(kind, destination)` mapping for known kinds that have stable section-level routes. Booking-specific kinds cannot derive an entity ID from kind alone, so their fallback is:

- `operational_booking_reserved` and other unresolved member booking kinds → `#/account/payments`
- unresolved Admin payment/gym kinds → `#/admin/payments`
- unresolved session update/cancellation kinds → `#/schedule`

This ensures unmatched historical records still land in a relevant section rather than an unrelated generic Profile page.

## Security and privacy

- Only internal hash routes beginning with `#/` are accepted by the view helper.
- Destinations contain booking/session IDs already protected by existing route ownership and role checks.
- A member opening another member’s booking route still receives Booking not found.
- Backfill joins always require matching `profile_id` for member-owned bookings.
- The migration does not expose additional notification data or alter RLS.

## Testing

### Pure and rendering coverage

Verify:

- Explicit valid destinations remain authoritative.
- Unknown/malformed destinations use safe fallbacks.
- Every stable known kind maps to its expected section.
- A rendered `operational_booking_reserved` row with `#/pay/<booking-id>` contains that exact `data-destination`.
- Read and unread rows use the same semantic destination.
- Existing mark-read-before-navigation and failed-destination behavior remains unchanged.

### Supabase migration coverage

Add SQL assertions covering:

- New reservation notification destination equals the returned booking payment route.
- RSVP confirmation points to Booking Details.
- Payment approval points to Booking Details.
- Payment marked and gym finalized point to Admin Payments.
- Deferral and cancellation point to their related booking/session routes.
- Admin and Giving notifications use their stable routes.
- Existing reservation rows are backfilled only to same-profile uniquely matched bookings.
- Explicit destinations and `read_at` values are not overwritten.

Run `node app/smoke.mjs`, `node app/live-auth-smoke.mjs`, relevant Supabase SQL tests available in the repository, and `git diff --check` before completion.
