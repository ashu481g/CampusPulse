-- ============================================================
-- CampusPulse AI — Part 3b: several classes per subject per day,
-- with optional class timings.
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (03_attendance.sql must already have been run.) Safe to run again.
--
-- Existing marks become "class 1" of their day, with no time.
-- ============================================================

-- 1. New columns --------------------------------------------------
alter table public.att_records
  add column if not exists class_no   smallint not null default 1,
  add column if not exists start_time time,
  add column if not exists end_time   time;

do $$
declare
  c record;
begin
  -- Class number 1..9 within the day.
  if not exists (select 1 from pg_constraint where conname = 'att_records_class_no_check') then
    alter table public.att_records
      add constraint att_records_class_no_check check (class_no between 1 and 9);
  end if;

  -- If both times are given, the class must end after it starts.
  if not exists (select 1 from pg_constraint where conname = 'att_records_times_check') then
    alter table public.att_records
      add constraint att_records_times_check
      check (start_time is null or end_time is null or end_time > start_time);
  end if;

  -- 2. Replace "one mark per subject per day" with
  --    "one mark per class per subject per day".
  --    (Finds the old rule whatever Postgres named it.)
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.att_records'::regclass
      and con.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = con.conrelid and a.attnum = any (con.conkey))
          = array['date', 'subject_id', 'user_id']
  loop
    execute format('alter table public.att_records drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'att_records_user_subject_date_class_key') then
    alter table public.att_records
      add constraint att_records_user_subject_date_class_key
      unique (user_id, subject_id, date, class_no);
  end if;
end $$;

-- 3. Let the API see the new columns straight away.
notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Check (run manually): days with more than one class
--   select s.name, r.date, r.class_no, r.start_time, r.end_time, r.status
--   from public.att_records r join public.att_subjects s on s.id = r.subject_id
--   where (r.user_id, r.subject_id, r.date) in (
--     select user_id, subject_id, date from public.att_records
--     group by 1, 2, 3 having count(*) > 1)
--   order by r.date desc, s.name, r.class_no;
-- ------------------------------------------------------------
