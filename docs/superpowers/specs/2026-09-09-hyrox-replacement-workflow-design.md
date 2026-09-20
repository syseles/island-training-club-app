# Manual HYROX Replacement Workflow

**Date:** 2026-09-09
**Branch:** `feature/booking-no-deferral`
**Status:** Design approved in conversation; implementation pending

## Purpose

Allow a member who cannot attend a paid HYROX booking to record a manual replacement inside the app without introducing refunds, payment transfers, automatic member discovery, or an unverified ownership change.

The workflow applies to every paid HYROX booking:

- pooled BFT Causeway Bay / Midtown 28 bookings;
- direct Island ECC / Quarry Bay bookings.

The replacement keeps the same booking, session, venue assignment, payment, and receipt. It changes only the effective attendee after the replacement is accepted by an approved member and confirmed by an Admin or collector.

## Product flow

### 1. Original member creates an invitation

On an eligible paid HYROX booking, the member sees:

> **I can’t attend — arrange a replacement**
>
> Your paid booking is final — no refund or deferral. If an approved ITC friend is taking your place, contact ITC so an Admin can record and confirm the manual replacement.

The member selects the replacement action. The app creates one single-use, expiring replacement invitation and shows:

- the HYROX date;
- venue or `Venue pending`;
- session time when authoritative;
- expiry time;
- current status;
- **Share via WhatsApp** action.

The WhatsApp action is a user-initiated share of a private app link. It does not send a WhatsApp message from the system and does not claim that delivery occurred.

The original booking remains unchanged and the original member remains the effective attendee.

### 2. Friend claims the invitation

The recipient opens the private link. They must sign in and have an approved ITC member profile.

The invitation page shows only the minimum information needed to decide:

- HYROX date;
- venue or pending venue;
- session time when authoritative;
- replacement terms;
- the original member's display name only if needed for a clear handover context.

The recipient can choose:

- **Accept replacement**;
- **Decline replacement**.

The first approved member to accept claims the single-use invitation. A second member cannot claim it. A member who already owns an active booking for the same HYROX session is rejected.

After acceptance, the request becomes **Pending Admin confirmation**. The original member remains the effective attendee until an Admin confirms the handover.

### 3. Admin confirms the handover

Admin → Payments shows accepted replacement requests in a dedicated, compact section associated with the booking's payment/session roster.

An Admin can see:

- original member;
- replacement member;
- HYROX date, time, venue/pending venue;
- request status and timestamps;
- payer/receipt status without exposing unnecessary payment payloads.

Admin actions:

- **Confirm replacement**;
- **Reject replacement**.

On confirmation:

- the replacement becomes the effective attendee;
- the original member is removed from the attendance roster;
- the replacement appears on the Expected/Arrived roster as Expected;
- the existing booking, payment, receipt, session, venue allocation, and price remain unchanged;
- the original member remains the payer of record;
- no refund or payment transfer occurs;
- an audit record preserves the original member, replacement member, accepting member, confirming Admin, and timestamps.

The original member and replacement member receive in-app confirmation notifications. The replacement member becomes responsible for attending the existing session, but no payment obligation is created.

## Eligibility and lifecycle rules

A replacement invitation may be created only when:

- the caller owns the booking;
- the booking is a paid HYROX booking;
- the booking is `confirmed`;
- the session is not cancelled;
- the session has not started;
- no active replacement request already exists for the booking;
- the booking has not already been marked `attended`.

A replacement invitation can be accepted only when:

- the recipient is authenticated and approved;
- the invitation is active and unexpired;
- the invitation has not already been claimed;
- the recipient is not the original member;
- the recipient has no active booking for the same HYROX session;
- the booking/session has not been cancelled or started.

A pending invitation can be cancelled by the original member before acceptance. An accepted request can be rejected by an Admin before confirmation. A confirmed replacement cannot be changed through member self-service; Admin must record a new correction path if required.

Invitations expire before session start. The exact default expiry is the earlier of:

- 24 hours after creation; or
- the concrete session start time.

For an unallocated pooled booking, the invitation can be accepted while the venue is pending. The replacement inherits the booking and receives the authoritative venue when allocation later occurs.

No replacement may change the HYROX date, session, venue, allocation, payment amount, receipt owner, or collector assignment.

## Data model

Add an additive replacement-request record with:

- request ID;
- booking ID;
- original profile ID;
- replacement profile ID, nullable until claimed;
- single-use token hash;
- status: `pending`, `accepted`, `declined`, `cancelled`, `rejected`, `confirmed`, or `expired`;
- created, expires, accepted, declined, cancelled, rejected, and confirmed timestamps;
- accepted-by and confirmed-by profile IDs;
- optional rejection/cancellation reason.

