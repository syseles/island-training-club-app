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

### Executable release sequence

Use this sequence without reordering or combining its gates:

1. **Inventory, apply, and verify the backend and RPC boundary.** Run the count-only inventory, apply only the reviewed retirement migration, compare retained counts, and complete pool RPC denial and Island ECC active-RPC checks.
2. **Deploy and verify the avatar boundary.** Deploy the reviewed `resolve-profile-avatars` Edge Function only after SQL classifier/grant verification; record its artifact revision and pass the direct authenticated endpoint gates below before any browser acceptance.
3. **Deploy the reviewed preview.** Deploy the reviewed preview revision against that verified migrated backend; do not promote it yet.
4. **Run browser UI and Island ECC acceptance.** Against the deployed preview, verify browser UI and the full Island ECC lifecycle, exact deep-link behavior, and absence of retired data.
5. **Promote the exact accepted snapshot.** Promote only the exact preview commit accepted in step 4, then repeat bounded production checks.

The local gates below precede this release sequence and never replace any production or preview gate.

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

The SHA-256 identifies the complete reviewed SQL, including generic notification provenance; the version alone is not artifact identity. These final-review corrections revise the not-yet-deployed source artifact. Discard prior approval/hash evidence for this file and record a fresh reviewed digest. If any target already applied a different digest under `20260922000001`, stop: do not reapply this file or repair history to pretend it matches. That target requires a new, separately reviewed forward correction migration.

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
      or (
        n.kind = 'operational_payment_marked'
        and exists (
          select 1 from public.operational_bookings b
           where b.payment_marked_at = n.created_at
             and b.id in (select id from retired_bookings)
        )
      )
      or (
        n.kind = 'operational_gym_finalized'
        and exists (
          select 1 from public.operational_sessions s
           where s.gym_confirmed_at = n.created_at
             and s.id in (select id from retired_sessions)
        )
      )
      or (
        n.kind = 'hyrox_replacement_review'
        and (
          exists (
            select 1
              from public.operational_booking_replacement_requests r
             where r.accepted_at = n.created_at
               and r.booking_id in (select id from retired_bookings)
          )
          or not exists (
            select 1
              from public.operational_booking_replacement_requests r
             where r.accepted_at = n.created_at
          )
        )
      )
)
select metric, bucket, row_count
  from metrics
 order by metric, bucket;
```

The `hyrox_replacement_review` branch mirrors the pre-migration relationship rule: a notice matching any retired booking is counted; an ambiguous notice with no replacement at the same acceptance/creation timestamp is conservatively counted; and a notice is excluded only when that timestamp resolves exclusively to a proven active replacement such as Island ECC. If active and retired replacements share a timestamp, the retired match wins. The query emits only the aggregate bucket—never notification IDs or content. The rollback-scoped integration includes retired, unmatched, and proven-active Island ECC review-notice controls and asserts the expected aggregate classification.

Generic `operational_payment_marked` and `operational_gym_finalized` producers use the same transaction timestamp as `payment_marked_at` and `gym_confirmed_at`. The inventory follows those authoritative booking/session relationships: any retired match hides (even with an active match), ECC-only matches remain active, and unrelated generic notices without HYROX provenance are not blanket-hidden. No body parsing or notification rewriting is used.

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

### 5. Deploy and verify the avatar service-role boundary

This is a separate, explicitly authorized Edge Function deployment, not part of Vercel deployment. Do not deploy now as part of local implementation. After step 4, verify as a trusted operator that `operational_is_retired_hyrox_session(text)` exists, is security-definer with `search_path=public`, denies `PUBLIC`/`anon`/`authenticated`, and grants `service_role` EXECUTE:

```sql
select p.prosecdef, p.proconfig,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
  from pg_proc p
 where p.oid = 'public.operational_is_retired_hyrox_session(text)'::regprocedure;
```

From the reviewed checkout only, and with separate deployment authorization:

```bash
git rev-parse HEAD
shasum -a 256 supabase/functions/resolve-profile-avatars/index.ts \
  supabase/functions/_shared/avatar-service.ts
