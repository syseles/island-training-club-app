-- Island Training Club — manual HYROX replacement requests
--
-- A replacement request never transfers the booking payer, payment, receipt,
-- session, venue, or allocation. The booking's replacement identity is set
-- only by the Admin decision RPC after an approved member accepts the invite.

create table if not exists public.operational_booking_replacement_requests (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.operational_bookings(id),
  original_profile_id   uuid not null references public.profiles(id),
  replacement_profile_id uuid references public.profiles(id),
  token_hash            text not null unique,
  status                text not null default 'pending'
                          check (status in (
                            'pending', 'accepted', 'declined', 'cancelled',
                            'rejected', 'confirmed', 'expired'
                          )),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  accepted_at           timestamptz,
  accepted_by           uuid references public.profiles(id),
  declined_at           timestamptz,
  declined_by           uuid references public.profiles(id),
  cancelled_at          timestamptz,
  cancelled_by          uuid references public.profiles(id),
  rejected_at           timestamptz,
  rejected_by           uuid references public.profiles(id),
  confirmed_at          timestamptz,
  confirmed_by          uuid references public.profiles(id),
  decision_reason       text,
  check (expires_at > created_at),
  check ((status = 'accepted' and replacement_profile_id is not null and accepted_at is not null and accepted_by is not null)
      or status <> 'accepted'),
  check ((status = 'confirmed' and replacement_profile_id is not null and confirmed_at is not null and confirmed_by is not null)
      or status <> 'confirmed')
);

create index if not exists operational_replacement_booking_idx
  on public.operational_booking_replacement_requests(booking_id, created_at desc);
create index if not exists operational_replacement_status_idx
  on public.operational_booking_replacement_requests(status, expires_at);
create unique index if not exists operational_replacement_one_active_booking
  on public.operational_booking_replacement_requests(booking_id)
  where status in ('pending', 'accepted');

alter table public.operational_bookings
  add column if not exists replacement_profile_id uuid references public.profiles(id),
  add column if not exists replacement_confirmed_at timestamptz,
  add column if not exists replacement_confirmed_by uuid references public.profiles(id);

alter table public.operational_bookings
  drop constraint if exists operational_bookings_replacement_consistency;
alter table public.operational_bookings
  add constraint operational_bookings_replacement_consistency check (
    (replacement_profile_id is null
      and replacement_confirmed_at is null
      and replacement_confirmed_by is null)
    or
    (replacement_profile_id is not null
      and replacement_confirmed_at is not null
      and replacement_confirmed_by is not null)
  );

create table if not exists public.operational_booking_replacement_audit (
  id                    uuid primary key default gen_random_uuid(),
  request_id            uuid not null references public.operational_booking_replacement_requests(id),
  booking_id            uuid not null references public.operational_bookings(id),
  action                text not null check (action in (
                          'created', 'accepted', 'declined', 'cancelled',
                          'rejected', 'confirmed', 'expired'
                        )),
  original_profile_id   uuid not null references public.profiles(id),
  replacement_profile_id uuid references public.profiles(id),
  actor_profile_id      uuid references public.profiles(id),
  reason                text,
  created_at            timestamptz not null default now()
);

create index if not exists operational_replacement_audit_request_idx
  on public.operational_booking_replacement_audit(request_id, created_at desc);

alter table public.operational_booking_replacement_requests enable row level security;
alter table public.operational_booking_replacement_audit enable row level security;

revoke all on table public.operational_booking_replacement_requests
  from public, anon, authenticated;
revoke all on table public.operational_booking_replacement_audit
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------

