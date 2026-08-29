-- Island Training Club — assigned collector payout read seam
--
-- Keep collector_payout_profiles under its existing self/Admin RLS. Approved
-- callers use this narrow function to hydrate payout details only for profiles
-- that have appeared in collector_assignments.

create or replace function public.get_assigned_collector_payout_profiles()
returns table (
  profile_id uuid,
  payme_link text,
  fps_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  v_role := public.current_user_role();
  if v_role is null or v_role not in ('member', 'admin', 'super_admin') then
    raise exception 'Approved membership required.' using errcode = '42501';
  end if;

  return query
  select distinct
    payout.profile_id,
    payout.payme_link,
    payout.fps_phone
  from public.collector_assignments as assignment
  join public.collector_payout_profiles as payout
    on payout.profile_id = assignment.collector_profile_id;
end;
$$;

revoke all on function public.get_assigned_collector_payout_profiles() from public;
revoke all on function public.get_assigned_collector_payout_profiles() from anon;
grant execute on function public.get_assigned_collector_payout_profiles() to authenticated;