Additive booking fields record the effective attendee without changing the payer/owner relationship:

- `replacement_profile_id`, nullable;
- `replacement_confirmed_at`, nullable;
- `replacement_confirmed_by`, nullable.

The effective attendee resolver is:

```text
replacement_profile_id ?? booking.profile_id
```

The resolver is used only for attendance/display identity after confirmation. Financial ownership, payment authorization, receipts, notifications about payment, and booking audit ownership remain tied to `booking.profile_id`.

The migration must preserve all existing bookings, queues, payments, receipts, allocations, notifications, and profiles. Existing rows receive null replacement fields.

## Authorization and privacy

- Live Supabase remains authoritative; live errors never fall back to local replacement state.
- Member invitation creation requires booking ownership.
- Invitation claim requires an approved member.
- Admin confirmation uses the existing Admin/Super Admin authorization seam.
- The raw invitation token is never displayed in Admin lists or persisted as plaintext server data; store a hash and issue the raw token only in the generated share URL.
- A bearer link alone is insufficient without approved authentication.
- Member-facing views expose only the session details, display names, and status needed for the handover.
- Admin views may show both full display names but must not expose email, phone, donor ID, or unrelated profile data.
- WhatsApp is only a user-initiated share target. No outbound WhatsApp/email delivery is implemented.

## Notifications

In-app notifications only:

- original member: replacement accepted and replacement confirmed/rejected;
- replacement member: invitation accepted and replacement confirmed/rejected;
- Admin/collector: accepted request requiring confirmation.

Notifications contain the minimum session/status context and link to the replacement or Admin Payments route. They do not contain raw tokens, payment references, emails, phones, or donor IDs.

## Local and live parity

Local mode mirrors live behavior through `store.js`:

- additive state migration;
- token/request lifecycle;
- ownership and approved-member checks;
- same expiry and session-start guards;
- same duplicate-booking guard;
- same effective-attendee resolver;
- same Admin confirmation and reversal protections.

Live mode adds narrow RPCs for create, claim/decline, cancel, and Admin confirm/reject. Every mutation locks the relevant booking/request rows and revalidates eligibility server-side.

## UI requirements

### Member booking detail

Show the approved heading and supporting copy. The action state must be explicit:

- no request: create replacement;
- pending: show expiry and **Share via WhatsApp**;
- accepted: show **Pending Admin confirmation**;
- confirmed: show replacement display name and confirmation state;
- declined/cancelled/expired: show the final state and allow a new request only when eligibility rules permit.

### Invitation route

Add a validated route for the replacement token. Preserve it through sign-in handoff using the existing route-persistence seam. Invalid, expired, claimed, or unauthorized links render a clear non-sensitive error state.

### Admin Payments

Add replacement requests near the relevant payment/session roster without creating a new Admin tab. Keep the section mobile-first and use the existing compact disclosure-row pattern.

## Failure handling

- Concurrent claims allow only one approved recipient to win.
- A stale claim returns a clear message and does not mutate the booking.
- Admin rejection leaves the original member as effective attendee.
- Cancelled/expired sessions reject all new actions.
- A failed live mutation leaves the authoritative cache unchanged and triggers a refresh before the UI settles.
- Repeated idempotent confirmation does not create a second replacement or alter payment/receipt fields.

## Testing requirements

Local smoke coverage must include:

- eligible paid direct and pooled bookings can create invitations;
- free, RSVP, unpaid, cancelled, attended, started, and non-owner requests are rejected;
- WhatsApp share URL contains a validated replacement route without exposing raw profile data;
- first approved recipient claims the invitation and a second recipient is rejected;
- recipient decline, original cancellation, expiry, and session-start cutoff;
- duplicate same-session booking rejection;
- Admin-only confirmation/rejection;
- confirmed replacement changes effective attendee but preserves payer, receipt, session, venue, price, and payment timestamps;
- attendance roster shows the replacement and not the original member;
- pooled unallocated replacement inherits later authoritative allocation;
- migration preserves existing state.

Live/mock coverage must include:

- RPC names and narrow payloads;
- token/request mapping;
- no local fallback after live failures;
- concurrent claim behavior;
- Admin authorization;
- authoritative cache refresh after acceptance and confirmation;
- privacy assertions for member and Admin surfaces.

SQL integration coverage must run only against an explicitly acknowledged disposable database. Never run a linked destructive reset.

## Out of scope

- Automated WhatsApp/email delivery.
- Payment/refund/credit transfer.
- Public member search or directory browsing.
- Changing the replacement to a different session or venue.
- Multiple replacements for one booking.
- Automatic Admin approval.
- Automatic attendance marking.
- Shop, Giving, Community, or RSVP changes.
