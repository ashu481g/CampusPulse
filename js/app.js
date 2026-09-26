// app.js — the signed-in home page (app.html).

import { startSignedInPage, finishLoading } from './shell.js';
import { listDeadlines } from './deadlines-data.js';
import { CATEGORIES, isOverdue, urgency, dueText, daysFromToday } from './deadline-format.js';
import { loadAll as loadAttendance } from './attendance-data.js';
import { statsFor, margin, marginText, formatPercent } from './attendance-calc.js';

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

// Overall figure plus the subjects that need attention (below target or no margin left).
function renderAttendance({ subjects, records, target }) {
  const overall = statsFor(records);
  $('attHomePercent').textContent = formatPercent(overall.percentage);
  const meter = $('attHomeMeter');
  meter.querySelector('.meter-fill').style.width = `${overall.percentage ?? 0}%`;
  meter.querySelector('.meter-target').style.left = `${target}%`;

  if (!subjects.length) {
    $('attHomeSummary').innerHTML = '';
    const a = document.createElement('a');
    a.href = 'attendance.html';
    a.textContent = 'Add your subjects';
    $('attHomeSummary').append(a, ' to start tracking attendance.');
    meter.hidden = true;
    return;
  }

  const rows = subjects.map((s) => {
    const stats = statsFor(records.filter((r) => r.subjectId === s.id));
    return { s, stats, m: margin(stats, target) };
  });
  const below = rows.filter((r) => r.m.kind === 'below' || r.m.kind === 'unreachable');
  const edge = rows.filter((r) => r.m.kind === 'safe' && r.m.canMiss === 0);
  meter.dataset.tone = overall.total && overall.percentage < target ? 'below' : 'safe';

  let summary = overall.total
    ? `${overall.attended} of ${overall.total} classes attended. `
    : 'No classes marked yet. ';
  if (below.length) summary += `${below.length} subject${below.length === 1 ? ' is' : 's are'} below your ${target}% target.`;
  else if (edge.length) summary += `All subjects meet your ${target}% target, but some have no room to miss a class.`;
  else if (overall.total) summary += `All subjects meet your ${target}% target.`;
  $('attHomeSummary').textContent = summary;

  const list = $('attHomeList');
  list.textContent = '';
  for (const { s, stats, m } of [...below, ...edge].slice(0, 4)) {
    const li = document.createElement('li');
    li.className = 'mini-row';
    li.dataset.urgency = m.kind === 'safe' ? 'today' : 'overdue';
    const main = document.createElement('div');
    const t = document.createElement('p');
    t.className = 'mini-title';
    t.textContent = s.name;
    const meta = document.createElement('p');
    meta.className = 'mini-meta';
    meta.textContent = `${formatPercent(stats.percentage)} (${stats.attended} of ${stats.total})`;
    main.append(t, meta);
    const due = document.createElement('p');
    due.className = 'mini-due';
    due.textContent = marginText(stats, target);
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

  try {
    renderAttendance(await loadAttendance());
  } catch (err) {
    $('attHomeSummary').textContent = `Could not load attendance: ${err.message}`;
    $('attHomeMeter').hidden = true;
  }

  finishLoading();
}

init();
