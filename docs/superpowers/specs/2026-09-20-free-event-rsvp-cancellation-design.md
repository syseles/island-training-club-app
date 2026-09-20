# Free Event RSVP and Cancellation Design

**Date:** 2026-09-20
**Status:** Approved
**Branch:** `feature/free-event-rsvp-cancellation`, based on `testing`

## Objective

Give every free ITC event an optional, payment-free **I’m coming** RSVP so approved members and leaders can see who is expected, and give Admin/Super Admin a consistent per-occurrence cancellation and reopening workflow.

This includes the recurring Wednesday Night Training, ITC Run Club, ITC Swimming, and every zero-price one-off event. Post-Training Lunch keeps its existing RSVP behavior. HYROX and other paid-event payment behavior must not change.

Web Push, service workers, phone notification sounds, email delivery, and SMS are explicitly deferred.

## Product Rules

### Free remains free and open

- RSVP is optional and does not become a booking requirement.
- Walk-ins remain welcome.
- There is no checkout, payment, capacity, waitlist, or automatic deferral.
- The primary action is **I’m coming**. A confirmed member can withdraw with **Can’t make it**.
- RSVP and withdrawal are allowed until the event’s Hong Kong scheduled start.
- The controls close once the event starts or is cancelled.

### Eligibility and privacy

- Only approved `member`, `admin`, `superadmin`, and `super_admin` identities may RSVP or withdraw.
- Only those approved roles may view attendee names and profile photos.
- Visitors and pending/declined members can see public event information and cancellation details but cannot see attendee identities or RSVP.
- Public attendee totals may remain identity-free, consistent with the current Lunch RSVP count.
- Existing private avatar resolution rules remain unchanged.

### Cancellation and reopening

- Admin/Super Admin can cancel one dated occurrence with a trimmed, required reason.
- Cancelling one occurrence does not modify its recurring template or future weeks.
- Cancellation is visible on Schedule and Activity Details to everyone.
- Active free-event RSVPs are cancelled, never deferred to another week.
- Members with an active RSVP at cancellation receive one in-app cancellation notification linked to the occurrence.
- Members who previously withdrew do not receive cancellation or later change notifications.
- Admin/Super Admin may reopen a cancelled occurrence only before it starts.
- Reopening does not restore cancelled RSVPs. Members must choose **I’m coming** again.
- Members whose RSVP was cancelled by that occurrence receive one in-app reopening notification.

### Event changes and notifications

- Venue and time changes remain publicly visible on the event wherever it is rendered.
- Only members with an active RSVP receive an in-app event-change notification.
- Admin identities retain the existing operational audit notifications where applicable.
- Notification records must be destination-aware, deduplicated, and created server-side in live mode.
- Browser push notifications and sounds are not part of this work.

## Architecture

### One operational session model

Live mode will materialize the three recurring free activities as operational templates and dated `operational_sessions`, just like Lunch and paid sessions:

- `wnt`
- `run`
- `water`

Each template has `price_hkd = 0`, `capacity = null`, and `requires_rsvp = true`. The existing session-generation RPC creates only the appropriate weekday occurrences. Free one-off event creation always sets `requires_rsvp = true` and allows uncapped capacity.

Live hydration must stop separately generating these free occurrences from local seed data, preventing duplicate cards and conflicting authority. Seed activities still provide presentation content such as photographs, descriptions, and member notes.

### Presentation and participation are separate

Free events remain `kind: "free"` for badges and copy, while a separate `requiresRsvp: true` property enables attendee behavior. Lunch remains `kind: "rsvp"`. Paid events remain `kind: "paid"`.

A shared predicate, `sessionRequiresRsvp(session)`, is the client authority for displaying RSVP controls. Server RPCs independently enforce the template’s `requires_rsvp` flag and zero price.

### Reuse RSVP bookings

A free-event RSVP is a confirmed, zero-price `operational_bookings` row. Existing reservation and withdrawal RPCs remain the member entry points, but continue to require explicit `requires_rsvp`; zero price alone is insufficient.

To distinguish member withdrawals from event cancellation, booking cancellation metadata will record:

- cancellation timestamp
- cancellation source (`member` or `session`)

The active-booking uniqueness rule continues to allow a member to RSVP again after withdrawal, cancellation, or reopening.

