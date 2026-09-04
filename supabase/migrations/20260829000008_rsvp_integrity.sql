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

create table if not exists public.operational_rsvp_counts (
  session_id text primary key
    references public.operational_sessions(id) on delete cascade,
  going_count bigint not null default 0 check (going_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.operational_rsvp_counts enable row level security;

revoke all on table public.operational_rsvp_counts from public, anon, authenticated;
grant select on table public.operational_rsvp_counts to anon, authenticated;

drop policy if exists "public read operational RSVP counts"
  on public.operational_rsvp_counts;
create policy "public read operational RSVP counts"
  on public.operational_rsvp_counts
  for select
  to public
  using (true);

-- Locking the session row serializes count refreshes for concurrent booking
-- mutations. The count is recalculated inside the booking transaction, so a
-- committed count row always describes committed confirmed RSVP bookings.
create or replace function public.recalculate_operational_rsvp_count(
  p_session_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requires_rsvp boolean;
begin
  select t.requires_rsvp
    into v_requires_rsvp
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id
   for update of s;

  if not found or not coalesce(v_requires_rsvp, false) then
    delete from public.operational_rsvp_counts
     where session_id = p_session_id;
    return;
  end if;

  insert into public.operational_rsvp_counts
    (session_id, going_count, updated_at)
  select p_session_id,
         count(*) filter (where b.status = 'confirmed')::bigint,
         now()
    from public.operational_bookings b
   where b.session_id = p_session_id
  on conflict (session_id) do update
    set going_count = excluded.going_count,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.sync_operational_rsvp_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_operational_rsvp_count(new.session_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.recalculate_operational_rsvp_count(old.session_id);
    return old;
  end if;

  if old.session_id = new.session_id then
    perform public.recalculate_operational_rsvp_count(new.session_id);
  elsif old.session_id < new.session_id then
    perform public.recalculate_operational_rsvp_count(old.session_id);
    perform public.recalculate_operational_rsvp_count(new.session_id);
  else
    perform public.recalculate_operational_rsvp_count(new.session_id);
    perform public.recalculate_operational_rsvp_count(old.session_id);
  end if;
  return new;
end;
$$;

revoke all on function public.recalculate_operational_rsvp_count(text) from public, anon, authenticated;
revoke all on function public.sync_operational_rsvp_count() from public, anon, authenticated;

drop trigger if exists sync_operational_rsvp_count on public.operational_bookings;
create trigger sync_operational_rsvp_count
  after insert or update or delete
  on public.operational_bookings
  for each row
  execute function public.sync_operational_rsvp_count();

-- Existing RSVP sessions receive a row even when nobody is going. This makes
-- zero a first-class exact count and backfills confirmed bookings atomically
-- when the migration is applied.
insert into public.operational_rsvp_counts
  (session_id, going_count, updated_at)
select s.id,
       count(b.id) filter (where b.status = 'confirmed')::bigint,
       now()
  from public.operational_sessions s
  join public.operational_activity_templates t
    on t.activity_id = s.activity_id
  left join public.operational_bookings b
    on b.session_id = s.id
 where t.requires_rsvp
 group by s.id
on conflict (session_id) do update
  set going_count = excluded.going_count,
      updated_at = excluded.updated_at;

create or replace function public.get_operational_rsvp_counts()
returns table(session_id text, going_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.session_id, c.going_count
    from public.operational_rsvp_counts c;
$$;

revoke all on function public.get_operational_rsvp_counts() from public;
grant execute on function public.get_operational_rsvp_counts() to anon, authenticated;

-- Count rows contain no member identity and have public SELECT RLS, so all
-- browsers receive the same invalidation even when booking RLS hides the
-- booking mutation that caused it. Guard membership so the undeployed
-- migration can be reapplied by the disposable integration verifier.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'operational_rsvp_counts'
  ) then
    alter publication supabase_realtime add table public.operational_rsvp_counts;
  end if;
end;
$$;

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

  if v_is_rsvp then
    if (v_session.session_date + v_session.start_time)
         at time zone 'Asia/Hong_Kong' <= now() then
      raise exception 'Session has already started.' using errcode = '23514';
    end if;
  elsif v_session.session_date <= (now() at time zone 'Asia/Hong_Kong')::date then
    -- Paid reservations retain the original date cutoff: once the Hong Kong
    -- session date begins, no already-expired payment hold can be created.
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

revoke all on function public.reserve_operational_session(text) from public, anon;
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

revoke all on function public.withdraw_operational_rsvp(uuid) from public, anon;
grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;

notify pgrst, 'reload schema';
