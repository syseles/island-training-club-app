-- Allow signed-in recipients to fetch rows admitted by notification RLS.
--
-- The local Supabase baseline does not grant SELECT on newly created public
-- tables. UPDATE policies also evaluate the visible row, so marking read needs
-- this table privilege in addition to UPDATE (read_at).

revoke select on table public.notifications from anon;
grant select on table public.notifications to authenticated;
