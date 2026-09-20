-- Island Training Club — authoritative unpaid reservation release
--
-- Forward-only RPC after the RSVP locking correction. Owners and operational
-- Admins may release only an unmarked reserved booking. No queue promotion is
-- attempted here; live waitlist behavior remains server-authoritative.

create or replace function public.release_operational_reservation(
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
begin
  if v_uid is null then
    raise exception 'Authentication required.'
      using errcode = '28000';
  end if;

  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.'
      using errcode = '42501';
  end if;

  select *
    into v_booking
    from public.operational_bookings
   where id = p_booking_id
   for update;

  if not found then
    raise exception 'Booking not found.'
      using errcode = 'P0002';
  end if;

  if v_booking.profile_id <> v_uid
      and v_role not in ('admin', 'super_admin') then
    raise exception 'Not authorized for this booking.'
      using errcode = '42501';
  end if;

  if v_booking.status <> 'reserved' then
    raise exception 'Reservation is no longer releasable.'
      using errcode = '23514';
  end if;

  if v_booking.payment_marked_at is not null then
    raise exception 'Payment has already been marked.'
      using errcode = '23514';
  end if;

  update public.operational_bookings
     set status = 'cancelled'
   where id = p_booking_id
     and status = 'reserved'
     and payment_marked_at is null
  returning * into v_booking;

  if not found then
    raise exception 'Reservation changed before it could be released.'
      using errcode = '40001';
  end if;

  return v_booking;
end;
$$;

revoke all on function public.release_operational_reservation(uuid)
  from public, anon, authenticated;
grant execute on function public.release_operational_reservation(uuid)
  to authenticated;

notify pgrst, 'reload schema';
