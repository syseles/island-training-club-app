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
6. `20260922000001_retire_bft_midtown_hyrox_pool.sql`;
7. `20260922000002_harden_retired_hyrox_boundary.sql`;
8. `20260922000003_reassert_retired_hyrox_pool_acls.sql` last.

Do not skip or rewrite historical files in a clean replay: the final retirement migration depends on the schema they created and then closes its browser boundary.

Production has known migration-history drift. Do **not** replay the chain, use unqualified `supabase db push`, use `--include-all`, or repair an older migration as part of this rollout. Confirm the linked project and remote history first. `00001` already applied once in production; `00002` also already applied once. Apply only the reviewed source-tip file `supabase/migrations/20260922000003_reassert_retired_hyrox_pool_acls.sql` after its hash/preflight and inventory are verified under separate authorization. Never edit, replay, reapply, or repair `00001` or `00002`.

## HYROX pool retirement: backend-first deployment

This rollout is strictly backend-first deployment. A frontend containing retirement behavior must not target an unmigrated project.

### Executable release sequence

Use this sequence without reordering or combining its gates:

1. **Inventory, apply, and verify the backend and RPC boundary.** Complete hash/preflight and count-only inventory; apply only `20260922000003_reassert_retired_hyrox_pool_acls.sql`; verify the exact restored pool policy/ACL boundary, unchanged function bodies/domain rows/older history, and complete pool RPC denial and Island ECC active-RPC checks. Both previous migrations already applied once. Complete the separately reviewed one-off recovery below before resuming acceptance.
2. **Deploy and verify the avatar boundary.** Deploy the reviewed `resolve-profile-avatars` Edge Function only after SQL classifier/grant verification; record its artifact revision and pass the direct authenticated endpoint gates below before any browser acceptance.
3. **Deploy the reviewed preview.** Deploy the reviewed preview revision against that verified migrated backend; do not promote it yet.
4. **Run browser UI and Island ECC acceptance.** Against the deployed preview, verify browser UI and the full Island ECC lifecycle, exact deep-link behavior, and absence of retired data.
5. **Promote the exact accepted snapshot.** Promote only the exact preview commit accepted in step 4, then repeat bounded production checks.

The local gates below precede this release sequence and never replace any production or preview gate. The stopped Task 7 target already has resolver version 8; this ACL repair does not require redeployment or authorize preview/promotion.

### Stopped Task 7 recovery order (00003)

1. STOP the original process and independently establish quiescence. Preserve its mode-0600 v5 journal unchanged. Ordinary cleanup-only calls crash restoration and would latch uncertainty: do not use it and never clear uncertainty.
2. Independently review exact current drift, migration bytes, original baseline and retained digests. `00001` and `00002` must each exist exactly once; `00003` must be absent before its one-time application. Only the two historical pool policies, the cycle/queue SELECT grants and browser EXECUTE grants on `ensure_hyrox_cycles(date,integer)`, `send_hyrox_member_payment_reminders(timestamptz)`, `send_hyrox_collector_payment_reminder(timestamptz)` and `send_hyrox_venue_reminders(timestamptz)` may differ. The three reminders must remain the reviewed no-op stubs. Any other catalog drift blocks this procedure. 00003 was never applied to a shared database; its amended nine-statement artifact supersedes the earlier local-only candidate. Obtain review of its new complete hash; never use the superseded bytes.
3. Under separate explicit authorization, apply only 00003 atomically via the trusted migration procedure. Its SQL changes no rows, bodies, defaults, roles, notification boundary or history. Record only the new version through that procedure; preserve every older history row. Verify all three versions exactly once, policy absence, effective PUBLIC/anon/authenticated denial and preserved service/operator access to all four no-op functions. The repaired catalog must equal pinned `5a0ecdeb48872f4ec2aacebc1d037c14`; never replace this pin with observed drift.
4. Obtain independent review of the ignored one-off tool, its exact authority hashes and post-00003 catalog/history/source/ACL hashes. Obtain a short-lived one-use acknowledgement bound to journal SHA-256, current fixture-inclusive counts for all 21 domains and Auth, original baseline/normalized excluded snapshot equality, the exact normalized organic-ID hash, originalProcessStopped and exactDriftRepaired. An acknowledgement is not permission to adopt a new catalog or fixture row.
5. The separately reviewed one-off recovery must durably lock/receipt before deletion, validate exact capture/provenance/FK closure and unsupported rows, and compare the fixture-excluded snapshot to the saved baseline (with only the reviewed new history row and strictly verified organic-session additions accounted for). Organic-session normalization applies ONLY to additional `operational_sessions` rows absent from both baseline and journal: canonical activity/date ID, active non-retired template, open/uncancelled/future in Hong Kong, matching weekday/time/duration/venue/capacity/price/default-open and untouched generator-default metadata. Creation after journal creation is a conservative candidate bound, not proof of baseline absence: subtracting candidates must reproduce the saved count and whole-row digest exactly. All other domains, retained cohorts, notifications and counts must still match exactly. Record normalized IDs only in the private mode-0600 receipt; never adopt or delete them. Preserve their full unnormalized snapshot before commit and after confirmed commit. The deployed generator remains active for non-retired templates while the old frontend is live; fresh additions during recovery invalidate the reviewed snapshot, not authorize dynamic adoption. Execute only the original locked SERIALIZABLE exact-ID/xmin/full-row-digest compiler transaction, including marker/activity/date/created_at and managed Auth child checks. No API keys, Auth HTTP, broad deletes or assumed cascades. The one-off transaction's extra locks on the two pool tables (ACCESS EXCLUSIVE), migration history (SHARE), and sessions/templates (SHARE to block generator/session writes during the transaction), plus its repeated catalog/Auth/snapshot guards, require explicit review for operational impact; they prevent concurrent observed-policy drift from slipping between checks and deletion. On mismatch preserve journal and receipt; never clear uncertainty, adopt rows, or retry an ambiguous commit.
6. Recheck baseline, counts, history, catalog and zero fixture rows both before commit and after confirmed commit. Remove the private journal only after definitive success. The original harness remains bound to its six-version history and must not resume unchanged after 00003; acceptance needs a newly reviewed contract and fresh authorization. No Task 7 completion or frontend promotion is implied.

