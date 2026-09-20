-- Island Training Club — HYROX payment reminder preferences and collector heads-up
--
-- Member reminders remain in the existing cycle deadline sweep. This migration
-- adds a preference guard around those notifications and gives the assigned
-- collector a separate, idempotent 4 PM aggregate reminder.

alter table public.applications
  add column if not exists hyrox_payment_reminders boolean not null default true;

alter table public.operational_hyrox_cycles
  add column if not exists collector_payment_reminder_sent_at timestamptz;

create or replace function public.suppress_opted_out_hyrox_payment_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.kind = 'operational_hyrox_payment_reminder'
     and exists (
       select 1
         from public.applications a
        where a.profile_id = NEW.profile_id
          and a.hyrox_payment_reminders = false
     ) then
    return null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notifications_respect_hyrox_payment_preference
  on public.notifications;
create trigger notifications_respect_hyrox_payment_preference
  before insert on public.notifications
  for each row execute function public.suppress_opted_out_hyrox_payment_reminder();

revoke all on function public.suppress_opted_out_hyrox_payment_reminder()
  from public;

create or replace function public.send_hyrox_member_payment_reminders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_sent integer := 0;
begin
  for v_cycle in
    select c.*
      from public.operational_hyrox_cycles c
     where c.registration_state <> 'cancelled'
       and c.registration_opens_at <= p_now
       and p_now >= c.payment_deadline_at - interval '2 hours'
       and c.payment_reminder_sent_at is null
     order by c.session_date, c.id
     for update skip locked
  loop
    insert into public.notifications
      (profile_id, kind, title, body, destination)
    select b.profile_id,
           'operational_hyrox_payment_reminder',
           'HYROX payment reminder',
           'Mark payment for ' || v_cycle.session_date::text ||
             ' by Thursday at 6 PM HKT.',
           '#/pay/' || b.id::text
      from public.operational_bookings b
     where b.hyrox_cycle_id = v_cycle.id
       and b.status = 'reserved'
       and b.payment_marked_at is null
       and b.promoted_from_waitlist_at is null;

    update public.operational_hyrox_cycles
       set payment_reminder_sent_at = p_now
     where id = v_cycle.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

revoke all on function public.send_hyrox_member_payment_reminders(timestamptz)
  from public;
grant execute on function public.send_hyrox_member_payment_reminders(timestamptz)
  to authenticated;

create or replace function public.send_hyrox_collector_payment_reminder(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_collector uuid;
  v_sent integer := 0;
  v_claims integer;
  v_unmarked integer;
  v_waitlist integer;
begin
  for v_cycle in
    select c.*
      from public.operational_hyrox_cycles c
     where c.registration_state <> 'cancelled'
       and c.registration_opens_at <= p_now
       and p_now >= c.payment_deadline_at - interval '2 hours'
       and c.collector_payment_reminder_sent_at is null
     order by c.session_date, c.id
     for update skip locked
  loop
    select ca.collector_profile_id
      into v_collector
      from public.collector_assignments ca
     where ca.week_start <= v_cycle.session_date
     order by ca.week_start desc
     limit 1;

    if v_collector is null then
      continue;
    end if;

    select count(*) filter (where b.payment_marked_at is not null),
           count(*) filter (where b.payment_marked_at is null)
      into v_claims, v_unmarked
      from public.operational_bookings b
     where b.hyrox_cycle_id = v_cycle.id
       and b.status = 'reserved'
       and b.promoted_from_waitlist_at is null;

    select count(*)
      into v_waitlist
      from public.operational_hyrox_queue_entries q
     where q.cycle_id = v_cycle.id
       and q.kind = 'weekly_waitlist'
       and q.status = 'active';

    insert into public.notifications
      (profile_id, kind, title, body, destination)
    values (
      v_collector,
      'operational_hyrox_collector_payment_reminder',
      'HYROX payments due at 6 PM HKT',
      format('%s payment claims, %s unmarked holders, %s weekly waitlist for %s.',
        v_claims, v_unmarked, v_waitlist, v_cycle.session_date),
      '#/admin/payments'
    );

    update public.operational_hyrox_cycles
       set collector_payment_reminder_sent_at = p_now
     where id = v_cycle.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

revoke all on function public.send_hyrox_collector_payment_reminder(timestamptz)
  from public;
grant execute on function public.send_hyrox_collector_payment_reminder(timestamptz)
  to authenticated;
