-- ============================================================
-- CampusPulse AI — Part 1: Authentication
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- ============================================================

-- 1. Which email domains may sign up --------------------------
--    Kept in a table so you can change it later without touching code.
create table if not exists public.allowed_email_domains (
  domain text primary key check (domain = lower(domain))
);
insert into public.allowed_email_domains (domain) values ('iiml.ac.in')
on conflict do nothing;

alter table public.allowed_email_domains enable row level security;
revoke all on public.allowed_email_domains from anon, authenticated;
-- (No policies: only the security-definer trigger below reads it.)

-- 2. Block sign-ups from any other domain ---------------------
--    This is the real gate. The "hd" hint on the Google screen and the
--    check in the browser are only there for a nicer experience.
create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (
    select 1 from public.allowed_email_domains d
    where d.domain = lower(split_part(new.email, '@', 2))
  ) then
    raise exception 'Email domain not allowed for CampusPulse AI';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_allowed_email_domain on auth.users;
create trigger enforce_allowed_email_domain
  before insert on auth.users
  for each row execute function public.enforce_allowed_email_domain();

-- 3. One profile row per user ---------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  role        text not null default 'student' check (role in ('student', 'cr', 'admin')),
  created_at  timestamptz not null default now()
);

-- Filled automatically from the Google account on first sign-in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Row Level Security for profiles --------------------------
alter table public.profiles enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "update own profile" on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Users may read their row and change their display name only.
-- They can never change their own role, email, or insert/delete rows.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- Useful later (run manually when needed):
--   make someone a Course Representative:
--     update public.profiles set role = 'cr' where email = 'someone@iiml.ac.in';
--   allow personal Gmail while testing:
--     insert into public.allowed_email_domains values ('gmail.com');
--   remove it again:
--     delete from public.allowed_email_domains where domain = 'gmail.com';
-- ------------------------------------------------------------
