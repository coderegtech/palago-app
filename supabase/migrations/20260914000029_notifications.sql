-- Phase 12: the notification reaches the passenger.
--
-- The rows have existed since Phase 5 — payment, boarding, loyalty, SOS,
-- discount review and counter sales all write one. What was missing was any way
-- for a passenger to receive it: no realtime, no push. This migration adds both
-- transports. The feed itself is client-side and needed no schema change.
--
--   1. `notifications` joins the realtime publication, so one written while the
--      app is open arrives without a refetch. That matters most when the event
--      happened somewhere else — the test payment page is a public URL, so it is
--      routinely completed in a browser while the app sits on another screen.
--   2. `push_tokens` — one row per device that agreed to receive push.
--   3. A trigger that asks the `send-push` Edge Function to deliver it.
--
-- Delivery is configuration, not schema: the function's URL and shared secret
-- differ per environment, so they live in `app_settings` and start empty. On a
-- database where push has not been configured the trigger does nothing at all —
-- the row is still written and the in-app feed still shows it. Nothing
-- half-works and nothing claims a push was sent that was not.

-- ---------------------------------------------------------------------------
-- Realtime
--
-- INSERT already carries the whole row, and a notification is only ever updated
-- to set `read_at` — by the client that did it, which does not need telling.
-- So no `replica identity full` here: it would double the traffic of a payload
-- that already contains a title and a message.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------------------
-- push_tokens
--
-- A token identifies a device, not a person. The same handset can be signed in
-- as a different passenger tomorrow, so `token` is unique and registering moves
-- the row to the new owner rather than adding a second one — otherwise the
-- previous passenger keeps receiving alerts about a stranger's trip.
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Expo's push token, e.g. ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx].
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.push_tokens is
  'Devices that agreed to receive push. One row per device; registering hands the row to whoever is signed in now.';

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- A device list says where a person can be reached, so only they may read it —
-- not their operator, and not an admin.
create policy "Users read their own devices"
  on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes go through the two functions below, like every other table here.
revoke insert, update, delete on public.push_tokens from anon, authenticated;

create or replace function public.register_push_token(
  p_token text,
  p_platform text,
  p_device_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.push_tokens%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_token is null or length(trim(p_token)) = 0
     or p_platform is null or p_platform not in ('ios', 'android', 'web') then
    raise exception 'VALIDATION_ERROR';
  end if;

  insert into public.push_tokens (user_id, token, platform, device_name)
  values (
    v_user_id,
    trim(p_token),
    p_platform,
    nullif(trim(coalesce(p_device_name, '')), '')
  )
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        device_name = coalesce(excluded.device_name, public.push_tokens.device_name),
        last_seen_at = now()
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'registered', true);
end;
$$;

comment on function public.register_push_token is
  'Records this device against the signed-in user, moving it off any previous owner.';

-- Signing out forgets the device. Without this the handset keeps receiving the
-- previous passenger's trip alerts until somebody else signs in on it.
create or replace function public.remove_push_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHORIZED';
  end if;

  delete from public.push_tokens
   where token = trim(coalesce(p_token, ''))
     and user_id = v_user_id;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('removed', v_deleted);
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public, anon;
revoke all on function public.remove_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;
grant execute on function public.remove_push_token(text) to authenticated;

-- ---------------------------------------------------------------------------
-- app_settings
--
-- Deployment configuration that a migration cannot know: where this
-- environment's Edge Functions live, and the secret the push function checks.
--
-- No policy is defined and every client privilege is revoked, so neither a
-- passenger nor an admin can read it through the API. It is reachable from
-- SECURITY DEFINER functions and from the service role key, which lives only on
-- the server. Treat a value here as a secret in the clear: whoever can read the
-- database can read it.
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is
  'Per-environment deployment configuration, set outside the app. Not readable by any client.';

alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- Empty on purpose: push is off until somebody deploys the function and sets
-- these. See docs/notifications.md.
insert into public.app_settings (key, value) values
  ('push_webhook_url', ''),
  ('push_webhook_secret', '')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Delivery
--
-- pg_net sends the request out of band: the trigger queues it and returns. That
-- is the important property here. A push that cannot be delivered — Expo down,
-- URL wrong, device token expired — must never roll back the payment, boarding
-- or SOS alert that caused the notification. The row in `notifications` is the
-- record that the event happened; the push is only a second attempt to get
-- someone's attention.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

create or replace function public.deliver_push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from public.app_settings where key = 'push_webhook_url';
  select value into v_secret from public.app_settings where key = 'push_webhook_secret';

  -- Not configured: write the row, say nothing, promise nothing.
  if coalesce(v_url, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-palago-push-secret', coalesce(v_secret, '')
    ),
    body := jsonb_build_object('notificationId', new.id),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

comment on function public.deliver_push_notification is
  'Queues a request to the send-push Edge Function. No-op while push_webhook_url is empty.';

create trigger notifications_deliver_push
  after insert on public.notifications
  for each row execute function public.deliver_push_notification();
