# HYROX Weekly Registration, Payment and Venue Allocation

**Date:** 2026-09-03  
**Branch:** `feature/hyrox-registration-allocation` (off `origin/testing`)  
**Status:** Approved for implementation

## Problem

The current application treats BFT Causeway Bay and Midtown28 as separate
bookable sessions. BFT holds 20 people and members beyond capacity wait without
paying. Under that model, the collector can never observe more than 20 paid
members, so the operational rule “book both gyms when more than 20 people have
paid” cannot trigger.

Separate venue booking also asks new members to understand ITC’s venue-planning
process before they have experienced it. The member needs to buy one Saturday
HYROX place, understand the possible venues and times, and receive a clear venue
assignment later.

## Approved direction

Use one **weekly HYROX registration pool** for BFT and Midtown:

- Up to 32 approved members may reserve and pay before venue allocation.
- Registration #33 onward enters the weekly waitlist and does not pay.
- Each registering member records a non-binding preference: BFT, Midtown or
  Either.
- Every payer explicitly accepts BFT at 11:15 as the fallback if Midtown does
  not open.
- Registration opens automatically Monday 6 PM HKT for that week’s Saturday;
  later Saturdays remain visible but locked.
- The standard payment deadline is Thursday 6 PM, with a final holder grace
  period to Thursday 7 PM and a one-hour promoted-member deadline to Thursday
  8 PM.
- The on-duty collector reconciles member payment claims after Thursday 8 PM.
- Twenty or fewer collector-confirmed payments automatically produce a BFT-only plan.
- More than 20 collector-confirmed payments produce a two-venue plan.
- For a two-venue plan, the system creates a provisional allocation using the
  member’s preference and payment-confirmation order.
- Members may change venue, subject to BFT capacity 20 and Midtown capacity 12,
  until Friday 9 PM.
- A paid member whose preferred venue is full keeps the assigned venue and may
  join a separate venue-switch queue.

This combines the shared-pool structure from mockup A with the early-preference
experience from mockup B.

## Goals

- Make “more than 20 paid” operationally possible without charging waitlisted
  members.
- Give new members transparent venue and time information before payment.
- Separate a weekly waitlist from a venue-switch queue so “waiting” never has
  ambiguous payment consequences.
- Make payment reconciliation, threshold calculation and venue allocation
  authoritative and atomic in Supabase live mode.
- Keep the localStorage prototype behaviourally equivalent for smoke tests and
  offline product review.
- Preserve the current collector duty, PayMe/FPS, receipt, cancellation,
  notification and Realtime foundations.
- Introduce the workflow without rewriting or discarding existing historical
  session-specific bookings.

## Non-goals

- Real payment processing or automatic PayMe/FPS reconciliation.
- Refunds, member-initiated deferrals or peer-to-peer booking transfers for
  pooled BFT/Midtown registrations.
- Charging a member while they remain on the weekly waitlist.
- Including Quarry Bay in the initial BFT/Midtown pool.
- Changing membership approval, Giving, Shop, Community or RSVP-event flows.
- Automatically sending WhatsApp, email or push messages.
- Replacing child venue sessions; BFT and Midtown remain authoritative dated
  sessions for attendance, calendar details, cancellation and gym finalization.

## Venue scope and Quarry Bay

The initial weekly pool contains exactly:

| Venue | Activity ID | Time | Capacity |
|---|---|---:|---:|
| BFT Causeway Bay | `hyrox-bft` | Saturday 11:15 | 20 |
| Midtown28 Fitness | `hyrox-midtown` | Saturday 11:00 | 12 |

`hyrox-quarry-bay` remains a separately displayed and separately booked HYROX
session with its existing time, capacity and payment flow. It does not contribute
to the 20-payment threshold or the 32-place pool.

A member may not hold an active pooled BFT/Midtown registration and an active
Quarry Bay booking for the same Saturday. Reservation RPCs enforce this in both
directions. This replaces the current “hold multiple venues, release siblings
when payment is confirmed” behaviour for pooled weeks and prevents one member
from occupying multiple overlapping HYROX places.

