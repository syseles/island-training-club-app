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

-- Existing free one-off events become explicit, uncapped RSVPs. Zero price
-- outside this known event family remains insufficient to enter an RSVP path.
update public.operational_activity_templates
   set requires_rsvp = true,
       capacity = null,
       updated_at = now()
 where activity_id like 'event-%'
   and price_hkd = 0;

-- Existing occurrences inherit the uncapped invariant from every explicit
-- zero-price RSVP template, including recurring rows materialized previously.
update public.operational_sessions s
   set capacity = null
  from public.operational_activity_templates t
 where t.activity_id = s.activity_id
   and t.requires_rsvp
   and t.price_hkd = 0
   and s.price_hkd = 0;

-- Legacy queue rows cannot remain active after an occurrence becomes an
-- explicit RSVP. Future member queue operations are rejected by the RPCs below.
update public.operational_queue_entries q
   set status = 'dissolved',
       resolved_at = now()
  from public.operational_sessions s
  join public.operational_activity_templates t on t.activity_id = s.activity_id
 where q.session_id = s.id
   and q.status = 'active'
   and s.price_hkd = 0
   and t.requires_rsvp;

-- These checks make the free one-off rule authoritative even for trusted SQL
-- writers: free event templates are explicit RSVPs and both rows are uncapped.
alter table public.operational_activity_templates
  drop constraint if exists operational_activity_templates_free_one_off_rsvp_check;
alter table public.operational_activity_templates
  add constraint operational_activity_templates_free_one_off_rsvp_check
  check (activity_id not like 'event-%' or price_hkd <> 0
    or (requires_rsvp and capacity is null));

alter table public.operational_sessions
  drop constraint if exists operational_sessions_free_one_off_uncapped_check;
alter table public.operational_sessions
  add constraint operational_sessions_free_one_off_uncapped_check
  check (activity_id not like 'event-%' or price_hkd <> 0 or capacity is null);

-- Preserve the RSVP-aware ten-argument signature (and its defaulted final
-- argument used by the current nine-argument browser call). Free one-offs
-- normalize to explicit RSVP/null capacity; paid one-offs retain capacity.
create or replace function public.create_operational_event(
  p_name             text,
  p_session_date     date,
  p_start_time       time,
  p_duration_minutes integer,
  p_venue            text,
  p_maps_query       text default null,
  p_category         text default 'Other',
  p_price_hkd        integer default 0,
  p_capacity         integer default 20,
  p_requires_rsvp    boolean default false
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id text;
  v_session public.operational_sessions;
  v_is_free boolean;
begin
  perform public.operational_assert_admin('create_event');

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Event name is required.' using errcode = '22023';
  end if;
  if p_session_date is null or p_session_date < current_date then
    raise exception 'Event date must be today or in the future.' using errcode = '22023';
  end if;
  if p_start_time is null then
    raise exception 'Start time is required.' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'Duration must be positive.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_venue, '')), '') is null then
    raise exception 'Venue is required.' using errcode = '22023';
  end if;
  if p_price_hkd is null or p_price_hkd < 0 then
    raise exception 'Price must be zero (free) or positive.' using errcode = '22023';
  end if;

  v_is_free := p_price_hkd = 0;
  if not v_is_free and coalesce(p_requires_rsvp, false) then
    raise exception 'RSVP events must be free.' using errcode = '22023';
  end if;
  if not v_is_free and (p_capacity is null or p_capacity <= 0) then
    raise exception 'Capacity must be positive.' using errcode = '22023';
  end if;

  v_activity_id := 'event-' || floor(extract(epoch from now()))::bigint::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    (v_activity_id, btrim(p_name), btrim(p_venue),
     extract(dow from p_session_date)::smallint, p_start_time, p_duration_minutes,
     case when v_is_free then null else p_capacity end,
     p_price_hkd, true, false,
     coalesce(nullif(btrim(p_category), ''), 'Other'),
     nullif(btrim(coalesce(p_maps_query, '')), ''),
     v_is_free);

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_activity_id || '-' || p_session_date::text, v_activity_id, p_session_date,
     p_start_time, p_duration_minutes, btrim(p_venue),
     case when v_is_free then null else p_capacity end,
     p_price_hkd, true)
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.create_operational_event(
  text, date, time, integer, text, text, text, integer, integer, boolean
) from public, anon, authenticated;
grant execute on function public.create_operational_event(
  text, date, time, integer, text, text, text, integer, integer, boolean
) to authenticated;

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
-- Queue rejection for explicit free RSVPs
-- =====================================================================

