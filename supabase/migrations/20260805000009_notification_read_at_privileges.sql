-- Restrict browser notification updates to the per-recipient read marker.
--
-- RLS continues to decide which rows may be updated; column privileges decide
-- what may change. Revoke first so this migration is safe to rerun even when
-- Supabase's default table grants gave browser roles broad UPDATE access.

revoke update on table public.notifications from anon, authenticated;
grant update (read_at) on table public.notifications to authenticated;