## Weekly timeline

All deadlines use `Asia/Hong_Kong`, independent of the browser or database host
timezone.

### Before Monday 6 PM: visible but locked

- Rolling generation continues creating that Saturday’s BFT and Midtown child
  sessions as it does today.
- A pooled cycle is scheduled only for a clean future Saturday after the cutover
  guard confirms neither child has active legacy bookings or queues.
- The combined Saturday HYROX card is visible, but its action reads **Opens
  Monday at 6 PM** and cannot reserve or join a queue.
- Saturdays after the current week remain locked until their own Monday 6 PM
  opening time.

### Monday 6 PM: registration opens automatically

- The server derives `registration_opens_at` as Monday 18:00 HKT for that
  Saturday.
- An idempotent cycle sweep opens the cycle and notifies approved members. The
  reserve RPC also opens an eligible due cycle under lock so a delayed sweep
  cannot block registration.
- Opening records the server timestamp; no collector decision is required.
- BFT and Midtown cannot be booked directly once their pooled cycle is
  scheduled.

### Monday 6 PM to Thursday 6 PM: reserve and pay

- The first 32 active registrations receive an unpaid held place.
- Further members may join the ordered weekly waitlist.
- Joining the weekly waitlist records the same venue preference and BFT
  fallback acknowledgement as a direct reservation, but exposes no payment
  action.
- If an unpaid member cancels during this period, the oldest weekly-waitlist
  member is promoted with their recorded preference and the standard Thursday
  6 PM payment deadline.
- Reservation records venue preference and the fallback acknowledgement.
- A reserved member sees the on-duty collector’s PayMe/FPS instructions and may
  mark payment.
- When capacity first reaches 32, unmarked holders are notified that they must
  pay by Thursday 6 PM or risk losing the place to the waitlist.
- Thursday 5 PM sends a payment reminder to every unmarked holder.
- The collector approves or rejects each payment claim.
- Collector approval issues the receipt immediately; venue assignment is not
  required for receipt issuance.
- A member may cancel an unpaid registration only before marking payment.

### Thursday 6 PM to 7 PM: final holder grace period

- New reservations and weekly-waitlist joins close at Thursday 6 PM.
- An unmarked holder remains booked for one final hour and receives: **Pay now—
  your place will move to the waitlist at 7 PM if payment is not marked.**
- The collector receives confirmed, pending-claim, unmarked-holder and
  weekly-waitlist totals.
- Existing holders may mark payment until Thursday 7 PM. Payment claims already
  submitted remain held for collector review.

### Thursday 7 PM to 8 PM: one promotion round

- Every still-unmarked original holder is removed from the booking and appended
  to the non-payable weekly waitlist.
- The server promotes the oldest pre-existing weekly-waitlist entries into the
  freed places. Queue order remains `joined_at`, then UUID; newly demoted holders
  join behind members who were already waiting.
- Promoted members are notified immediately and have one hour, until Thursday
  8 PM, to mark payment.
- No additional member is promoted if a promoted member fails to pay.

### Thursday 8 PM: payment closes and reconciliation begins

- Payment marking closes for every pooled booking.
- Unmarked promoted bookings expire. Remaining active weekly-waitlist entries
  dissolve and members are notified that no place opened for that week.
- Payment claims submitted by the applicable deadline remain held until
  reviewed.
- The collector receives an updated summary and must approve or reject every
  pending claim. Resolving the last claim automatically finalizes the venue plan;
  if no claims are pending, the 8 PM sweep finalizes it immediately.
- The server counts collector-confirmed payments while holding the cycle lock:
  - `0–20` confirmed: `bft_only`
  - `21–32` confirmed: `both`
- The server automatically derives the plan; the collector is prompted to
  reconcile claims but cannot choose a result inconsistent with capacity.
- Finalizing the plan is idempotent and cannot be reversed through the normal UI.

### Venue allocation

For a BFT-only plan, every collector-confirmed registration is assigned BFT as
a final allocation and Midtown remains closed. There is no venue-choice or
switch-queue step.

