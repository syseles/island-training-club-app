# Shared HYROX Operations Backend

**Date:** 2026-08-08  
**Branch:** `feature/shared-operations` (off `origin/testing`)  
**Status:** Approved design; implementation requires a reviewed plan

## Problem

The live `testing` deployment uses Supabase for identity, applications, roles, notifications, Giving, and donor profiles, but HYROX operations remain in each browser's `localStorage`. Registrations, queues, payment marking/approval, session cancellation, collector duty, payout details, and gym confirmation therefore disagree across devices.

The failure was reproduced with the 15 August 2026 Midtown session: one administrator cancelled the session on one device while another completed registration/payment/gym-finalization steps on another. Both browsers displayed success because neither mutation reached Supabase. This is not a cache problem; it is split-brain device-local state.

## Goals

- Make Supabase the single source of truth for the complete HYROX operational workflow in live mode.
- Synchronize member and administrator changes across devices with Supabase Realtime and focus-time refetching.
- Make multi-record operations atomic, especially cancellation, capacity allocation, queue promotion, payment approval, and deferral.
- Enforce member/admin authorization in the database, not only in JavaScript.
- Fail closed when Supabase is unavailable; never report a local-only live-mode success.
- Start with clean shared operational data instead of importing conflicting browser state.
- Seed both 15 August 2026 HYROX sessions as cancelled with reason `HYROX race weekend`.

## Non-goals

- Real card processing or automatic PayMe/FPS reconciliation.
- Importing or reconciling existing device-local operational records.
- Offline mutation queues or later conflict reconciliation.
- Shop, merchandise, Giving, or Community persistence changes.
- Removing the local operation engine used by non-live smoke/prototype mode.

## Confirmed product rules

- Cancellation copy is rendered as `Session cancelled by ITC — [admin-entered reason]`.
- Cancellation reason is required and stored separately from the fixed display prefix.
- Paid/confirmed bookings automatically defer to the next available same-venue session.
- Unpaid reservations are cancelled.
- Waitlist and Midtown interest entries are dissolved.
- Shared operational events create Supabase-backed in-app notifications.
- Failed Supabase mutations do not fall back to localStorage.
- Open browsers update through Realtime; tab focus performs a full refetch as fallback.
- Both 15 August 2026 sessions start cancelled:
  - `hyrox-2026-08-15` — BFT Causeway Bay
  - `hyrox-midtown-2026-08-15` — Midtown 28
  - reason: `HYROX race weekend`

## Architecture

### Ownership boundary

In Supabase live mode:

- Supabase owns operational templates, session instances, bookings, queues, receipts, collector duty, payout profiles, and operational notifications.
- `store.js` exposes asynchronous operational actions and maintains a read-through in-memory cache hydrated from Supabase.
- `app.js` awaits mutations, renders busy/error states, and refreshes only after confirmed success.
- `views.js` renders shared cached data and never reads legacy operational localStorage collections directly.

In local mode (Supabase configuration absent), the current localStorage engine remains available for smoke tests and prototype demonstrations.

### No live fallback

Every live action branches explicitly:

```js
if (isLive()) return await liveOperationalAction(...);
return localOperationalAction(...);
```

A live Supabase error is surfaced to the user. The action must not invoke the local implementation after an error.

## Database model

### `operational_activity_templates`

Server-owned definitions for the two recurring HYROX venues.

| Column | Type | Rule |
|---|---|---|
| `activity_id` | text PK | `hyrox` or `hyrox-midtown` |
| `name` | text | member-facing activity name |
| `venue` | text | BFT Causeway Bay / Midtown 28 |
| `weekday` | smallint | Saturday = 6 |
| `start_time` | time | recurring start time |
| `duration_minutes` | integer | positive |
| `capacity` | integer | positive; BFT 20, Midtown 12 |
| `price_hkd` | integer | positive |
| `default_open` | boolean | Midtown may default closed |
| `active` | boolean | controls future generation |
| `updated_at` | timestamptz | trigger-maintained |

Direct writes are admin/super-admin only.

### `operational_sessions`

One authoritative row per venue/date.

