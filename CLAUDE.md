# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CampusPulse AI: a student dashboard for IIM Lucknow (`@iiml.ac.in` accounts only). It covers Google sign-in, a deadline tracker, attendance, daily reminder emails, a case competition tracker, and deadlines pulled from email. The README calls these Part 1–6, and the same numbering runs through the SQL files.

- **Frontend:** static HTML, CSS and vanilla JS ES modules, with **no build step, no package.json, no bundler and no test suite or linter**. It's hosted on GitHub Pages.
- **Backend:** Supabase (Postgres with RLS, Auth, Edge Functions on Deno, pg_cron, Vault). There is no other server.

## Running locally

```bash
python -m http.server 8000
```

Open http://localhost:8000. Google sign-in only works if `http://localhost:8000` is listed in Google's JavaScript origins and `http://localhost:8000/**` is in Supabase's Redirect URLs.

There are no build, lint or test commands. To check a change, load the page in a browser.

## Architecture

### Pages and modules
Each HTML page loads exactly one `<script type="module">` entry point, `js/<name>-page.js` (the home page uses `js/app.js` and sign-in uses `js/login.js`). Feature code is split into three layers:

- `*-data.js`: the **only** module allowed to touch that feature's Supabase tables. It converts snake_case DB rows to camelCase objects (`fromRow` / `toRow`) and throws `Error(error.message)` on failure. Pages never call `supabase.from(...)` directly.
- Pure helpers with no DOM or DB access: `deadline-format.js`, `attendance-calc.js`, `competition-stages.js`.
- `*-page.js`: DOM rendering and event wiring.

Every signed-in page starts with `startSignedInPage()` from `js/shell.js`. It checks the session, loads the profile and fills the top bar (`#userName`, `#userAvatar`, `#signOutBtn`), then calls `finishLoading()`, which removes the `is-loading` class from `body`.

`js/supabaseClient.js` is the single shared client. supabase-js comes from the jsDelivr CDN as an ESM import, and the auth flow is PKCE with `detectSessionInUrl`. `js/config.js` holds the Supabase URL, the publishable key (safe to commit) and `ALLOWED_DOMAINS`. The root-level `config-f.js` duplicates it and nothing references it.

### Security model (enforced in the database, not the UI)
- `supabase/01_auth.sql` sets up a trigger that rejects new users whose email domain isn't in `allowed_email_domains`, and another trigger that creates the `profiles` row. `ALLOWED_DOMAINS` in `js/config.js` is only for the UI, so keep the two lists in sync.
- Every table uses RLS that limits each user to their own rows. Columns written only by functions, such as `reminder_settings.last_sent_on` and `last_status`, can't be written by clients.
- `profiles.role` can be `'cr'` (Course Representative), which is set by hand in SQL.

### Schema migrations
The `supabase/NN_*.sql` files are run once, in order, in the Supabase SQL Editor. There's no migration tool. Make schema changes by adding a new numbered file rather than editing an old one (`07_attendance_classes.sql`, for example, changes the tables from `03`).

### Cross-feature coupling
- Competition key dates are ordinary rows in `deadlines` with `competition_id` set and `category = 'case_competition'`. That's why they appear on the Deadlines page, the Home page and in reminder emails automatically. `deadlines-data.js` only sends `competition_id` and `source` when they're provided, so edits don't clear them.
- `deadlines.source` is one of `manual`, `email` or `cr`.
- Due dates are stored in UTC and shown in local time. The app's time zone is IST (UTC+05:30), and reminder hours and attendance class times are in IST.

### Edge Functions (`supabase/functions/*/index.ts`)
Both are deployed with **Verify JWT turned off** because they check their callers themselves. They use `npm:@supabase/supabase-js@2` with the secret key from `SUPABASE_SECRET_KEYS`, falling back to `SUPABASE_SERVICE_ROLE_KEY`.

- `daily-reminders`: pg_cron calls it hourly (`30 * * * *` UTC, which is :00 IST) with a secret header stored in Vault and checked through `reminders_check_secret()`. It sends emails through Resend. It also handles a signed-in user's request for a test email. Secrets: `RESEND_API_KEY`, `APP_URL`, and optionally `REMINDER_FROM`. Without a verified domain, Resend only delivers to the account owner's address.
- `extract-deadlines`: takes up to 10 emails per call (the browser sends 5 at a time), asks an AI model for dated, actionable items, validates them (IST, skips past dates) and writes them to `email_suggestions`. Processed Gmail ids go in `email_processed`. It calls OpenRouter's chat-completions API with `OPENROUTER_API_KEY` (`OPENROUTER_MODEL`, default `google/gemini-2.5-flash-lite`, with calls spaced about 3.5 s apart for free-model rate limits). The system prompt treats email content as untrusted data. Suggestions only become deadlines when the user accepts them, and those get `source = 'email'`.

### Gmail access
`js/gmail.js` uses Google Identity Services in the browser with the `gmail.readonly` scope. The token is kept only in memory (about an hour) and never sent to or stored on the server. The OAuth Client ID is in `js/google-config.js` and is public. `gmail.readonly` is a restricted scope, so while the app is in Testing mode only listed test users can grant it.

## Conventions
- Each JS file starts with a `// filename.js — purpose` header comment, written in plain English. Follow the same style.
- Use plain DOM APIs (`textContent`, `createElement`) and no framework.
- When you add a page, table or function, also update the file list and part notes in `README.md`.
