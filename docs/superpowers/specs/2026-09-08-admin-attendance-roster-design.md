# Admin Payment and Attendance Rosters — Design

Date: 2026-09-08
Branch: `feature/admin-attendance-roster`
Target branch: `testing`

## Purpose

Give payment collectors and Admins one predictable, mobile-friendly place to answer two operational questions:

1. During the Thursday and Friday payment checkpoints, who is Payment due, Awaiting confirmation, or Paid?
2. From 15 minutes before a paid session, which confirmed-paid members are still Expected and which have Arrived?

The feature belongs under **Admin → Payments**. It does not add an Attendance tab or duplicate the roster under Activities.

## Product rules

### Payment states

Every active paid booking appears in exactly one financial group:

- **Payment due** — `status = reserved` and `payment_marked_at is null`.
- **Awaiting confirmation** — `status = reserved` and `payment_marked_at is not null`.
- **Paid** — `status in (confirmed, attended)`.

`attended` remains financially Paid. Marking attendance must never reduce paid headcount, alter payment timestamps, void a receipt, or imply that every confirmed-paid member attended.

Cancelled, expired, deferred, and withdrawn records do not appear in these active payment groups.

### Attendance states

Attendance is manual and is available only for confirmed-paid bookings:

- **Expected** — `status = confirmed`.
- **Arrived** — `status = attended`.

There is no automatic `confirmed → attended` transition and no No-show status in Group C. A member contributes to the Profile Attended count only after an Admin marks the booking Arrived.

Attendance controls:

- open exactly 15 minutes before the concrete session start;
- remain open through the session;
- close exactly 24 hours after the session end;
- are reversible while open: `Expected ↔ Arrived`;
- use authoritative server time in live mode;
- reject unpaid, unassigned, free/RSVP, cancelled, expired, and deferred bookings.

A session end is its HKT start plus `duration_minutes`. The attendance close is 24 hours after that end.

## Admin experience

### Location

Extend **Admin → Payments**. Preserve the four Admin tabs:

**Members · Activities · Giving · Payments**

Existing Payment duty, pending-payment reconciliation, venue handoff, and weekly booking setup remain intact.

### Payment roster cards

Render stacked, collapsible roster cards for dated HYROX cycles and direct paid sessions. A pooled cycle is visible from registration opening through the end of its attendance correction window. A direct paid session is visible from 21 days before its start through the end of its attendance correction window. Any active Payment due, Awaiting confirmation, Paid, or Arrived booking keeps its card visible even if ordinary provisioning horizons shift. Cards are sorted chronologically, with the nearest operational session first.

Each card summary shows:

- date;
- session or weekly-cycle label;
- venue, or `Venue allocation pending` for an unallocated pooled cycle;
- Payment due, Awaiting confirmation, and Paid counts.

Inside each card, render three collapsible name groups in this order:

1. Payment due
2. Awaiting confirmation
3. Paid

Names are alphabetical. Rows show the member’s full display name and the financial badge only. They do not show email, phone, donor ID, payment payloads, raw booking records, queues, or unrelated profile data. Awaiting-confirmation rows may retain the existing payment-reference review and confirm/reject controls already authorized on Admin → Payments.

For a pooled BFT/Midtown cycle before allocation, financial names remain grouped under the parent weekly cycle. Once allocation assigns `session_id`, the attendance portion separates confirmed-paid members by concrete venue and start time. Quarry Bay and other direct paid HYROX sessions use their concrete session from the beginning.

Empty financial groups show a concise zero/empty state rather than disappearing, so collectors can verify all three states during Thursday and Friday checkpoints.

### Expected-arrivals roster

Within the same Admin Payments session card, show an **Expected arrivals** section for each concrete paid session.

Before the check-in window:

- confirmed-paid names are visible read-only;
- copy states when check-in opens;
- no attendance mutation control is rendered.

During the check-in window:

- Expected members appear first with a **Mark Arrived** button;
- Arrived members follow with an **Undo** button;
- the summary shows `X arrived · Y still expected`;
- buttons use at least the existing small-button tap target and become full-width where needed on mobile;
- each mutation disables its control while saving.

After the 24-hour correction window:

- names and final states remain visible read-only;
- copy states that attendance is locked.

Unallocated pooled bookings cannot appear in Expected arrivals because they have no authoritative venue/start session. The UI explains that the arrival roster becomes available after venue allocation.

## Data and schema

### Operational booking changes

Add migration `supabase/migrations/20260909000001_operational_attendance.sql`.

The migration will:

1. Extend the `operational_bookings.status` check constraint to allow `attended` in addition to the existing values.
2. Add nullable columns:
   - `attended_at timestamptz`
   - `attended_by uuid references public.profiles(id)`
3. Add consistency constraints so:
   - `status = attended` requires both attendance columns;
   - non-attended statuses require both attendance columns to be null.
4. Create the Admin-only RPC described below.
5. Preserve existing booking rows and indexes.

No existing booking, queue, receipt, payment, allocation, or notification record is deleted or rewritten by the migration.

### Attendance RPC

Add:

```sql
public.set_operational_attendance(
  p_booking_id uuid,
  p_arrived boolean
) returns public.operational_bookings
```

The function is `security definer`, uses a fixed `search_path`, and locks the selected booking row before validation.

Authorization and validation:

- caller must be an authenticated Admin or Super Admin;
- booking and concrete session must exist;
- session must not be cancelled;
- session price must be greater than zero;
- booking must have an assigned `session_id`;
- `p_arrived = true` accepts `confirmed` or already-`attended` only;
- `p_arrived = false` accepts `attended` or already-`confirmed` only;
- current server time must be within `[session start - 15 minutes, session end + 24 hours]`.

