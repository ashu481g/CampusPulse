-- ============================================================
-- CampusPulse AI — Part 5: Case competition tracker
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (01–04 must already have been run.)
-- ============================================================

-- 1. Competitions ----------------------------------------------
create table if not exists public.case_competitions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 150),
  organizer     text not null default '' check (char_length(organizer) <= 150),
  link          text not null default '' check (link = '' or link ~* '^https?://'),
  -- how far you have got: interested -> registered -> submitted -> shortlisted -> finalist
  stage         text not null default 'interested'
                check (stage in ('interested', 'registered', 'submitted', 'shortlisted', 'finalist')),
  -- empty while the competition is still running
  outcome       text check (outcome in ('won', 'not_selected', 'withdrawn')),
  result        text not null default '' check (char_length(result) <= 200),   -- e.g. "2nd place, Rs 50,000"
  team_name     text not null default '' check (char_length(team_name) <= 100),
  team_members  text not null default '' check (char_length(team_members) <= 500),
  notes         text not null default '' check (char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists case_competitions_user_idx on public.case_competitions (user_id, created_at);

drop trigger if exists case_competitions_set_updated_at on public.case_competitions;
create trigger case_competitions_set_updated_at
  before update on public.case_competitions
  for each row execute function public.set_updated_at();

alter table public.case_competitions enable row level security;
drop policy if exists "own competitions" on public.case_competitions;
create policy "own competitions" on public.case_competitions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.case_competitions from anon, authenticated;
grant select, insert, update, delete on public.case_competitions to authenticated;

-- 2. A competition's key dates are ordinary deadlines linked to it,
--    so they appear on the Deadlines page, on Home and in reminder emails.
alter table public.deadlines
  add column if not exists competition_id uuid references public.case_competitions(id) on delete cascade;
create index if not exists deadlines_competition_idx on public.deadlines (competition_id) where competition_id is not null;

-- A deadline may only be linked to one of the student's OWN competitions.
drop policy if exists "own deadlines" on public.deadlines;
create policy "own deadlines" on public.deadlines
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      competition_id is null
      or exists (
        select 1 from public.case_competitions c
        where c.id = competition_id and c.user_id = (select auth.uid())
      )
    )
  );
