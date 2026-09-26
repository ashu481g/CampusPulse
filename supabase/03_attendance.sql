-- ============================================================
-- CampusPulse AI — Part 3: Attendance module
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (01_auth.sql and 02_deadlines.sql must already have been run.)
-- ============================================================

-- 1. Subjects --------------------------------------------------
create table if not exists public.att_subjects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 120),
  code         text not null default '' check (char_length(code) <= 30),
  description  text not null default '' check (char_length(description) <= 500),
  created_at   timestamptz not null default now()
);
-- No two subjects with the same name, or the same (non-empty) code, per student.
create unique index if not exists att_subjects_name_uniq on public.att_subjects (user_id, lower(trim(name)));
create unique index if not exists att_subjects_code_uniq on public.att_subjects (user_id, lower(trim(code))) where code <> '';

-- 2. One attendance record per subject per day -----------------
create table if not exists public.att_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id  uuid not null references public.att_subjects(id) on delete cascade,
  date        date not null,
  status      text not null check (status in ('present', 'absent')),
  remarks     text not null default '' check (char_length(remarks) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, subject_id, date)
);
create index if not exists att_records_subject_idx on public.att_records (user_id, subject_id, date);

drop trigger if exists att_records_set_updated_at on public.att_records;
create trigger att_records_set_updated_at
  before update on public.att_records
  for each row execute function public.set_updated_at();   -- defined in 02_deadlines.sql

-- 3. Per-student target (e.g. 75%) -----------------------------
create table if not exists public.att_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  target_percent  numeric(5,2) not null default 75 check (target_percent > 0 and target_percent <= 100)
);

-- 4. Row Level Security ----------------------------------------
alter table public.att_subjects enable row level security;
alter table public.att_records  enable row level security;
alter table public.att_settings enable row level security;

drop policy if exists "own subjects" on public.att_subjects;
drop policy if exists "own records"  on public.att_records;
drop policy if exists "own settings" on public.att_settings;

create policy "own subjects" on public.att_subjects
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- A record may only point at one of the student's OWN subjects.
create policy "own records" on public.att_records
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.att_subjects s
      where s.id = subject_id and s.user_id = (select auth.uid())
    )
  );

create policy "own settings" on public.att_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.att_subjects, public.att_records, public.att_settings from anon, authenticated;
grant select, insert, update, delete on public.att_subjects, public.att_records, public.att_settings to authenticated;
