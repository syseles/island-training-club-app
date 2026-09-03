# HYROX Weekly Registration, Payment and Venue Allocation

**Date:** 2026-09-03  
**Branch:** `feature/hyrox-registration-allocation` (off `origin/testing`)  
**Status:** Proposed design for review

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
- The on-duty collector reconciles member payment claims after Thursday 6 PM.
- Twenty or fewer collector-confirmed payments produce a BFT-only plan.
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

### Sunday or Monday: coordinator opens registration

- Rolling generation continues creating that Saturday’s BFT and Midtown child
  sessions as it does today.
- An Admin or Super Admin manually selects **Open registration**. The RPC creates
  a draft cycle if one does not exist, validates the clean-week cutover guard,
  and then opens it.
- Opening records actor and server timestamp and exposes the pooled registration
  action to approved members.
- The cycle itself is the source of truth; BFT and Midtown cannot be booked
  directly while their pooled cycle is open.

### Before Thursday 6 PM: reserve and pay

- The first 32 active registrations receive an unpaid held place.
- Further members may join the ordered weekly waitlist.
- Joining the weekly waitlist records the same venue preference and BFT
  fallback acknowledgement as a direct reservation, but exposes no payment
  action.
- If an unpaid member cancels before Thursday 6 PM, the oldest weekly-waitlist
  member is promoted with their recorded preference and inherits the same
  Thursday 6 PM payment deadline.
- Reservation records venue preference and the fallback acknowledgement.
- A reserved member sees the on-duty collector’s PayMe/FPS instructions and may
  mark payment.
- The collector approves or rejects each payment claim.
- Collector approval issues the receipt immediately; venue assignment is not
  required for receipt issuance.
- A member may cancel an unpaid registration only before marking payment.

### Thursday 6 PM: reconcile and confirm the venue plan

- Initial payment marking closes at 6 PM.
- The cycle enters payment reconciliation.
- Unmarked unpaid registrations expire without post-deadline promotion.
- Every remaining weekly-waitlist entry dissolves and its member is notified
  that no place opened for that week.
- Payment claims submitted before the deadline remain held until reviewed.
- The collector must approve or reject every pending claim before finalizing the
  plan.
- The server counts collector-confirmed payments while holding the cycle lock:
  - `0–20` confirmed: `bft_only`
  - `21–32` confirmed: `both`
- The server derives the plan; the collector cannot manually choose a result
  inconsistent with the confirmed count.
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

- Starts after 32 active pooled registrations before the deadline.
- Member does not see payment actions and must not pay.
- Position is ordered by server `joined_at`, then queue-entry UUID.
- Joining records `bft`, `midtown` or `either` preference plus explicit BFT
  fallback acknowledgement so an automatic promotion never creates an
  unacknowledged paid reservation.
- A promotion before Thursday 6 PM creates a reservation with those recorded
  choices and retains the same visible payment deadline.
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
Venue plan confirmed after Thursday’s payment deadline
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

> I understand that my booking will be at BFT at 11:15 if only one gym opens,
> and that venue preferences are subject to capacity.

The submit action is **Reserve & continue to pay**.

### Payment and reconciliation states

Member-facing states are:

1. **Payment due** — amount and exact Thursday deadline.
2. **Payment reported** — collector is checking; place remains held.
3. **Payment claim rejected before deadline** — reason shown, claim audit kept,
   and payment controls reopen for another attempt before Thursday 6 PM.
4. **Payment confirmed, venue pending** — weekly place confirmed; venue plan is
   announced after reconciliation.
5. **BFT assigned** — BFT-only plan, fixed venue and calendar details.
6. **Both gyms confirmed** — provisional venue plus capacity-aware change
   controls until Friday 9 PM.
