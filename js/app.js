// app.js — the signed-in home page (app.html).

import { startSignedInPage, finishLoading } from './shell.js';
import { listDeadlines } from './deadlines-data.js';
import { CATEGORIES, isOverdue, urgency, dueText, daysFromToday } from './deadline-format.js';

const $ = (id) => document.getElementById(id);

const ROLE_LABELS = { student: 'Student', cr: 'Course Representative', admin: 'Administrator' };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function summarySentence(overdue, thisWeek) {
  if (!overdue && !thisWeek) return 'Nothing due in the next 7 days.';
  const parts = [];
  if (thisWeek) parts.push(`${plural(thisWeek, 'deadline')} in the next 7 days`);
  if (overdue) parts.push(`${overdue} overdue`);
  return `You have ${parts.join(' and ')}.`;
}

function renderUpcoming(deadlines) {
  const now = new Date();
  const pending = deadlines.filter((d) => d.status !== 'done');
  const overdue = pending.filter((d) => isOverdue(d, now));
  const upcoming = pending.filter((d) => !isOverdue(d, now));
  const thisWeek = upcoming.filter((d) => daysFromToday(d.dueAt, now) <= 7);

  $('upcomingSummary').textContent = summarySentence(overdue.length, thisWeek.length);

  const list = $('upcomingList');
  list.textContent = '';
  const shown = [...overdue, ...upcoming].slice(0, 5);

  if (!shown.length) {
    $('upcomingEmpty').hidden = false;
    return;
  }
  for (const d of shown) {
    const li = document.createElement('li');
    li.className = 'mini-row';
    li.dataset.urgency = urgency(d, now);

    const main = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'mini-title';
    title.textContent = d.title;
    const meta = document.createElement('p');
    meta.className = 'mini-meta';
    meta.textContent = [CATEGORIES[d.category], d.course].filter(Boolean).join(', ');
    main.append(title, meta);

    const due = document.createElement('p');
    due.className = 'mini-due';
    due.textContent = dueText(d, now);

    li.append(main, due);
    list.appendChild(li);
  }
}

async function init() {
  const ctx = await startSignedInPage();
  if (!ctx) return;
  const { user, profile, profileError, name } = ctx;

  $('greeting').textContent = `${greeting()}, ${name.split(/\s+/)[0]}.`;
  $('detailName').textContent = name;
  $('detailEmail').textContent = user.email;
  $('detailRole').textContent = ROLE_LABELS[profile?.role] || 'Student';
  $('detailSince').textContent = formatDateTime(profile?.created_at || user.created_at);
  $('detailLast').textContent = formatDateTime(user.last_sign_in_at);

  const note = profileError
    ? `Could not load your profile: ${profileError}`
    : !profile
      ? 'Your profile record is missing. Run supabase/01_auth.sql, then sign out and sign in again.'
      : '';
  if (note) { $('profileNote').textContent = note; $('profileNote').hidden = false; }

  try {
    renderUpcoming(await listDeadlines());
  } catch (err) {
    $('upcomingSummary').textContent = `Could not load deadlines: ${err.message}`;
  }

  finishLoading();
}

init();
