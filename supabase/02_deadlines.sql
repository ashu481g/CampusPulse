-- ============================================================
-- CampusPulse AI — Part 2: Assignment & Deadline tracker
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (01_auth.sql must already have been run.)
-- ============================================================

create table if not exists public.deadlines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  category      text not null default 'assignment'
                check (category in ('assignment', 'quiz', 'exam', 'case_competition', 'placement', 'other')),
  course        text not null default '' check (char_length(course) <= 100),
  due_at        timestamptz not null,
  link          text not null default '' check (link = '' or link ~* '^https?://'),
  notes         text not null default '' check (char_length(notes) <= 2000),
  status        text not null default 'pending' check (status in ('pending', 'done')),
  completed_at  timestamptz,
  source        text not null default 'manual' check (source in ('manual', 'email', 'cr')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists deadlines_user_due_idx on public.deadlines (user_id, due_at);

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deadlines_set_updated_at on public.deadlines;
create trigger deadlines_set_updated_at
  before update on public.deadlines
  for each row execute function public.set_updated_at();

-- Row Level Security: each student sees and edits only their own deadlines.
alter table public.deadlines enable row level security;

drop policy if exists "own deadlines" on public.deadlines;
create policy "own deadlines" on public.deadlines
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.deadlines from anon, authenticated;
grant select, insert, update, delete on public.deadlines to authenticated;