For a two-venue plan, each collector-confirmed registration is provisionally
allocated immediately after plan confirmation using this deterministic order:

1. Process registrations by `paid_at`, then booking UUID as the stable tie-break.
2. If the preferred venue has capacity, allocate it.
3. For `Either`, allocate BFT while BFT has capacity, then Midtown.
4. If the preferred venue is full, allocate the other venue.

This assignment is provisional but guarantees a valid gym place. Members do not
race to obtain their initial allocation.

Until Friday 9 PM, a member may:

- move immediately when the target venue has capacity;
- retain the current guaranteed allocation and join the target venue’s switch
  queue when it is full; or
- leave the switch queue without affecting the current allocation.

When a member requests a full target venue, the RPC immediately swaps them with
the oldest active opposite-direction switch request when one exists; otherwise
it records their ordered request. Every move also checks the oldest switch
request targeting the newly freed venue. Any move or swap is atomic and must
leave both venue counts within capacity.

### Friday 9 PM: allocation closes

- Venue changes close at Friday 9 PM.
- Existing provisional allocations become final without further action.
- Unmatched venue-switch entries dissolve; members keep their current assigned
  venues and receive a notification.
- The collector’s final BFT and Midtown gym lists become available.
- Gym finalization becomes available only after Friday 9 PM allocation closure.
- If collector reconciliation is exceptionally completed after Friday 9 PM,
  the server still derives the plan and allocates deterministically, but marks
  allocations final immediately and does not open venue changes or switch
  queues. The Admin dashboard flags the missed choice window.

## Capacity and queue semantics

### Weekly HYROX waitlist

The weekly waitlist means the member does **not** currently have a Saturday
HYROX place.

- Starts after 32 active pooled registrations before Thursday 6 PM and also
  receives still-unmarked original holders demoted at Thursday 7 PM.
- Member does not see payment actions and must not pay.
- Position is ordered by server `joined_at`, then queue-entry UUID.
- Joining records `bft`, `midtown` or `either` preference plus explicit BFT
  fallback acknowledgement so an automatic promotion never creates an
  unacknowledged paid reservation.
- A promotion before Thursday 6 PM creates a reservation with those recorded
  choices and retains the standard Thursday 6 PM deadline.
- The single Thursday 7 PM promotion round gives promoted members until
  Thursday 8 PM; there are no later promotions.
- Leaving removes the queue entry without affecting other records.

Member copy:

> You’re #2 on the weekly waitlist. Don’t pay yet—we’ll notify you if a place
> opens and show your payment deadline.

### Venue-switch queue

The venue-switch queue means the paid member already has a guaranteed Saturday
HYROX place but prefers the other full gym.

- Exists only for a two-venue plan before Friday 9 PM.
- Records the requested target venue.
- Never removes or weakens the member’s current allocation.
- May resolve through a vacancy or an opposite-direction swap.
- Dissolves at Friday 9 PM if unmatched.

Member copy:

> BFT switch queue · you’re #2. Your Midtown place remains guaranteed while
> you wait.

The UI must never label a venue-switch entry merely “waitlist”.

## Member experience

### Public visitor and pending applicant

Public and pending users may inspect:

- Saturday date and fixed price;
- BFT and Midtown names, times and capacities;
- the Thursday payment threshold rule; and
- the Friday venue-choice deadline.

Booking remains gated by approved membership. The page explains the gate rather
than hiding the venue-planning rules.

### Schedule

For a pooled Saturday, Schedule replaces the separate BFT and Midtown booking
cards with one card:

```text
ITC HYROX — Saturday
Up to 32 paid places
BFT Causeway Bay · 11:15 · max 20
Midtown28 Fitness · 11:00 · max 12
Registration opens Monday 6 PM · venue plan follows Thursday reconciliation
```

Quarry Bay remains a separate card labelled with its specific venue and time.

### Registration

The primary action is **Reserve Saturday HYROX · HK$180**.

The registration screen includes:

- both possible venues and times;
- `BFT`, `Midtown` and `Either` preference controls;
- visible copy stating that preference is not a venue reservation;
- threshold outcomes (`≤20` and `21–32`);
- payment and venue-choice deadlines; and
- required acknowledgement:

