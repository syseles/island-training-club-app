-- Island Training Club — contribution-sensitive RSVP count locking
--
-- Forward-only correction after 20260829000008_rsvp_integrity.sql. Paid and
-- non-contributing booking updates no longer enter the RSVP serializer. Exact
-- RSVP recounts serialize on per-session advisory transaction locks so session
-- row lock upgrades cannot deadlock payment operations.

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
  -- Classify without taking a session tuple lock. Non-RSVP sessions never
  -- enter the advisory serializer.
  select coalesce(t.requires_rsvp, false)
    into v_requires_rsvp
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not found or not v_requires_rsvp then
    delete from public.operational_rsvp_counts
     where session_id = p_session_id;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('operational_rsvp_count'),
    hashtext(p_session_id)
  );

  -- Recheck classification after waiting so a concurrent template/session
  -- change cannot leave a stale aggregate row.
  select coalesce(t.requires_rsvp, false)
    into v_requires_rsvp
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not found or not v_requires_rsvp then
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
declare
  v_candidates text[] := array[]::text[];
  v_rsvp_sessions text[];
  v_session_id text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'confirmed' then
      v_candidates := array_append(v_candidates, new.session_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.status = 'confirmed' then
      v_candidates := array_append(v_candidates, old.session_id);
    end if;
  else
    if old.status = 'confirmed'
        and (new.status <> 'confirmed' or old.session_id is distinct from new.session_id) then
      v_candidates := array_append(v_candidates, old.session_id);
    end if;
    if new.status = 'confirmed'
        and (old.status <> 'confirmed' or old.session_id is distinct from new.session_id) then
      v_candidates := array_append(v_candidates, new.session_id);
    end if;
  end if;

  -- Classify both sides independently. Sorting before recalculation gives
  -- opposing RSVP session moves the same advisory-lock order.
  select array_agg(distinct candidate.session_id order by candidate.session_id)
    into v_rsvp_sessions
    from unnest(v_candidates) as candidate(session_id)
    join public.operational_sessions s on s.id = candidate.session_id
    join public.operational_activity_templates t on t.activity_id = s.activity_id
   where t.requires_rsvp;

  foreach v_session_id in array coalesce(v_rsvp_sessions, array[]::text[])
  loop
    perform public.recalculate_operational_rsvp_count(v_session_id);
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.recalculate_operational_rsvp_count(text)
  from public, anon, authenticated;
revoke all on function public.sync_operational_rsvp_count()
  from public, anon, authenticated;

drop trigger if exists sync_operational_rsvp_count
  on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_insert
  on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_delete
  on public.operational_bookings;
drop trigger if exists sync_operational_rsvp_count_update
  on public.operational_bookings;

create trigger sync_operational_rsvp_count_insert
  after insert
  on public.operational_bookings
  for each row
  when (new.status = 'confirmed')
  execute function public.sync_operational_rsvp_count();

create trigger sync_operational_rsvp_count_delete
  after delete
  on public.operational_bookings
  for each row
  when (old.status = 'confirmed')
  execute function public.sync_operational_rsvp_count();

create trigger sync_operational_rsvp_count_update
  after update of status, session_id
  on public.operational_bookings
  for each row
  when (
    (
      old.status = 'confirmed'
      and (
        new.status <> 'confirmed'
        or old.session_id is distinct from new.session_id
      )
    )
    or
    (
      new.status = 'confirmed'
      and (
        old.status <> 'confirmed'
        or old.session_id is distinct from new.session_id
      )
    )
  )
  execute function public.sync_operational_rsvp_count();

-- Remove stale rows for sessions that are no longer RSVP-backed, then rebuild
-- every current RSVP session from authoritative confirmed bookings. LEFT JOIN
-- preserves exact zero rows.
delete from public.operational_rsvp_counts c
 where not exists (
   select 1
     from public.operational_sessions s
     join public.operational_activity_templates t
       on t.activity_id = s.activity_id
    where s.id = c.session_id
      and t.requires_rsvp
 );

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

-- Reassert the identity-free read boundary without changing booking RLS or
-- granting any browser write/helper access.
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

notify pgrst, 'reload schema';
