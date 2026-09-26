# CampusPulse AI

Part 1: Sign-in with Google (OAuth 2.0). Part 2: Assignment & Deadline tracker. Part 3: Attendance. Part 4: Daily reminders. Part 5: Case competition tracker. Part 6: Deadlines from email.

Static site (HTML/CSS/vanilla JS, no build step) hosted on GitHub Pages, with
Supabase Auth handling Google sign-in.

## How sign-in works

OAuth 2.0 **Authorization Code flow with PKCE**:

1. You press **Continue with Google** (`index.html`). The app makes a random
   secret (the PKCE verifier), keeps it in the browser, and sends only its hash
   to Supabase, which forwards you to Google.
2. Google shows only `@iiml.ac.in` accounts (`hd` hint) and asks for consent to
   the basic scopes `openid email profile`.
3. Google sends a one-time code to Supabase; Supabase sends you to
   `app.html?code=...`.
4. supabase-js exchanges that code plus the kept verifier for a session. A stolen
   code is useless without the verifier.
5. `app.html` checks the session and the email domain, then shows your account.

The domain rule is enforced in the database (`supabase/01_auth.sql`): a trigger
refuses to create any user whose email is not in `allowed_email_domains`, and
another trigger creates the `profiles` row. Row Level Security lets each user
read only their own profile and change only their display name.

## Files

```
index.html            sign-in page
app.html              home: greeting, Coming up, account (protected)
deadlines.html        deadline tracker (protected)
attendance.html       attendance module (protected)
reminders.html        daily reminder settings + test email (protected)
competitions.html     case competition tracker (protected)
email.html            deadlines found in Gmail / pasted emails, for review (protected)
css/styles.css
js/config.js          Supabase URL, publishable key, allowed domains
js/supabaseClient.js  Supabase client (PKCE flow)
js/auth.js            sign-in / sign-out / session checks
js/login.js           sign-in page logic
js/shell.js           shared set-up for signed-in pages (session, top bar)
js/app.js             home page logic
js/deadlines-data.js  reads/writes the deadlines table (only module that does)
js/deadline-format.js due-date wording, categories, date helpers
js/deadlines-page.js  deadlines page logic
js/attendance-data.js reads/writes att_subjects, att_records, att_settings
js/attendance-calc.js attendance %, can-miss / must-attend maths
js/attendance-page.js attendance page logic
js/reminders-data.js  reminder_settings + test-email call
js/reminders-page.js  reminders page logic
js/competitions-data.js  case_competitions + linked key dates
js/competition-stages.js stage/outcome names, date suggestions
js/competitions-page.js  competitions page logic
js/google-config.js   Google OAuth Client ID for Gmail (public)
js/gmail.js           reads Gmail in the browser (read-only token, memory only)
js/email-data.js      suggestions, extract-deadlines call, accept/dismiss
js/email-page.js      From email page logic
supabase/01_auth.sql       Part 1: profiles, domain rule, security
supabase/02_deadlines.sql  Part 2: deadlines table and security
supabase/03_attendance.sql Part 3: attendance tables and security
supabase/04_reminders.sql  Part 4: reminder settings, Vault secrets, hourly schedule
supabase/05_competitions.sql Part 5: case_competitions, deadlines.competition_id
supabase/06_email_import.sql Part 6: email_suggestions, email_processed
supabase/functions/extract-deadlines/index.ts  Edge Function: emails -> Claude -> suggestions
supabase/functions/daily-reminders/index.ts  Edge Function that builds and sends the emails
```

## Setup

See the step-by-step guide in the chat, in this order:
Supabase project → Google Cloud OAuth client → Supabase Google provider →
Supabase URL configuration → run SQL → edit `js/config.js` → push to GitHub Pages.

