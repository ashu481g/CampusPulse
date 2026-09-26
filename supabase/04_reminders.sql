-- ============================================================
-- CampusPulse AI — Part 4: Daily reminders
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (01, 02 and 03 must already have been run.)
--
-- BEFORE RUNNING: check the project ref in section 3 below matches the
-- SUPABASE_URL in your js/config.js.
-- ============================================================

-- 1. Each student's reminder settings --------------------------
create table if not exists public.reminder_settings (
  user_id             uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled             boolean  not null default false,
  send_hour           smallint not null default 7 check (send_hour between 0 and 23),   -- India time (IST)
  days_ahead          smallint not null default 3 check (days_ahead between 1 and 14),
  include_attendance  boolean  not null default true,
  skip_empty          boolean  not null default true,
  -- written only by the reminder function:
  last_sent_on        date,
  last_status         text     not null default '',
  updated_at          timestamptz not null default now()
);

drop trigger if exists reminder_settings_set_updated_at on public.reminder_settings;
create trigger reminder_settings_set_updated_at
  before update on public.reminder_settings
  for each row execute function public.set_updated_at();

alter table public.reminder_settings enable row level security;

drop policy if exists "own reminder settings" on public.reminder_settings;
create policy "own reminder settings" on public.reminder_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Students may change their preferences, but not the send log.
revoke all on public.reminder_settings from anon, authenticated;
grant select on public.reminder_settings to authenticated;
grant insert (enabled, send_hour, days_ahead, include_attendance, skip_empty) on public.reminder_settings to authenticated;
grant update (enabled, send_hour, days_ahead, include_attendance, skip_empty) on public.reminder_settings to authenticated;

-- 2. Extensions for scheduling and outgoing HTTP ---------------
--    (If either line errors, enable "pg_cron" and "pg_net" under
--     Database -> Extensions, then run this file again.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3. Secrets kept in Vault (never in plain SQL or code) --------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reminders_url') then
    perform vault.create_secret(
      'https://yoyjdwvmpuyllzfsfisl.supabase.co/functions/v1/daily-reminders',   -- <- your project ref
      'reminders_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'reminders_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'reminders_cron_secret');
  end if;
end $$;

-- The reminder function uses this to confirm a call really came from the scheduler.
create or replace function public.reminders_check_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'reminders_cron_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.reminders_check_secret(text) from public, anon, authenticated;
grant execute on function public.reminders_check_secret(text) to service_role;

-- 4. Run every hour at :00 India time (:30 UTC) ----------------
--    The function then emails the students whose chosen hour it is.
select cron.unschedule('campuspulse-daily-reminders')
where exists (select 1 from cron.job where jobname = 'campuspulse-daily-reminders');

select cron.schedule(
  'campuspulse-daily-reminders',
  '30 * * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_secret')),
    body    := '{"mode":"scheduled"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

-- ------------------------------------------------------------
-- Checking it later (run manually):
--   recent scheduler runs:
--     select * from cron.job_run_details order by start_time desc limit 5;
--   what the function answered:
--     select id, status_code, content, created from net._http_response order by created desc limit 5;
--   fix a wrong URL:
--     select vault.update_secret(
--       (select id from vault.secrets where name = 'reminders_url'),
--       'https://<correct-ref>.supabase.co/functions/v1/daily-reminders');
-- ------------------------------------------------------------