> I understand that my booking will be at BFT at 11:15 if only BFT opens.

Separate visible copy explains that preferences remain subject to capacity.

The submit action is **Reserve & continue to pay**.

### Payment and reconciliation states

Member-facing states are:

1. **Payment due** — amount and standard Thursday 6 PM deadline.
2. **Final payment grace** — from Thursday 6–7 PM for an original holder.
3. **Promoted payment due** — promoted at Thursday 7 PM and due Thursday 8 PM.
4. **Payment reported** — collector is checking; place remains held.
5. **Payment claim rejected before that booking’s hard deadline** — reason shown,
   claim audit kept and payment controls reopen for another attempt.
6. **Payment confirmed, venue pending** — weekly place confirmed; venue plan is
   announced after reconciliation.
7. **BFT assigned** — BFT-only plan, fixed venue and calendar details.
8. **Both gyms confirmed** — provisional venue plus capacity-aware change
   controls until Friday 9 PM.
9. **Venue final** — final venue/time, directions and calendar action.

Payment instructions and references identify the weekly event, not an
unconfirmed venue. Example:

```text
ITC HYROX · Saturday 24 August · Seles Li
```

### Cancellation and transfer policy

- An unpaid registration can be cancelled before payment is marked.
- After payment is marked, the member cannot cancel, defer or request a refund
  in the app.
- A member may use the community group to find someone willing to take the
  place, but peer transfer is not implemented in this feature.
- Admin-only exceptional handling remains an offline operational decision.
- ITC-initiated whole-cycle cancellation retains the existing protection:
  confirmed payments move to the next available pooled cycle when capacity
  permits; otherwise the member and admins receive a follow-up notification.

## Collector and Admin experience

### Weekly cycle card

Payments displays one BFT/Midtown cycle card with:

- registration state and opening actor/time;
- active reservations out of 32;
- collector-confirmed paid count;
- payment claims awaiting review;
- unpaid count;
- weekly-waitlist count;
- derived threshold outcome preview; and
- venue allocation counts after plan confirmation.

Example:

```text
Saturday HYROX · Payment reconciliation
32 reserved
22 confirmed paid
3 payment claims to review
7 unpaid holders
4 on weekly waitlist
Next checkpoint: Thursday 7 PM holder release
Expected plan after review: Both gyms
```

### Collector controls

- Inspect automatic Monday 6 PM opening and upcoming locked cycles
- **Confirm received** or **Reject payment claim**
- Review the Thursday 6 PM and Thursday 8 PM in-app reconciliation summaries
- Inspect the automatically derived venue plan after Thursday 8 PM and after all
  claims are resolved
- Inspect BFT/Midtown allocations and venue-switch queues
- Send/copy final per-venue gym messages after Friday 9 PM
- **Mark confirmed with gym** on each opened child session

The dashboard explains why finalization is blocked, for example:

> Review 3 pending payment claims before the venue plan can be confirmed automatically.

### Activity controls

Existing child-session time, notice and venue-TBC controls remain under
Activities. Once a pooled cycle is scheduled:

- Midtown’s old manual open/close and interest-list controls are replaced by the
  threshold-derived plan.
- Direct BFT/Midtown reservation actions are disabled.
- The individual BFT/Midtown cancellation controls are replaced by one cycle
  cancellation action. It atomically cancels both child sessions, defers paid
  registrations under the cycle policy, cancels unpaid registrations and
  dissolves both cycle queues.
- Legacy non-pooled dates and Quarry Bay retain their existing per-session
  cancellation controls.

## State model

### Cycle state

`operational_hyrox_cycles` separates registration state from venue plan:

- `registration_state`: `draft`, `open`, `reconciling`, `closed`, `cancelled`
- `venue_plan`: `pending`, `bft_only`, `both`
- `allocation_closed_at`: null until Friday 9 PM closure

Valid transitions:

```text
draft → open → reconciling → closed
  └──────────────→ cancelled
open/reconciling ─→ cancelled
```

