-- Island Training Club — web push delivery (phase 2)
-- Subscriptions + AFTER INSERT hook to Edge Function send-web-push.
-- No offline/asset caching; push-only delivery for WEB_PUSH_OPS allowlist.

create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete to authenticated
  using (profile_id = auth.uid());

revoke all on table public.push_subscriptions from public, anon;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

-- Allowlisted kinds mirror app/js/data.js WEB_PUSH_OPS_KINDS.
-- Venue audit rows use title 'Session venue updated' and are excluded.
create or replace function public.web_push_ops_kind_eligible(p_kind text, p_title text)
returns boolean
language sql
immutable
as $$
  select case
    when p_kind in (
      'operational_booking_reserved',
      'operational_rsvp_confirmed',
      'operational_payment_approved',
      'operational_session_deferred',
      'operational_session_cancelled',
      'operational_session_cancelled_no_defer'
    ) then true
    when p_kind = 'operational_session_venue_updated'
      and p_title in ('Venue confirmed', 'Venue updated') then true
    else false
  end;
$$;

create or replace function public.request_web_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_wants boolean;
  v_has_sub boolean;
begin
  if not public.web_push_ops_kind_eligible(NEW.kind, NEW.title) then
    return NEW;
  end if;

  select coalesce(a.web_push_ops, false) into v_wants
    from public.applications a
   where a.profile_id = NEW.profile_id;
  if not coalesce(v_wants, false) then
    return NEW;
  end if;

  select exists(
    select 1 from public.push_subscriptions s where s.profile_id = NEW.profile_id
  ) into v_has_sub;
  if not v_has_sub then
    return NEW;
  end if;

  v_url := coalesce(
    nullif(current_setting('app.web_push_hook_url', true), ''),
    'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-web-push'
  );
  v_secret := nullif(current_setting('app.web_push_hook_secret', true), '');
  if v_secret is null then
    -- Hook secret not configured yet; skip without failing the inbox write.
    return NEW;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-push-secret', v_secret
    ),
    body := jsonb_build_object('notification_id', NEW.id)
  );
  return NEW;
exception
  when others then
    -- Never block notification insert on push fan-out failures.
    return NEW;
end;
$$;

drop trigger if exists notifications_request_web_push on public.notifications;
create trigger notifications_request_web_push
  after insert on public.notifications
  for each row execute function public.request_web_push_delivery();

revoke all on function public.web_push_ops_kind_eligible(text, text) from public, anon, authenticated;
revoke all on function public.request_web_push_delivery() from public, anon, authenticated;

comment on table public.push_subscriptions is
  'Browser Push API subscriptions for opted-in members (applications.web_push_ops).';
comment on function public.request_web_push_delivery() is
  'AFTER INSERT fan-out to Edge Function send-web-push when kind is allowlisted and web_push_ops is on. Requires app.web_push_hook_secret.';
