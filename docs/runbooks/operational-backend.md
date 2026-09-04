# Operational Backend Deployment Runbook

This runbook covers applying the shared-pool HYROX operational backend
migrations to the disposable/staging or production Supabase project,
verifying the result, and executing the Admin two-browser acceptance test
before merging to `testing`. Live Supabase remains the source of truth;
the local v19 engine is prototype parity only.

## What lives in Supabase

From this branch onward, the Supabase project owns the full HYROX
operational workflow:

- `operational_activity_templates` — `hyrox-bft`, `hyrox-midtown`, and
  `hyrox-quarry-bay` recurring definitions.
- `operational_sessions` — one row per venue per scheduled Saturday.
- `operational_bookings` — reservation, confirmation, payment approval,
  cancellation, and deferral records.
- `operational_queue_entries` — legacy waitlist/interest lists.
- `operational_hyrox_cycles` — one weekly 32-place BFT/Midtown pool with
  HKT checkpoints and derived venue plan.
- `operational_hyrox_queue_entries` — weekly waitlist and venue-switch
  queues.
- `operational_receipts` — payment-confirmation receipts with sequence
  numbers `ITC-YYYY-NNNN`.
- `collector_assignments` — one row per Saturday.
- `collector_payout_profiles` — collector PayMe/FPS destinations.

All mutations are routed through `SECURITY DEFINER` RPCs:

- Member RPCs: `reserve_operational_session`, `join_operational_queue`,
  `leave_operational_queue`, `mark_operational_payment`,
  `defer_operational_booking`.
- Admin RPCs: `approve_operational_payment`, `cancel_operational_session`,
  `set_operational_session_time`, `set_operational_venue_tbc`,
  `set_operational_notice`, `set_operational_midtown_open`,
  `finalize_operational_gym`, `set_collector_assignment`,
  `update_collector_payout_profile`, `sweep_operational_deadlines`, plus
  `schedule_hyrox_cycle`, `sweep_hyrox_cycle_deadlines`,
  `finalize_hyrox_venue_plan`, `reject_hyrox_cycle_payment`,
  `close_hyrox_venue_allocation`, and `cancel_hyrox_cycle`.
- Pooled member RPCs: `reserve_hyrox_cycle`,
  `join_hyrox_cycle_waitlist`, `leave_hyrox_cycle_queue`,
  `select_hyrox_cycle_venue`, `join_hyrox_venue_switch_queue`, and
  `leave_hyrox_venue_switch_queue`.
- Both: `ensure_operational_sessions` (idempotent rolling window) and
  `ensure_hyrox_cycles` (idempotent parent-cycle provisioning for clean future
  BFT + Midtown Saturdays).

## Apply the migrations

The deployment is intentionally manual. First apply the repository’s
pre-existing migrations through `20260902000001_hyrox_bft_quarry_bay.sql`.
Then apply these five pooled-HYROX migrations in this exact order, in the
Supabase SQL Editor (or via `supabase db push` from a trusted workstation):

1. `20260903000001_hyrox_cycle_schema.sql` — cycle/queue columns, RLS and
   pooled constraints.
2. `20260903000002_hyrox_cycle_member_rpcs.sql` — pooled member actions.
3. `20260903000003_hyrox_cycle_reconciliation.sql` — payment checkpoints,
   automatic allocation and receipts.
4. `20260903000004_hyrox_cycle_allocation.sql` — venue switches, closure
   and cancellation carry-forward.
5. `20260904000001_hyrox_cycle_auto_provision.sql` — automatic recurring
   parent-cycle provisioning.

Apply each migration on its own. Resolve any error before moving to the
next migration. The verified `feature/shared-operations` branch uses
`origin/testing` as its base; the same migrations must be applied to
the same database that the App's anon key reaches.

## Automatic recurring provisioning

The app calls `ensure_operational_sessions` and `ensure_hyrox_cycles` during
live boot. Clean future Saturdays receive a draft parent cycle automatically;
the parent card is visible immediately and registration opens at Monday 6 PM
HKT. No collector scheduling click is required.

A week with active legacy BFT/Midtown bookings or queues is intentionally
skipped. It remains on the legacy presentation until those records are resolved
or explicitly migrated; this prevents orphaning member reservations.

## Post-deployment verification

Run the following read-only checks in the SQL Editor to confirm a clean
deployment. Compare the output of each query against the expected shape.

Verify the operational tables exist with RLS enabled, including the two
pooled HYROX tables:

```sql
select c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'operational_activity_templates',
     'operational_sessions',
     'operational_bookings',
     'operational_queue_entries',
     'operational_receipts',
     'collector_assignments',
     'collector_payout_profiles',
     'operational_hyrox_cycles',
     'operational_hyrox_queue_entries'
   )
 order by c.relname;
```

Expected: every row has `relrowsecurity = true`.

Verify the operational live tables are in the Realtime publication:

```sql
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and schemaname = 'public'
   and tablename in (
     'operational_sessions',
     'operational_bookings',
     'operational_queue_entries',
     'operational_receipts',
     'collector_assignments',
     'collector_payout_profiles',
     'operational_hyrox_cycles',
     'operational_hyrox_queue_entries'
   )
 order by tablename;
```

Expected: eight rows, including `operational_hyrox_cycles` and
`operational_hyrox_queue_entries`.

Verify the pooled RPCs are executable only through their intended role grants:

```sql
select routine_name, grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in (
     'reserve_hyrox_cycle', 'join_hyrox_cycle_waitlist',
     'finalize_hyrox_venue_plan', 'reject_hyrox_cycle_payment',
     'select_hyrox_cycle_venue', 'join_hyrox_venue_switch_queue',
     'cancel_hyrox_cycle'
   )
 order by routine_name, grantee;
```

Expected: only the documented authenticated role grants appear; internal
locked helpers are not executable by `public`, `anon`, or `authenticated`.

Verify the 15 August 2026 sessions are seeded as cancelled with the
required reason:

```sql
select id, cancelled_source, cancelled_by, cancel_reason
  from public.operational_sessions
 where id in ('hyrox-bft-2026-08-15', 'hyrox-midtown-2026-08-15');
```

Expected: both rows have `cancel_reason = 'HYROX race weekend'`,
`cancelled_source = 'system'`, and `cancelled_by is null`.

Verify the activity templates match the configured venues:

```sql
select activity_id, venue, capacity, price_hkd
  from public.operational_activity_templates
 order by activity_id;
```

Expected: `hyrox-bft` (BFT Causeway Bay, 20, 180), `hyrox-midtown`
(Midtown28 Fitness, 12, 180), and `hyrox-quarry-bay` (10/F, Island ECC,
Quarry Bay; Saturday 11:00; 60 minutes; capacity 12; HK$180; open by
default; directions query `Island ECC, Quarry Bay, Hong Kong`).

Confirm the rejected registrations, gym confirmation, and cancellation
gates are enforced:

```sql
-- Anonymous reservation must be rejected.
select reserve_operational_session('hyrox-bft-2026-08-22');
-- Error: "Authentication required."
```

The anon key in the browser will not reach this RPC; the call is only
useful inside the SQL editor while impersonating.

If the post-deployment checks fail, **do not deploy the application
update**. Re-run the migrations in a disposable database (see below) and
compare the schema. Reapply any missing migration and re-verify before
proceeding.

## Disposable database verification

Run the destructive verifier against a fresh, empty Supabase-compatible
database before every production apply. The verifier replays every
migration and runs the SQL integration suite (RLS, atomic cancellation,
seed assertions, RPC refusal messages).

```bash
export ITC_OPERATIONS_TEST_DATABASE_URL='postgresql://...disposable database...'
export ITC_ALLOW_DATABASE_RESET=1
bash supabase/tests/verify_operational_backend.sh
```

Expected: every migration applies cleanly, every integration test passes.

The safety gate refuses any database that already contains user data.
Exercise the gate without applying migrations with:

```bash
bash supabase/tests/verify_operational_backend.sh --safety-check-only
bash supabase/tests/verify_operational_backend_safety.sh
```

The safety scripts check that the destructive gate refuses missing
environment variables, missing confirmation, and use of the database
URL without resetting.

## Two-browser acceptance test

Before approving the merge to `testing`, verify the shared workflow on
two separate browsers signed in as different administrators.

1. Open the Vercel preview or the local server with the new branch
   deployed. Two admins in two browsers / two profiles. Use the same
   Supabase project that just received the migrations.
2. Navigate to **Schedule**. Both browsers show the 15 August 2026 row
   labelled `Session cancelled by ITC — HYROX race weekend`. The Midtown
   variant shows the same cancellation.
3. Navigate to **Activity** for `hyrox-bft-2026-08-15`. Both admins see the
   canonical cancellation banner; no `Reserve`, `Mark paid`,
   `Confirm received`, or `Mark confirmed with gym` controls appear.
4. As **Admin A**, open the next active HYROX session (e.g. the
   following Saturday). As a member signed in on a third browser, tap
   **Reserve**, **Mark paid**, and notify Admin A.
5. As **Admin A**, confirm the payment. Verify the booking moves to
   `confirmed` and a receipt appears in **Admin → HYROX**.
6. **Admin B** sees the same confirmed status without reloading. The
   booking's snapshot is preserved.
7. As **Admin A**, record the gym confirmation. **Admin B** sees the
   confirmation timestamp and the optional note.
8. Move the browser tab for Admin B to the background for sixty
   seconds. Switch back to the foreground. Verify the live state
   matches Admin A's view (Realtime refresh).
9. As **Admin A**, cancel the session with a custom reason. **Admin B**
   sees the cancellation immediately; the receipts and bookings
   disappear from the HYROX queue.
10. Confirm a paid booking was deferred to the next available session
    and the corresponding queued notification appeared for the member.

If any of the above fail, do not merge. The likely causes are:

- A missing migration; reapply the post-deployment checks.
- A missing `supabase_realtime` publication entry; reapply migration 4.
- A missing anon key in `app/index.html`; re-deploy the new branch
  after fixing the inline script.

## Rollback

Database migrations are forward-only. Do not attempt to drop the
operational or pooled HYROX tables in production. If a schema fix is
required, write a new migration that adjusts the table. Before the first
pooled reservation, a code rollback may return to the legacy child-session
flow only if no pooled live data exists. After the first pooled reservation,
rollback must remain pooled-booking compatible and must continue reading
live Supabase; never fall back to local state.

## Pre-deployment checklist

- [ ] Disposable database verifier passes on an explicitly acknowledged disposable database.
- [ ] All four pooled migrations applied in order after the pre-existing operational migrations.
- [ ] Post-deployment SQL checks executed and match the expected output.
- [ ] 15 August 2026 sessions render with the canonical cancellation copy
      in two separate browsers.
- [ ] Two-browser cross-admin acceptance test passes.
- [ ] Application preview verified with the same anon key the deployed
      build will use.