`venue_plan` remains `pending` until payment claims are reconciled and the
system finalizes the derived plan. A closed cycle must have `bft_only` or
`both`. Timestamped checkpoint markers make repeated hydration/focus sweeps
idempotent.

### Booking state

The existing booking status continues to represent payment commitment:

```text
reserved (unpaid)
  → payment marked (still reserved)
  → confirmed (collector-approved paid)
  → expired/cancelled
```

Venue allocation is orthogonal:

```text
unallocated → provisionally allocated → final allocation
```

This avoids inventing payment statuses such as `midtown_waiting` and keeps
receipts tied to the same booking identity.

## Supabase data model

### `operational_hyrox_cycles`

| Column | Type | Rule |
|---|---|---|
| `id` | text PK | `hyrox-pool-YYYY-MM-DD` |
| `session_date` | date unique | Saturday |
| `bft_session_id` | text FK sessions | matching-date `hyrox-bft` session |
| `midtown_session_id` | text FK sessions | matching-date `hyrox-midtown` session |
| `registration_state` | text check | draft/open/reconciling/closed/cancelled |
| `venue_plan` | text check | pending/bft_only/both |
| `registration_capacity` | integer | fixed 32 initially |
| `registration_opens_at` | timestamptz | Monday 18:00 HKT |
| `payment_deadline_at` | timestamptz | standard Thursday 18:00 HKT deadline |
| `holder_grace_deadline_at` | timestamptz | Thursday 19:00 HKT hard deadline for original holders |
| `promoted_payment_deadline_at` | timestamptz | Thursday 20:00 HKT hard deadline for 19:00 promotions |
| `venue_choice_deadline_at` | timestamptz | Friday 21:00 HKT |
| `capacity_warning_sent_at` | timestamptz nullable | idempotent full-pool warning marker |
| `payment_reminder_sent_at` | timestamptz nullable | idempotent Thursday 17:00 reminder marker |
| `holder_grace_started_at` | timestamptz nullable | idempotent Thursday 18:00 transition marker |
| `waitlist_promoted_at` | timestamptz nullable | idempotent Thursday 19:00 transition marker |
| `reconciliation_started_at` | timestamptz nullable | idempotent Thursday 20:00 transition marker |
| `opened_at` | timestamptz nullable | automatic opening timestamp |
| `plan_confirmed_at` | timestamptz nullable | required once venue plan is derived |
| `plan_confirmed_by` | UUID nullable | collector/Admin actor when one triggered derivation |
| `plan_confirmed_source` | text nullable | automatic_sweep/payment_reconciliation/admin_retry |
| `allocation_closed_at` | timestamptz nullable | server deadline closure |
| `cancelled_at` / `cancelled_by` / `cancel_reason` | fields | paired, reason required |
| `created_at` / `updated_at` | timestamptz | server-maintained |

The two child sessions must share `session_date`. BFT and Midtown IDs cannot be
used by more than one cycle.

### Additions to `operational_bookings`

| Column | Type | Rule |
|---|---|---|
| `hyrox_cycle_id` | text nullable FK cycles | set only for pooled registrations |
| `venue_preference` | text nullable | bft/midtown/either |
| `fallback_acknowledged_at` | timestamptz nullable | required for pooled registration |
| `promoted_from_waitlist_at` | timestamptz nullable | set only on the Thursday 7 PM promotion cohort |
| `allocation_state` | text nullable | provisional/final |
| `allocation_source` | text nullable | preference/member/automatic/admin |
| `allocated_at` | timestamptz nullable | paired with assigned session |
| `allocation_snapshot` | jsonb nullable | append-only array of assigned venue/time history |
| `payment_rejected_at` / `payment_rejected_by` | timestamp/UUID nullable | paired rejection audit |
| `payment_rejection_reason` | text nullable | required when rejection audit exists |

`session_id` becomes nullable only for an unallocated pooled booking. A pooled
booking receives the BFT or Midtown child `session_id` when allocated. Existing
non-pooled bookings continue to require `session_id`.

Add a partial unique index allowing at most one active booking per member and
cycle. Existing per-member/session uniqueness remains for non-pooled bookings.

