-- Forward-only repair of the exact observed post-retirement ACL/policy drift.
-- 00001/00002 remain immutable. No retained rows or function bodies change.
-- Keep the reviewed no-op generator and existing service/operator privileges.
drop policy if exists "public read HYROX cycles" on public.operational_hyrox_cycles;
drop policy if exists "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries;

revoke select on table public.operational_hyrox_cycles from public, anon, authenticated;
revoke select on table public.operational_hyrox_queue_entries from public, anon, authenticated;
revoke execute on function public.ensure_hyrox_cycles(date, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
