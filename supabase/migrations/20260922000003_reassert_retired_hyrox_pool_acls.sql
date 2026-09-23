-- Reassert 00001's complete pool-only ACL boundary after historical re-grants.
-- 00003 has never been shared; 00001/00002 remain immutable.
-- No rows, bodies, shared guarded RPCs, or service/operator privileges change.

-- Retained pool tables: remove both historical policies and browser SELECT.
drop policy if exists "public read HYROX cycles" on public.operational_hyrox_cycles;
drop policy if exists "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries;
revoke select on table public.operational_hyrox_cycles from public, anon, authenticated;
revoke select on table public.operational_hyrox_queue_entries from public, anon, authenticated;

-- Retired generator, scheduler, deadline job and reminders (00001 job revokes).
revoke execute on function public.ensure_hyrox_cycles(date, integer) from public, anon, authenticated;
revoke execute on function public.schedule_hyrox_cycle(text) from public, anon, authenticated;
revoke execute on function public.sweep_hyrox_cycle_deadlines(timestamptz) from public, anon, authenticated;
revoke execute on function public.send_hyrox_member_payment_reminders(timestamptz) from public, anon, authenticated;
revoke execute on function public.send_hyrox_collector_payment_reminder(timestamptz) from public, anon, authenticated;
revoke execute on function public.send_hyrox_venue_reminders(timestamptz) from public, anon, authenticated;

-- All twelve RPCs in 00001's "Pool-only browser RPCs" section, in source order.
revoke execute on function public.reserve_hyrox_cycle(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.join_hyrox_cycle_waitlist(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.leave_hyrox_cycle_queue(uuid) from public, anon, authenticated;
revoke execute on function public.reject_hyrox_cycle_payment(uuid, text) from public, anon, authenticated;
revoke execute on function public.finalize_hyrox_venue_plan(text) from public, anon, authenticated;
revoke execute on function public.finalize_hyrox_venue_plan_locked(text, timestamptz, text, uuid) from public, anon, authenticated;
revoke execute on function public.select_hyrox_cycle_venue(uuid, text) from public, anon, authenticated;
revoke execute on function public.join_hyrox_venue_switch_queue(uuid, text) from public, anon, authenticated;
revoke execute on function public.leave_hyrox_venue_switch_queue(uuid) from public, anon, authenticated;
revoke execute on function public.close_hyrox_venue_allocation(text) from public, anon, authenticated;
revoke execute on function public.cancel_hyrox_cycle(text, text) from public, anon, authenticated;
revoke execute on function public.set_operational_midtown_open(text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
