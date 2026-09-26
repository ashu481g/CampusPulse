-- ============================================================
-- CampusPulse AI — Part 6: Deadlines pulled from your email
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (01–05 must already have been run.)
-- ============================================================

-- 1. Deadlines the AI found in emails, waiting for the student to review.
create table if not exists public.email_suggestions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  source         text not null check (source in ('gmail', 'paste')),
  message_id     text,                          -- Gmail message id (null for pasted text)
  email_subject  text not null default '',
  email_from     text not null default '',
  email_date     timestamptz,
  title          text not null check (char_length(title) between 1 and 200),
  category       text not null default 'other'
                 check (category in ('assignment', 'quiz', 'exam', 'case_competition', 'placement', 'other')),
  course         text not null default '',
  due_at         timestamptz not null,
  time_given     boolean not null default true, -- false when the email named a date but no time
  link           text not null default '',
  notes          text not null default '',
  confidence     text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  deadline_id    uuid references public.deadlines(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists email_suggestions_user_idx on public.email_suggestions (user_id, status, due_at);

-- 2. Gmail messages already read, so a re-scan never analyses (or pays for) them twice.
create table if not exists public.email_processed (
  user_id       uuid not null references auth.users(id) on delete cascade,
  message_id    text not null,
  found         integer not null default 0,
  processed_at  timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- 3. Security: students read and review their own rows; only the
--    extract-deadlines function (secret key) creates them.
alter table public.email_suggestions enable row level security;
alter table public.email_processed  enable row level security;

drop policy if exists "own suggestions" on public.email_suggestions;
create policy "own suggestions" on public.email_suggestions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "own processed" on public.email_processed;
create policy "own processed" on public.email_processed
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.email_suggestions, public.email_processed from anon, authenticated;
grant select, delete on public.email_suggestions to authenticated;
grant update (status, deadline_id) on public.email_suggestions to authenticated;
grant select, delete on public.email_processed to authenticated;