The initial booking snapshot contains weekly date, price and both candidate
venues. An original booking uses `pay_deadline_at = holder_grace_deadline_at`;
the member UI still presents Thursday 6 PM as the standard deadline and switches
to grace messaging afterward. A Thursday 7 PM promoted booking uses
`pay_deadline_at = promoted_payment_deadline_at`. `allocation_snapshot` records
venue/time changes without mutating the original payment snapshot.

### Additions to `operational_receipts`

- Add nullable `hyrox_cycle_id`.
- Allow `session_id` to remain null until allocation for pooled receipts.
- Retain the required `booking_id` relationship.
- Populate the final session link after allocation without changing amount,
  method, receipt number or issued timestamp.

### `operational_hyrox_queue_entries`

| Column | Type | Rule |
|---|---|---|
| `id` | UUID PK | server-generated |
| `cycle_id` | text FK cycles | required |
| `profile_id` | UUID FK profiles | required |
| `kind` | text check | weekly_waitlist/venue_switch |
| `target_session_id` | text nullable FK sessions | required only for venue_switch |
| `venue_preference` | text nullable | required only for weekly_waitlist |
| `fallback_acknowledged_at` | timestamptz nullable | required only for weekly_waitlist |
| `status` | text check | active/promoted/matched/left/dissolved |
| `joined_at` | timestamptz | authoritative order |
| `resolved_at` | timestamptz nullable | terminal timestamp |

A partial unique index permits at most one active cycle queue entry per member.
A member with a venue-switch entry must own a confirmed booking allocated to the
other child session.

## Atomic RPC operations

### Member RPCs

- `reserve_hyrox_cycle(cycle_id, preference, fallback_acknowledged)`
- `join_hyrox_cycle_waitlist(cycle_id, preference, fallback_acknowledged)`
- `leave_hyrox_cycle_queue(entry_id)`
- `select_hyrox_cycle_venue(booking_id, target_session_id)`
- `join_hyrox_venue_switch_queue(booking_id, target_session_id)`
- `leave_hyrox_venue_switch_queue(entry_id)`

Existing `mark_operational_payment` remains the payment-claim entry point and is
extended to understand pooled deadlines.

### Admin and lifecycle RPCs

- `schedule_hyrox_cycle(cycle_id)` — Admin-only clean-week activation
- `sweep_hyrox_cycle_deadlines(now)` — idempotently opens and advances due cycles
- `reject_hyrox_cycle_payment(booking_id, reason)`
- `finalize_hyrox_venue_plan(cycle_id)` — idempotent Admin recovery RPC; normal
  approval/rejection and sweep paths call the same internal derivation automatically
- `close_hyrox_venue_allocation(cycle_id)`
- `cancel_hyrox_cycle(cycle_id, reason)`

Existing `approve_operational_payment` is extended to approve pooled bookings
and generate cycle-linked receipts. `reject_hyrox_cycle_payment` is deliberately
scoped to pooled bookings: it records actor/time/reason; before that booking’s
hard deadline it clears the active claim so the member may try again, while at
or after the hard deadline it expires the booking. Existing gym finalization remains on child
sessions but rejects unopened Midtown and rejects finalization before the
Friday 9 PM allocation close.

### Locking and concurrency

Every pool mutation locks the parent cycle first. Operations that change venue
counts then lock BFT and Midtown child sessions in stable ID order. This covers:

- the 32nd reservation versus the 33rd waitlist placement;
- payment approval versus plan finalization;
- simultaneous claims for the last venue place;
- direct moves and opposite-direction swaps;
- waitlist promotion versus cancellation; and
- allocation closure versus a final member change.

The database, not the client, calculates counts and deadlines. A stale client
receives a typed error and refetches authoritative state.

## Authorization and RLS

- Public, pending and declined users may read public cycle/session presentation
  but not member identities, payments or queue entries.
- Approved members may read their own pooled bookings, receipts and queue
  entries and invoke member RPCs for themselves.
- Admin and Super Admin may read all cycle operations and invoke reconciliation,
  cancellation and finalization RPCs.
