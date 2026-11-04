// calendar.js — reads the student's Google Calendar directly in their browser.
//
// The read-only token comes from google-auth.js and stays in memory only.
// Only the classes on one chosen day are fetched, and only those that have
// already started: nothing later today and no future dates.

import { getGoogleToken, hasToken, forgetToken } from './google-auth.js';
import { isoFromDate } from './attendance-calc.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const getCalendarToken = (hintEmail) => getGoogleToken(SCOPE, hintEmail, 'see your calendar');
export const hasCalendarToken = () => hasToken(SCOPE);

async function calendar(token, path) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { forgetToken(SCOPE); throw new Error('Calendar access has expired. Press Fetch classes again to reconnect.'); }
  if (res.status === 403) {
    let reason = '';
    try { reason = (await res.json())?.error?.message || ''; } catch { /* no body */ }
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(reason)) {
      throw new Error('The Google Calendar API is switched off in your Google Cloud project. Enable "Google Calendar API" under APIs & Services → Library, wait a minute, then try again.');
    }
    if (/insufficient|scope/i.test(reason)) {
      throw new Error('Google did not grant calendar access. Try again and tick the box that allows CampusPulse to see your calendar.');
    }
    throw new Error(`Google Calendar refused access: ${reason || 'no reason given'}.`);
  }
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// The student's calendars, their own first: [{ id, name, primary }].
export async function listCalendars(token) {
  const d = await calendar(token, 'users/me/calendarList?minAccessRole=reader&maxResults=250');
  return (d.items || [])
    .filter((c) => !c.deleted)
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: Boolean(c.primary) }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Timed events that start on dateIso (local time) and have already started,
// skipping cancelled ones and ones the student declined:
// [{ id, title, startTime: 'HH:MM', endTime: 'HH:MM' }], in start order.
export async function classesOn(token, calendarId, dateIso, now = new Date()) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d);
  const dayEnd = new Date(y, m - 1, d + 1);
  if (dayStart > now) return [];
  const until = dayEnd < now ? dayEnd : now; // Google's timeMax bounds the START time

  const params = new URLSearchParams({
    timeMin: dayStart.toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const out = [];
  let pageToken = '';
  do {
    const page = await calendar(token, `calendars/${encodeURIComponent(calendarId)}/events?${params}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    for (const e of page.items || []) {
      if (e.status === 'cancelled' || !e.start?.dateTime) continue; // all-day events are not classes
      if ((e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')) continue;
      const start = new Date(e.start.dateTime);
      const end = new Date(e.end?.dateTime || e.start.dateTime);
      if (isoFromDate(start) !== dateIso || start > now) continue;
      const endTime = isoFromDate(end) === dateIso && end > start ? hhmm(end) : '';
      out.push({ id: e.id, title: (e.summary || '(no title)').trim(), startTime: hhmm(start), endTime });
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return out;
}
