-- Island Training Club — authoritative HYROX replacement eligibility
--
-- Operational reservation snapshots predate the replacement workflow and do
-- not contain a `kind` field. Eligibility therefore comes from the locked
-- booking plus its authoritative session/template (or HYROX cycle), not from
-- optional snapshot presentation fields.

create or replace function public.create_operational_replacement_request(
  p_booking_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_is_paid_hyrox boolean := false;
  v_start_at timestamptz;
  v_expires_at timestamptz;
  v_request public.operational_booking_replacement_requests;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_token_hash, ''))) < 32 then
    raise exception 'Replacement invite token is invalid.' using errcode = '22023';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
     and profile_id = v_uid
   for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;

  if v_booking.session_id is not null then
    select * into v_session
      from public.operational_sessions
     where id = v_booking.session_id;
    select exists (
      select 1
        from public.operational_sessions s
        join public.operational_activity_templates t
          on t.activity_id = s.activity_id
       where s.id = v_booking.session_id
         and coalesce(s.price_hkd, t.price_hkd, 0) > 0
         and (s.activity_id ilike 'hyrox%' or t.name ilike '%HYROX%')
    ) into v_is_paid_hyrox;
  elsif v_booking.hyrox_cycle_id is not null then
    select exists (
      select 1
        from public.operational_hyrox_cycles c
       where c.id = v_booking.hyrox_cycle_id
    ) into v_is_paid_hyrox;
  end if;

  if v_booking.status <> 'confirmed' or not coalesce(v_is_paid_hyrox, false) then
    raise exception 'Only a confirmed paid HYROX booking can arrange a replacement.' using errcode = '23514';
  end if;
  if v_booking.replacement_profile_id is not null then
    raise exception 'This booking already has a confirmed replacement.' using errcode = '23505';
  end if;

  if v_booking.session_id is not null then
    if v_session.id is null then
      raise exception 'This HYROX session is unavailable.' using errcode = '23514';
    end if;
    if v_session.cancelled_at is not null then
      raise exception 'This HYROX session is cancelled.' using errcode = '23514';
    end if;
    v_start_at := (v_session.session_date + v_session.start_time)
      at time zone 'Asia/Hong_Kong';
  elsif v_booking.hyrox_cycle_id is not null then
    if exists (
      select 1 from public.operational_hyrox_cycles c
       where c.id = v_booking.hyrox_cycle_id
         and c.registration_state = 'cancelled'
    ) then
      raise exception 'This HYROX session is cancelled.' using errcode = '23514';
    end if;
    select min((s.session_date + s.start_time) at time zone 'Asia/Hong_Kong')
      into v_start_at
      from public.operational_hyrox_cycles c
      join public.operational_sessions s
        on s.id in (c.bft_session_id, c.midtown_session_id)
     where c.id = v_booking.hyrox_cycle_id;
  end if;
  if v_start_at is null or v_start_at <= now() then
    raise exception 'This HYROX session has started.' using errcode = '23514';
  end if;

  update public.operational_booking_replacement_requests
     set status = 'expired', decision_reason = 'Invite expired before reuse.'
   where booking_id = v_booking.id
     and status = 'pending'
     and expires_at <= now();
  if exists (
    select 1 from public.operational_booking_replacement_requests r
     where r.booking_id = v_booking.id
       and r.status in ('pending', 'accepted')
  ) then
    raise exception 'A replacement invite is already active for this booking.' using errcode = '23505';
  end if;

  v_expires_at := least(v_start_at, now() + interval '24 hours');
  if p_expires_at is not null and p_expires_at < v_expires_at then
    v_expires_at := p_expires_at;
  end if;
  if v_expires_at <= now() then
    raise exception 'Replacement invite expiry is invalid.' using errcode = '22023';
  end if;

  insert into public.operational_booking_replacement_requests (
    booking_id, original_profile_id, token_hash, expires_at
  ) values (
    v_booking.id, v_uid, trim(p_token_hash), v_expires_at
  ) returning * into v_request;

  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id, actor_profile_id
  ) values (
    v_request.id, v_booking.id, 'created', v_uid, v_uid
  );

  return public.operational_replacement_public(v_request.id);
end;
$$;

revoke all on function public.create_operational_replacement_request(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_operational_replacement_request(uuid, text, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
