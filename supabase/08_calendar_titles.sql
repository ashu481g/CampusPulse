-- ============================================================
-- CampusPulse AI — Part 3c: classes from Google Calendar
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (03_attendance.sql must already have been run.) Safe to run again.
--
-- The Attendance page reads a day's classes from the student's Google
-- Calendar in their browser. This table remembers which subject each
-- calendar event name belongs to, so the student only matches it once.
-- subject_id null means "this event is not a class".
-- ============================================================

create table if not exists public.att_calendar_titles (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title_key   text not null check (char_length(title_key) between 1 and 300),
  subject_id  uuid references public.att_subjects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, title_key)
);

alter table public.att_calendar_titles enable row level security;

drop policy if exists "own calendar titles" on public.att_calendar_titles;
-- A choice may only point at one of the student's OWN subjects.
create policy "own calendar titles" on public.att_calendar_titles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (subject_id is null or exists (
      select 1 from public.att_subjects s
      where s.id = subject_id and s.user_id = (select auth.uid())
    ))
  );

revoke all on public.att_calendar_titles from anon, authenticated;
grant select, insert, update, delete on public.att_calendar_titles to authenticated;

notify pgrst, 'reload schema';