create or replace function public.operational_replacement_public(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'requestId', r.id,
    'bookingId', r.booking_id,
    'status', r.status,
    'originalDisplayName', coalesce(nullif(trim(oa.preferred_name), ''), nullif(trim(op.full_name), ''), 'ITC member'),
    'replacementDisplayName', coalesce(nullif(trim(ra.preferred_name), ''), nullif(trim(rp.full_name), ''), null),
    'sessionId', b.session_id,
    'cycleId', b.hyrox_cycle_id,
    'snapshot', b.snapshot,
    'createdAt', r.created_at,
    'expiresAt', r.expires_at,
    'acceptedAt', r.accepted_at,
    'declinedAt', r.declined_at,
    'cancelledAt', r.cancelled_at,
    'rejectedAt', r.rejected_at,
    'confirmedAt', r.confirmed_at,
    'decisionReason', r.decision_reason
  )
    from public.operational_booking_replacement_requests r
    join public.operational_bookings b on b.id = r.booking_id
    join public.profiles op on op.id = r.original_profile_id
    left join public.applications oa on oa.profile_id = op.id
    left join public.profiles rp on rp.id = r.replacement_profile_id
    left join public.applications ra on ra.profile_id = rp.id
   where r.id = p_request_id;
$$;

revoke all on function public.operational_replacement_public(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Create and inspect an invite
-- ---------------------------------------------------------------------

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
  if v_booking.status <> 'confirmed'
      or coalesce(v_booking.snapshot ->> 'kind', '') <> 'paid'
      or coalesce(v_booking.snapshot ->> 'name', '') not ilike '%HYROX%' then
    raise exception 'Only a confirmed paid HYROX booking can arrange a replacement.' using errcode = '23514';
  end if;
  if v_booking.replacement_profile_id is not null then
    raise exception 'This booking already has a confirmed replacement.' using errcode = '23505';
  end if;

  if v_booking.session_id is not null then
    select * into v_session
      from public.operational_sessions
     where id = v_booking.session_id;
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

create or replace function public.get_operational_replacement_invite(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_request public.operational_booking_replacement_requests;
  v_public jsonb;
begin
  if auth.uid() is null then
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
  if v_request.status = 'pending' and v_request.expires_at <= now() then
    update public.operational_booking_replacement_requests
       set status = 'expired', decision_reason = 'Invite expired.'
     where id = v_request.id;
    insert into public.operational_booking_replacement_audit (
      request_id, booking_id, action, original_profile_id, actor_profile_id, reason
    ) values (
      v_request.id, v_request.booking_id, 'expired', v_request.original_profile_id,
      auth.uid(), 'Invite expired.'
    );
  end if;
  v_public := public.operational_replacement_public(v_request.id);
  return v_public;
end;
$$;

-- ---------------------------------------------------------------------
-- Member claim, decline, and cancellation
-- ---------------------------------------------------------------------

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
      left join public.operational_sessions other_session on other_session.id = other.session_id
     where other.profile_id = v_uid
       and other.status in ('reserved', 'confirmed')
       and (
         (v_booking.hyrox_cycle_id is not null and other.hyrox_cycle_id = v_booking.hyrox_cycle_id)
         or (other_session.session_date = v_session_date)
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
   where p.role in ('admin', 'super_admin')
     and p.status = 'approved';

  v_public := public.operational_replacement_public(v_request.id);
  return v_public;
end;
$$;

create or replace function public.decline_operational_replacement_request(
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
begin
  if v_uid is null or not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;
  select * into v_request
    from public.operational_booking_replacement_requests
   where token_hash = trim(p_token_hash)
   for update;
  if not found or v_request.status <> 'pending' then
    raise exception 'This replacement invite is no longer available.' using errcode = '23514';
  end if;
  if v_request.expires_at <= now() then
    update public.operational_booking_replacement_requests
       set status = 'expired', decision_reason = 'Invite expired.'
     where id = v_request.id;
    raise exception 'This replacement invite has expired.' using errcode = '23514';
  end if;

  update public.operational_booking_replacement_requests
     set status = 'declined', declined_at = now(), declined_by = v_uid
   where id = v_request.id
  returning * into v_request;
  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id, actor_profile_id
  ) values (v_request.id, v_request.booking_id, 'declined', v_request.original_profile_id, v_uid);
  return public.operational_replacement_public(v_request.id);
end;
$$;

create or replace function public.cancel_operational_replacement_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.operational_booking_replacement_requests;
begin
  select * into v_request
    from public.operational_booking_replacement_requests
   where id = p_request_id
   for update;
  if not found or v_request.original_profile_id <> v_uid then
    raise exception 'Replacement request not found.' using errcode = 'P0002';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Only an unclaimed replacement invite can be cancelled.' using errcode = '23514';
  end if;
  update public.operational_booking_replacement_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
   where id = v_request.id
  returning * into v_request;
  insert into public.operational_booking_replacement_audit (
    request_id, booking_id, action, original_profile_id, actor_profile_id
  ) values (v_request.id, v_request.booking_id, 'cancelled', v_request.original_profile_id, v_uid);
  return public.operational_replacement_public(v_request.id);
end;
$$;

-- ---------------------------------------------------------------------
-- Admin list and decision
-- ---------------------------------------------------------------------

create or replace function public.list_operational_replacement_requests()
returns table (
  request_id uuid,
  booking_id uuid,
  status text,
  original_display_name text,
  replacement_display_name text,
  session_id text,
  cycle_id text,
  snapshot jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  confirmed_at timestamptz,
  decision_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.operational_is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return query
  select r.id, r.booking_id, r.status,
         coalesce(nullif(trim(oa.preferred_name), ''), nullif(trim(op.full_name), ''), 'ITC member'),
         coalesce(nullif(trim(ra.preferred_name), ''), nullif(trim(rp.full_name), ''), null),
         b.session_id, b.hyrox_cycle_id, b.snapshot, r.created_at, r.expires_at,
         r.accepted_at, r.confirmed_at, r.decision_reason
    from public.operational_booking_replacement_requests r
    join public.operational_bookings b on b.id = r.booking_id
    join public.profiles op on op.id = r.original_profile_id
    left join public.applications oa on oa.profile_id = op.id
    left join public.profiles rp on rp.id = r.replacement_profile_id
    left join public.applications ra on ra.profile_id = rp.id
   where r.status in ('pending', 'accepted', 'confirmed', 'rejected', 'declined', 'cancelled', 'expired')
   order by r.created_at desc;
end;
$$;

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
        left join public.operational_sessions other_session on other_session.id = other.session_id
       where other.profile_id = v_request.replacement_profile_id
         and other.status in ('reserved', 'confirmed')
         and other.id <> v_booking.id
         and (
           (v_booking.hyrox_cycle_id is not null and other.hyrox_cycle_id = v_booking.hyrox_cycle_id)
           or other_session.session_date = v_session_date
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

revoke all on function public.create_operational_replacement_request(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_operational_replacement_invite(text)
  from public, anon, authenticated;
revoke all on function public.accept_operational_replacement_request(text)
  from public, anon, authenticated;
revoke all on function public.decline_operational_replacement_request(text)
  from public, anon, authenticated;
revoke all on function public.cancel_operational_replacement_request(uuid)
  from public, anon, authenticated;
revoke all on function public.list_operational_replacement_requests()
  from public, anon, authenticated;
revoke all on function public.admin_decide_operational_replacement(uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function public.create_operational_replacement_request(uuid, text, timestamptz)
  to authenticated;
grant execute on function public.get_operational_replacement_invite(text)
  to authenticated;
grant execute on function public.accept_operational_replacement_request(text)
  to authenticated;
grant execute on function public.decline_operational_replacement_request(text)
  to authenticated;
grant execute on function public.cancel_operational_replacement_request(uuid)
  to authenticated;
grant execute on function public.list_operational_replacement_requests()
  to authenticated;
grant execute on function public.admin_decide_operational_replacement(uuid, boolean, text)
  to authenticated;