Never edit, replay, reapply, or repair `00001` or `00002`. The historical 00002 verification queries below remain useful invariants, not instructions to apply it again.

### 1. Local gates

From the reviewed checkout, prove migration-version uniqueness and run the complete local safety suite:

```bash
test -z "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | cut -d_ -f1 | sort | uniq -d)"
test "$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' \
  -exec basename {} \; | sort | tail -1)" = \
  "20260922000003_reassert_retired_hyrox_pool_acls.sql"
shasum -a 256 supabase/migrations/20260922000003_reassert_retired_hyrox_pool_acls.sql
bash supabase/tests/retire_hyrox_pool_safety.sh
python3 supabase/tests/verify_retired_hyrox_correction.py
python3 supabase/tests/verify_retired_hyrox_drift.py
```

Reset a disposable local Supabase stack, replay the unmodified chain, and run the rollback-scoped integration:

```bash
supabase stop --no-backup || true
supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
supabase db reset --local --no-seed
docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -P pager=off -v ON_ERROR_STOP=1 \
  < supabase/tests/retire_hyrox_pool_integration.sql
python3 supabase/tests/verify_retired_hyrox_correction.py --integration
python3 supabase/tests/verify_retired_hyrox_drift.py --sql | docker exec -i supabase_db_island-training-club-app \
  psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
```

The drift integration reproduces the exact observed two policies, browser grants and authenticated EXECUTE on all three reminder overloads, proves nonempty cycle exposure, applies 00003 twice, compares all public/Auth/history rows and function/catalog state, checks actual browser denial and Island ECC reservation, and rolls back. `--sql --red` omits the repair and must fail with rollback. It separately tests inherited PUBLIC grants.

The correction integration recreates production function defaults, service grants, broad notification table/column grants and the older preserved roster in one transaction. It verifies exact ACLs, unchanged RLS/defaults/notification rows, ECC paid/replacement rosters, free RSVP rosters and member mark-read, then rolls back. `--integration --red` deliberately omits `00002` and must fail (connection close rolls back). Forbidden mutations including TRUNCATE are checked with catalog privilege predicates, never executed.

Expected: the integration emits `OK: retired HYROX pool boundary`, ends with `ROLLBACK`, and exits zero. Never run this reset or integration against production, Testing, staging, a shared database, or a database containing real user data.

### 2. Read-only production inventory

Before any shared mutation, confirm the target project, backup/PITR status, reviewed commit, migration SHA-256, and remote history:

```bash
export SUPABASE_PROJECT_REF="<confirmed-project-ref>"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --linked
```

Stop unless `20260922000001` and `20260922000002` are each present exactly once with reviewed evidence, `20260922000003` is absent, BFT/Midtown are inactive, and Island ECC is active. Known older history gaps are not permission to replay or repair anything. Stop on duplicate/unexpected versions or artifact mismatch.

