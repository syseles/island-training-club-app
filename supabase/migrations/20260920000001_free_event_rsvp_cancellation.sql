-- Island Training Club — recurring free-event RSVP cancellation authority
--
-- Free presentation and RSVP participation are independent: only an explicit
-- requires_rsvp template with a zero-price occurrence enters the RSVP paths.
-- Paid and HYROX-cycle cancellation continue through the existing dispatcher.

-- =====================================================================
-- Schema and recurring templates
-- =====================================================================

alter table public.operational_activity_templates
  drop constraint if exists operational_activity_templates_activity_id_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_activity_id_check
  check (activity_id in ('hyrox-bft', 'hyrox-midtown', 'hyrox-quarry-bay', 'lunch', 'wnt', 'run', 'water')
    or activity_id like 'event-%');

alter table public.operational_bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_source text;

alter table public.operational_bookings
  drop constraint if exists operational_bookings_cancellation_source_check;
alter table public.operational_bookings
  add constraint operational_bookings_cancellation_source_check
  check (cancellation_source is null or cancellation_source in ('member', 'session'))
  not valid;
alter table public.operational_bookings
  validate constraint operational_bookings_cancellation_source_check;

insert into public.operational_activity_templates
  (activity_id, name, venue, weekday, start_time, duration_minutes,
   capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
values
  ('wnt', 'Wednesday Night Training', 'TBC', 3, '19:30', 60,
   null, 0, true, true, 'Strength', null, true),
  ('run', 'ITC Run Club', 'TBC', 1, '19:30', 45,
   null, 0, true, true, 'Run', null, true),
  ('water', 'ITC Swimming', 'TBC', 2, '19:30', 90,
   null, 0, true, true, 'Water', null, true)
on conflict (activity_id) do update
set name = excluded.name,
    venue = excluded.venue,
    weekday = excluded.weekday,
    start_time = excluded.start_time,
    duration_minutes = excluded.duration_minutes,
    capacity = excluded.capacity,
    price_hkd = excluded.price_hkd,
    default_open = excluded.default_open,
    active = excluded.active,
    category = excluded.category,
    maps_query = excluded.maps_query,
    requires_rsvp = excluded.requires_rsvp,
    updated_at = now();

-- Existing free one-off events become explicit RSVPs. Zero price outside this
-- known event family remains insufficient to enter an RSVP path.
update public.operational_activity_templates
   set requires_rsvp = true,
       updated_at = now()
 where activity_id like 'event-%'
   and price_hkd = 0;

-- Generate each active template on its declared weekday. This preserves the
-- function signature while correcting the historical Saturday-only generator.
create or replace function public.ensure_operational_sessions(
  p_start_date date,
  p_weeks integer default 16
)
returns setof public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_first_occurrence date;
  v_series date;
  v_id text;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 16 then
    raise exception 'ensure_operational_sessions: weeks must be between 1 and 16.'
      using errcode = '22023';
  end if;

  for v_template in
    select *
      from public.operational_activity_templates
     where active
     order by activity_id
  loop
    v_first_occurrence := p_start_date
      + ((v_template.weekday - extract(dow from p_start_date)::integer + 7) % 7);

    for v_series in
      select v_first_occurrence + (7 * gs)::integer
        from generate_series(0, p_weeks - 1) gs
    loop
      v_id := v_template.activity_id || '-' || v_series::text;
      insert into public.operational_sessions
        (id, activity_id, session_date, start_time, duration_minutes,
         venue, capacity, price_hkd, is_open)
      values
        (v_id, v_template.activity_id, v_series, v_template.start_time,
         v_template.duration_minutes, v_template.venue, v_template.capacity,
         v_template.price_hkd, v_template.default_open)
      on conflict (id) do nothing;
    end loop;
  end loop;

  return query
    select s.*
      from public.operational_sessions s
     where s.session_date between p_start_date
       and p_start_date + (7 * p_weeks - 1)
     order by s.session_date, s.activity_id;
end;
$$;

select count(*)
  from public.ensure_operational_sessions(current_date, 16);

-- Ensure newly materialized RSVP occurrences expose a first-class zero count.
insert into public.operational_rsvp_counts (session_id, going_count, updated_at)
select s.id,
       count(b.id) filter (where b.status = 'confirmed')::bigint,
       now()
  from public.operational_sessions s
  join public.operational_activity_templates t on t.activity_id = s.activity_id
  left join public.operational_bookings b on b.session_id = s.id
 where t.requires_rsvp
 group by s.id
on conflict (session_id) do update
  set going_count = excluded.going_count,
      updated_at = excluded.updated_at;

-- Historical source is filled only when the old transaction can be proven by
-- its exact session timestamp, booking update timestamp, and member notice.
with proven_session_cancellations as (
  select b.id, s.cancelled_at
    from public.operational_bookings b
    join public.operational_sessions s on s.id = b.session_id
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where b.status = 'cancelled'
     and b.cancelled_at is null
     and b.cancellation_source is null
     and s.cancelled_at is not null
     and b.updated_at = s.cancelled_at
     and s.price_hkd = 0
     and t.requires_rsvp
     and exists (
       select 1
         from public.notifications n
        where n.profile_id = b.profile_id
          and n.kind = 'operational_session_cancelled_no_defer'
          and n.created_at = s.cancelled_at
     )
)
update public.operational_bookings b
   set cancelled_at = proven.cancelled_at,
       cancellation_source = 'session'
  from proven_session_cancellations proven
 where b.id = proven.id;

-- =====================================================================
-- Member withdrawal
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

  -- Read the owner and session id first, then use the same session-before-
  -- booking lock order as Admin cancellation to avoid lock inversion.
  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id;
  if not found or v_booking.profile_id <> v_uid then
    raise exception 'RSVP not found.' using errcode = 'P0002';
  end if;

  select s.* into v_session
    from public.operational_sessions s
   where s.id = v_booking.session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select * into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;
  if not found or v_booking.profile_id <> v_uid
      or v_booking.session_id <> v_session.id then
    raise exception 'RSVP not found.' using errcode = 'P0002';
  end if;

  select coalesce(t.requires_rsvp, false) into v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  if v_session.price_hkd <> 0
      or not coalesce(v_requires_rsvp, false)
      or v_booking.status <> 'confirmed' then
    raise exception 'Only your own active confirmed RSVP can be withdrawn.'
      using errcode = '23514';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if (v_session.session_date + v_session.start_time)
       at time zone 'Asia/Hong_Kong' <= now() then
    raise exception 'Session has already started.' using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_source = 'member'
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

-- =====================================================================
-- Admin cancellation dispatcher
-- =====================================================================

create or replace function public.cancel_operational_session(
  p_session_id text,
  p_reason text
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.operational_sessions;
  v_requires_rsvp boolean;
  v_is_rsvp boolean;
  v_trim_reason text;
  v_cycle_id text;
begin
  perform public.operational_assert_admin('cancel_session');

  select s.* into v_session
    from public.operational_sessions s
   where s.id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  select coalesce(t.requires_rsvp, false) into v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;
  v_is_rsvp := v_session.price_hkd = 0 and coalesce(v_requires_rsvp, false);

  if v_is_rsvp then
    v_trim_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_trim_reason is null then
      raise exception 'Cancellation reason is required.' using errcode = '22023';
    end if;
    if v_session.cancelled_at is not null then
      raise exception 'Session is already cancelled.' using errcode = '23514';
    end if;

    update public.operational_sessions
       set cancelled_at = now(),
           cancelled_by = v_uid,
           cancelled_source = 'admin',
           cancel_reason = v_trim_reason
     where id = p_session_id
    returning * into v_session;

    with cancelled_rsvps as (
      update public.operational_bookings
         set status = 'cancelled',
             cancelled_at = v_session.cancelled_at,
             cancellation_source = 'session'
       where session_id = p_session_id
         and status = 'confirmed'
      returning profile_id
    )
    insert into public.notifications
      (profile_id, kind, title, body, destination, created_at)
    select distinct profile_id,
           'operational_session_cancelled',
           'Session cancelled',
           'Session cancelled by ITC — ' || v_trim_reason,
           '#/activity/' || p_session_id,
           v_session.cancelled_at
      from cancelled_rsvps;

    return v_session;
  end if;

  select c.id into v_cycle_id
    from public.operational_hyrox_cycles c
   where c.bft_session_id = p_session_id
      or c.midtown_session_id = p_session_id;
  if v_cycle_id is not null then
    raise exception 'Cancel the weekly HYROX cycle instead.' using errcode = '23514';
  end if;

  return public.cancel_operational_session_legacy(p_session_id, p_reason);
end;
$$;

-- =====================================================================
-- Admin reopening
-- =====================================================================

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
  v_recipients uuid[];
begin
  perform public.operational_assert_admin('reopen_rsvp');

  select s.* into v_session
    from public.operational_sessions s
   where s.id = p_session_id
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
  if v_session.price_hkd <> 0 or not coalesce(v_requires_rsvp, false) then
    raise exception 'Only cancelled RSVP events can be reopened.' using errcode = '22023';
  end if;
  if (v_session.session_date + v_session.start_time)
       at time zone 'Asia/Hong_Kong' <= now() then
    raise exception 'The RSVP event has already started.' using errcode = '23514';
  end if;

  select coalesce(array_agg(distinct b.profile_id), array[]::uuid[])
    into v_recipients
    from public.operational_bookings b
   where b.session_id = p_session_id
     and b.status = 'cancelled'
     and b.cancellation_source = 'session'
     and b.cancelled_at = v_session.cancelled_at;

  update public.operational_sessions
     set cancelled_at = null,
         cancelled_by = null,
         cancelled_source = null,
         cancel_reason = null
   where id = p_session_id
  returning * into v_session;

  insert into public.notifications
    (profile_id, kind, title, body, destination)
  select profile_id,
         'operational_rsvp_reopened',
         'RSVP reopened',
         'This session has reopened. RSVP again if you are coming.',
         '#/activity/' || p_session_id
    from unnest(v_recipients) profile_id;

  return v_session;
end;
$$;

revoke all on function public.withdraw_operational_rsvp(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_operational_session(text, text)
  from public, anon, authenticated;
revoke all on function public.reopen_operational_rsvp(text)
  from public, anon, authenticated;
grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;
grant execute on function public.cancel_operational_session(text, text) to authenticated;
grant execute on function public.reopen_operational_rsvp(text) to authenticated;

notify pgrst, 'reload schema';