7. **Venue final** — final venue/time, directions and calendar action.

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
7 unpaid
4 on weekly waitlist
Expected plan after review: Both gyms
```

### Collector controls

- **Open registration**
- **Confirm received** or **Reject payment claim**
- **Finalize venue plan** after Thursday 6 PM and after all claims are resolved
- Inspect BFT/Midtown allocations and venue-switch queues
- Send/copy final per-venue gym messages after Friday 9 PM
- **Mark confirmed with gym** on each opened child session

The dashboard explains why finalization is blocked, for example:

> Review 3 pending payment claims before confirming the venue plan.

### Activity controls

Existing child-session time, notice and venue-TBC controls remain under
Activities. Once a pooled cycle opens:

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

`venue_plan` remains `pending` until the collector finalizes reconciliation.
A closed cycle must have `bft_only` or `both`.

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
| `payment_deadline_at` | timestamptz | Thursday 18:00 HKT |
| `venue_choice_deadline_at` | timestamptz | Friday 21:00 HKT |
| `opened_at` / `opened_by` | timestamp/UUID | paired |
| `plan_confirmed_at` / `plan_confirmed_by` | timestamp/UUID | paired |
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
venues. `allocation_snapshot` records the final venue/time without mutating the
original payment snapshot.

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

Unique partial indexes prevent duplicate active weekly and target-venue entries.
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

### Admin RPCs

- `open_hyrox_cycle(cycle_id)`
- `reject_hyrox_cycle_payment(booking_id, reason)`
- `finalize_hyrox_venue_plan(cycle_id)`
- `sweep_hyrox_cycle_deadlines(now)`
- `close_hyrox_venue_allocation(cycle_id)`
- `cancel_hyrox_cycle(cycle_id, reason)`

Existing `approve_operational_payment` is extended to approve pooled bookings
and generate cycle-linked receipts. `reject_hyrox_cycle_payment` is deliberately
scoped to pooled bookings: it records actor/time/reason; before the main deadline
it clears the active claim so the member may try again, while at or after the
deadline it expires the booking. Existing gym finalization remains on child
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

- A generated BFT/Midtown date without an open cycle continues using the legacy
  venue-specific presentation and records.
- A draft cycle is inert; successfully opening it opts that future Saturday into
  pooled behaviour.
- An Admin cannot open a cycle while either child session has active legacy
  bookings or queues; the UI explains which records must be resolved.
- No existing historical booking, receipt, queue, cancellation or notification
  is rewritten.
- The first live pooled week must be a future clean Saturday selected after the
  migration and application deployment.
- Once a cycle opens, direct child-session reservation and Midtown-interest RPCs
  reject that date to prevent split inventory.

This avoids an unsafe mass migration and provides a controlled operational
launch.

## Notifications

Create transactional notifications for:

- registration opened;
- reservation confirmed and payment deadline;
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
- `Payment marking closed Thursday at 6 PM.`
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

- cycle generation and exact HKT deadlines;
- authorization and RLS boundaries;
- 32 concurrent reservations plus ordered #33 waitlist placement;
- waitlisted members cannot mark payment;
- fallback acknowledgement required for direct reservation and weekly-waitlist
  join, and preserved by promotion;
- prevention of overlapping Quarry Bay and pooled registrations;
- pending claims block plan finalization;
- confirmed counts 20 → BFT-only and 21 → both;
- payment marking is rejected after Thursday 6 PM and the derived plan cannot
  be manually overridden;
- deterministic provisional allocation;
- BFT 20 and Midtown 12 enforcement under concurrent moves;
- switch queue ordering and atomic opposite-direction swap;
- Thursday 6 PM unpaid expiry without promotion, remaining weekly-waitlist
  dissolution and Friday 9 PM venue closure;
- late plan finalization produces immediate final allocations without opening
  venue changes;
- receipt generation before allocation and final session linking afterward;
- direct child reservation rejection for a pooled week;
- cycle cancellation transaction and paid-booking follow-up;
- clean-week cutover guard preserving legacy records; and
- rollback of every multi-record operation on injected failure.

### JavaScript smoke tests

Extend `app/smoke.mjs` and `app/live-auth-smoke.mjs` for:

- one combined Schedule card for pooled BFT/Midtown plus separate Quarry Bay;
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

1. Admin opens a clean future Saturday cycle in Browser A.
2. Approved members reserve from separate browsers; visitor/pending users remain
   read-only.
3. Fill 32 reservations and verify member #33 enters a no-payment waitlist.
4. Reconcile exactly 20 confirmed payments and verify BFT-only allocation.
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
5. Create one future clean draft cycle; do not open it yet.
6. Complete Admin/member multi-browser acceptance.
7. Open the first live pooled registration only after acceptance passes.

Before the first cycle opens, application rollback is safe and leaves dormant
additive tables. After members enter a pooled cycle, do not roll the app back to
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
- Collector counts and final lists agree across devices.
- Existing Quarry Bay and historical operational records remain intact.
