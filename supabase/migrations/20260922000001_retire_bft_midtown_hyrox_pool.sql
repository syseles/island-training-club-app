-- Island Training Club — retire the BFT/Midtown pooled HYROX product
--
-- This is an access and mutation boundary, not a data cleanup. Retained pool
-- rows remain available to trusted database operators. Browser roles cannot
-- read or mutate those rows, and no retirement notification is produced.

-- =====================================================================
-- Canonical retirement identity
-- =====================================================================

create or replace function public.operational_is_retired_hyrox_activity(p_activity_id text)
returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(p_activity_id, '') = any (array['hyrox-bft', 'hyrox-midtown']);
$$;

create or replace function public.operational_is_retired_hyrox_session(p_session_id text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.operational_sessions s
    where s.id = p_session_id
      and public.operational_is_retired_hyrox_activity(s.activity_id)
  );
$$;

create or replace function public.operational_is_retired_hyrox_booking(p_booking_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.operational_bookings b
      left join public.operational_sessions s on s.id = b.session_id
     where b.id = p_booking_id
       and (b.hyrox_cycle_id is not null
         or public.operational_is_retired_hyrox_activity(s.activity_id))
  );
$$;

revoke all on function public.operational_is_retired_hyrox_activity(text)
  from public, anon, authenticated;
revoke all on function public.operational_is_retired_hyrox_session(text)
  from public, anon, authenticated;
revoke all on function public.operational_is_retired_hyrox_booking(uuid)
  from public, anon, authenticated;
-- The avatar resolver uses a service-role client and therefore bypasses RLS.
-- Give that service only the session classifier needed to enforce the same
-- exact authoritative boundary before reading attendee identities.
grant execute on function public.operational_is_retired_hyrox_session(text)
  to service_role;