The SHA-256 identifies the complete reviewed SQL; the version alone is not artifact identity. Keep the applied `00001` digest `81f66371c360d9e6aed31f4130f38df891aad4100abdbddf2aa1c0d92e7aadb8` unchanged. Keep `00002` digest `1bb968bdbe435d4cad66a1fec993946c5b67692e8f1b25e53b1bde85e2edb6eb` unchanged. Recompute the new `00003` digest against its independently approved report before application. The following 00002-era invariants must still pass; they do not authorize another correction. Retain reviewed commit/hash, target, prerequisites, backup/PITR evidence and count-only baseline. Preflight the three reported differences: postgres/public default EXECUTE grants, notification table/column ACL drift, and the preserved attendee body. Confirm the wrapper/policies still match reviewed `00001`; unexpected divergence blocks this narrow correction.

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
        and (
          exists (
            select 1 from public.operational_bookings b
             where b.payment_marked_at = n.created_at
               and b.id in (select id from retired_bookings)
          )
          or exists (
            select 1 from public.operational_hyrox_cycles c
             where n.title = 'HYROX payment claim submitted'
               and n.destination = '#/admin/payments'
               and n.body = 'Review the payment claim for ' || c.session_date::text || '.'
          )
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

Generic `operational_payment_marked` and `operational_gym_finalized` producers initially use the same transaction timestamp as `payment_marked_at` and `gym_confirmed_at`. Any retired timestamp match hides (even with an active match). Payment timestamps are mutable: mark → reject clears the mark, and mark → reject → re-mark replaces it. Therefore the inventory and RLS classifier also recognize the durable exact pooled producer fingerprint: kind `operational_payment_marked`, title exactly `HYROX payment claim submitted`, destination exactly `#/admin/payments`, and body exactly `Review the payment claim for <cycle-date>.` where `<cycle-date>` is a retained `operational_hyrox_cycles.session_date::text`. Every prior claim stays hidden regardless of the current booking timestamp or status. A fingerprint match wins even if another active payment shares its timestamp.

Direct Island ECC uses title `Payment marked for hyrox-quarry-bay` and body `A member marked payment on <session-date>.`; sharing a date with a retained cycle does not match the fingerprint. ECC-only timestamps and unrelated generic notices remain active. Near matches, missing retained dates, and arbitrary HYROX wording do not establish fingerprint provenance. This uses full-string equality to a known historical producer, never substring inference, free-text date parsing, or notification rewriting. Inventory output remains counts only—never title/body content.

The policy adapter and revoked public classifier now take `(text, text, timestamptz, text, text)` in kind/destination/created_at/title/body order; SELECT and both UPDATE predicates pass the original row fields. The private adapter is executable only by authenticated policy evaluation, not anon/PUBLIC; the public classifier remains revoked from all browser roles. The applied `00001` defines only this signature, with no three-argument overload. The production review verified these policies and signatures; `00002` intentionally leaves them unchanged. Any different policy/signature state requires separate review, never reapplication of `00001`.

Record the UTC query time and count-only evidence. Confirm with the data owner that future BFT/Midtown/pool rows are the acknowledged test records. A mismatch or evidence of genuine future member activity blocks deployment; do not infer consent, cancel it, migrate it, or inspect personal fields.

### 3. Apply only the forward drift repair

`00001` already applied once, as did `00002`. After hash/preflight and separate explicit production authorization, apply only the complete reviewed `supabase/migrations/20260922000003_reassert_retired_hyrox_pool_acls.sql` atomically using the trusted migration application procedure. Do not use broad chain push, or edit/reapply either previous migration or repair its history. This local implementation does not authorize any remote action.

Command success is not acceptance. Do not deploy the resolver or dependent frontend yet. Do not run cancellation RPCs or any cleanup statement.

### 4. Verify backend state before resolver deployment

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

Every row must have `rls_enabled = true`, `browser_read_policies = 0`, and both mutation values false. Then rerun the exact inventory query from step 2. Every retained-domain count and status bucket must equal the pre-correction evidence; no template flags, domain rows, or notification rows may change in `00002`. The pool-related notification count must also be unchanged.

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

Expected: one active `hyrox-quarry-bay` template at Island ECC, capacity 30, HK$180, with the expected current/future session window. Any failed check blocks resolver and frontend deployment.

Verify effective ACLs, not merely explicit migration statements: `service_role` may execute the session classifier only among retirement classifiers/adapters; activity, booking, notification classifiers and all three private policy adapters must deny it. All public classifiers deny PUBLIC/anon/authenticated. The preserved attendee implementation denies PUBLIC/anon/authenticated/service_role, is owned by postgres, stable SECURITY DEFINER with `search_path=public`, and its body must exactly match `20260910000002_operational_attendee_names_rsvp.sql` (body MD5 `64c519f7652df631b654191575a51680`, compare full reviewed source too). The public guarded wrapper and its authenticated grant remain unchanged. Prove BFT/Midtown empty rosters, ECC paid/replacement names without payer transfer, and free RSVP names in disposable local acceptance; use no fixture creation or mutating RPCs for read-only production verification.

For notifications, verify RLS and both complete reviewed policy predicates unchanged; anon has no table or column privileges, authenticated has only table SELECT and column UPDATE(read_at). Inspect every column for SELECT/INSERT/UPDATE/REFERENCES and every table privilege including TRUNCATE/TRIGGER/REFERENCES. No other UPDATE, INSERT, DELETE or TRUNCATE may be effective. Inspect PUBLIC/inherited grants too. Do not execute forbidden mutations to test denial. Read-only production metadata checks plus local member read/read_at and cross-recipient/retired denial tests are required; RLS alone is not evidence of correct grants.

Production defaults remain unchanged: object-specific revokes close this boundary, not all service/legacy/job privileges. Other preserved implementations and generic sweep grants observed in Step 2 remain a separate review item, not claimed owner-only here. No reviewed runtime requires direct service access to the restored attendee helper or notification classifier; the definer wrapper/policy adapters call internally as postgres. The resolver calls only the public session classifier.

After all checks pass, confirm the trusted application procedure recorded only new version `20260922000003`. Confirm `00001`, `00002` and `00003` each occur exactly once and no older history row changed. Never repair historical versions. Complete the stopped-run recovery gates before resuming acceptance; any STOP blocks further deployment.

#### Read-only correction ACL/source gate

Run as the trusted operator in a read-only transaction. Every returned `ok` must be true. These queries do not invoke application RPCs or execute forbidden mutations; preserve the Step 2 full policy/wrapper comparison and count-only inventory gates as well.

```sql
begin transaction isolation level repeatable read read only;
with helpers(signature, service_execute) as (values
  ('public.operational_is_retired_hyrox_activity(text)', false),
  ('public.operational_is_retired_hyrox_booking(uuid)', false),
  ('public.operational_is_retired_hyrox_session(text)', true),
  ('public.operational_notification_is_retired_hyrox(text,text,timestamptz,text,text)', false),
  ('public.get_operational_attendee_names_pre_pool_retirement_20260922(text)', false)
)
select signature,
       not has_function_privilege('anon', signature, 'EXECUTE')
       and not has_function_privilege('authenticated', signature, 'EXECUTE')
       and has_function_privilege('service_role', signature, 'EXECUTE') = service_execute as ok
  from helpers;

with roles(role_name) as (values ('anon'), ('authenticated')),
privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'))
select role_name, bool_and(has_table_privilege(role_name, 'public.notifications', privilege)
  = (role_name = 'authenticated' and privilege = 'SELECT')) as ok
from roles cross join privileges group by role_name;

with roles(role_name) as (values ('anon'), ('authenticated')),
privileges(privilege) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES'))
select role_name, bool_and(has_column_privilege(role_name, 'public.notifications', a.attname, privilege)
  = (role_name = 'authenticated' and (privilege = 'SELECT'
       or (privilege = 'UPDATE' and a.attname = 'read_at')))) as ok
from roles cross join privileges cross join pg_attribute a
where a.attrelid = 'public.notifications'::regclass and a.attnum > 0 and not a.attisdropped
 group by role_name;

select p.proname, not has_function_privilege('service_role', p.oid, 'EXECUTE')
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
    = (p.proname <> 'operational_notification_is_active') as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname in
 ('operational_booking_is_active', 'operational_session_is_active', 'operational_notification_is_active');

select md5(prosrc) = '64c519f7652df631b654191575a51680'
  and prosecdef and provolatile = 's' and proconfig = array['search_path=public']
  and pg_get_userbyid(proowner) = 'postgres'
  and not exists (select 1 from aclexplode(proacl) where grantee = 0) as ok
from pg_proc where oid = 'public.get_operational_attendee_names_pre_pool_retirement_20260922(text)'::regprocedure;
rollback;
```

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
- [ ] Migration versions unique; forward drift repair `00003` is source tip; `00001`/`00002` hashes unchanged.
- [ ] Disposable clean replay and rollback-scoped retirement integration pass.
- [ ] Correct linked project, backups, and remote migration history confirmed.
- [ ] Pre-apply count-only evidence recorded without personal or payment data.
- [ ] Future pool records confirmed as acknowledged test data.
- [ ] `00001`/`00002` already applied once; only reviewed `20260922000003_reassert_retired_hyrox_pool_acls.sql` applied after hash/preflight.
- [ ] Template, helper, grant, RLS, shared-RPC guard, and Island ECC checks pass.
- [ ] Retained counts/statuses and notification count equal the baseline.
- [ ] Reviewed avatar artifact revision deployed after classifier/grant verification; direct BFT/Midtown denial, ECC success and disposable classifier-failure fail-closed gates pass.
- [ ] Browser denial and full Island ECC direct-session acceptance pass.
- [ ] Migration history records `20260922000001`, `20260922000002`, `20260922000003` exactly once each; older history unchanged.
- [ ] Testing frontend acceptance precedes exact-snapshot production promotion.
- [ ] Disposable fixtures removed and final count-only evidence recorded.
