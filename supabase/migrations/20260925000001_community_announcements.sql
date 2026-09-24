-- Island Training Club — community announcements + inbox fan-out

create table public.community_announcements (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(btrim(title)) > 0),
  body                text not null check (char_length(btrim(body)) > 0),
  photo_url           text check (photo_url is null or photo_url ~* '^https://'),
  status              text not null default 'published' check (status = 'published'),
  creator_profile_id  uuid not null references public.profiles(id),
  published_at        timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index community_announcements_published_at_idx
  on public.community_announcements (published_at desc);

create function public.community_announcement_preview(p_body text)
returns text
language sql
immutable
set search_path = public
as $$
  with stripped as (
    select btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(p_body, ''), '\*\*|__|\*|_|~~', '', 'g'),
            E'(?m)^\\s*[-*]\\s+',
            '',
            'g'
          ),
          E'(?m)^\\s*\\d+\\.\\s+',
          '',
          'g'
        ),
        E'[\\n\\r]+',
        ' ',
        'g'
      )
    ) as plain
  )
  select case
    when length(plain) > 140 then left(plain, 137) || '…'
    else plain
  end
  from stripped;
$$;

create function public.notify_community_announcement_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text;
  v_preview text;
  v_shared_body text;
begin
  if TG_OP <> 'INSERT' or NEW.status <> 'published' then
    return NEW;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Admin')
    into v_actor_label
    from public.profiles
   where id = NEW.creator_profile_id;
  v_actor_label := coalesce(v_actor_label, 'Admin');
  v_preview := public.community_announcement_preview(NEW.body);
  v_shared_body := NEW.title || ' — ' || v_preview;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select distinct p.id,
         'community_announcement_published',
         NEW.title,
         v_shared_body,
         '#/community/announcements'
    from public.profiles p
    left join public.applications a on a.profile_id = p.id
   where (p.role = 'member' and coalesce(a.community_news, false))
      or p.id = NEW.creator_profile_id;

  insert into public.notifications (profile_id, kind, title, body, destination)
  select p.id,
         'community_announcement_audit',
         'Announcement published',
         format('%s published “%s”.', v_actor_label, NEW.title),
         '#/community/announcements'
    from public.profiles p
   where p.role in ('admin', 'super_admin')
     and p.id <> NEW.creator_profile_id;

  return NEW;
end;
$$;

create trigger community_announcements_notify_published
  after insert on public.community_announcements
  for each row execute function public.notify_community_announcement_published();

alter table public.community_announcements enable row level security;

create policy "approved read published announcements"
  on public.community_announcements for select
  using (
    status = 'published'
    and public.current_user_role() in ('member', 'admin', 'super_admin')
  );

create policy "admin insert announcements"
  on public.community_announcements for insert
  with check (
    public.current_user_role() in ('admin', 'super_admin')
    and creator_profile_id = auth.uid()
  );

create function public.publish_community_announcement(
  p_title text,
  p_body text,
  p_photo_url text default null
)
returns public.community_announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_photo_url text := nullif(btrim(coalesce(p_photo_url, '')), '');
  v_row public.community_announcements;
begin
  select p.role
    into v_role
    from public.profiles p
   where p.id = v_actor;

  if v_actor is null or v_role is null
      or v_role not in ('admin', 'super_admin') then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  if char_length(v_title) = 0 then
    raise exception 'Enter a title' using errcode = '23514';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'Enter announcement body' using errcode = '23514';
  end if;

  if v_photo_url is not null and v_photo_url !~* '^https://' then
    raise exception 'Photo URL must be https' using errcode = '23514';
  end if;

  insert into public.community_announcements (
    title,
    body,
    photo_url,
    creator_profile_id
  ) values (
    v_title,
    v_body,
    v_photo_url,
    v_actor
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on table public.community_announcements from anon;
revoke all on table public.community_announcements from authenticated;
grant select, insert on table public.community_announcements to authenticated;

revoke all on function public.community_announcement_preview(text)
  from public, anon, authenticated;

revoke all on function public.publish_community_announcement(text, text, text)
  from public, anon;
grant execute on function public.publish_community_announcement(text, text, text)
  to authenticated;

-- Forward resolver cases when destination is omitted on insert.
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
  v_price_hkd integer;
  v_requires_rsvp boolean;
begin
  if p_kind = 'operational_booking_reserved' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
      left join public.operational_activity_templates t on t.activity_id = s.activity_id
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at;

    if v_candidate_count = 1 then
      select b.id, b.session_id, s.price_hkd, coalesce(t.requires_rsvp, false)
        into v_booking_id, v_session_id, v_price_hkd, v_requires_rsvp
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
        left join public.operational_activity_templates t on t.activity_id = s.activity_id
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at;
      if v_price_hkd > 0 then
        return '#/pay/' || v_booking_id::text;
      end if;
      if v_price_hkd = 0 or v_requires_rsvp then
        return '#/activity/' || v_session_id;
      end if;
    end if;
    return null;
  end if;

  if p_kind = 'operational_rsvp_confirmed' then
    select count(*)
      into v_candidate_count
      from public.operational_bookings b
      join public.operational_sessions s on s.id = b.session_id
      join public.operational_activity_templates t on t.activity_id = s.activity_id
     where b.profile_id = p_profile_id
       and b.reserved_at = p_created_at
       and s.price_hkd = 0
       and t.requires_rsvp;

    if v_candidate_count = 1 then
      select b.session_id
        into v_session_id
        from public.operational_bookings b
        join public.operational_sessions s on s.id = b.session_id
        join public.operational_activity_templates t on t.activity_id = s.activity_id
       where b.profile_id = p_profile_id
         and b.reserved_at = p_created_at
         and s.price_hkd = 0
         and t.requires_rsvp;
      return '#/activity/' || v_session_id;
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
    when 'community_announcement_published' then '#/community/announcements'
    when 'community_announcement_audit' then '#/community/announcements'
    when 'welcome' then '#/account'
    else null
  end;
end;
$$;

revoke all on function public.resolve_notification_destination(uuid, text, timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
