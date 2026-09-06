-- Island Training Club — automatic pooled HYROX cycle provisioning
--
-- Parent cycles are created automatically for future clean BFT + Midtown
-- Saturdays. Existing legacy weeks with active bookings or queues are left
-- untouched so the controlled cutover cannot orphan member records.

create or replace function public.ensure_hyrox_cycles(
  p_start_date date,
  p_weeks integer default 16
)
returns setof public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_saturday date;
  v_series date;
  v_bft_id text;
  v_midtown_id text;
  v_bft public.operational_sessions;
  v_midtown public.operational_sessions;
  v_registration_opens timestamptz;
  v_payment_deadline timestamptz;
  v_holder_grace_deadline timestamptz;
  v_promoted_payment_deadline timestamptz;
  v_choice_deadline timestamptz;
begin
  if p_weeks is null or p_weeks < 1 or p_weeks > 16 then
    raise exception 'ensure_hyrox_cycles: weeks must be between 1 and 16.'
      using errcode = '22023';
  end if;

  v_first_saturday := p_start_date
    + ((6 - extract(dow from p_start_date)::integer) % 7);

  for v_series in
    select v_first_saturday + (7 * (gs - 1))::integer
      from generate_series(1, p_weeks) gs
  loop
    if v_series < (now() at time zone 'Asia/Hong_Kong')::date then
      continue;
    end if;

    v_bft_id := 'hyrox-bft-' || v_series::text;
    v_midtown_id := 'hyrox-midtown-' || v_series::text;

    select * into v_bft
      from public.operational_sessions
     where id = v_bft_id and session_date = v_series;
    select * into v_midtown
      from public.operational_sessions
     where id = v_midtown_id and session_date = v_series;

    if v_bft.id is null or v_midtown.id is null
        or v_bft.cancelled_at is not null
        or v_midtown.cancelled_at is not null
        or v_bft.capacity <> 20
        or v_midtown.capacity <> 12
        or v_bft.price_hkd is null
        or v_bft.price_hkd <= 0
        or v_midtown.price_hkd is distinct from v_bft.price_hkd then
      continue;
    end if;

    if exists (
      select 1 from public.operational_hyrox_cycles
       where session_date = v_series
    ) then
      continue;
    end if;

    -- A legacy week must be explicitly cleaned before it can be pooled.
    if exists (
      select 1 from public.operational_bookings b
       where b.session_id in (v_bft_id, v_midtown_id)
         and b.status in ('reserved', 'confirmed')
    ) or exists (
      select 1 from public.operational_queue_entries q
       where q.session_id in (v_bft_id, v_midtown_id)
         and q.status = 'active'
    ) then
      continue;
    end if;

    v_registration_opens := ((v_series - 5) + time '18:00')
      at time zone 'Asia/Hong_Kong';
    v_payment_deadline := ((v_series - 2) + time '18:00')
      at time zone 'Asia/Hong_Kong';
    v_holder_grace_deadline := ((v_series - 2) + time '19:00')
      at time zone 'Asia/Hong_Kong';
    v_promoted_payment_deadline := ((v_series - 2) + time '20:00')
      at time zone 'Asia/Hong_Kong';
    v_choice_deadline := ((v_series - 1) + time '21:00')
      at time zone 'Asia/Hong_Kong';

    insert into public.operational_hyrox_cycles (
      id, session_date, bft_session_id, midtown_session_id,
      registration_state, venue_plan, registration_opens_at,
      payment_deadline_at, holder_grace_deadline_at,
      promoted_payment_deadline_at, venue_choice_deadline_at
    ) values (
      'hyrox-pool-' || v_series::text, v_series, v_bft_id, v_midtown_id,
      'draft', 'pending', v_registration_opens,
      v_payment_deadline, v_holder_grace_deadline,
      v_promoted_payment_deadline, v_choice_deadline
    ) on conflict (id) do nothing;
  end loop;

  return query
    select * from public.operational_hyrox_cycles
     where session_date between v_first_saturday
                            and v_first_saturday + (7 * (p_weeks - 1))::integer
     order by session_date, id;
end;
$$;

revoke all on function public.ensure_hyrox_cycles(date, integer)
  from public;
grant execute on function public.ensure_hyrox_cycles(date, integer)
  to anon, authenticated;

notify pgrst, 'reload schema';