-- Preserve the current leave implementation behind an ungranted compatibility
-- name, matching the existing join wrapper pattern.
do $$
begin
  if to_regprocedure('public.leave_operational_queue_legacy(uuid)') is null then
    alter function public.leave_operational_queue(uuid)
      rename to leave_operational_queue_legacy;
  end if;
end $$;

revoke all on function public.leave_operational_queue_legacy(uuid)
  from public, anon, authenticated;

create or replace function public.join_operational_queue(
  p_session_id text,
  p_kind text
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_is_rsvp boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select s.price_hkd = 0 and coalesce(t.requires_rsvp, false)
    into v_is_rsvp
    from public.operational_sessions s
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where s.id = p_session_id;
  if coalesce(v_is_rsvp, false) then
    raise exception 'RSVP sessions do not use queues.' using errcode = '23514';
  end if;

  return public.join_operational_queue_legacy(p_session_id, p_kind);
end;
$$;

create or replace function public.leave_operational_queue(
  p_entry_id uuid
)
returns public.operational_queue_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := public.current_user_role();
  v_entry public.operational_queue_entries;
  v_is_rsvp boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select * into v_entry
    from public.operational_queue_entries
   where id = p_entry_id
   for update;
  if not found then
    raise exception 'Queue entry not found.' using errcode = 'P0002';
  end if;
  if v_entry.profile_id <> v_uid and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this queue entry.' using errcode = '42501';
  end if;

  select s.price_hkd = 0 and coalesce(t.requires_rsvp, false)
    into v_is_rsvp
    from public.operational_sessions s
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where s.id = v_entry.session_id;
  if coalesce(v_is_rsvp, false) then
    raise exception 'RSVP sessions do not use queues.' using errcode = '23514';
  end if;

  return public.leave_operational_queue_legacy(p_entry_id);
end;
$$;

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
  v_role text := public.current_user_role();
  v_booking public.operational_bookings;
  v_session public.operational_sessions;
  v_requires_rsvp boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;
  if v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
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
    if (v_session.session_date + v_session.start_time)
         at time zone 'Asia/Hong_Kong' <= now() then
      raise exception 'Session has already started.' using errcode = '23514';
    end if;

    update public.operational_sessions
       set cancelled_at = now(),
           cancelled_by = v_uid,
           cancelled_source = 'admin',
           cancel_reason = v_trim_reason
     where id = p_session_id
    returning * into v_session;

    update public.operational_queue_entries
       set status = 'dissolved',
           resolved_at = v_session.cancelled_at
     where session_id = p_session_id
       and status = 'active';

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
    select distinct r.profile_id,
           'operational_session_cancelled',
           'Session cancelled',
           'Session cancelled by ITC — ' || v_trim_reason,
           '#/activity/' || p_session_id,
           v_session.cancelled_at
      from cancelled_rsvps r
      join public.profiles p on p.id = r.profile_id
     where p.role in ('member', 'admin', 'super_admin');

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
    join public.profiles p on p.id = b.profile_id
   where b.session_id = p_session_id
     and b.status = 'cancelled'
     and b.cancellation_source = 'session'
     and b.cancelled_at = v_session.cancelled_at
     and p.role in ('member', 'admin', 'super_admin');

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

-- =====================================================================
-- RSVP-targeted occurrence change notifications
-- =====================================================================

-- This is the latest effective six-argument venue implementation from the
-- WNT/lunch meeting-point migrations, extended in place. Keep the four-
-- argument compatibility wrapper and Tamar validation intact.
create or replace function public.set_session_venue(
  p_session_id text,
  p_location text,
  p_maps_query text,
  p_was_tbc boolean,
  p_meeting_lat double precision,
  p_meeting_lng double precision
)
returns public.operational_session_venue_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id text;
  v_actor uuid := auth.uid();
  v_session public.operational_sessions;
  v_activity_id text;
  v_requires_rsvp boolean := false;
  v_template_name text;
  v_template_maps text;
  v_location text;
  v_maps_query text;
  v_meeting_lat double precision;
  v_meeting_lng double precision;
  v_normalized_location text;
  v_is_wnt_tamar boolean := false;
  v_existing public.operational_session_venue_overrides;
  v_saved public.operational_session_venue_overrides;
  v_changed boolean := false;
  v_effective_changed boolean := false;
  v_before_location text;
  v_before_maps text;
  v_after_location text;
  v_after_maps text;
  v_after_confirmed boolean := false;
  v_destination text;
  v_session_label text;
  v_actor_label text;
begin
  perform public.operational_assert_admin('set_session_venue');

  v_session_id := trim(p_session_id);
  if v_session_id is null or v_session_id = '' then
    raise exception 'Session id is required.' using errcode = '22023';
  end if;

  select s.* into v_session
    from public.operational_sessions s
   where s.id = v_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  v_activity_id := v_session.activity_id;
  if v_activity_id not in ('wnt', 'run', 'water', 'lunch') then
    raise exception 'Activity venue is fixed.' using errcode = '42501';
  end if;

  select coalesce(t.requires_rsvp, false), t.name, t.maps_query
    into v_requires_rsvp, v_template_name, v_template_maps
    from public.operational_activity_templates t
   where t.activity_id = v_activity_id;

  v_location := nullif(trim(p_location), '');
  v_maps_query := nullif(trim(p_maps_query), '');
  v_normalized_location := regexp_replace(
    lower(coalesce(v_location, '')), '\s+', ' ', 'g'
  );
  v_normalized_location := regexp_replace(
    v_normalized_location, '\s*,\s*', ', ', 'g'
  );
  v_is_wnt_tamar := v_activity_id = 'wnt'
    and v_normalized_location in ('tamar park', 'tamar park, admiralty');

  if v_is_wnt_tamar then
    if (p_meeting_lat is null) <> (p_meeting_lng is null)
       or (p_meeting_lat is not null and (
         p_meeting_lat not between -90 and 90
         or p_meeting_lng not between -180 and 180
       )) then
      raise exception 'Meeting point must include valid latitude and longitude.'
        using errcode = '22023';
    end if;
    v_meeting_lat := p_meeting_lat;
    v_meeting_lng := p_meeting_lng;
  else
    v_meeting_lat := null;
    v_meeting_lng := null;
  end if;

  select coalesce(nullif(trim(full_name), ''), email, 'Admin')
    into v_actor_label
    from public.profiles
   where id = v_actor;
  v_actor_label := coalesce(v_actor_label, 'Admin');

  perform pg_advisory_xact_lock(hashtext('set_session_venue'), hashtext(v_session_id));

  select * into v_existing
    from public.operational_session_venue_overrides
   where session_id = v_session_id
   for update;

  if v_existing.session_id is null
     and v_location is null and v_maps_query is null
     and v_meeting_lat is null and v_meeting_lng is null then
    return v_existing;
  end if;

  v_changed := (v_existing.location is distinct from v_location)
    or (v_existing.maps_query is distinct from v_maps_query)
    or (v_existing.meeting_lat is distinct from v_meeting_lat)
    or (v_existing.meeting_lng is distinct from v_meeting_lng);

  if not v_changed and v_existing.session_id is not null then
    return v_existing;
  end if;

  v_before_location := coalesce(v_existing.location, v_session.venue);
  v_before_maps := coalesce(v_existing.maps_query, v_template_maps, v_session.venue);
  v_after_location := coalesce(v_location, v_session.venue);
  v_after_maps := coalesce(v_maps_query, v_template_maps, v_session.venue);
  v_after_confirmed := v_after_location is not null
    and upper(v_after_location) <> 'TBC'
    and v_after_maps is not null
    and upper(v_after_maps) <> 'TBC';
  v_effective_changed := v_before_location is distinct from v_after_location
    or v_before_maps is distinct from v_after_maps
    or v_existing.meeting_lat is distinct from v_meeting_lat
    or v_existing.meeting_lng is distinct from v_meeting_lng;

  insert into public.operational_session_venue_overrides
    (session_id, activity_id, location, maps_query, meeting_lat, meeting_lng,
     set_by, set_at, member_notified_at)
  values
    (v_session_id, v_activity_id, v_location, v_maps_query,
     v_meeting_lat, v_meeting_lng, v_actor, now(),
     case when v_effective_changed then now() else v_existing.member_notified_at end)
  on conflict (session_id) do update
    set location = excluded.location,
        maps_query = excluded.maps_query,
        meeting_lat = excluded.meeting_lat,
        meeting_lng = excluded.meeting_lng,
        set_by = excluded.set_by,
        set_at = excluded.set_at,
        member_notified_at = excluded.member_notified_at
  returning * into v_saved;

  v_destination := '#/activity/' || v_session_id;
  v_session_label := coalesce(v_template_name, v_activity_id)
    || ' on ' || v_session.session_date::text;

  if v_effective_changed and v_requires_rsvp and v_session.price_hkd = 0 then
    insert into public.notifications (profile_id, kind, title, body, destination)
    select distinct b.profile_id,
           'operational_session_venue_updated',
           case when v_after_confirmed then 'Venue confirmed' else 'Venue updated' end,
           case
             when v_after_confirmed then format(
               '%s is at %s. Check the activity page for details.',
               v_session_label, v_after_location
             )
             else format('%s has a venue update. Check the activity page for details.', v_session_label)
           end,
           v_destination
      from public.operational_bookings b
      join public.profiles p on p.id = b.profile_id
     where b.session_id = v_session_id
       and b.status = 'confirmed'
       and (p.role = 'member' or p.id = v_actor);
  end if;

  -- Existing Admin audit fan-out remains independent of the RSVP cohort.
  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'operational_session_venue_updated',
         'Session venue updated',
         case
           when v_location is null and v_maps_query is null then
             format('%s reset the venue for %s to the activity default.', v_actor_label, v_session_id)
           else
             format('%s set the venue for %s to %s.',
                    v_actor_label, v_session_id, coalesce(v_location, 'the activity default'))
         end,
         v_destination
    from public.profiles p
   where p.role in ('admin', 'super_admin')
     and p.id <> v_actor;

  return v_saved;
end;
$$;

create or replace function public.set_session_venue(
  p_session_id text,
  p_location text,
  p_maps_query text,
  p_was_tbc boolean
)
returns public.operational_session_venue_overrides
language sql
security definer
set search_path = public
as $$
  select public.set_session_venue(
    p_session_id, p_location, p_maps_query, p_was_tbc, null, null
  );
$$;

create or replace function public.set_operational_session_time(
  p_session_id text,
  p_time time
)
returns public.operational_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.operational_sessions;
  v_requires_rsvp boolean := false;
begin
  perform public.operational_assert_admin('set_session_time');

  select s.* into v_session
    from public.operational_sessions s
   where s.id = p_session_id
   for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_session.cancelled_at is not null then
    raise exception 'Session is cancelled.' using errcode = '23514';
  end if;
  if v_session.start_time is not distinct from p_time then
    return v_session;
  end if;

  update public.operational_sessions
     set start_time = p_time
   where id = p_session_id
  returning * into v_session;

  select coalesce(t.requires_rsvp, false) into v_requires_rsvp
    from public.operational_activity_templates t
   where t.activity_id = v_session.activity_id;

  if v_requires_rsvp and v_session.price_hkd = 0 then
    insert into public.notifications (profile_id, kind, title, body, destination)
    select distinct b.profile_id,
           'operational_session_time_updated',
           'Event time updated',
           format('%s now starts at %s. Check the activity page for details.',
                  v_session.activity_id, to_char(v_session.start_time, 'HH24:MI')),
           '#/activity/' || p_session_id
      from public.operational_bookings b
      join public.profiles p on p.id = b.profile_id
     where b.session_id = p_session_id
       and b.status = 'confirmed'
       and p.role in ('member', 'admin', 'super_admin');
  end if;

  return v_session;
end;
$$;

revoke all on function public.set_session_venue(
  text, text, text, boolean, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.set_session_venue(
  text, text, text, boolean, double precision, double precision
) to authenticated;
revoke all on function public.set_session_venue(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_session_venue(text, text, text, boolean)
  to authenticated;
revoke all on function public.set_operational_session_time(text, time)
  from public, anon, authenticated;
grant execute on function public.set_operational_session_time(text, time)
  to authenticated;

revoke all on function public.join_operational_queue(text, text)
  from public, anon, authenticated;
revoke all on function public.leave_operational_queue(uuid)
  from public, anon, authenticated;
revoke all on function public.withdraw_operational_rsvp(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_operational_session(text, text)
  from public, anon, authenticated;
revoke all on function public.reopen_operational_rsvp(text)
  from public, anon, authenticated;
grant execute on function public.join_operational_queue(text, text) to authenticated;
grant execute on function public.leave_operational_queue(uuid) to authenticated;
grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;
grant execute on function public.cancel_operational_session(text, text) to authenticated;
grant execute on function public.reopen_operational_rsvp(text) to authenticated;

notify pgrst, 'reload schema';
