# CampusPulse AI — Part 1: Sign-in with Google (OAuth 2.0)

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
app.html              signed-in page (protected)
css/styles.css
js/config.js          Supabase URL, publishable key, allowed domains
js/supabaseClient.js  Supabase client (PKCE flow)
js/auth.js            sign-in / sign-out / session checks
js/login.js           sign-in page logic
js/app.js             signed-in page logic
supabase/01_auth.sql  tables, triggers and security rules
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
