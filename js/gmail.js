// gmail.js — reads the student's Gmail directly in their browser.
//
// The read-only token comes from google-auth.js and stays in memory only.
// Emails go from Gmail to this page, and only their text is passed on for
// deadline extraction.

import { getGoogleToken, forgetToken } from './google-auth.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export const getGmailToken = (hintEmail) => getGoogleToken(SCOPE, hintEmail, 'read your email');
export const disconnectGmail = () => forgetToken(SCOPE);

async function gmail(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { forgetToken(SCOPE); throw new Error('Gmail access has expired. Press Scan again to reconnect.'); }
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

// Gmail search: mail from the last N days, or from a { from, to } pair of
// Dates (both days included), no promotions/social, optionally only mail
// that mentions deadline-like words (saves time and AI cost).
export function buildQuery(period, onlyLikely) {
  const when = typeof period === 'number'
    ? `newer_than:${period}d`
    : `after:${Math.floor(period.from / 1000)} before:${Math.floor(period.to / 1000) + 86400}`;
  let q = `${when} -in:chats -in:sent -category:promotions -category:social`;
  if (onlyLikely) {
    q += ' {deadline due submission submit "last date" register registration quiz exam assignment round deliverable apply application}';
  }
  return q;
}

// Every matching message id, newest first, following Gmail's pages to the end.
// onProgress(count) is called after each page.
export async function listMessageIds(token, query, onProgress = () => {}) {
  const ids = [];
  let pageToken = '';
  do {
    const d = await gmail(token, `messages?maxResults=500&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const m of d.messages || []) ids.push(m.id);
    onProgress(ids.length);
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return ids;
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
