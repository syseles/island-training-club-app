-- Island Training Club — approved-member attendee display names
--
-- Returns only confirmed attendee display labels to approved authenticated
-- members. Anonymous users and pending applicants cannot read booking identity.
-- Contact details and raw booking/profile rows remain private.

create or replace function public.get_operational_attendee_names(
  p_session_id text
)
returns table(display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_is_paid boolean;
begin
  if not coalesce(v_role in ('member', 'admin', 'super_admin'), false) then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  select t.price_hkd > 0
    into v_is_paid
    from public.operational_sessions s
    join public.operational_activity_templates t
      on t.activity_id = s.activity_id
   where s.id = p_session_id;

  if not coalesce(v_is_paid, false) then
    return;
  end if;

  return query
  select coalesce(
           nullif(trim(a.preferred_name), '') || case
             when position(' ' in trim(coalesce(p.full_name, ''))) > 0
               then ' ' || upper(right(trim(p.full_name), 1)) || '.'
             else ''
           end,
           nullif(trim(p.full_name), ''),
           'Member'
         )::text
    from public.operational_bookings b
    join public.profiles p on p.id = b.profile_id
    left join public.applications a on a.profile_id = p.id
   where b.session_id = p_session_id
     and b.status = 'confirmed'
   order by b.created_at, b.id;
end;
$$;

revoke all on function public.get_operational_attendee_names(text)
  from public, anon, authenticated;
grant execute on function public.get_operational_attendee_names(text)
  to authenticated;