### RSVP-aware cancellation

The public `cancel_operational_session` dispatcher will branch before paid/HYROX deferral logic when the session is zero-price and its template requires RSVP. The free/RSVP branch will atomically:

1. authorize the Admin actor;
2. lock and cancel the dated session;
3. mark active confirmed RSVPs cancelled with source `session`;
4. create one linked cancellation notification per affected member; and
5. leave future sessions and the recurring template untouched.

Paid and HYROX cancellation behavior remains unchanged.

The existing `reopen_operational_rsvp` RPC will support all zero-price RSVP-enabled sessions. It will notify only profiles whose active RSVP was cancelled by that cancellation timestamp, clear session cancellation fields, and leave old booking rows cancelled.

### Local prototype parity

`store.js` remains the only localStorage seam. Local mode will:

- mark seeded free activities as RSVP-enabled;
- create confirmed zero-price RSVP booking records;
- allow member withdrawal before start;
- cancel free RSVPs without deferral;
- track cancellation source/time for reopening recipients; and
- produce the same member-facing notifications.

If persisted state requires new mandatory keys, `STATE_VERSION` must be bumped with a migration. Additive optional fields on existing booking records may be normalized without deleting historical data.

## User Experience

### Schedule and Activity Details

- Free cards retain the **Free** badge and open-attendance language.
- Approved members see **I’m coming** when not RSVP’d.
- Confirmed attendees see a clear going state and **Can’t make it**.
- Approved members can open **Who’s coming** and see names/photos using the existing roster and private avatar resolver.
- Visitors see neither the attendee identities nor an RSVP action.
- Cancelled cards and details show **Cancelled** and the Admin reason; RSVP actions are absent.
- Started events no longer accept RSVP changes.

### Admin Weekly Event Controls

Each upcoming free or RSVP occurrence shows:

- date, time, venue, and expected-attendee count;
- the existing weekly venue controls;
- a required-reason **Cancel this week’s event** form while active; or
- **Reopen event** while cancelled and still before start.

The Admin attendee/attendance surfaces reuse the same effective attendee and avatar rules already used for RSVP and paid sessions.

## Error Handling and Concurrency

- Duplicate RSVP attempts return the existing friendly already-going state.
- Duplicate withdrawals, cancellations, reopenings, and update submissions are suppressed in the UI and rejected safely by RPC state checks.
- RPCs lock the session/booking rows needed for atomic decisions.
- A cancellation racing an RSVP resolves under the session lock: no active RSVP may survive on a cancelled event.
- Missing or malformed sessions, unauthorized roles, started occurrences, blank reasons, and non-RSVP zero-price sessions fail closed.
- Failed actions retain the current view and show an actionable status/error message.

## Testing and Acceptance

Automated coverage must prove:

1. all three recurring free activities and all new zero-price one-offs are RSVP-enabled;
2. free events remain uncapped, payment-free, and open to walk-ins;
3. only approved roles can RSVP or view attendee identities;
4. RSVP and withdrawal close at Hong Kong start time;
5. free cancellation does not defer attendees and affects only one occurrence;
6. cancellation, venue, time, and reopening notifications target the correct RSVP cohort exactly once;
7. reopening leaves prior bookings cancelled and allows a fresh RSVP;
8. live hydration returns one authoritative occurrence without local duplicates;
9. public cancellation state/reason remains visible;
10. Lunch RSVP, HYROX, paid booking, replacements, attendance, auth, avatars, indemnity export, and existing routing do not regress.

SQL safety tests must verify authorization, grants, RLS-compatible RPC boundaries, explicit RSVP checks, row locking, no paid-path changes, and migration ordering. Disposable-database integration remains optional unless an acknowledged reset-safe test database is supplied.

## Deployment

Deploy in this order:

1. apply the new Supabase migration;
2. verify recurring free templates and generated future sessions;
3. deploy frontend changes;
4. confirm exact Testing origin CORS remains allowed;
5. run authenticated member/Admin acceptance for RSVP, roster, cancellation, reopening, venue/time changes, and notifications.

Rollback is access-first: disable the new controls in the frontend before reverting database functions. Do not remove booking audit fields or RSVP rows during rollback.