Mutation behavior:

- marking Arrived sets `status = attended`, `attended_at = now()`, and `attended_by = auth.uid()`;
- undoing sets `status = confirmed` and clears both attendance columns;
- repeating the already-achieved desired state is idempotent and does not replace the original attendance timestamp;
- payment, receipt, allocation, and booking-owner fields are unchanged.

Execution is revoked from `public` and `anon`, then granted to `authenticated`; the function’s role check remains authoritative.

No member notification is generated for attendance marking in Group C.

## Application architecture

### `app/js/operations.js`

- Map `attended_at` and `attended_by` in operational booking rows.
- Add `liveSetOperationalAttendance(bookingId, arrived)` calling the narrow RPC.
- Refresh or reconcile the authoritative operational cache after success.
- Preserve Realtime booking updates.

### `app/js/store.js`

Add shared helpers so counts, lists, and labels cannot drift:

- `paymentStateForBooking(booking)` → `payment_due`, `awaiting_confirmation`, `paid`, or `null`.
- `attendanceWindowForSession(session, now)` → opening/closing timestamps and `upcoming`, `open`, or `locked` state.
- roster selectors that include `attended` as Paid while excluding inactive records.
- `setBookingAttendance(bookingId, arrived, now?)` with live/local parity.

The mutation requires the existing Admin/Super Admin authorization seam. Local mode mirrors the same paid-session, assignment, cancellation, status-transition, and timing rules.

Advance local prototype state from v21 to v22. The migration initializes `attendedAt` and `attendedBy` to null on existing bookings without changing their status or other fields. New bookings initialize the same fields explicitly.

### `app/js/views.js`

- Pass the already Admin-authorized payment-user directory into roster rendering.
- Resolve booking owners by ID and render names only in Admin scope.
- Use one payment-state helper for summary counts and name groups.
- Treat `confirmed` as Expected and `attended` as Arrived.
- Keep pooled pre-allocation financial lists available while withholding attendance controls until a concrete session exists.
- Use semantic `<details>` / `<summary>` structures and existing card, badge, button, muted, and section-head styles.

### `app/js/app.js`

Add delegated `attendance-toggle` handling:

- validate booking ID and requested state from dataset values;
- disable the selected control while saving;
- call `store.setBookingAttendance()`;
- refresh Admin → Payments from the authoritative store;
- show concise success or error feedback;
- do not navigate away from the roster.

## Privacy and authorization

- The roster is rendered only after the existing Admin route authorization succeeds.
- It reuses `listPaymentUsers()`, which Admin → Payments already loads, and operational booking IDs already available to Admins.
- No new broad profile or booking read endpoint is added.
- Members retain only the existing protected attendee display-name surface; this feature does not expose financial state, attendance controls, emails, phones, raw bookings, unpaid reservations, or queues to members.
- Collector reminder notifications remain aggregate-only and continue linking to `#/admin/payments`.

## Failure handling

- UI hides mutation controls before opening and after locking; the RPC independently enforces both boundaries.
- A stale, concurrent, unauthorized, or invalid transition returns a clear error and does not optimistically change the row.
- After a failed or successful live mutation, refresh the operational cache so the screen reflects Supabase.
- Missing member-directory entries render `Member` rather than leaking an identifier.
- Missing concrete allocation renders explanatory pending copy, not a guessed venue.
- Empty groups remain legible and do not break the session card layout.

## Testing

### Local smoke coverage

Add tests for:

- exact financial classification of Payment due, Awaiting confirmation, Paid, and inactive records;
- names and counts matching within each financial group;
- full-name visibility in Admin only;
- pre-allocation pooled financial grouping;
- concrete venue attendance grouping after allocation;
- confirmed-paid → Expected and attended → Arrived distinction;
- exact opening boundary at 15 minutes before start;
- exact closing boundary at 24 hours after session end;
- reversible and idempotent local attendance;
- rejection for members, unpaid bookings, unassigned bookings, non-paid sessions, cancelled sessions, and out-of-window requests;
- Profile Attended count after marking arrival;
- v21→v22 migration preserving all existing booking/payment data.

### Live/mock coverage

Extend `app/live-auth-smoke.mjs` for:

- RPC name and payload;
- mapped attendance timestamps/actor;
- cache refresh after mutation;
- Admin success and member rejection behavior;
- stale/concurrent error propagation.

### SQL contract and integration coverage

- Assert status/column constraints, fixed search path, row lock, authorization, paid-session guard, timing bounds, idempotency, grants, and revokes.
- Extend `supabase/tests/operational_backend_integration.sql` with Admin mark/undo cases and member-denied cases.
- SQL execution remains limited to an explicitly acknowledged disposable database; never run `supabase db reset --linked`.

### Final verification

Run:

```sh
node app/smoke.mjs
node --check app/js/app.js
node --check app/js/store.js
node --check app/js/views.js
node --check app/js/operations.js
node --check app/live-auth-smoke.mjs
node --check app/smoke.mjs
git diff --check
```

Confirm no Shop paths are changed.

## Out of scope

- No-show status or policy.
- Attendance for free/open-attendance sessions or RSVP socials.
- Member-facing roster payment states.
- Email, WhatsApp, or push attendance reminders.
- Automatic attendance marking.
- A separate Attendance Admin tab.
- Attendance analytics, exports, or long-term reporting.