| Column | Type | Rule |
|---|---|---|
| `id` | text PK | deterministic: `<activity_id>-YYYY-MM-DD` |
| `activity_id` | text FK | template |
| `session_date` | date | Saturday |
| `start_time` | time | snapshot, admin-overridable |
| `duration_minutes` | integer | template snapshot |
| `venue` | text | template snapshot |
| `capacity` | integer | positive snapshot |
| `price_hkd` | integer | positive snapshot |
| `is_open` | boolean | controls registration/Midtown opening |
| `venue_tbc` | boolean | default false |
| `notice` | text nullable | non-cancellation notice |
| `cancelled_at` | timestamptz nullable | cancellation state |
| `cancelled_by` | uuid nullable FK profiles | administrator; null only for system seed |
| `cancelled_source` | text nullable check | `admin` or `system` |
| `cancel_reason` | text nullable | required when cancelled |
| `gym_confirmed_at` | timestamptz nullable | finalization state |
| `gym_confirmed_by` | uuid nullable FK profiles | administrator |
| `gym_note` | text nullable | optional |
| `created_at` | timestamptz | server time |
| `updated_at` | timestamptz | trigger-maintained |

Constraints:

- `cancelled_at`, `cancelled_source`, and nonblank `cancel_reason` must appear together.
- `cancelled_source = 'admin'` requires `cancelled_by`; `cancelled_source = 'system'` requires `cancelled_by` to be null.
- Cancelled sessions cannot be opened or gym-confirmed.
- `gym_confirmed_at` and `gym_confirmed_by` must appear together.
- Session ID must match activity/date.

A security-definer `ensure_operational_sessions(start_date, weeks)` function creates a bounded rolling window from templates. It accepts at most 16 weeks and only inserts deterministic missing rows. Direct member inserts are prohibited.

### `operational_bookings`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | generated server-side |
| `profile_id` | uuid FK profiles | booking owner |
| `session_id` | text FK sessions | target session |
| `status` | text check | `reserved`, `confirmed`, `cancelled`, `expired`, `deferred` |
| `reserved_at` | timestamptz | server time |
| `pay_deadline_at` | timestamptz | server-derived checkpoint |
| `payment_marked_at` | timestamptz nullable | member claim |
| `payment_method` | text nullable | PayMe/FPS |
| `payment_reference` | text nullable | optional member reference |
| `paid_at` | timestamptz nullable | admin approval time |
| `confirmed_by` | uuid nullable FK profiles | approving administrator |
| `deferred_from_booking_id` | uuid nullable FK self | chain provenance |
| `deferred_to_booking_id` | uuid nullable FK self | chain provenance |
| `snapshot` | jsonb | immutable name/date/time/venue/price history |
| `created_at` / `updated_at` | timestamptz | server-maintained |

Indexes/constraints:

- One active booking per member/session (`reserved` or `confirmed`) via partial unique index.
- Capacity is enforced inside a session-row lock, not by client-side counting.
- Payment approval requires `payment_marked_at` and an active approved member.
- Cancelled sessions reject reserve, mark-paid, approve, defer-to, and finalize actions.

### `operational_queue_entries`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | generated server-side |
| `session_id` | text FK sessions | queue owner |
| `profile_id` | uuid FK profiles | member |
| `kind` | text check | `waitlist` or `interest` |
| `status` | text check | `active`, `promoted`, `left`, `dissolved` |
| `joined_at` | timestamptz | authoritative ordering |
| `resolved_at` | timestamptz nullable | terminal time |

One active entry per member/session. Queue position is computed from server order (`joined_at`, then `id`). Promotions lock the session and candidate rows.

### `operational_receipts`

Shared receipts generated only by payment approval.

- UUID primary key and human receipt number.
- Booking/member/session foreign keys.
- Amount, currency, method, issued timestamp, and status.
- Member reads own; admins read all.

### `collector_assignments`

- `week_start` date primary key.
- `collector_profile_id` FK profiles.
- Assignment administrator and timestamps.
- One authoritative collector per week.

### `collector_payout_profiles`

