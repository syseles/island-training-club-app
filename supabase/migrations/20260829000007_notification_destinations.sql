-- Island Training Club — semantic notification destinations
--
-- Centralizes exact destination assignment at the notifications INSERT
-- boundary. A separate booking-only resolver permits bounded fuzzy matching
-- during historical backfill; historical cancellation routes are never
-- inferred. Valid explicit routes remain authoritative and ambiguous rows
-- keep client-safe semantic fallbacks.

create or replace function public.resolve_notification_destination(
  p_profile_id uuid,
  p_kind text,
  p_created_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate_count bigint;
  v_booking_id uuid;
  v_session_id text;
begin
  if p_kind = 'operational_booking_reserved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at;
      return '#/pay/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_rsvp_confirmed' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at;
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_payment_approved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.paid_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.paid_at = p_created_at;
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_deferred' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.deferred_from_booking_id is not null
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.deferred_from_booking_id is not null
         and b.reserved_at = p_created_at;
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_cancelled_no_defer' then
    select count(*)
      into v_candidate_count
      from (
        select distinct s.id
          from public.operational_sessions s
          join public.operational_bookings b on b.session_id = s.id
         where b.profile_id = p_profile_id
           and s.cancelled_at = p_created_at
      ) candidates;

    if v_candidate_count = 1 then
      select distinct s.id
        into v_session_id
        from public.operational_sessions s
        join public.operational_bookings b on b.session_id = s.id
       where b.profile_id = p_profile_id
         and s.cancelled_at = p_created_at;
      return '#/activity/' || v_session_id;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_cancelled' then
    select count(*)
      into v_candidate_count
      from public.operational_sessions s
     where s.cancelled_at = p_created_at;

    if v_candidate_count = 1 then
      select s.id
        into v_session_id
        from public.operational_sessions s
       where s.cancelled_at = p_created_at;
      return '#/activity/' || v_session_id;
    end if;
    return null;
  end if;

  return case p_kind
    when 'operational_payment_marked' then '#/admin/payments'
    when 'operational_gym_finalized' then '#/admin/payments'
    when 'operational_session_venue_updated' then '#/schedule'
    when 'admin_application_submitted' then '#/admin/approvals'
    when 'admin_application_approved' then '#/admin/members'
    when 'admin_application_declined' then '#/admin/members'
    when 'admin_role_promoted' then '#/admin/members'
    when 'admin_role_demoted' then '#/admin/members'
    when 'admin_membership_revoked' then '#/admin/members'
    when 'admin_role_changed' then '#/admin/members'
    when 'giving_campaign_published' then '#/giving'
    when 'welcome' then '#/account'
    else null
  end;
end;
$$;

create or replace function public.resolve_historical_booking_notification_destination(
  p_profile_id uuid,
  p_kind text,
  p_created_at timestamptz
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate_count bigint;
  v_booking_id uuid;
begin
  if p_kind = 'operational_booking_reserved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.reserved_at between p_created_at - interval '5 seconds'
                             and p_created_at + interval '5 seconds';

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.reserved_at between p_created_at - interval '5 seconds'
                               and p_created_at + interval '5 seconds';
      return '#/pay/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_rsvp_confirmed' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.reserved_at between p_created_at - interval '5 seconds'
                             and p_created_at + interval '5 seconds';

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.reserved_at between p_created_at - interval '5 seconds'
                               and p_created_at + interval '5 seconds';
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_payment_approved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.paid_at between p_created_at - interval '5 seconds'
                         and p_created_at + interval '5 seconds';

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.paid_at between p_created_at - interval '5 seconds'
                           and p_created_at + interval '5 seconds';
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  if p_kind = 'operational_session_deferred' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
     where b.profile_id = p_profile_id
       and b.deferred_from_booking_id is not null
       and b.reserved_at between p_created_at - interval '5 seconds'
                             and p_created_at + interval '5 seconds';

    if v_candidate_count = 1 then
      select b.id
        into v_booking_id
        from public.operational_bookings b
       where b.profile_id = p_profile_id
         and b.deferred_from_booking_id is not null
         and b.reserved_at between p_created_at - interval '5 seconds'
                               and p_created_at + interval '5 seconds';
      return '#/booking/' || v_booking_id::text;
    end if;
    return null;
  end if;

  return null;
end;
$$;

create or replace function public.route_notification_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if left(new.destination, 2) = '#/' then
    return new;
  end if;

  new.destination := public.resolve_notification_destination(
    new.profile_id,
    new.kind,
    new.created_at
  );
  return new;
end;
$$;

drop trigger if exists notifications_route_destination on public.notifications;
create trigger notifications_route_destination
  before insert on public.notifications
  for each row execute function public.route_notification_destination();

revoke all on function public.resolve_notification_destination(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.resolve_historical_booking_notification_destination(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.route_notification_destination()
  from public, anon, authenticated;

with notification_destination_backfill as (
  select n.id,
         case
           when n.kind in (
             'operational_booking_reserved',
             'operational_rsvp_confirmed',
             'operational_payment_approved',
             'operational_session_deferred'
           ) then public.resolve_historical_booking_notification_destination(
             n.profile_id, n.kind, n.created_at
           )
           when n.kind in (
             'operational_session_cancelled_no_defer',
             'operational_session_cancelled'
           ) then null
           else public.resolve_notification_destination(
             n.profile_id, n.kind, n.created_at
           )
         end as destination
    from public.notifications n
   where n.destination is null or left(n.destination, 2) <> '#/'
)
update public.notifications n
   set destination = b.destination
  from notification_destination_backfill b
 where n.id = b.id
   and b.destination is not null;

notify pgrst, 'reload schema';