-- RLS evaluates policy functions as the browser role, so the three public
-- classification helpers above cannot be used directly after their required
-- revocation. These policy-only adapters live outside PostgREST's exposed
-- schema and reveal no row data; they only admit or reject the row being
-- evaluated by RLS.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create or replace function private.operational_booking_is_active(p_booking_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not public.operational_is_retired_hyrox_booking(p_booking_id);
$$;

create or replace function private.operational_session_is_active(p_session_id text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not public.operational_is_retired_hyrox_session(p_session_id);
$$;

revoke all on function private.operational_booking_is_active(uuid) from public;
revoke all on function private.operational_session_is_active(text) from public;
grant execute on function private.operational_booking_is_active(uuid) to anon, authenticated;
grant execute on function private.operational_session_is_active(text) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from public.operational_activity_templates
     where activity_id = 'hyrox-bft'
  ) or not exists (
    select 1 from public.operational_activity_templates
     where activity_id = 'hyrox-midtown'
  ) or not exists (
    select 1 from public.operational_activity_templates
     where activity_id = 'hyrox-quarry-bay'
  ) then
    raise exception 'Canonical HYROX templates are incomplete.' using errcode = '23514';
  end if;
  if public.operational_is_retired_hyrox_activity('hyrox-quarry-bay') then
    raise exception 'Island ECC must not be classified as retired.' using errcode = '23514';
  end if;
end;
$$;

update public.operational_activity_templates
   set active = false,
       updated_at = now()
 where activity_id in ('hyrox-bft', 'hyrox-midtown')
   and active;

-- =====================================================================
-- Browser-readable tables and notifications
-- =====================================================================

revoke select on table public.operational_hyrox_cycles from anon, authenticated;
revoke select on table public.operational_hyrox_queue_entries from anon, authenticated;
drop policy if exists "public read HYROX cycles" on public.operational_hyrox_cycles;
drop policy if exists "member read own HYROX cycle queues" on public.operational_hyrox_queue_entries;

drop policy if exists "public read operational templates" on public.operational_activity_templates;
drop policy if exists "admin manage operational templates" on public.operational_activity_templates;
create policy "browser read active operational templates"
  on public.operational_activity_templates for select
  using (activity_id <> all (array['hyrox-bft', 'hyrox-midtown']));
create policy "admin insert active operational templates"
  on public.operational_activity_templates for insert
  with check (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );
create policy "admin update active operational templates"
  on public.operational_activity_templates for update
  using (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  )
  with check (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );
create policy "admin delete active operational templates"
  on public.operational_activity_templates for delete
  using (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );

drop policy if exists "public read operational sessions" on public.operational_sessions;
drop policy if exists "admin manage operational sessions" on public.operational_sessions;
create policy "browser read active operational sessions"
  on public.operational_sessions for select
  using (activity_id <> all (array['hyrox-bft', 'hyrox-midtown']));
create policy "admin insert active operational sessions"
  on public.operational_sessions for insert
  with check (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );
create policy "admin update active operational sessions"
  on public.operational_sessions for update
  using (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  )
  with check (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );
create policy "admin delete active operational sessions"
  on public.operational_sessions for delete
  using (
    public.operational_is_admin()
    and activity_id <> all (array['hyrox-bft', 'hyrox-midtown'])
  );

drop policy if exists "member read own operational bookings" on public.operational_bookings;
drop policy if exists "admin read all operational bookings" on public.operational_bookings;
create policy "browser read active operational bookings"
  on public.operational_bookings for select
  using (
    (profile_id = (select auth.uid()) or public.operational_is_admin())
    and private.operational_booking_is_active(id)
  );

drop policy if exists "member read own operational queue" on public.operational_queue_entries;
drop policy if exists "admin read all operational queue" on public.operational_queue_entries;
create policy "browser read active operational queue"
  on public.operational_queue_entries for select
  using (
    (profile_id = (select auth.uid()) or public.operational_is_admin())
    and private.operational_session_is_active(session_id)
  );

drop policy if exists "member read own operational receipts" on public.operational_receipts;
drop policy if exists "admin read all operational receipts" on public.operational_receipts;
create policy "browser read active operational receipts"
  on public.operational_receipts for select
  using (
    (profile_id = (select auth.uid()) or public.operational_is_admin())
    and private.operational_booking_is_active(booking_id)
  );

create or replace function public.operational_notification_is_retired_hyrox(
  p_kind text,
  p_destination text,
  p_created_at timestamptz,
  p_title text,
  p_body text
)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce(p_kind, '') like 'operational_hyrox\_%' escape '\'
    or exists (
      select 1
        from public.operational_bookings b
       where public.operational_is_retired_hyrox_booking(b.id)
         and p_destination in (
           '#/booking/' || b.id::text,
           '#/pay/' || b.id::text
         )
    )
    or exists (
      select 1
        from public.operational_sessions s
       where public.operational_is_retired_hyrox_activity(s.activity_id)
         and p_destination = '#/activity/' || s.id
    )
    -- Historical generic Admin producers use now() both on the authoritative
    -- payment/gym record and notification. Any retired match wins, including
    -- transactions that also contain active ECC work. Unlike HYROX-only review
    -- notices, unrelated generic notices without provenance remain visible.
    or (
      coalesce(p_kind, '') = 'operational_payment_marked'
      and (
        exists (
          select 1 from public.operational_bookings b
           where b.payment_marked_at = p_created_at
             and public.operational_is_retired_hyrox_booking(b.id)
        )
        -- Rejection clears payment_marked_at; a later claim replaces it.
        -- The historical pooled producer's exact fingerprint and retained
        -- cycle date survive both transitions. This is not free-text parsing:
        -- direct ECC has different title/body and cannot match this branch.
        or exists (
          select 1 from public.operational_hyrox_cycles c
           where p_title = 'HYROX payment claim submitted'
             and p_destination = '#/admin/payments'
             and p_body = 'Review the payment claim for ' || c.session_date::text || '.'
        )
      )
    )
    or (
      coalesce(p_kind, '') = 'operational_gym_finalized'
      and exists (
        select 1 from public.operational_sessions s
         where s.gym_confirmed_at = p_created_at
           and public.operational_is_retired_hyrox_activity(s.activity_id)
      )
    )
    or (
      coalesce(p_kind, '') = 'hyrox_replacement_review'
      and (
        -- The historical producer used now() for both accepted_at and the
        -- generic Admin notification's created_at. A retired match wins when
        -- a transaction produced multiple notices at the same timestamp.
        exists (
          select 1
            from public.operational_booking_replacement_requests r
           where r.accepted_at = p_created_at
             and public.operational_is_retired_hyrox_booking(r.booking_id)
        )
        or not exists (
          select 1
            from public.operational_booking_replacement_requests r
           where r.accepted_at = p_created_at
        )
      )
    );
$$;

revoke all on function public.operational_notification_is_retired_hyrox(
  text, text, timestamptz, text, text
) from public, anon, authenticated;

create or replace function private.operational_notification_is_active(
  p_kind text,
  p_destination text,
  p_created_at timestamptz,
  p_title text,
  p_body text
)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select not public.operational_notification_is_retired_hyrox(
    p_kind, p_destination, p_created_at, p_title, p_body
  );
$$;
revoke all on function private.operational_notification_is_active(
  text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function private.operational_notification_is_active(
  text, text, timestamptz, text, text
) to authenticated;

drop policy if exists "self read notifications" on public.notifications;
drop policy if exists "self mark notification read" on public.notifications;
create policy "self read active notifications"
  on public.notifications for select
  using (
    auth.uid() = profile_id
    and private.operational_notification_is_active(kind, destination, created_at, title, body)
  );
create policy "self mark active notification read"
  on public.notifications for update
  using (
    auth.uid() = profile_id
    and private.operational_notification_is_active(kind, destination, created_at, title, body)
  )
  with check (
    auth.uid() = profile_id
    and private.operational_notification_is_active(kind, destination, created_at, title, body)
  );

-- =====================================================================
-- Provisioning and background jobs
-- =====================================================================

-- Active-template generation remains available, but cannot return retained
-- retired sessions that happen to fall inside the requested date range.
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
       and not public.operational_is_retired_hyrox_activity(activity_id)
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
       and not public.operational_is_retired_hyrox_activity(s.activity_id)
     order by s.session_date, s.activity_id;
end;
$$;

create or replace function public.ensure_hyrox_cycles(
  p_start_date date,
  p_weeks integer default 16
)
returns setof public.operational_hyrox_cycles
language sql
security definer
set search_path = public
as $$
  select c.* from public.operational_hyrox_cycles c where false;
$$;

create or replace function public.schedule_hyrox_cycle(p_cycle_id text)
returns public.operational_hyrox_cycles
language plpgsql
security definer
set search_path = public
as $$
begin
  perform p_cycle_id;
  raise exception 'The BFT/Midtown HYROX pool is retired.' using errcode = '23514';
end;
$$;

create or replace function public.sweep_hyrox_cycle_deadlines(
  p_now timestamptz default now()
)
returns integer
language sql
security definer
set search_path = public
as $$ select 0; $$;

create or replace function public.send_hyrox_member_payment_reminders(p_now timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$ select 0; $$;

create or replace function public.send_hyrox_collector_payment_reminder(p_now timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$ select 0; $$;

create or replace function public.send_hyrox_venue_reminders(p_now timestamptz)
returns integer
language sql
security definer
set search_path = public
as $$ select 0; $$;

-- The generic deadline job retains its direct-session behavior while ignoring
-- every booking and queue row related to the retired pool.
create or replace function public.sweep_operational_deadlines(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
begin
  with expired as (
    update public.operational_bookings b
       set status = 'expired'
     where b.status = 'reserved'
       and b.pay_deadline_at < p_now
       and b.payment_marked_at is null
       and not public.operational_is_retired_hyrox_booking(b.id)
     returning b.id
  )
  select count(*) into v_expired from expired;

  with ranked as (
    select qe.id,
           qe.session_id,
           row_number() over (
             partition by qe.session_id order by qe.joined_at, qe.id
           ) as rn
      from public.operational_queue_entries qe
     where qe.status = 'active'
       and qe.kind = 'waitlist'
       and not public.operational_is_retired_hyrox_session(qe.session_id)
  ),
  promotable as (
    select r.id
      from ranked r
      join public.operational_sessions s on s.id = r.session_id
     where r.rn = 1
       and s.cancelled_at is null
       and s.is_open
       and (select count(*) from public.operational_bookings b
             where b.session_id = r.session_id
               and b.status in ('reserved', 'confirmed')) < s.capacity
  )
  update public.operational_queue_entries qe
     set status = 'promoted', resolved_at = now()
    from promotable p
   where qe.id = p.id;

  return v_expired;
end;
$$;

revoke all on function public.ensure_hyrox_cycles(date, integer)
  from public, anon, authenticated;
revoke all on function public.schedule_hyrox_cycle(text)
  from public, anon, authenticated;
revoke all on function public.sweep_hyrox_cycle_deadlines(timestamptz)
  from public, anon, authenticated;
revoke all on function public.send_hyrox_member_payment_reminders(timestamptz)
  from public, anon, authenticated;
revoke all on function public.send_hyrox_collector_payment_reminder(timestamptz)
  from public, anon, authenticated;
revoke all on function public.send_hyrox_venue_reminders(timestamptz)
  from public, anon, authenticated;

-- =====================================================================
-- Pool-only browser RPCs
-- =====================================================================

revoke execute on function public.reserve_hyrox_cycle(text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.join_hyrox_cycle_waitlist(text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.leave_hyrox_cycle_queue(uuid)
  from public, anon, authenticated;
revoke execute on function public.reject_hyrox_cycle_payment(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.finalize_hyrox_venue_plan(text)
  from public, anon, authenticated;
revoke execute on function public.finalize_hyrox_venue_plan_locked(text, timestamptz, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.select_hyrox_cycle_venue(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.join_hyrox_venue_switch_queue(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.leave_hyrox_venue_switch_queue(uuid)
  from public, anon, authenticated;
revoke execute on function public.close_hyrox_venue_allocation(text)
  from public, anon, authenticated;
revoke execute on function public.cancel_hyrox_cycle(text, text)
  from public, anon, authenticated;
revoke execute on function public.set_operational_midtown_open(text, boolean)
  from public, anon, authenticated;

-- =====================================================================
-- Shared RPC guards
-- =====================================================================

-- Preserve each current implementation behind an owner-only function, then
-- recreate its public signature. This keeps all non-retired behavior and ACLs
-- intact while rejecting retired relationships before side effects. The
-- canonical suffix is _pre_pool_retirement_20260922 (long identifiers are
-- safely truncated by PostgreSQL's 63-byte identifier limit).
do $$
begin
  alter function public.reserve_operational_session(text)
    rename to reserve_operational_session_pre_pool_retirement_20260922;
  alter function public.release_operational_reservation(uuid)
    rename to release_operational_reservation_pre_pool_retirement_20260922;
  alter function public.join_operational_queue(text, text)
    rename to join_operational_queue_pre_pool_retirement_20260922;
  alter function public.leave_operational_queue(uuid)
    rename to leave_operational_queue_pre_pool_retirement_20260922;
  alter function public.mark_operational_payment(uuid, text, text)
    rename to mark_operational_payment_pre_pool_retirement_20260922;
  alter function public.approve_operational_payment(uuid)
    rename to approve_operational_payment_pre_pool_retirement_20260922;
  alter function public.defer_operational_booking(uuid, text)
    rename to defer_operational_booking_pre_pool_retirement_20260922;
  alter function public.withdraw_operational_rsvp(uuid)
    rename to withdraw_operational_rsvp_pre_pool_retirement_20260922;
  alter function public.set_operational_attendance(uuid, boolean)
    rename to set_operational_attendance_pre_pool_retirement_20260922;
  alter function public.cancel_operational_session(text, text)
    rename to cancel_operational_session_pre_pool_retirement_20260922;
  alter function public.set_operational_session_time(text, time)
    rename to set_operational_session_time_pre_pool_retirement_20260922;
  alter function public.set_operational_venue_tbc(text, boolean)
    rename to set_operational_venue_tbc_pre_pool_retirement_20260922;
  alter function public.set_operational_notice(text, text)
    rename to set_operational_notice_pre_pool_retirement_20260922;
  alter function public.finalize_operational_gym(text, text)
    rename to finalize_operational_gym_pre_pool_retirement_20260922;
  alter function public.set_session_venue(
    text, text, text, boolean, double precision, double precision
  ) rename to set_session_venue_pre_pool_retirement_20260922;
  alter function public.get_operational_attendee_names(text)
    rename to get_operational_attendee_names_pre_pool_retirement_20260922;
  alter function public.create_operational_replacement_request(uuid, text, timestamptz)
    rename to create_operational_replacement_request_pre_pool_retirement_20260922;
  alter function public.get_operational_replacement_invite(text)
    rename to get_operational_replacement_invite_pre_pool_retirement_20260922;
  alter function public.accept_operational_replacement_request(text)
    rename to accept_operational_replacement_request_pre_pool_retirement_20260922;
  alter function public.decline_operational_replacement_request(text)
    rename to decline_operational_replacement_request_pre_pool_retirement_20260922;
  alter function public.cancel_operational_replacement_request(uuid)
    rename to cancel_operational_replacement_request_pre_pool_retirement_20260922;
  alter function public.list_operational_replacement_requests()
    rename to list_operational_replacement_requests_pre_pool_retirement_20260922;
  alter function public.admin_decide_operational_replacement(uuid, boolean, text)
    rename to admin_decide_operational_replacement_pre_pool_retirement_20260922;
end;
$$;

revoke all on function public.reserve_operational_session_pre_pool_retirement_20260922(text) from public, anon, authenticated;
revoke all on function public.release_operational_reservation_pre_pool_retirement_20260922(uuid) from public, anon, authenticated;
revoke all on function public.join_operational_queue_pre_pool_retirement_20260922(text, text) from public, anon, authenticated;
revoke all on function public.leave_operational_queue_pre_pool_retirement_20260922(uuid) from public, anon, authenticated;
revoke all on function public.mark_operational_payment_pre_pool_retirement_20260922(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_operational_payment_pre_pool_retirement_20260922(uuid) from public, anon, authenticated;
revoke all on function public.defer_operational_booking_pre_pool_retirement_20260922(uuid, text) from public, anon, authenticated;
revoke all on function public.withdraw_operational_rsvp_pre_pool_retirement_20260922(uuid) from public, anon, authenticated;
revoke all on function public.set_operational_attendance_pre_pool_retirement_20260922(uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_operational_session_pre_pool_retirement_20260922(text, text) from public, anon, authenticated;
revoke all on function public.set_operational_session_time_pre_pool_retirement_20260922(text, time) from public, anon, authenticated;
revoke all on function public.set_operational_venue_tbc_pre_pool_retirement_20260922(text, boolean) from public, anon, authenticated;
revoke all on function public.set_operational_notice_pre_pool_retirement_20260922(text, text) from public, anon, authenticated;
revoke all on function public.finalize_operational_gym_pre_pool_retirement_20260922(text, text) from public, anon, authenticated;
revoke all on function public.set_session_venue_pre_pool_retirement_20260922(text, text, text, boolean, double precision, double precision) from public, anon, authenticated;
revoke all on function public.get_operational_attendee_names_pre_pool_retirement_20260922(text) from public, anon, authenticated;
revoke all on function public.create_operational_replacement_request_pre_pool_retirement_20260922(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_operational_replacement_invite_pre_pool_retirement_20260922(text) from public, anon, authenticated;
revoke all on function public.accept_operational_replacement_request_pre_pool_retirement_20260922(text) from public, anon, authenticated;
revoke all on function public.decline_operational_replacement_request_pre_pool_retirement_20260922(text) from public, anon, authenticated;
revoke all on function public.cancel_operational_replacement_request_pre_pool_retirement_20260922(uuid) from public, anon, authenticated;
revoke all on function public.list_operational_replacement_requests_pre_pool_retirement_20260922() from public, anon, authenticated;
revoke all on function public.admin_decide_operational_replacement_pre_pool_retirement_20260922(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.reserve_operational_session(p_session_id text)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  -- Bypass the historical pooled wrapper so retained same-date pool fixtures
  -- cannot conflict with Island ECC. The preserved legacy implementation is
  -- the authoritative direct-session/RSVP behavior.
  return public.reserve_operational_session_legacy(p_session_id);
end; $$;

create or replace function public.release_operational_reservation(p_booking_id uuid)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.release_operational_reservation_pre_pool_retirement_20260922(p_booking_id);
end; $$;

create or replace function public.join_operational_queue(p_session_id text, p_kind text)
returns public.operational_queue_entries language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.join_operational_queue_pre_pool_retirement_20260922(p_session_id, p_kind);
end; $$;

create or replace function public.leave_operational_queue(p_entry_id uuid)
returns public.operational_queue_entries language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.operational_queue_entries q
     where q.id = p_entry_id
       and public.operational_is_retired_hyrox_session(q.session_id)
  ) then
    raise exception 'Queue entry not found.' using errcode = 'P0002';
  end if;
  return public.leave_operational_queue_pre_pool_retirement_20260922(p_entry_id);
end; $$;

create or replace function public.mark_operational_payment(p_booking_id uuid, p_method text, p_reference text)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.mark_operational_payment_pre_pool_retirement_20260922(p_booking_id, p_method, p_reference);
end; $$;

create or replace function public.approve_operational_payment(p_booking_id uuid)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.approve_operational_payment_pre_pool_retirement_20260922(p_booking_id);
end; $$;

create or replace function public.defer_operational_booking(p_booking_id uuid, p_target_session_id text)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id)
     or public.operational_is_retired_hyrox_session(p_target_session_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.defer_operational_booking_pre_pool_retirement_20260922(p_booking_id, p_target_session_id);
end; $$;

create or replace function public.withdraw_operational_rsvp(p_booking_id uuid)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'RSVP not found.' using errcode = 'P0002';
  end if;
  return public.withdraw_operational_rsvp_pre_pool_retirement_20260922(p_booking_id);
end; $$;

create or replace function public.set_operational_attendance(p_booking_id uuid, p_arrived boolean)
returns public.operational_bookings language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.set_operational_attendance_pre_pool_retirement_20260922(p_booking_id, p_arrived);
end; $$;

create or replace function public.cancel_operational_session(p_session_id text, p_reason text)
returns public.operational_sessions language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.cancel_operational_session_pre_pool_retirement_20260922(p_session_id, p_reason);
end; $$;

create or replace function public.set_operational_session_time(p_session_id text, p_time time)
returns public.operational_sessions language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.set_operational_session_time_pre_pool_retirement_20260922(p_session_id, p_time);
end; $$;

create or replace function public.set_operational_venue_tbc(p_session_id text, p_enabled boolean)
returns public.operational_sessions language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.set_operational_venue_tbc_pre_pool_retirement_20260922(p_session_id, p_enabled);
end; $$;

create or replace function public.set_operational_notice(p_session_id text, p_notice text)
returns public.operational_sessions language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.set_operational_notice_pre_pool_retirement_20260922(p_session_id, p_notice);
end; $$;

create or replace function public.finalize_operational_gym(p_session_id text, p_note text)
returns public.operational_sessions language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.finalize_operational_gym_pre_pool_retirement_20260922(p_session_id, p_note);
end; $$;

create or replace function public.set_session_venue(
  p_session_id text, p_location text, p_maps_query text, p_was_tbc boolean,
  p_meeting_lat double precision, p_meeting_lng double precision
)
returns public.operational_session_venue_overrides language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  return public.set_session_venue_pre_pool_retirement_20260922(
    p_session_id, p_location, p_maps_query, p_was_tbc,
    p_meeting_lat, p_meeting_lng
  );
end; $$;

create or replace function public.get_operational_attendee_names(p_session_id text)
returns table(display_name text) language plpgsql stable security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_session(p_session_id) then
    return;
  end if;
  return query
    select * from public.get_operational_attendee_names_pre_pool_retirement_20260922(p_session_id);
end; $$;

create or replace function public.create_operational_replacement_request(
  p_booking_id uuid, p_token_hash text, p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if public.operational_is_retired_hyrox_booking(p_booking_id) then
    raise exception 'Booking not found.' using errcode = 'P0002';
  end if;
  return public.create_operational_replacement_request_pre_pool_retirement_20260922(
    p_booking_id, p_token_hash, p_expires_at
  );
end; $$;

create or replace function public.get_operational_replacement_invite(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
      from public.operational_booking_replacement_requests r
     where r.token_hash = trim(p_token_hash)
       and public.operational_is_retired_hyrox_booking(r.booking_id)
  ) then
    raise exception 'Replacement invite not found.' using errcode = 'P0002';
  end if;
  return public.get_operational_replacement_invite_pre_pool_retirement_20260922(p_token_hash);
end; $$;

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
  if not found or public.operational_is_retired_hyrox_booking(v_request.booking_id) then
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
       and not public.operational_is_retired_hyrox_booking(other.id)
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

create or replace function public.decline_operational_replacement_request(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
      from public.operational_booking_replacement_requests r
     where r.token_hash = trim(p_token_hash)
       and public.operational_is_retired_hyrox_booking(r.booking_id)
  ) then
    raise exception 'Replacement invite not found.' using errcode = 'P0002';
  end if;
  return public.decline_operational_replacement_request_pre_pool_retirement_20260922(p_token_hash);
end; $$;

create or replace function public.cancel_operational_replacement_request(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1
      from public.operational_booking_replacement_requests r
     where r.id = p_request_id
       and public.operational_is_retired_hyrox_booking(r.booking_id)
  ) then
    raise exception 'Replacement request not found.' using errcode = 'P0002';
  end if;
  return public.cancel_operational_replacement_request_pre_pool_retirement_20260922(p_request_id);
end; $$;

create or replace function public.list_operational_replacement_requests()
returns table (
  request_id uuid, booking_id uuid, status text,
  original_display_name text, replacement_display_name text,
  session_id text, cycle_id text, snapshot jsonb,
  created_at timestamptz, expires_at timestamptz,
  accepted_at timestamptz, confirmed_at timestamptz, decision_reason text
)
language plpgsql stable security definer set search_path = public as $$
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
     and not public.operational_is_retired_hyrox_booking(r.booking_id)
   order by r.created_at desc;
end; $$;

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
  if not found or public.operational_is_retired_hyrox_booking(v_request.booking_id) then
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
        left join public.operational_sessions other_session
          on other_session.id = other.session_id
        left join public.operational_hyrox_cycles other_cycle
          on other_cycle.id = other.hyrox_cycle_id
       where other.profile_id = v_request.replacement_profile_id
         and other.status in ('reserved', 'confirmed')
         and not public.operational_is_retired_hyrox_booking(other.id)
         and other.id <> v_booking.id
         and (
           other_cycle.session_date = v_session_date
           or (
             other_session.session_date = v_session_date
             and other_session.activity_id ilike 'hyrox%'
           )
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

-- Restore only the public shared signatures. Their preserved implementations
-- and every helper remain owner-only.
revoke all on function public.reserve_operational_session(text) from public, anon, authenticated;
revoke all on function public.release_operational_reservation(uuid) from public, anon, authenticated;
revoke all on function public.join_operational_queue(text, text) from public, anon, authenticated;
revoke all on function public.leave_operational_queue(uuid) from public, anon, authenticated;
revoke all on function public.mark_operational_payment(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_operational_payment(uuid) from public, anon, authenticated;
revoke all on function public.defer_operational_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.withdraw_operational_rsvp(uuid) from public, anon, authenticated;
revoke all on function public.set_operational_attendance(uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_operational_session(text, text) from public, anon, authenticated;
revoke all on function public.set_operational_session_time(text, time) from public, anon, authenticated;
revoke all on function public.set_operational_venue_tbc(text, boolean) from public, anon, authenticated;
revoke all on function public.set_operational_notice(text, text) from public, anon, authenticated;
revoke all on function public.finalize_operational_gym(text, text) from public, anon, authenticated;
revoke all on function public.set_session_venue(text, text, text, boolean, double precision, double precision) from public, anon, authenticated;
revoke all on function public.get_operational_attendee_names(text) from public, anon, authenticated;
revoke all on function public.create_operational_replacement_request(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.get_operational_replacement_invite(text) from public, anon, authenticated;
revoke all on function public.accept_operational_replacement_request(text) from public, anon, authenticated;
revoke all on function public.decline_operational_replacement_request(text) from public, anon, authenticated;
revoke all on function public.cancel_operational_replacement_request(uuid) from public, anon, authenticated;
revoke all on function public.list_operational_replacement_requests() from public, anon, authenticated;
revoke all on function public.admin_decide_operational_replacement(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.reserve_operational_session(text) to authenticated;
grant execute on function public.release_operational_reservation(uuid) to authenticated;
grant execute on function public.join_operational_queue(text, text) to authenticated;
grant execute on function public.leave_operational_queue(uuid) to authenticated;
grant execute on function public.mark_operational_payment(uuid, text, text) to authenticated;
grant execute on function public.approve_operational_payment(uuid) to authenticated;
grant execute on function public.defer_operational_booking(uuid, text) to authenticated;
grant execute on function public.withdraw_operational_rsvp(uuid) to authenticated;
grant execute on function public.set_operational_attendance(uuid, boolean) to authenticated;
grant execute on function public.cancel_operational_session(text, text) to authenticated;
grant execute on function public.set_operational_session_time(text, time) to authenticated;
grant execute on function public.set_operational_venue_tbc(text, boolean) to authenticated;
grant execute on function public.set_operational_notice(text, text) to authenticated;
grant execute on function public.finalize_operational_gym(text, text) to authenticated;
grant execute on function public.set_session_venue(text, text, text, boolean, double precision, double precision) to authenticated;
grant execute on function public.get_operational_attendee_names(text) to authenticated;
grant execute on function public.create_operational_replacement_request(uuid, text, timestamptz) to authenticated;
grant execute on function public.get_operational_replacement_invite(text) to authenticated;
grant execute on function public.accept_operational_replacement_request(text) to authenticated;
grant execute on function public.decline_operational_replacement_request(text) to authenticated;
grant execute on function public.cancel_operational_replacement_request(uuid) to authenticated;
grant execute on function public.list_operational_replacement_requests() to authenticated;
grant execute on function public.admin_decide_operational_replacement(uuid, boolean, text) to authenticated;

-- Pool-only functions not covered by the background replacements above stay
-- owner-callable for trusted audit/rollback work, but never browser-callable.
revoke execute on function public.ensure_hyrox_cycles(date, integer) from anon, authenticated;
revoke execute on function public.schedule_hyrox_cycle(text) from anon, authenticated;
revoke execute on function public.sweep_hyrox_cycle_deadlines(timestamptz) from anon, authenticated;
revoke execute on function public.send_hyrox_collector_payment_reminder(timestamptz) from anon, authenticated;
revoke execute on function public.send_hyrox_member_payment_reminders(timestamptz) from anon, authenticated;
revoke execute on function public.send_hyrox_venue_reminders(timestamptz) from anon, authenticated;

notify pgrst, 'reload schema';
