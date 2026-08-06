-- Island Training Club — trusted Admin operational notifications
--
-- Notifies every current Admin and Super Admin when an application is first
-- submitted or a supported membership/role transition occurs. Trigger-owned
-- writes keep these operational events aligned with the underlying database
-- changes and out of client control.

create or replace function public.notify_admins_application_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  applicant_name text;
  should_notify boolean := false;
begin
  if TG_OP = 'INSERT' then
    should_notify := NEW.submitted_at is not null;
  elsif TG_OP = 'UPDATE' then
    should_notify := OLD.submitted_at is null and NEW.submitted_at is not null;
  end if;

  if not should_notify then
    return NEW;
  end if;

  select coalesce(nullif(full_name, ''), email, 'A member')
    into applicant_name
    from public.profiles
   where id = NEW.profile_id;

  insert into public.notifications (profile_id, kind, title, body)
  select id,
         'admin_application_submitted',
         'Membership application submitted',
         applicant_name || ' submitted a membership application.'
    from public.profiles
   where role in ('admin', 'super_admin');

  return NEW;
end;
$$;

drop trigger if exists applications_notify_admins_submitted on public.applications;
create trigger applications_notify_admins_submitted
  after insert or update of submitted_at on public.applications
  for each row execute function public.notify_admins_application_submitted();

-- Preserve the existing audit and member welcome behavior while adding an
-- Admin fan-out for the explicitly supported operational transitions.
create or replace function public.record_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_name text;
  actor_name text;
  event_kind text;
  event_title text;
  event_body text;
begin
  if OLD.role is distinct from NEW.role then
    insert into public.role_changes (profile_id, changed_by, old_role, new_role)
    values (NEW.id, auth.uid(), OLD.role, NEW.role);

    if NEW.role = 'member' then
      insert into public.notifications (profile_id, kind, title, body)
      values (
        NEW.id,
        'welcome',
        'Welcome to Island Training Club',
        'Your application has been approved. You can now book sessions and access the member area.'
      );
    end if;

    target_name := coalesce(nullif(NEW.full_name, ''), NEW.email, 'A member');

    select coalesce(nullif(full_name, ''), email, 'An administrator')
      into actor_name
      from public.profiles
     where id = auth.uid();
    actor_name := coalesce(actor_name, 'An administrator');

    event_kind := case
      when OLD.role = 'pending' and NEW.role = 'member' then 'admin_application_approved'
      when OLD.role = 'pending' and NEW.role = 'declined' then 'admin_application_declined'
      when OLD.role = 'member' and NEW.role = 'admin' then 'admin_role_promoted'
      when OLD.role = 'admin' and NEW.role = 'member' then 'admin_role_demoted'
      when OLD.role in ('member', 'admin') and NEW.role = 'pending' then 'admin_membership_revoked'
      else null
    end;

    if event_kind is not null then
      case event_kind
        when 'admin_application_approved' then
          event_title := 'Application approved';
          event_body := target_name || ' was approved by ' || actor_name || '.';
        when 'admin_application_declined' then
          event_title := 'Application declined';
          event_body := target_name || ' was declined by ' || actor_name || '.';
        when 'admin_role_promoted' then
          event_title := 'Member promoted';
          event_body := actor_name || ' promoted ' || target_name || ' from Member to Admin.';
        when 'admin_role_demoted' then
          event_title := 'Admin demoted';
          event_body := actor_name || ' changed ' || target_name || ' from Admin to Member.';
        when 'admin_membership_revoked' then
          event_title := 'Membership revoked';
          event_body := actor_name || ' revoked ' || target_name || '’s member access.';
      end case;

      insert into public.notifications (profile_id, kind, title, body)
      select id, event_kind, event_title, event_body
        from public.profiles
       where role in ('admin', 'super_admin');
    end if;
  end if;

  return NEW;
end;
$$;
