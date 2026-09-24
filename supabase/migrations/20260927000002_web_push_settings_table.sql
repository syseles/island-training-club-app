-- Store web-push hook secret in a private one-row table.
-- Hosted Supabase denies ALTER DATABASE … SET app.web_push_hook_secret.

create schema if not exists private;

create table if not exists private.web_push_settings (
  id          integer primary key default 1 check (id = 1),
  hook_secret text not null,
  hook_url    text,
  updated_at  timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.web_push_settings from public, anon, authenticated;

create or replace function public.request_web_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private
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

  select nullif(s.hook_secret, ''), nullif(s.hook_url, '')
    into v_secret, v_url
    from private.web_push_settings s
   where s.id = 1;

  v_url := coalesce(
    v_url,
    'https://krxbvgyolxvmzgysfjkj.supabase.co/functions/v1/send-web-push'
  );
  if v_secret is null then
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
    return NEW;
end;
$$;

comment on table private.web_push_settings is
  'One-row config for web push hook secret/url. Set via SQL editor; not exposed to clients.';
comment on function public.request_web_push_delivery() is
  'AFTER INSERT fan-out to Edge Function send-web-push. Reads secret from private.web_push_settings.';
