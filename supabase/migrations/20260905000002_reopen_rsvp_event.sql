-- Island Training Club — reopen cancelled RSVP events
--
-- Reopening changes the original session back to active. It does not create
-- a duplicate session or restore cancelled bookings; members can RSVP again.

create or replace function public.reopen_operational_rsvp(
  p_session_id text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_requires_rsvp boolean;
begin
  perform public.operational_assert_admin('reopen_rsvp');

  select * into v_session
    from public.operational_sessions
   where id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is null then
    raise exception 'Session is not cancelled.' using errcode = '23514';
  end if;

  select coalesce(t.requires_rsvp, false) into v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;
  if not coalesce(v_requires_rsvp, false) or v_session.price_hkd <> 0 then
    raise exception 'Only cancelled RSVP events can be reopened.' using errcode = '22023';
  end if;
  if (v_session.session_date + v_session.start_time)
      <= (now() at time zone 'Asia/Hong_Kong') then
    raise exception 'The RSVP event has already started.' using errcode = '23514';
  end if;

  update public.operational_sessions
     set cancelled_at = null,
         cancelled_by = null,
         cancelled_source = null,
         cancel_reason = null
   where id = p_session_id
   returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.reopen_operational_rsvp(text) to authenticated;
