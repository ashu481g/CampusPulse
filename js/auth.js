// auth.js — everything about signing in and out.
// Pages call these functions; nothing else touches supabase.auth directly.
//
// The flow (OAuth 2.0 Authorization Code + PKCE):
//   1. signInWithGoogle() sends the browser to Supabase -> Google.
//   2. The user picks their IIML account and consents (openid, email, profile).
//   3. Google returns to Supabase, which returns to app.html?code=...
//   4. supabase-js swaps that code (plus the PKCE verifier it kept) for a session.
//   5. requireUser() on app.html confirms the session and the email domain.

import { supabase } from './supabaseClient.js';
import { ALLOWED_DOMAINS } from './config.js';

// Absolute URL of a sibling page, without any query string or hash.
// Works both at http://localhost:8000/ and https://<user>.github.io/<repo>/.
export function pageUrl(name) {
  return new URL(name, window.location.href).href;
}

export function isAllowedEmail(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

export function allowedDomainsText() {
  return ALLOWED_DOMAINS.map((d) => `@${d}`).join(' or ');
}

export async function signInWithGoogle() {
  const queryParams = { prompt: 'select_account' };
  // "hd" asks Google to show only accounts from this Workspace domain.
  if (ALLOWED_DOMAINS.length === 1) queryParams.hd = ALLOWED_DOMAINS[0];

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: pageUrl('app.html'), queryParams },
  });
  if (error) throw error;
  // On success the browser is already navigating to Google.
}

export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Errors come back from Supabase/Google as ?error=...&error_description=...
// (sometimes in the #hash instead).
export function readAuthErrorFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = q.get('error') || h.get('error');
  const description = q.get('error_description') || h.get('error_description');
  return code || description ? { code, description } : null;
}

export function goToSignIn(reason, detail) {
  const url = new URL(pageUrl('index.html'));
  if (reason) url.searchParams.set('reason', reason);
  if (detail) url.searchParams.set('detail', detail);
  window.location.replace(url.href);
}

// Turns a reason code (or raw provider error) into one clear sentence.
export function messageFor(reason, detail = '') {
  const domains = allowedDomainsText();
  const d = detail.toLowerCase();
  if (reason === 'domain' || d.includes('database error saving new user') || d.includes('domain not allowed')) {
    return `Only ${domains} accounts can use CampusPulse AI. Choose your institute account and try again.`;
  }
  if (reason === 'signed_out') return 'You have signed out.';
  if (reason === 'expired') return 'Your session has ended. Sign in again to continue.';
  if (d.includes('access_denied') || d.includes('denied')) {
    return 'Sign-in was cancelled on the Google screen. Choose Continue with Google to try again.';
  }
  if (reason === 'error' && detail) return `Sign-in failed: ${detail}`;
  return '';
}

// Use at the top of every protected page. Returns the user, or redirects.
export async function requireUser() {
  const urlError = readAuthErrorFromUrl();
  if (urlError) {
    goToSignIn('error', urlError.description || urlError.code);
    return null;
  }

  let session;
  try {
    session = await getCurrentSession();
  } catch (err) {
    goToSignIn('error', err.message);
    return null;
  }
  if (!session) {
    goToSignIn();
    return null;
  }

  // Remove ?code=... from the address bar once it has been used.
  if (window.location.search) {
    window.history.replaceState(null, '', window.location.pathname);
  }

  if (!isAllowedEmail(session.user.email)) {
    await supabase.auth.signOut();
    goToSignIn('domain');
    return null;
  }
  return session.user;
}

export async function signOut() {
  signingOut = true;
  await supabase.auth.signOut();
  goToSignIn('signed_out');
}

// If the user signs out in another tab, follow along.
let signingOut = false;
export function watchForSignOut() {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !signingOut) goToSignIn('expired');
  });
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('email, full_name, avatar_url, role, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