supabase functions deploy resolve-profile-avatars --project-ref "$SUPABASE_PROJECT_REF"
```

Record the deployed artifact revision (commit plus function/shared-adapter digests and deployment version), target project, and UTC time. Retain the reviewed shared adapter in the bundle. An old resolver bypasses RLS through service-role reads: SQL success alone never closes this boundary.

**Direct authenticated endpoint gates**, independent of frontend routing: use disposable approved-member and Admin access tokens (never log tokens or avatar response payloads). Send GET requests directly to `/functions/v1/resolve-profile-avatars?scope=session&sessionId=<URL-encoded-canonical-session-id>` with `Authorization: Bearer <access-token>` and the project's public API key.

- BFT and Midtown retained sessions: HTTP 404 with only `{"error":"Session not found"}`; no attendee identities, avatar payload, or signed URLs. Verify no attendee read/signing occurs using privacy-safe instrumentation in the disposable replica.
- Active Island ECC with disposable attendee/avatar fixtures: HTTP 200 and the expected authorized attendee presentations; confirm signing still works without retaining the URLs or identities in evidence.
- **classifier-failure fail-closed**: on a disposable local replica of the exact artifact, inject a classifier lookup error (or temporarily revoke its service grant there only), then call the authenticated HTTP endpoint. Require HTTP 500 with only `{"error":"Profile photos could not be loaded"}` and zero attendee reads/signing. Restore the local grant and repeat ECC success. Never break the classifier in a shared project to test failure.

Record status, count-only assertions, revision and target, not private payloads. Every gate must pass before endpoint/browser acceptance is declared complete or a preview is accepted. Unit mocks do not substitute for direct HTTP acceptance of the deployed artifact. Recheck BFT/Midtown denial and ECC success on the authorized target after deployment; failure-injection evidence comes from the disposable replica.

### 6. Pre-preview backend and RPC denial/active checks

Use separate disposable approved-member and Admin API sessions against the migrated backend. This is an RPC/data-boundary gate, not browser UI acceptance.

1. As member and Admin API clients, attempts to select pool cycles/queues must fail or return no rows; retired templates, sessions, bookings, receipts, replacements, and notifications must not hydrate.
2. Pool reservation, waitlist, venue choice/switch, allocation, cancellation, reminder, payment, attendance, and replacement RPCs must be denied before any row, audit, queue, or notification side effect.
3. Exercise Island ECC active RPCs with disposable fixtures: reserve, mark paid, Admin confirm, issue/read receipt, attendance, waitlist where applicable, and replacement acceptance/confirmation. Verify replacement preserves original payer, payment, receipt owner, amount, and direct session.
4. Re-run count-only evidence. Retained rows/statuses and the complete pool-related notification count—including retired/unmatched replacement-review notices—must equal baseline.
5. Remove API fixtures and prove cleanup with count-only queries.

Any failure blocks preview deployment.

### 7. Deploy the reviewed preview

Deploy the reviewed preview revision—the exact tested commit—against the migrated and verified backend. Confirm the served revision and target Supabase project. Do not merge or promote it yet.

### 8. Browser UI and Island ECC acceptance

Against that deployed preview, use separate visitor, pending, approved-member, Admin, and Super Admin browser sessions in current Chrome and Safari at 375 px.

1. Verify Home, Schedule, Profile/history/notifications, Admin Activities, and Admin Payments show Island ECC once, expose no active pool controls or indirect pool counts, and do not clip horizontally.
2. Verify known retired Activity, pool, booking, payment, checkout, and receipt deep links show `This session is no longer available.` and keep the original URL without RPC/avatar calls. Unknown identifiers keep the safe not-found state. Neither redirects to Island ECC.
3. Through the browser UI, complete the full Island ECC lifecycle: reserve → mark paid → Admin confirmation → receipt → attendance, plus waitlist behavior where applicable.
4. Create and accept an Island ECC replacement invite, then confirm it as Admin. Verify only effective attendee ownership changes; payer/payment/receipt ownership remains unchanged.
5. Compare retained count-only evidence again, confirm no retirement notification was created, remove all preview fixtures, and prove cleanup.

Record fixture UUIDs and bounded UTC timestamps only. Never retain names, emails, tokens, payment references, notification bodies, or screenshots containing personal data. Any failure blocks production promotion.

### 9. Promote the exact accepted snapshot

Promote only the exact preview commit accepted in step 8. Wait for the production deployment, confirm its served revision, repeat minimal canonical-route/browser-denial and Island ECC lifecycle checks, compare retained counts once more, and remove all disposable fixtures.

A failed or unexecuted backend or preview gate blocks promotion. Frontend rollback alone does not restore pool access and must never point old pool UI at the migrated backend.

## Forward-only rollback

Rollback is a forward-only rollback: preserve all retained rows and write a new, separately reviewed forward migration that explicitly restores any intended template activation, policies, grants, functions, and provisioning. Pair it with a compatible frontend deployment and compatible avatar Edge Function artifact in backend-first order. Keep the fail-closed resolver while retirement is intended; never roll back to the old service-role resolver that bypasses classification. Any intentional reopening must review the database, Edge Function and frontend together, deploy SQL prerequisites first, then the compatible resolver, rerun direct endpoint gates, and only then accept the frontend.

Never edit or replay applied migration history. Never delete or mark down `20260922000001_retire_bft_midtown_hyrox_pool.sql`, alter historical pool migrations, drop/truncate retained tables, or reconstruct state from browser caches. If only the retirement frontend is defective, redeploy a reviewed compatible frontend that keeps pool entry points unavailable while the backend boundary remains in force.

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
- [ ] Reviewed avatar artifact revision deployed after classifier/grant verification; direct BFT/Midtown denial, ECC success and disposable classifier-failure fail-closed gates pass.
- [ ] Browser denial and full Island ECC direct-session acceptance pass.
- [ ] Migration history records `20260922000001` exactly once.
- [ ] Testing frontend acceptance precedes exact-snapshot production promotion.
- [ ] Disposable fixtures removed and final count-only evidence recorded.
