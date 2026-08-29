-- Island Training Club — exact RSVP totals and RSVP integrity
--
-- Publishes identity-free confirmed RSVP totals despite booking RLS, limits
-- zero-price reservation/withdrawal to templates that explicitly require an
-- RSVP, and compares session starts at the Hong Kong wall-clock boundary.
--
-- Depends on 20260829000004_uncapped_rsvp.sql.

-- =====================================================================
-- Public, identity-free RSVP totals
-- =====================================================================

create or replace function public.get_operational_rsvp_counts()
returns table(session_id text, going_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.session_id, count(*)::bigint
    from public.operational_bookings b
    join public.operational_sessions s on s.id = b.session_id
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where t.requires_rsvp
     and b.status = 'confirmed'
   group by b.session_id;
$$;

revoke all on function public.get_operational_rsvp_counts() from public;
grant execute on function public.get_operational_rsvp_counts() to anon, authenticated;

-- =====================================================================
-- Reservation: paid sessions or explicitly configured zero-price RSVPs
-- =====================================================================

create or replace function public.reserve_operational_session(
  p_session_id text
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_session public.operational_sessions;
  v_template_name text;
  v_requires_rsvp boolean;
  v_is_rsvp boolean;
  v_active_count integer;
  v_existing uuid;
  v_deadline timestamptz;
  v_booking public.operational_bookings;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  -- Lock the session row to serialize duplicate and capacity decisions.
  select * into v_session
    from public.operational_sessions
   where id = p_session_id
     for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select t.name, t.requires_rsvp
    into v_template_name, v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if not v_session.is_open then
    raise exception 'Session is not open.' using errcode = '23514';
  end if;

  v_is_rsvp := v_session.price_hkd = 0 and coalesce(v_requires_rsvp, false);
  if v_session.price_hkd = 0 and not v_is_rsvp then
    raise exception 'Session does not require RSVP.' using errcode = '23514';
  end if;

  if (v_session.session_date + v_session.start_time)
       at time zone 'Asia/Hong_Kong' <= now() then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  -- One active booking per member per session.
  select id into v_existing
    from public.operational_bookings
   where profile_id = v_uid
     and session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_existing is not null then
    raise exception 'Already booked.' using errcode = '23514';
  end if;

  select count(*) into v_active_count
    from public.operational_bookings
   where session_id = p_session_id
     and status in ('reserved', 'confirmed');
  if v_session.capacity is not null and v_active_count >= v_session.capacity then
    raise exception 'Session is full.' using errcode = '23514';
  end if;

  -- Paid sessions retain their Thursday checkpoint. RSVP rows confirm and
  -- complete immediately because no payment is involved.
  v_deadline := case when v_is_rsvp
    then now()
    else (v_session.session_date - interval '2 days')::date + time '15:59'
  end;

  insert into public.operational_bookings
    (profile_id, session_id, status, reserved_at, pay_deadline_at, paid_at, snapshot)
  values
    (v_uid, p_session_id,
     case when v_is_rsvp then 'confirmed' else 'reserved' end,
     now(), v_deadline,
     case when v_is_rsvp then now() else null end,
     jsonb_build_object(
       'name', coalesce(v_template_name, v_session.activity_id),
       'session_date', v_session.session_date,
       'start_time', v_session.start_time,
       'venue', v_session.venue,
       'price_hkd', v_session.price_hkd
     ))
  returning * into v_booking;

  insert into public.notifications (profile_id, kind, title, body)
  values (v_uid,
          case when v_is_rsvp then 'operational_rsvp_confirmed' else 'operational_booking_reserved' end,
          case when v_is_rsvp then 'You''re in' else 'Booking reserved' end,
          case when v_is_rsvp
            then 'You''re on the list for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. Everyone pays their own bill — see you there.'
            else 'You have a reserved spot for ' || coalesce(v_template_name, v_session.activity_id)
              || ' on ' || v_session.session_date::text
              || '. Pay by ' || v_deadline::text || '.'
          end);

  return v_booking;
end;
$$;

grant execute on function public.reserve_operational_session(text) to authenticated;

-- =====================================================================
-- Withdrawal: own confirmed RSVP before its Hong Kong start only
-- =====================================================================

create or replace function public.withdraw_operational_rsvp(
  p_booking_id uuid
)
returns public.operational_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_requires_rsvp boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found or v_booking.profile_id <> v_uid then
    raise exception 'RSVP not found.' using errcode = 'P0002';
  end if;

  select * into v_session
    from public.operational_sessions
   where id = v_booking.session_id;

  select t.requires_rsvp into v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  if v_session.price_hkd <> 0
      or not coalesce(v_requires_rsvp, false)
      or v_booking.status <> 'confirmed' then
    raise exception 'Only your own confirmed RSVP can be withdrawn.'
      using errcode = '23514';
  end if;

  if (v_session.session_date + v_session.start_time)
       at time zone 'Asia/Hong_Kong' <= now() then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'cancelled'
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;

notify pgrst, 'reload schema';
