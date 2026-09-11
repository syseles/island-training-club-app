-- Island Training Club — scope Admin replacement conflicts to HYROX
--
-- Admin confirmation repeats the member-acceptance conflict guard. Apply the
-- same authoritative HYROX-only scope so unrelated same-day bookings such as
-- Post-Training Lunch do not block a handover.

create or replace function public.admin_decide_operational_replacement(
  p_request_id uuid,
  p_confirm boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.operational_booking_replacement_requests;
  v_booking public.operational_bookings;
  v_session_date date;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.operational_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into v_request
    from public.operational_booking_replacement_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'Replacement request not found.' using errcode = 'P0002';
  end if;
  if v_request.status = 'confirmed' and p_confirm then
    return public.operational_replacement_public(v_request.id);
  end if;
  if v_request.status = 'rejected' and not p_confirm then
    return public.operational_replacement_public(v_request.id);
  end if;
  if p_confirm and v_request.status <> 'accepted' then
    raise exception 'Only an accepted replacement can be confirmed.' using errcode = '23514';
  end if;
  if p_confirm and v_request.expires_at <= now() then
    raise exception 'This replacement request has expired.' using errcode = '23514';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = v_request.booking_id
   for update;
  if p_confirm then
    if v_request.replacement_profile_id is null
        or v_booking.status <> 'confirmed'
        or v_booking.replacement_profile_id is not null then
      raise exception 'This booking is no longer available for replacement.' using errcode = '23514';
    end if;
    if v_booking.session_id is not null then
      select session_date into v_session_date
        from public.operational_sessions
       where id = v_booking.session_id and cancelled_at is null;
    else
      select session_date into v_session_date
        from public.operational_hyrox_cycles
       where id = v_booking.hyrox_cycle_id and registration_state <> 'cancelled';
    end if;
    if v_session_date is null then
      raise exception 'This HYROX session is unavailable.' using errcode = '23514';
    end if;
    if exists (
      select 1
        from public.operational_bookings other
        left join public.operational_sessions other_session
          on other_session.id = other.session_id
        left join public.operational_hyrox_cycles other_cycle
          on other_cycle.id = other.hyrox_cycle_id
       where other.profile_id = v_request.replacement_profile_id
         and other.status in ('reserved', 'confirmed')
         and other.id <> v_booking.id
         and (
           other_cycle.session_date = v_session_date
           or (
             other_session.session_date = v_session_date
             and other_session.activity_id ilike 'hyrox%'
           )
         )
    ) then
      raise exception 'The replacement member now has a HYROX booking for this session.' using errcode = '23505';
    end if;

    update public.operational_bookings
       set replacement_profile_id = v_request.replacement_profile_id,
           replacement_confirmed_at = now(),
           replacement_confirmed_by = v_uid
     where id = v_booking.id;
    update public.operational_booking_replacement_requests
       set status = 'confirmed', confirmed_at = now(), confirmed_by = v_uid,
           decision_reason = v_reason
     where id = v_request.id
    returning * into v_request;
    insert into public.operational_booking_replacement_audit (
      request_id, booking_id, action, original_profile_id,
      replacement_profile_id, actor_profile_id, reason
    ) values (
      v_request.id, v_request.booking_id, 'confirmed', v_request.original_profile_id,
      v_request.replacement_profile_id, v_uid, v_reason
    );
    insert into public.notifications (profile_id, kind, title, body, destination)
    values
      (v_request.original_profile_id, 'hyrox_replacement_confirmed', 'HYROX replacement confirmed',
       'ITC confirmed the replacement. You remain the payer and receipt owner; the approved member is now the attendee.',
       '#/booking/' || v_request.booking_id::text),
      (v_request.replacement_profile_id, 'hyrox_replacement_confirmed', 'HYROX replacement confirmed',
       'ITC confirmed your HYROX replacement. Check the session details before attending.',
       '#/booking/' || v_request.booking_id::text);
  else
    if v_request.status not in ('pending', 'accepted') then
      return public.operational_replacement_public(v_request.id);
    end if;
    update public.operational_booking_replacement_requests
       set status = 'rejected', rejected_at = now(), rejected_by = v_uid,
           decision_reason = coalesce(v_reason, 'Admin rejected the replacement request.')
     where id = v_request.id
    returning * into v_request;
    insert into public.operational_booking_replacement_audit (
      request_id, booking_id, action, original_profile_id,
      replacement_profile_id, actor_profile_id, reason
    ) values (
      v_request.id, v_request.booking_id, 'rejected', v_request.original_profile_id,
      v_request.replacement_profile_id, v_uid, v_request.decision_reason
    );
    insert into public.notifications (profile_id, kind, title, body, destination)
    values
      (v_request.original_profile_id, 'hyrox_replacement_rejected', 'HYROX replacement not confirmed',
       'ITC did not confirm the replacement. Your original booking remains unchanged.',
       '#/booking/' || v_request.booking_id::text);
    if v_request.replacement_profile_id is not null then
      insert into public.notifications (profile_id, kind, title, body, destination)
      values (v_request.replacement_profile_id, 'hyrox_replacement_rejected', 'HYROX replacement not confirmed',
        'ITC did not confirm this replacement request. The original booking remains unchanged.',
        '#/booking/' || v_request.booking_id::text);
    end if;
  end if;

  return public.operational_replacement_public(v_request.id);
end;
$$;

revoke all on function public.admin_decide_operational_replacement(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_decide_operational_replacement(uuid, boolean, text)
  to authenticated;

notify pgrst, 'reload schema';
