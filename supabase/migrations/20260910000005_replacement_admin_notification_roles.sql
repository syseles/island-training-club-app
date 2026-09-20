-- Island Training Club — replacement Admin notification role repair
--
-- public.profiles represents approval through role and has no status column.
-- Keep acceptance authorization unchanged and notify only operational Admin
-- roles after an approved member accepts an invite.

create or replace function public.accept_operational_replacement_request(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_request public.operational_booking_replacement_requests;
  v_booking public.operational_bookings;
  v_session_date date;
  v_public jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select * into v_request
    from public.operational_booking_replacement_requests
   where token_hash = trim(p_token_hash)
   for update;
  if not found then
    raise exception 'Replacement invite not found.' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This replacement invite is no longer available.' using errcode = '23514';
  end if;
  if v_request.expires_at <= now() then
    update public.operational_booking_replacement_requests
       set status = 'expired', decision_reason = 'Invite expired.'
     where id = v_request.id;
    raise exception 'This replacement invite has expired.' using errcode = '23514';
  end if;
  if v_uid = v_request.original_profile_id then
    raise exception 'The original member cannot accept their own replacement invite.' using errcode = '23514';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = v_request.booking_id
   for update;
  if v_booking.status <> 'confirmed' or v_booking.replacement_profile_id is not null then
    raise exception 'This booking is no longer available for replacement.' using errcode = '23514';
  end if;
  if v_booking.session_id is not null then
    select session_date into v_session_date
      from public.operational_sessions
     where id = v_booking.session_id
       and cancelled_at is null;
  else
    select session_date into v_session_date
      from public.operational_hyrox_cycles
     where id = v_booking.hyrox_cycle_id
       and registration_state <> 'cancelled';
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
     where other.profile_id = v_uid
       and other.status in ('reserved', 'confirmed')
       and (
         other_cycle.session_date = v_session_date
         or (
           other_session.session_date = v_session_date
           and other_session.activity_id ilike 'hyrox%'
         )
       )
  ) then
    raise exception 'You already have a HYROX booking for this session.' using errcode = '23505';
  end if;

  update public.operational_booking_replacement_requests
     set status = 'accepted', replacement_profile_id = v_uid,
         accepted_at = now(), accepted_by = v_uid
   where id = v_request.id
  returning * into v_request;

  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id,
    replacement_profile_id, actor_profile_id
  ) values (
    v_request.id, v_request.booking_id, 'accepted', v_request.original_profile_id,
    v_uid, v_uid
  );
  insert into public.notifications (profile_id, kind, title, body, destination)
  values (
    v_request.original_profile_id,
    'hyrox_replacement_accepted',
    'HYROX replacement accepted',
    'An approved member accepted your replacement invite. ITC must confirm the handover before the attendee changes.',
    '#/booking/' || v_request.booking_id::text
  );
  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'hyrox_replacement_review',
         'HYROX replacement needs confirmation',
         'An approved member accepted a paid HYROX replacement invite. Review it in Admin Payments.',
         '#/admin/ops'
    from public.profiles p
   where p.role in ('admin', 'super_admin');

  v_public := public.operational_replacement_public(v_request.id);
  return v_public;
end;
$$;

revoke all on function public.accept_operational_replacement_request(text)
  from public, anon, authenticated;
grant execute on function public.accept_operational_replacement_request(text)
  to authenticated;

notify pgrst, 'reload schema';