Run locally with `python -m http.server 8000` and open http://localhost:8000
(add `http://localhost:8000` to Google's JavaScript origins and
`http://localhost:8000/**` to Supabase's Redirect URLs first).

## Admin snippets (Supabase SQL Editor)

```sql
-- make someone a Course Representative
update public.profiles set role = 'cr' where email = 'someone@iiml.ac.in';
-- allow personal Gmail accounts while testing (also add 'gmail.com' to js/config.js)
insert into public.allowed_email_domains values ('gmail.com');
```

## Part 2: Deadline tracker

Run `supabase/02_deadlines.sql` once in the SQL Editor. Each deadline has a
title, category, optional course, due date/time (stored in UTC, shown in
local time), optional link and notes, and a done/pending status. Row Level
Security limits every student to their own deadlines. The `source` column
(`manual`, `email`, `cr`) is ready for the email-parsing and CR parts.

## Part 3: Attendance

Run `supabase/03_attendance.sql` once (after 02). Tables: `att_subjects`
(unique name and code per student), `att_records` (one mark per subject per
day, present/absent, remarks) and `att_settings` (target %, default 75).

With attended `a`, total `t` and target `p`:
- classes you can still miss: `floor(a/p - t)`
- classes to attend in a row when below target: `ceil((p*t - a) / (1 - p))`

Old data from the Attendance Register app: export a backup there and use
"import the backup file" at the bottom of the Attendance page. Subjects are
matched by name; existing marks for the same subject and day are kept.

## Part 4: Daily reminders

- `reminder_settings` holds each student's choices (on/off, hour in IST, days
  ahead, include attendance, skip empty days) plus `last_sent_on` /
  `last_status`, which only the function can write.
- pg_cron calls the `daily-reminders` Edge Function every hour at :00 IST
  (`30 * * * *` UTC) with a secret header; the secret lives in Vault and the
  function checks it through `reminders_check_secret()`.
- The function emails everyone whose hour it is and who hasn't had today's
  email, via Resend. It also accepts a signed-in student's request for a
  test email.
- Function secrets: `RESEND_API_KEY`, `APP_URL`, optional `REMINDER_FROM`.
  Deploy with JWT verification off (the function checks callers itself).
- Resend without a verified domain only delivers to the address the Resend
  account was created with. To email other students, verify a domain in
  Resend and set `REMINDER_FROM` to an address on it.

## Part 5: Case competition tracker

Run `supabase/05_competitions.sql` once. Each competition has a stage
(interested, registered, submitted, shortlisted, finalist), an outcome once
it ends (won, not selected, withdrawn) with optional result text, team,
link and notes. Key dates are rows in `deadlines` with `competition_id` set
and category `case_competition`, so they show on the Deadlines page, Home and
in reminder emails with no extra work. Renaming a competition updates the
name shown on its dates; deleting it deletes them. The deadlines policy now
also checks that a linked competition belongs to the same student.

## Part 6: Deadlines from email

- Gmail is read in the student's own browser with a read-only Google token
  (Google Identity Services, scope `gmail.readonly`). The token lives only in
  memory for about an hour; nothing about it is stored on the server.
- The browser sends up to 5 emails at a time to the `extract-deadlines` Edge
  Function, which asks an AI model (Gemini if `GEMINI_API_KEY` is set, otherwise Claude) for dated,
  actionable items, validates them (IST, skips past dates) and stores them
  in `email_suggestions`. Analysed Gmail ids go into `email_processed` so a
  re-scan skips them.
- Nothing becomes a deadline until the student presses "Add to deadlines";
  those deadlines get `source = 'email'`. Pasting an email works without
  Gmail access.
- Function secrets: `GEMINI_API_KEY` (free tier; default model `gemini-flash-lite-latest`, override with `GEMINI_MODEL`) or `ANTHROPIC_API_KEY` (default `claude-haiku-4-5-20251001`, override with `EXTRACT_MODEL`). Gemini calls are spaced ~4.5 s apart to respect free-tier per-minute limits.
  Deploy with JWT verification off.
- `gmail.readonly` is a restricted Google scope. In Testing mode only listed
  test users can grant it (with an "unverified app" warning); opening it to
  all students needs Google's verification and a security assessment.
