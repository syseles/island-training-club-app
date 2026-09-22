# Operational Backend Deployment Runbook

This is the current runbook for the live Supabase operational backend. Island ECC is the sole active HYROX session and keeps the direct paid-session reservation, waitlist, payment, receipt, attendance, replacement, collector, and venue-confirmation paths.

The former BFT Causeway Bay/Midtown28 shared pool is retired. Retained BFT/Midtown pool test records are hidden from browser roles, not deleted. They remain available only to trusted database operators for audit. Retirement does not cancel bookings, move members to Island ECC, delete rows, or send notifications.

Known retired HYROX deep links render `This session is no longer available.`; unknown IDs keep the existing safe not-found behavior; neither redirects to Island ECC.

## Current ownership and safety boundary

Supabase is authoritative in configured live mode. Browser reads are constrained by RLS and browser mutations use scoped security-definer RPCs. The retirement migration:

- deactivates exactly `hyrox-bft` and `hyrox-midtown` while preserving `hyrox-quarry-bay`;
- removes browser access to pool cycles and cycle queues;
- filters retired sessions, bookings, queues, receipts, replacements, and notifications;
- revokes pool-only RPCs and guards shared direct-session RPCs before side effects;
- disables cycle provisioning and pool reminders;
- leaves retained domain rows and their statuses unchanged.

The historical pool tables and migrations remain because they define the retained schema. Their presence does not make the pool an active product.

## Migration order

For a **clean disposable database only**, replay every repository migration once in filename/version order. The operational sequence is:

1. `20260808000001_operational_schema.sql`
2. `20260808000002_operational_member_rpcs.sql`
3. `20260808000003_operational_admin_rpcs.sql`
4. `20260808000004_operational_realtime_seed.sql`
5. all later migrations in filename order, including the historical pool schema/RPC migrations `20260903000001`–`20260904000002`, attendance `20260909000001`, replacement migrations `20260910000001`–`20260910000006`, free-event migration `20260920000001`, prayer migration `20260921000001`, and decision repair `20260921000002`;
6. `20260922000001_retire_bft_midtown_hyrox_pool.sql` last.

Do not skip or rewrite historical files in a clean replay: the final retirement migration depends on the schema they created and then closes its browser boundary.

Production has known migration-history drift. Do **not** replay the chain, use unqualified `supabase db push`, use `--include-all`, or repair an older migration as part of this rollout. Confirm the linked project and remote history first. Apply only the reviewed source-tip file `supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql` after its prerequisites and production inventory are verified.

## HYROX pool retirement: backend-first deployment

This rollout is strictly backend-first deployment. A frontend containing retirement behavior must not target an unmigrated project.

### 1. Local gates

From the reviewed checkout, prove migration-version uniqueness and run the complete local safety suite:

```bash
test -z "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | cut -d_ -f1 | sort | uniq -d)"
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | sort | tail -1)" = \
  "20260922000001_retire_bft_midtown_hyrox_pool.sql"
shasum -a 256 supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql
bash supabase/tests/retire_hyrox_pool_safety.sh
```

Reset a disposable local Supabase stack, replay the unmodified chain, and run the rollback-scoped integration:

```bash
supabase stop --no-backup || true
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
supabase db reset --local --no-seed
docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -P pager=off -v ON_ERROR_STOP=1 \
  < supabase/tests/retire_hyrox_pool_integration.sql
```

Expected: the integration emits `OK: retired HYROX pool boundary`, ends with `ROLLBACK`, and exits zero. Never run this reset or integration against production, Testing, staging, a shared database, or a database containing real user data.

### 2. Read-only production inventory

Before any shared mutation, confirm the target project, backup/PITR status, reviewed commit, migration SHA-256, and remote history:

```bash
export SUPABASE_PROJECT_REF="<confirmed-project-ref>"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
```

Stop if the target or history is unexpected, if `20260922000001` is already present without matching reviewed evidence, or if Island ECC is absent/inactive.

Run the following in trusted read-only SQL. It deliberately emits canonical activity/status labels and counts only—never member names, emails, profile IDs, payment references, replacement tokens, notification bodies, or screenshots of row content.

