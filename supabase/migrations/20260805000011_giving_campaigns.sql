-- Island Training Club — Giving campaign management and publication fan-out

create table public.giving_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text not null,
  goal_hkd            integer not null check (goal_hkd > 0),
  fps_id              text not null,
  fps_payee           text not null,
  status              text not null default 'draft'
                        check (status in ('draft', 'published', 'closed')),
  creator_profile_id  uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  published_at        timestamptz,
  closed_at           timestamptz
);

-- The first index states the publication invariant directly. The second is
-- stricter: a Draft and a Published campaign may not coexist.
create unique index giving_campaigns_one_published
  on public.giving_campaigns ((true))
  where (status = 'published');

create unique index giving_campaigns_one_open
  on public.giving_campaigns ((true))
  where (status in ('draft', 'published'));

create trigger giving_campaigns_touch_updated_at
  before update on public.giving_campaigns
  for each row execute function public.touch_updated_at();

create function public.enforce_giving_campaign_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'published' then
      NEW.published_at := now();
      NEW.closed_at := null;
    elsif NEW.status = 'draft' then
      NEW.published_at := null;
      NEW.closed_at := null;
    else
      raise exception 'Giving campaigns cannot be created closed.' using errcode = '23514';
    end if;
    return NEW;
  end if;

  if not (
    (OLD.status = 'draft' and NEW.status in ('draft', 'published')) or
    (OLD.status = 'published' and NEW.status in ('published', 'closed')) or
    (OLD.status = 'closed' and NEW.status = 'closed')
  ) then
    raise exception 'Invalid Giving campaign transition: % to %.', OLD.status, NEW.status
      using errcode = '23514';
  end if;

  if OLD.status = 'closed' then
    if (NEW.title, NEW.description, NEW.goal_hkd, NEW.fps_id, NEW.fps_payee,
        NEW.status, NEW.creator_profile_id, NEW.published_at, NEW.closed_at)
       is distinct from
       (OLD.title, OLD.description, OLD.goal_hkd, OLD.fps_id, OLD.fps_payee,
        OLD.status, OLD.creator_profile_id, OLD.published_at, OLD.closed_at) then
      raise exception 'Closed Giving campaigns are immutable.' using errcode = '23514';
    end if;
    -- The touch trigger runs first by trigger-name order. Preserve the closed
    -- row even for a no-op update.
    NEW.updated_at := OLD.updated_at;
    return NEW;
  end if;

  if OLD.status = 'draft' and NEW.status = 'published' then
    NEW.published_at := now();
    NEW.closed_at := null;
  elsif OLD.status = 'draft' then
    NEW.published_at := null;
    NEW.closed_at := null;
  elsif OLD.status = 'published' and NEW.status = 'published' then
    NEW.published_at := OLD.published_at;
    NEW.closed_at := null;
  elsif OLD.status = 'published' and NEW.status = 'closed' then
    NEW.published_at := OLD.published_at;
    NEW.closed_at := now();
  end if;

  return NEW;
end;
$$;

-- Named after the touch trigger so this trigger runs second and can keep a
-- closed row's updated_at immutable as well.
create trigger giving_campaigns_z_enforce_transition
  before insert or update on public.giving_campaigns
  for each row execute function public.enforce_giving_campaign_transition();

create function public.notify_giving_campaign_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    (TG_OP = 'INSERT' and NEW.status = 'published') or
    (TG_OP = 'UPDATE' and OLD.status = 'draft' and NEW.status = 'published')
  ) then
    return NEW;
  end if;

  insert into public.notifications (profile_id, kind, title, body)
  select id,
         'giving_campaign_published',
         'New Giving campaign',
         'ITC published “' || NEW.title || '”.'
    from public.profiles
   where role in ('member', 'admin', 'super_admin');

  return NEW;
end;
$$;

create trigger giving_campaigns_notify_published
  after insert or update of status on public.giving_campaigns
  for each row execute function public.notify_giving_campaign_published();

alter table public.giving_campaigns enable row level security;

create policy "admin read all giving campaigns"
  on public.giving_campaigns for select
  using (public.current_user_role() in ('admin', 'super_admin'));

create policy "approved member read published"
  on public.giving_campaigns for select
  using (
    public.current_user_role() = 'member'
    and status = 'published'
  );

create policy "admin insert giving campaigns"
  on public.giving_campaigns for insert
  with check (
    public.current_user_role() in ('admin', 'super_admin')
    and creator_profile_id = auth.uid()
  );

create policy "admin update giving campaigns"
  on public.giving_campaigns for update
  using (public.current_user_role() in ('admin', 'super_admin'))
  with check (public.current_user_role() in ('admin', 'super_admin'));

-- Browser clients can read and perform the two admitted mutations through RLS.
-- DELETE intentionally has neither a policy nor a table privilege.
revoke all on table public.giving_campaigns from anon;
revoke all on table public.giving_campaigns from authenticated;
grant select, insert, update on table public.giving_campaigns to authenticated;
