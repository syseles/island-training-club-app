# Admin Ops Restructure + One-Off Events

**Branch:** `feature/admin-ops` → merge to `testing` → verify on preview → merge to `main`.

## Phase A — Admin tab restructure (pure UI, no schema change)

1. Move the HYROX per-week session cards (time change, session note, cancel
   week, venue TBC, Midtown toggle) from `adminOps` into `adminActivities` as a
   new **"Weekly Session Overrides"** section, ordered:
   Recurring Activity Defaults → Weekly Venue Overrides → Weekly Session Overrides.
2. Rename Admin heading `Club ops.` → `Club operations`.
3. Admin sub-sections collapse behind their headers (`<details>/<summary>`),
   collapsed by default: Activities (3 sections) and Payments (duty, pending
   payments, finalize with gym, payout details).
4. Tab label `HYROX` → `Payments` (route `#/admin/payments` unchanged; `ops`
   alias kept). Ops tab keeps: payment duty, payout details, pending payments,
   finalize with gym.

## Phase B — One-off events (live-capable)

Admin can add a one-off event (free or paid, any date) from the Activities tab,
and cancel it. Works in live mode via Supabase; local mode stores in `state`.

**Schema findings driving the design:**
- `operational_activity_templates.activity_id` CHECK only allows
  `('hyrox','hyrox-midtown')` — must be relaxed for `event-*` ids.
- `ensure_operational_sessions` generates Saturday sessions from **active**
  templates only → one-off events use `active = false` templates + one
  manually inserted `operational_sessions` row (any weekday allowed).
- `price_hkd` CHECK is `> 0` → relax to `>= 0`; price 0 renders as a free
  event (no booking/capacity UI), paid goes through the existing
  reserve→pay→confirm pipeline unchanged.
- Cancel reuses `cancel_operational_session` (admin RPC exists). One-off
  sessions have no "next session" to defer to — cancel must release/void
  confirmed bookings instead of deferring (verify RPC behaviour; adjust if
  it hard-fails without a defer target).

**Migration `20260829000001_one_off_events.sql`:**
- Relax `operational_activity_templates.activity_id` CHECK to also allow
  `event-%` prefixed ids.
- Relax `price_hkd` CHECKs (templates + sessions) to `>= 0`.
- New SECURITY DEFINER admin RPC `create_operational_event(name, session_date,
  start_time, duration_minutes, venue, maps_query?, category, price_hkd,
  capacity)` → inserts inactive template `event-<slug>` + one session row.
- New admin RPC `delete_operational_event(session_id)` — hard-delete only when
  zero non-cancelled bookings exist; otherwise admins use cancel.

**Client:**
- `operations.js`: `liveCreateEvent`, `liveDeleteEvent` wrappers; session row
  builder maps `kind` from `price_hkd > 0` and carries template `name`.
- `store.js`: `createOneOffEvent` / `deleteOneOffEvent` actions; local mode
  keeps `state.oneOffEvents` (STATE_VERSION 14 → 15 migration).
- `views.js`: "Add one-off event" form + one-off cards on the Activities tab;
  schedule/home render one-offs through the normal session pipeline.
- Smoke coverage in `app/smoke.mjs` and `app/live-auth-smoke.mjs`.

## Verification

- `node app/smoke.mjs` + `node app/live-auth-smoke.mjs` green at every step.
- User applies the new migration to the live Supabase project before live
  one-off testing.
- Deploy-hook the `testing` preview for user verification before `main`.
