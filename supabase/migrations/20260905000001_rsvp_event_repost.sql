-- Island Training Club — RSVP event repost support
--
-- Reposting creates a new one-off event and preserves the cancelled source
-- session and its RSVP history. The RSVP flag belongs to the inactive event
-- template so live hydration reconstructs kind = 'rsvp'.

-- Replace the original nine-argument function with the RSVP-aware signature.
drop function if exists public.create_operational_event(text, date, time, integer, text, text, text, integer, integer);

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
  if coalesce(p_requires_rsvp, false) and p_price_hkd <> 0 then
    raise exception 'RSVP events must be free.' using errcode = '22023';
  end if;
  if p_capacity is null and not coalesce(p_requires_rsvp, false) then
    raise exception 'Capacity must be positive.' using errcode = '22023';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise exception 'Capacity must be positive.' using errcode = '22023';
  end if;

  -- Epoch-suffixed id keeps same-named events unique.
  v_activity_id := 'event-' || floor(extract(epoch from now()))::bigint::text;

  insert into public.operational_activity_templates
    (activity_id, name, venue, weekday, start_time, duration_minutes,
     capacity, price_hkd, default_open, active, category, maps_query, requires_rsvp)
  values
    (v_activity_id, btrim(p_name), btrim(p_venue),
     extract(dow from p_session_date)::smallint, p_start_time, p_duration_minutes,
     p_capacity, p_price_hkd, true, false,
     coalesce(nullif(btrim(p_category), ''), 'Other'),
     nullif(btrim(coalesce(p_maps_query, '')), ''),
     coalesce(p_requires_rsvp, false));

  insert into public.operational_sessions
    (id, activity_id, session_date, start_time, duration_minutes,
     venue, capacity, price_hkd, is_open)
  values
    (v_activity_id || '-' || p_session_date::text, v_activity_id, p_session_date,
     p_start_time, p_duration_minutes, btrim(p_venue), p_capacity, p_price_hkd, true)
  returning * into v_session;

  return v_session;
end;
$$;

grant execute on function public.create_operational_event(text, date, time, integer, text, text, text, integer, integer, boolean) to authenticated;
