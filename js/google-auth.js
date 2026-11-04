// google-auth.js — short-lived, read-only Google access tokens in the browser.
//
// Uses Google Identity Services. Each token covers one scope (Gmail or
// Calendar), lasts about an hour and is kept in memory only: it is never
// saved or sent to CampusPulse's servers.

import { GOOGLE_CLIENT_ID } from './google-config.js';

let gisReady = null;
const cache = new Map(); // scope -> { token, expires }

function loadGis() {
  if (!gisReady) {
    gisReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisReady = null; reject(new Error('Could not load Google sign-in. Check your connection or any ad blocker.')); };
      document.head.appendChild(s);
    });
  }
  return gisReady;
}

// True if a token for this scope is still valid, so no pop-up is needed.
export function hasToken(scope) {
  const c = cache.get(scope);
  return Boolean(c && Date.now() < c.expires - 60_000);
}

// Opens Google's consent pop-up the first time; reuses the token afterwards.
// Must be called from a click, or browsers block the pop-up.
// what: words for the error if access is refused, e.g. 'read your email'.
export async function getGoogleToken(scope, hintEmail, what) {
  if (hasToken(scope)) return cache.get(scope).token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      hint: hintEmail,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, scope)) {
          reject(new Error(`Google access was not given. On the Google screen, tick the box that lets CampusPulse ${what}.`));
          return;
        }
        cache.set(scope, { token: resp.access_token, expires: Date.now() + Number(resp.expires_in || 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        const messages = {
          popup_closed: 'The Google window was closed before access was given.',
          popup_failed_to_open: 'The Google window was blocked. Allow pop-ups for this site and try again.',
        };
        reject(new Error(messages[err?.type] || err?.message || 'Google sign-in failed.'));
      },
    });
    client.requestAccessToken();
  });
}

export function forgetToken(scope) {
  const c = cache.get(scope);
  if (c && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(c.token, () => {});
  cache.delete(scope);
}