- Critical tables reject direct browser writes; all mutations use
  `SECURITY DEFINER` RPCs with fixed `search_path`, role checks and `auth.uid()`.
- Collector payout visibility remains limited to the assigned collector’s
  payment destination.

## Local prototype model

Bump `STATE_VERSION` and add migrations; never delete existing keys or records.
Add additive collections:

- `hyroxCycles`, keyed by cycle ID;
- `hyroxCycleQueues`, keyed by cycle ID; and
- pooled fields on new booking records.

Existing local BFT, Midtown and Quarry Bay bookings remain readable. Local mode
uses the same pure transition rules, deterministic ordering and deadline helpers
as the live design. Reset rebuilds draft future cycles from seed activities.

## Compatibility and cutover

This is an additive, week-by-week cutover:

- A generated BFT/Midtown date without a scheduled cycle continues using the
  legacy venue-specific presentation and records.
- Scheduling opts a clean future Saturday into pooled behaviour: it immediately
  uses one combined locked card, then opens automatically at Monday 6 PM HKT.
- An Admin cannot schedule a cycle while either child session has active legacy
  bookings or queues; the UI explains which records must be resolved.
- No existing historical booking, receipt, queue, cancellation or notification
  is rewritten.
- The first live pooled week must be a future clean Saturday selected after the
  migration and application deployment.
- Once a cycle is scheduled, direct child-session reservation and
  Midtown-interest RPCs reject that date to prevent split inventory.

This avoids an unsafe mass migration and provides a controlled operational
launch.

## Notifications

Create transactional notifications for:

- Monday 6 PM registration opening for approved members;
- reservation confirmed and standard payment deadline;
- full-capacity payment-risk warning;
- Thursday 5 PM payment reminder;
- Thursday 6 PM final holder warning and collector summary;
- Thursday 7 PM holder demotion, weekly-waitlist promotion and promoted deadline;
- Thursday 8 PM payment closure, waitlist dissolution and collector summary;
- weekly-waitlist placement, departure and promotion;
- payment claim sent to collector;
- payment approved or rejected;
- BFT-only or two-venue plan confirmed;
- provisional venue assignment;
- venue changed;
- venue-switch queue joined, matched, left or dissolved;
- Friday venue-choice reminder;
- final venue confirmation;
- cycle cancellation and auto-defer/follow-up outcome; and
- final gym confirmation for relevant admins.

All member notifications deep-link to the pooled booking or cycle rather than an
unconfirmed child session.

## Realtime and cache changes

Add the new cycle and queue tables to `supabase_realtime`.

`operations.js` extends its existing cache with cycles and HYROX cycle queues.
Initial hydration loads sessions, cycles, bookings, queues, receipts, assignments
and payout data in parallel. RPC success reconciles immediately; Realtime and
focus refetch remain fallback synchronization paths.

No live mutation falls back to localStorage after a Supabase failure.

## Error handling and member copy

Required domain errors include:

- `Registration is not open.`
- `Weekly HYROX registration is full.`
- `Join the weekly waitlist—do not pay yet.`
- `New registrations closed Thursday at 6 PM.`
- `Final payment grace ends Thursday at 7 PM.`
- `Promoted payment marking closes Thursday at 8 PM.`
- `The collector is still reconciling payments.`
- `Review pending payment claims before confirming the venue plan.`
- `BFT is full. Your Midtown place remains confirmed.`
- `Venue changes closed Friday at 9 PM.`
- `This Saturday still uses venue-specific booking.`
- `Resolve existing venue bookings before opening the pooled cycle.`

Network failures remain `Unable to save — try again.` and never show success.
Errors are announced through the existing visible feedback/alert mechanism.

## Testing

### SQL integration tests

Cover:

- cycle scheduling plus exact Monday 6 PM, Thursday 5/6/7/8 PM and Friday 9 PM HKT checkpoints;
- authorization and RLS boundaries;
- 32 concurrent reservations plus ordered #33 waitlist placement;
- waitlisted members cannot mark payment;
- fallback acknowledgement required for direct reservation and weekly-waitlist
  join, and preserved by promotion;
