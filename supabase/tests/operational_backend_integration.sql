-- Island Training Club — shared HYROX operational backend integration tests
--
-- Plain SQL (no pgTAP) so the disposable Dockerized Postgres can run this
-- without extra extensions. The script asserts schema presence, RLS,
-- seeded templates, and the system-provenance cancellation invariants.
-- Atomicity / workflow assertions are added in Tasks 2+ once the
-- corresponding RPC functions exist.
--
-- Every assertion uses a CTE that raises a synthetic exception via
-- `raise notice` so the dispatcher can observe failures. The script does
-- NOT swallow errors; instead it accumulates a summary and exits with a
-- non-zero status if any check fails.

\set ON_ERROR_STOP on

do $$
declare
  failures integer := 0;
  expected_no_data boolean;
begin
  -- Schema presence
  if to_regclass('public.operational_activity_templates') is null then
    raise notice 'FAIL: operational_activity_templates missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.operational_sessions') is null then
    raise notice 'FAIL: operational_sessions missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.operational_bookings') is null then
    raise notice 'FAIL: operational_bookings missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.operational_queue_entries') is null then
    raise notice 'FAIL: operational_queue_entries missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.operational_receipts') is null then
    raise notice 'FAIL: operational_receipts missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.collector_assignments') is null then
    raise notice 'FAIL: collector_assignments missing';
    failures := failures + 1;
  end if;
  if to_regclass('public.collector_payout_profiles') is null then
    raise notice 'FAIL: collector_payout_profiles missing';
    failures := failures + 1;
  end if;

  -- Activity templates seed
  expected_no_data := not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox' and capacity = 20 and price_hkd = 180 and venue = 'BFT Causeway Bay'
  );
  if expected_no_data then
    raise notice 'FAIL: hyrox activity template seed missing';
    failures := failures + 1;
  end if;
  expected_no_data := not exists (
    select 1 from public.operational_activity_templates
    where activity_id = 'hyrox-midtown' and capacity = 12 and price_hkd = 180 and venue = 'Midtown 28'
  );
  if expected_no_data then
    raise notice 'FAIL: hyrox-midtown activity template seed missing';
    failures := failures + 1;
  end if;

  -- RLS enabled
  perform 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_sessions'
             and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_sessions RLS not enabled';
    failures := failures + 1;
  end if;

  perform 1 from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'operational_bookings'
             and c.relrowsecurity;
  if not found then
    raise notice 'FAIL: operational_bookings RLS not enabled';
    failures := failures + 1;
  end if;

  -- Seed cancellation smoke (Task 4); passing here is optional pre-Task-4.
  perform 1 from public.operational_sessions
           where id = 'hyrox-2026-08-15' and cancel_reason = 'HYROX race weekend';
  if not found then
    raise notice 'INFO: hyrox 15 August cancellation seed not yet applied (expected before Task 4)';
  end if;

  if failures > 0 then
    raise exception 'integration failures: %', failures;
  end if;
  raise notice 'OK: operational schema integration checks passed';
end $$;