```sql
-- Canonical templates: these IDs are product identifiers, not member data.
select activity_id, active, count(*) as row_count
  from public.operational_activity_templates
 where activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay')
 group by activity_id, active
 order by activity_id;

-- Retained-domain count-only evidence. Save this output for post-apply comparison.
with retired_sessions as (
  select id
    from public.operational_sessions
   where activity_id in ('hyrox-bft', 'hyrox-midtown')
), retired_bookings as (
  select b.id
    from public.operational_bookings b
   where b.hyrox_cycle_id is not null
      or b.session_id in (select id from retired_sessions)
), retired_replacements as (
  select r.id
    from public.operational_booking_replacement_requests r
   where r.booking_id in (select id from retired_bookings)
), metrics(metric, bucket, row_count) as (
  select 'sessions',
         case when s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
              then 'future_or_today' else 'past' end,
         count(*)
    from public.operational_sessions s
   where s.id in (select id from retired_sessions)
   group by 2
  union all
  select 'cycles', coalesce(c.registration_state, 'unknown'), count(*)
    from public.operational_hyrox_cycles c group by 2
  union all
  select 'bookings', coalesce(b.status, 'unknown'), count(*)
    from public.operational_bookings b
   where b.id in (select id from retired_bookings) group by 2
  union all
  select 'receipts', coalesce(r.status, 'unknown'), count(*)
    from public.operational_receipts r
   where r.booking_id in (select id from retired_bookings) group by 2
  union all
  select 'direct_queues', coalesce(q.kind, 'unknown') || ':' || coalesce(q.status, 'unknown'), count(*)
    from public.operational_queue_entries q
   where q.session_id in (select id from retired_sessions) group by 2
  union all
  select 'cycle_queues', coalesce(q.kind, 'unknown') || ':' || coalesce(q.status, 'unknown'), count(*)
    from public.operational_hyrox_queue_entries q group by 2
  union all
  select 'replacements', coalesce(r.status, 'unknown'), count(*)
    from public.operational_booking_replacement_requests r
   where r.id in (select id from retired_replacements) group by 2
  union all
  select 'replacement_audit', coalesce(a.action, 'unknown'), count(*)
    from public.operational_booking_replacement_audit a
   where a.request_id in (select id from retired_replacements) group by 2
  union all
  select 'notifications', 'retired_pool_related', count(*)
    from public.notifications n
   where n.kind like 'operational_hyrox\_%' escape '\'
      or n.destination in (
           select '#/activity/' || id from retired_sessions
           union all select '#/booking/' || id::text from retired_bookings
           union all select '#/pay/' || id::text from retired_bookings
         )
)
select metric, bucket, row_count
  from metrics
 order by metric, bucket;
```

Record the UTC query time and count-only evidence. Confirm with the data owner that future BFT/Midtown/pool rows are the acknowledged test records. A mismatch or evidence of genuine future member activity blocks deployment; do not infer consent, cancel it, migrate it, or inspect personal fields.

### 3. Apply only the retirement migration

Reconfirm that the production templates are still in the expected pre-retirement state and the remote migration list does not contain `20260922000001`. With explicit production authorization, apply the reviewed file unchanged to the confirmed project using the trusted Supabase SQL Editor or the separately approved linked CLI command:

```bash
supabase db query --linked \
  --file supabase/migrations/20260922000001_retire_bft_midtown_hyrox_pool.sql
```

Command success is not acceptance. Do not deploy the dependent frontend yet. Do not run cancellation RPCs or any cleanup statement.

### 4. Verify backend state before history repair or frontend deployment

The template query must return BFT and Midtown inactive and Island ECC active:

```sql
select activity_id, active
  from public.operational_activity_templates
 where activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay')
 order by activity_id;
```

Expected:

```text
hyrox-bft         false
hyrox-midtown     false
hyrox-quarry-bay  true
```

Verify the canonical helpers and pool RPC privilege boundary. All three helpers must deny `anon` and `authenticated`; every listed pool RPC must deny both browser roles:

```sql
with expected(signature) as (
  values
    ('public.operational_is_retired_hyrox_activity(text)'),
    ('public.operational_is_retired_hyrox_session(text)'),
    ('public.operational_is_retired_hyrox_booking(uuid)'),
    ('public.ensure_hyrox_cycles(date,integer)'),
    ('public.reserve_hyrox_cycle(text,text,boolean)'),
    ('public.join_hyrox_cycle_waitlist(text,text,boolean)'),
    ('public.select_hyrox_cycle_venue(uuid,text)'),
    ('public.join_hyrox_venue_switch_queue(uuid,text)'),
    ('public.cancel_hyrox_cycle(text,text)'),
    ('public.send_hyrox_member_payment_reminders(timestamp with time zone)'),
    ('public.send_hyrox_collector_payment_reminder(timestamp with time zone)'),
    ('public.send_hyrox_venue_reminders(timestamp with time zone)')
)
select signature,
       to_regprocedure(signature) is not null as exists,
       coalesce(has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE'), false)
         as anon_execute,
       coalesce(has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE'), false)
         as authenticated_execute
  from expected
 order by signature;
```

Verify pool tables enforce RLS, expose no browser-readable policy, and grant no browser mutation privilege. Historical `SELECT` grants on the two cycle tables are harmless only while RLS is enabled and no applicable policy exists; the authenticated acceptance below must also prove those queries return zero rows:

```sql
with checked(table_name) as (
  values
    ('operational_hyrox_cycles'),
    ('operational_hyrox_queue_entries'),
    ('operational_booking_replacement_requests'),
    ('operational_booking_replacement_audit')
)
select x.table_name,
       c.relrowsecurity as rls_enabled,
       count(p.policyname) as browser_read_policies,
       has_table_privilege('anon', format('public.%I', x.table_name), 'INSERT,UPDATE,DELETE')
         as anon_can_mutate,
       has_table_privilege('authenticated', format('public.%I', x.table_name), 'INSERT,UPDATE,DELETE')
         as authenticated_can_mutate
  from checked x
  join pg_class c on c.oid = format('public.%I', x.table_name)::regclass
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = x.table_name
   and p.cmd = 'SELECT'
 group by x.table_name, c.relrowsecurity
 order by x.table_name;
```

