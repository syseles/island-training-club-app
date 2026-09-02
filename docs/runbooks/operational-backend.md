# Operational Backend Deployment Runbook

This runbook covers applying the shared HYROX operational backend
migrations to the production Supabase project, verifying the result, and
executing the Admin two-browser acceptance test before merging to
`testing`.

## What lives in Supabase

From this branch onward, the Supabase project owns the full HYROX
operational workflow:

- `operational_activity_templates` — `hyrox-bft`, `hyrox-midtown`, and
  `hyrox-quarry-bay` recurring definitions.
- `operational_sessions` — one row per venue per scheduled Saturday.
- `operational_bookings` — reservation, confirmation, payment approval,
  cancellation, and deferral records.
- `operational_queue_entries` — waitlist and Midtown interest lists.
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
  `update_collector_payout_profile`, `sweep_operational_deadlines`.
- Both: `ensure_operational_sessions` (idempotent rolling window).

## Apply the migrations

The deployment is intentionally manual. Apply the four operational
migrations in this order, in the Supabase SQL Editor (or via `supabase db
push` from a trusted workstation):

1. `20260808000001_operational_schema.sql` — tables, RLS, trigger, seed.
2. `20260808000002_operational_member_rpcs.sql` — member RPCs.
3. `20260808000003_operational_admin_rpcs.sql` — admin RPCs.
4. `20260808000004_operational_realtime_seed.sql` — Realtime publication
   and the 15 August 2026 seed.
5. Apply every later migration in filename order, including
   `20260902000001_hyrox_bft_quarry_bay.sql`, which safely renames BFT’s
   canonical identifier and adds Quarry Bay.

Apply each migration on its own. Resolve any error before moving to the
next migration. The verified `feature/shared-operations` branch uses
`origin/testing` as its base; the same migrations must be applied to
the same database that the App's anon key reaches.

## Post-deployment verification

Run the following read-only checks in the SQL Editor to confirm a clean
deployment. Compare the output of each query against the expected shape.

Verify the seven operational tables exist with RLS enabled:

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
     'collector_payout_profiles'
   )
 order by c.relname;
```

Expected: every row has `relrowsecurity = true`.

Verify the six operational tables are in the Realtime publication:

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
     'collector_payout_profiles'
   )
 order by tablename;
```

Expected: six rows.

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

Application rollback is safe: shipping the previous `testing` build
restores the localStorage-only flow. The first live hydration of the
shared cache writes `itc.live.operations.backend.v1 = "supabase"` into
the browser's local storage; the rollback build does not read this
marker, so the prototype returns to the local-only flow without
mutating the new Supabase tables.

Database migrations are forward-only. Do not attempt to drop the
operational tables in production. If a schema fix is required, write a
new migration that adjusts the table.

## Pre-deployment checklist

- [ ] Disposable database verifier passes.
- [ ] All four ordered migrations applied to the production Supabase project.
- [ ] Post-deployment SQL checks executed and match the expected output.
- [ ] 15 August 2026 sessions render with the canonical cancellation copy
      in two separate browsers.
- [ ] Two-browser cross-admin acceptance test passes.
- [ ] Application preview verified with the same anon key the deployed
      build will use.