- `profile_id` PK/FK profiles.
- PayMe link and FPS phone.
- Owner and admins may write.
- Approved members may read only the currently assigned collector's payment destination through an RPC/view, not enumerate all payout profiles.

## Atomic RPC operations

All business-critical operations are PostgreSQL functions with row locks and server-side role checks.

### Member operations

- `reserve_operational_session(session_id)`
- `join_operational_queue(session_id, kind)`
- `leave_operational_queue(entry_id)`
- `mark_operational_payment(booking_id, method, reference)`
- `defer_operational_booking(booking_id, target_session_id)`

### Administrator operations

- `approve_operational_payment(booking_id)`
- `cancel_operational_session(session_id, reason)`
- `set_operational_session_time(session_id, time)`
- `set_operational_venue_tbc(session_id, enabled)`
- `set_operational_notice(session_id, notice)`
- `set_midtown_open(session_id, enabled)`
- `finalize_operational_gym(session_id, note)`
- `set_collector_assignment(week_start, profile_id)`
- `sweep_operational_deadlines(now)`

### Cancellation transaction

`cancel_operational_session`:

1. Requires admin/super-admin and a nonblank reason.
2. Locks the session and rejects duplicate/conflicting stale operations safely.
3. Sets cancellation actor/time/reason.
4. For every confirmed booking, finds the next available same-activity session, locks it, and creates a deferred confirmed booking when capacity exists.
5. If no target is available, cancels the booking and creates a leader-follow-up notification.
6. Cancels unpaid reservations.
7. Dissolves active waitlist/interest entries.
8. Inserts member and admin notifications.
9. Commits once; any failure rolls back every step.

Member-facing copy is composed as:

```text
Session cancelled by ITC — <cancel_reason>
```

The fixed prefix is not stored in `cancel_reason`.

### Concurrency rules

- Reservation, promotion, payment approval, cancellation, deferral, and gym finalization lock the authoritative session row with `FOR UPDATE`.
- Gym finalization checks `cancelled_at IS NULL` while holding the lock.
- Cancellation checks/finalizes state under the same lock.
- Simultaneous cancellation/finalization yields one committed operation; the loser receives a stale-state error and refetches.
- RPCs return complete changed rows so the initiating client can reconcile immediately before Realtime arrives.

## Authorization and RLS

Use the existing `current_user_role()` helper.

- Public/anonymous: read operational session status, including cancellation reason.
- Pending/declined: public session read only; no registration/payment/queue mutations.
- Approved member: read own bookings, queues, receipts; invoke own member RPCs.
- Admin/super-admin: read all operational records; invoke administrator RPCs.
- Direct client writes to critical booking/queue/session state are denied; mutations go through RPCs.
- Operational notification rows use the existing notification ownership/admin policies.
- All security-definer functions set a fixed `search_path` and verify `auth.uid()` plus role.

## Notifications

Reuse `public.notifications` for shared in-app notifications.

Generate notifications for:

- Reservation confirmed or queue/interest placement.
- Member marked payment (collector/admin recipients).
- Payment approved (member recipient).
- Waitlist promotion and payment deadline.
- Session cancellation plus defer/cancel outcome.
- Gym finalization (relevant administrators).

Notification creation happens in the same transaction as the state change.

## Realtime and client synchronization

Add operational tables to the `supabase_realtime` publication:

- `operational_sessions`
- `operational_bookings`
- `operational_queue_entries`
- `operational_receipts`
- `collector_assignments`
- `collector_payout_profiles`

`store.js` owns subscriptions and cache reconciliation. It exposes one operational change callback to `app.js`; views do not subscribe directly.

Behavior:

1. Initial route hydration fetches session/booking/queue/duty state in parallel.
2. Realtime events invalidate/reconcile affected cache entries.
3. `app.js` schedules one generation-safe rerender, coalescing event bursts.
4. `visibilitychange` refetches when the document becomes visible.
5. After reconnect/channel error, perform a full operational refetch.
6. The initiating mutation reconciles from its RPC return value immediately.

## App changes

### `store.js`

