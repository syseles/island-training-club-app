-- Remove the legacy Sept 5 RSVP duplicate created by the old repost flow.
-- Keep the canonical recurring lunch session and reopen it in place.
-- This is intentionally guarded so a duplicate with member history is not
-- deleted silently.

do $$
declare
  v_duplicate_id text := 'event-1788509289-2026-09-05';
begin
  if exists (
    select 1
      from public.operational_sessions s
      join public.operational_activity_templates t
        on t.activity_id = s.activity_id
     where s.id = v_duplicate_id
       and s.activity_id like 'event-%'
       and s.session_date = date '2026-09-05'
       and s.start_time = time '12:45:00'
       and t.name = 'Post-Training Lunch'
  ) then
    if exists (
      select 1 from public.operational_bookings
       where session_id = v_duplicate_id
    ) then
      raise exception 'Cannot remove Sept 5 RSVP duplicate with booking history.';
    end if;

    delete from public.operational_queue_entries
     where session_id = v_duplicate_id;
    delete from public.operational_sessions
     where id = v_duplicate_id;
    delete from public.operational_activity_templates
     where activity_id = 'event-1788509289';
  end if;

  update public.operational_sessions
     set cancelled_at = null,
         cancelled_by = null,
         cancelled_source = null,
         cancel_reason = null
   where id = 'lunch-2026-09-05'
     and cancelled_at is not null;
end;
$$;