Every row must have `rls_enabled = true`, `browser_read_policies = 0`, and both mutation values false. Then rerun the exact inventory query from step 2. Every retained-domain count and status bucket must equal the pre-apply evidence; only the BFT/Midtown template `active` flags may change. The pool-related notification count must also be unchanged.

Finally verify Island ECC remains present and future direct sessions remain available:

```sql
select t.activity_id, t.active, t.venue, t.capacity, t.price_hkd,
       count(s.id) filter (
         where s.session_date >= (now() at time zone 'Asia/Hong_Kong')::date
       ) as current_and_future_sessions
  from public.operational_activity_templates t
  left join public.operational_sessions s using (activity_id)
 where t.activity_id = 'hyrox-quarry-bay'
 group by t.activity_id, t.active, t.venue, t.capacity, t.price_hkd;
```

Expected: one active `hyrox-quarry-bay` template at Island ECC, capacity 30, HK$180, with the expected current/future session window. Any failed check blocks history repair and frontend deployment.

After every backend check and retained-count comparison passes, record only the new version and immediately re-list history:

```bash
supabase migration repair 20260922000001 --status applied --linked --yes
supabase migration list --linked
```

Never repair a historical pool version as part of this rollout.

### 5. Browser denial and Island ECC acceptance

Use separate disposable approved-member and Admin fixtures against the migrated backend.

1. As member and Admin browser sessions, attempts to select pool cycles/queues must fail or return no rows; retired templates, sessions, bookings, receipts, replacements, and notifications must not hydrate.
2. Pool reservation, waitlist, venue choice/switch, allocation, cancellation, reminder, payment, attendance, and replacement attempts must be denied before any row, audit, queue, or notification side effect.
3. Re-run count-only evidence and confirm all retained counts remain unchanged and no retirement notification was added.
4. Complete Island ECC reserve → mark paid → Admin confirmation → receipt → attendance. Exercise waitlist behavior with disposable capacity fixtures where applicable.
5. Create and accept a disposable Island ECC replacement invite; Admin confirmation changes only the effective attendee. The original payer, payment, receipt owner, amount, and direct session remain unchanged.
6. Verify visitor, pending, member, Admin, and Super Admin Home/Schedule/Admin surfaces show Island ECC once and no active pool controls or indirect pool counts.
7. Verify exact deep-link behavior without RPC or avatar calls: known retired Activity, pool, booking, payment, checkout, and receipt references show `This session is no longer available.` and keep their original URL; an unknown identifier shows the existing safe not-found state. Neither case redirects to Island ECC.
8. Remove all disposable fixtures and prove cleanup with count-only queries.

Record fixture UUIDs and bounded UTC timestamps only. Never retain names, emails, tokens, payment references, notification bodies, or screenshots containing personal data.

### 6. Frontend order

Only after steps 1–5 pass:

1. deploy the Testing/preview frontend from the reviewed commit against the migrated project;
2. repeat browser denial, exact deep-link, and full Island ECC acceptance in current Chrome and Safari at 375 px;
3. promote the exact accepted Testing snapshot to production;
4. repeat minimal canonical-route and Island ECC acceptance, then compare retained counts once more.

A failed or unexecuted backend gate blocks frontend promotion. Frontend rollback alone does not restore pool access and must never point old pool UI at the migrated backend.

## Forward-only rollback

Rollback is a forward-only rollback: preserve all retained rows and write a new, separately reviewed migration that explicitly restores any intended template activation, policies, grants, functions, and provisioning. Pair it with a compatible frontend deployment in backend-first order.

Never edit, delete, replay, or mark down `20260922000001_retire_bft_midtown_hyrox_pool.sql`; never alter historical pool migrations; never drop/truncate retained tables; and never reconstruct state from browser caches. If only the retirement frontend is defective, redeploy a reviewed frontend that keeps pool entry points unavailable while the backend boundary remains in force.

## Release checklist

- [ ] Reviewed commit and migration SHA-256 recorded.
- [ ] Migration versions unique; retirement migration is source tip.
- [ ] Disposable clean replay and rollback-scoped retirement integration pass.
- [ ] Correct linked project, backups, and remote migration history confirmed.
- [ ] Pre-apply count-only evidence recorded without personal or payment data.
- [ ] Future pool records confirmed as acknowledged test data.
- [ ] Only `20260922000001_retire_bft_midtown_hyrox_pool.sql` applied.
- [ ] Template, helper, grant, RLS, shared-RPC guard, and Island ECC checks pass.
- [ ] Retained counts/statuses and notification count equal the baseline.
- [ ] Browser denial and full Island ECC direct-session acceptance pass.
- [ ] Migration history records `20260922000001` exactly once.
- [ ] Testing frontend acceptance precedes exact-snapshot production promotion.
- [ ] Disposable fixtures removed and final count-only evidence recorded.