- prevention of overlapping Quarry Bay and pooled registrations;
- pending claims block plan finalization;
- confirmed counts 20 → BFT-only and 21 → both;
- new registration closes Thursday 6 PM, original-holder marking closes
  Thursday 7 PM, promoted-member marking closes Thursday 8 PM, and the derived
  plan cannot be manually overridden;
- deterministic provisional allocation;
- BFT 20 and Midtown 12 enforcement under concurrent moves;
- switch queue ordering and atomic opposite-direction swap;
- Thursday 6 PM grace notification, Thursday 7 PM one-round demotion/promotion,
  Thursday 8 PM expiry without further promotion and Friday 9 PM venue closure;
- late plan finalization produces immediate final allocations without opening
  venue changes;
- receipt generation before allocation and final session linking afterward;
- direct child reservation rejection for a pooled week;
- cycle cancellation transaction and paid-booking follow-up;
- clean-week cutover guard preserving legacy records; and
- rollback of every multi-record operation on injected failure.

### JavaScript smoke tests

Extend `app/smoke.mjs` and `app/live-auth-smoke.mjs` for:

- one combined locked/open Schedule card for pooled BFT/Midtown plus separate Quarry Bay;
- public/pending transparency and approved-member gate;
- preference and acknowledgement UI;
- member state progression from reserve through final venue;
- exact weekly-waitlist “Don’t pay yet” copy;
- distinct venue-switch queue copy;
- collector dashboard counts and blockers;
- local/live RPC routing with no live fallback;
- Realtime reconciliation; and
- localStorage migration preserving historical records.

All existing free, RSVP, Giving, notification, identity and booking tests remain
green.

### Manual acceptance

1. Admin schedules a clean future Saturday cycle and verifies it remains locked
   until Monday 6 PM, then opens automatically in Browser A.
2. Approved members reserve from separate browsers; visitor/pending users remain
   read-only.
3. Fill 32 reservations and verify member #33 enters a no-payment waitlist.
4. Exercise the Thursday 5/6/7/8 PM reminders, grace, demotion and one-round
   promotion sequence; then reconcile exactly 20 confirmed payments and verify
   BFT-only allocation.
5. On a separate test cycle, reconcile 21 and verify both venues plus
   deterministic provisional assignments.
6. Fill BFT to 20, request BFT from a Midtown-assigned member and verify the
   guaranteed Midtown place plus switch-queue position.
7. Complete an opposite venue switch and verify atomic swap/Realtime updates.
8. Close allocation at Friday 9 PM and verify switches disable and gym lists
   stabilize.
9. Confirm Quarry Bay remains separate and cannot overlap the same member’s
   pooled registration.
10. Background and restore a browser; focus refetch matches the authoritative
    Supabase state.

## Deployment and rollback

1. Apply forward-only schema/RPC/Realtime migrations to a disposable database.
2. Run SQL integration and safety suites.
3. Apply migrations to the intended Supabase project.
4. Deploy the application preview from this branch.
5. Schedule one future clean cycle whose Monday opening time has not arrived.
6. Complete Admin/member multi-browser acceptance.
7. Allow the first live pooled registration to open automatically on its Monday
   6 PM HKT checkpoint only after acceptance passes.

Before the first cycle is scheduled, application rollback is safe and leaves
dormant additive tables. After a cycle is scheduled, do not roll the app back to
a version that cannot display pooled bookings. Correct defects with forward
migrations and a compatible application release.

## Success criteria

- More than 20 members can hold collector-confirmed paid registrations before
  either venue is finalized.
- A weekly-waitlisted member is never instructed or permitted to pay.
- Every payer saw both venue outcomes and accepted BFT fallback before payment.
- A paid member always knows whether their venue is pending, provisional or
  final.
- Venue preferences never oversubscribe BFT or Midtown.
- A switch-queued member retains a guaranteed assigned venue.
- Collector counts and final lists agree across devices, and the venue outcome
  follows the confirmed count without collector override.
- Existing Quarry Bay and historical operational records remain intact.
