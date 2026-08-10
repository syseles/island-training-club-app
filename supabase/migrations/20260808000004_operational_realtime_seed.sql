-- Island Training Club — operational Realtime publication and seed
--
-- Publishes the operational tables to supabase_realtime so the browser
-- receives change events and refreshes the cache. Also pre-cancels both
-- 15 August 2026 sessions with reason 'HYROX race weekend' as system
-- provenance so the planned product change (race weekend) is captured
-- from the first run.

-- =====================================================================
-- Realtime publication
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.operational_sessions;
alter publication supabase_realtime add table public.operational_bookings;
alter publication supabase_realtime add table public.operational_queue_entries;
alter publication supabase_realtime add table public.operational_receipts;
alter publication supabase_realtime add table public.collector_assignments;
alter publication supabase_realtime add table public.collector_payout_profiles;

-- =====================================================================
-- 15 August 2026 cancellation seed (system-provenance)
-- =====================================================================

-- Ensure the deterministic session rows exist. ensure_operational_sessions
-- is idempotent and bounded; this seed call must not extend the rolling
-- window beyond the theoretical 16 weeks from a recent start.
do $$
declare
  v_first_saturday date;
  v_target date := date '2026-08-15';
begin
  -- Ensure the session exists; generate a window that covers August 2026.
  perform ensure_operational_sessions(date '2026-08-01', 1);
  v_first_saturday := date '2026-08-01'
    + ((6 - extract(dow from date '2026-08-01')::integer) % 7);
  perform ensure_operational_sessions(v_first_saturday, 1);
  -- Make sure the 15 August rows are present.
  perform ensure_operational_sessions(date '2026-08-15' - ((6 - extract(dow from date '2026-08-15')::integer) % 7), 1);
end $$;

update public.operational_sessions
   set cancelled_at = now(),
       cancelled_by = null,
       cancelled_source = 'system',
       cancel_reason = 'HYROX race weekend'
 where id in ('hyrox-2026-08-15', 'hyrox-midtown-2026-08-15')
   and cancelled_at is null;
