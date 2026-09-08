-- Island Training Club — Friday HYROX venue-choice and handoff reminders
--
-- Members receive one reminder before venue changes close. The assigned
-- collector receives one aggregate reminder at the close only when the
-- allocation or enabled venue handoff is incomplete.

alter table public.operational_hyrox_cycles
  add column if not exists venue_choice_reminder_sent_at timestamptz,
  add column if not exists venue_finalization_reminder_sent_at timestamptz;

create or replace function public.send_hyrox_venue_reminders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_collector uuid;
  v_incomplete boolean;
  v_sent integer := 0;
begin
  for v_cycle in
    select c.*
      from public.operational_hyrox_cycles c
     where c.registration_state <> 'cancelled'
       and c.venue_choice_deadline_at > c.promoted_payment_deadline_at
       and p_now >= c.venue_choice_deadline_at - interval '2 hours'
       and (
         c.venue_choice_reminder_sent_at is null
         or c.venue_finalization_reminder_sent_at is null
       )
     order by c.session_date, c.id
     for update skip locked
  loop
    if p_now >= v_cycle.venue_choice_deadline_at - interval '2 hours'
       and v_cycle.venue_choice_reminder_sent_at is null then
      insert into public.notifications
        (profile_id, kind, title, body, destination)
      select b.profile_id,
             'operational_hyrox_venue_choice_reminder',
             'HYROX venue changes close at 9 PM HKT',
             'Review your HYROX venue preference before Friday at 9 PM HKT.',
             '#/booking/' || b.id::text
        from public.operational_bookings b
       where b.hyrox_cycle_id = v_cycle.id
         and b.status = 'confirmed'
         and b.allocation_state = 'provisional';

      update public.operational_hyrox_cycles
         set venue_choice_reminder_sent_at = p_now
       where id = v_cycle.id;
      v_cycle.venue_choice_reminder_sent_at := p_now;
      v_sent := v_sent + 1;
    end if;

    if p_now >= v_cycle.venue_choice_deadline_at
       and v_cycle.venue_finalization_reminder_sent_at is null then
      v_incomplete := v_cycle.allocation_closed_at is null
        or exists (
          select 1
            from public.operational_sessions s
           where s.id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)
             and s.cancelled_at is null
             and s.gym_confirmed_at is null
             and ((v_cycle.venue_plan = 'bft_only' and s.id = v_cycle.bft_session_id)
               or (v_cycle.venue_plan = 'both'
                 and s.id in (v_cycle.bft_session_id, v_cycle.midtown_session_id)))
        );

      select ca.collector_profile_id
        into v_collector
        from public.collector_assignments ca
       where ca.week_start <= v_cycle.session_date
       order by ca.week_start desc
       limit 1;

      if v_collector is not null then
        if v_incomplete then
          insert into public.notifications
            (profile_id, kind, title, body, destination)
          values (
            v_collector,
            'operational_hyrox_venue_finalization_reminder',
            'HYROX venue finalization is due',
            'Close the allocation and confirm each enabled venue for ' ||
              v_cycle.session_date::text || ' in Admin at 9 PM HKT.',
            '#/admin/payments'
          );
        end if;

        update public.operational_hyrox_cycles
           set venue_finalization_reminder_sent_at = p_now
         where id = v_cycle.id;
        v_sent := v_sent + 1;
      end if;
    end if;
  end loop;
  return v_sent;
end;
$$;

revoke all on function public.send_hyrox_venue_reminders(timestamptz)
  from public;
grant execute on function public.send_hyrox_venue_reminders(timestamptz)
  to authenticated;