- Retain local operational functions for non-live mode only.
- Add async live readers/actions matching the existing public store interfaces where practical.
- Convert callers that require shared state to await async results.
- In live mode, selectors use Supabase-backed cache and never local `state.bookings`, `state.sessionOverrides`, queues, duty, payouts, or receipts.
- Surface typed/domain errors for full, cancelled, stale, unauthorized, and network cases.

### `app.js`

- Await every live operational mutation.
- Use existing busy-control helpers and disable conflicting controls during requests.
- Show success only after RPC success.
- On errors, show clear failure copy and refetch stale state.
- Subscribe once to store operational changes and rerender generation-safely.

### `views.js`

- Render cancellation as `Session cancelled by ITC — ${reason}` on Schedule, activity, booking/history, Admin Activities, and Payments/Ops.
- Disable registration, payment approval, deferral-to, Midtown opening, and gym finalization where server state prohibits them.
- Render shared payment/queue/headcount/duty/gym state from the live cache.

## Clean cutover

No local operational data is imported.

In live mode after deployment:

- Legacy local bookings, queues, overrides, duty, payout and receipts are ignored.
- A one-time local marker records that live operational storage is retired, preventing accidental fallback logic.
- Community and other deliberately local prototype data remain untouched.
- Local mode continues using existing fixtures and migrations.

## Initial operational seed

The migration inserts activity templates and generates the initial rolling session window. It then upserts:

```text
hyrox-2026-08-15
hyrox-midtown-2026-08-15
cancelled_at = migration timestamp
cancelled_source = system
cancelled_by = null
cancel_reason = HYROX race weekend
```

The seeded display is:

```text
Session cancelled by ITC — HYROX race weekend
```

## Error handling

- Network/database failure: `Unable to save — try again.`
- Stale operation: `This session changed on another device. We refreshed the latest status.`
- Cancelled session: display authoritative cancellation copy.
- Full open session: offer its waitlist action; closed Midtown session: offer its interest-list action.
- Unauthorized action: no mutation; display access error and refetch profile role.
- Realtime disconnect: show no false success; refetch on reconnect/focus.

## Testing

### SQL integration tests

Cover:

- Session generation and deterministic IDs.
- Aug 15 cancellation seed rows and reasons.
- RLS read/write boundaries for visitor, pending, member, admin, super-admin.
- Capacity enforcement under concurrent reservations.
- Duplicate booking/queue rejection.
- Queue order and promotion.
- Member payment marking and admin approval.
- Shared receipt creation.
- Atomic cancellation, auto-deferral, unpaid cancellation, and queue dissolution.
- Rollback on cancellation failure.
- Gym finalization rejection after cancellation.
- Cancellation/finalization concurrency.
- Collector assignment/payout visibility.
- Notification creation in operational transactions.

Tests run only against an explicitly acknowledged disposable database, following existing safety scripts.

### JavaScript tests

Extend `app/live-auth-smoke.mjs` with a fake operational Supabase layer and verify:

- Live readers/actions never call local operational mutations.
- RPC payloads and returned cache reconciliation.
- Realtime invalidation and focus refetch.
- Failure paths do not show success or fall back locally.
- Cancelled sessions disable incompatible controls.
- Cancellation copy renders exactly `Session cancelled by ITC — HYROX race weekend`.

Keep `node app/smoke.mjs` green for local prototype behavior.

### Manual two-browser verification

1. Sign in as two separate administrators in different browsers/devices.
2. Admin A cancels an active test session with a reason.
3. Admin B sees the cancellation without reload and cannot approve/finalize it.
4. On another active session: member reserves, marks paid; Admin A approves; Admin B sees confirmed status.
5. Admin B finalizes with gym; Admin A sees the finalization.
6. Background and restore one browser; focus refetch matches Supabase.

## Deployment sequence

1. Apply migrations to a disposable database and run SQL integration/safety tests.
2. Apply migrations to the intended Supabase project.
3. Verify Realtime publication and RLS policies.
4. Deploy the feature branch preview.
5. Complete two-browser verification.
6. Merge to `testing` only after automated and manual checks pass.

## Rollback

- App code can roll back while retaining new Supabase tables.
- Once shared operations are launched, do not re-enable localStorage fallback in live mode.
- Database migrations are forward-only; corrections use new migrations.
