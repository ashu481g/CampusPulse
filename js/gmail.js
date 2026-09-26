// gmail.js — reads the student's Gmail directly in their browser.
//
// Uses Google Identity Services to get a short-lived, read-only access
// token (about an hour). The token is kept in memory only: it is never
// saved or sent to CampusPulse's servers. Emails go from Gmail to this
// page, and only their text is passed on for deadline extraction.

import { GOOGLE_CLIENT_ID } from './google-config.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
let gisReady = null;
let cached = { token: null, expires: 0 };

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

// Opens Google's consent pop-up the first time; reuses the token afterwards.
// Must be called from a click, or browsers block the pop-up.
export async function getGmailToken(hintEmail) {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      hint: hintEmail,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          reject(new Error('Gmail access was not given. On the Google screen, tick the box that lets CampusPulse read your email.'));
          return;
        }
        cached = { token: resp.access_token, expires: Date.now() + Number(resp.expires_in || 3600) * 1000 };
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

export function disconnectGmail() {
  if (cached.token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(cached.token, () => {});
  cached = { token: null, expires: 0 };
}

async function gmail(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { cached = { token: null, expires: 0 }; throw new Error('Gmail access has expired. Press Scan again to reconnect.'); }
  if (res.status === 403) {
    // Show Google's real reason instead of guessing.
    let reason = '';
    try { reason = (await res.json())?.error?.message || ''; } catch { /* no body */ }
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(reason)) {
      throw new Error('The Gmail API is switched off in your Google Cloud project. Enable "Gmail API" under APIs & Services → Library, wait a minute, then scan again.');
    }
    if (/insufficient|scope/i.test(reason)) {
      throw new Error('Google did not grant read access to Gmail. Press Disconnect Gmail, scan again, and tick the box that allows reading your email.');
    }
    throw new Error(`Gmail refused access: ${reason || 'no reason given'}. If your institute blocks this app, use "Paste an email" instead.`);
  }
  if (!res.ok) throw new Error(`Gmail error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Gmail search: recent mail, no promotions/social, optionally only mail
// that mentions deadline-like words (saves time and AI cost).
export function buildQuery(days, onlyLikely) {
  let q = `newer_than:${days}d -in:chats -in:sent -category:promotions -category:social`;
  if (onlyLikely) {
    q += ' {deadline due submission submit "last date" register registration quiz exam assignment round deliverable apply application}';
  }
  return q;
}

export async function listMessageIds(token, query, max = 40) {
  const ids = [];
  let pageToken = '';
  while (ids.length < max) {
    const d = await gmail(token, `messages?maxResults=${Math.min(100, max - ids.length)}&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const m of d.messages || []) ids.push(m.id);
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return ids.slice(0, max);
}

function decode(data) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, head').forEach((e) => e.remove());
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href) && !a.textContent.includes(href)) a.append(` (${href})`);
  });
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('td, th').forEach((e) => e.append(' | '));
  doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, table').forEach((e) => e.append('\n'));
  return (doc.body?.textContent || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

function bodyOf(payload) {
  const plain = [];
  const html = [];
  (function walk(part) {
    if (!part) return;
    const type = part.mimeType || '';
    if (part.body?.data) {
      if (type === 'text/plain') plain.push(decode(part.body.data));
      else if (type === 'text/html') html.push(decode(part.body.data));
    }
    (part.parts || []).forEach(walk);
  })(payload);
  if (plain.join('').trim()) return plain.join('\n');
  if (html.length) return htmlToText(html.join('\n'));
  return '';
}

export async function getMessage(token, id) {
  const m = await gmail(token, `messages/${id}?format=full`);
  const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
  return {
    id: m.id,
    source: 'gmail',
    subject: h.subject || '',
    from: h.from || '',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : (h.date || ''),
    body: bodyOf(m.payload) || m.snippet || '',
  };
}
