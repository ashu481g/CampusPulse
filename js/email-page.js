// email-page.js — the "From email" page (email.html).

import { startSignedInPage, finishLoading } from './shell.js';
import * as data from './email-data.js';
import { listDeadlines } from './deadlines-data.js';
import { isGmailConfigured } from './google-config.js';
import { getGmailToken, disconnectGmail, buildQuery, listMessageIds, getMessage } from './gmail.js';
import { CATEGORIES, toDateInput, toTimeInput, fromInputs, formatDate } from './deadline-format.js';

const $ = (id) => document.getElementById(id);
const BATCH = 3;          // emails per call to the extract function (keeps free AI tiers happy)
const CONFIRM_OVER = 100; // ask before checking more new emails than this in one scan

const state = { suggestions: [], deadlines: [], email: '' };

// ---------- helpers ----------

let toastTimer;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.kind = isError ? 'error' : 'ok';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 7000 : 3000);
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function progress(id, text, kind = 'info') {
  $(id).textContent = text;
  $(id).dataset.kind = kind;
  $(id).hidden = !text;
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// An existing deadline on the same day with a similar title, if any.
function possibleDuplicate(s) {
  const day = toDateInput(s.dueAt);
  const t = norm(s.title);
  return state.deadlines.find((d) => {
    if (toDateInput(d.dueAt) !== day) return false;
    const u = norm(d.title);
    return u === t || u.includes(t) || t.includes(u);
  }) || null;
}

// ---------- review list ----------

function card(s) {
  const art = el('article', 'suggestion');
  art.dataset.confidence = s.confidence;

  const src = el('p', 'sg-source');
  const when = s.emailDate ? `, ${formatDate(s.emailDate)}` : '';
  src.textContent = s.source === 'paste'
    ? `From pasted text${s.subject ? `: ${s.subject}` : ''}`
    : `From: ${s.from.replace(/<.*>/, '').trim() || s.from}${when}. Subject: ${s.subject || '(none)'}`;
  art.appendChild(src);

  const form = el('div', 'sg-fields');

  const titleWrap = el('div', 'sg-title');
  const titleLabel = el('label', '', 'Title');
  const title = el('input');
  title.type = 'text';
  title.maxLength = 200;
  title.value = s.title;
  title.id = `t-${s.id}`;
  titleLabel.htmlFor = title.id;
  titleWrap.append(titleLabel, title);

  const catWrap = el('div');
  const catLabel = el('label', '', 'Category');
  const cat = el('select');
  cat.id = `c-${s.id}`;
  catLabel.htmlFor = cat.id;
  for (const [v, l] of Object.entries(CATEGORIES)) cat.add(new Option(l, v, false, v === s.category));
  catWrap.append(catLabel, cat);

  const courseWrap = el('div');
  const courseLabel = el('label', '', 'Course');
  const course = el('input');
  course.type = 'text';
  course.maxLength = 100;
  course.value = s.course;
  course.placeholder = 'Optional';
  course.id = `k-${s.id}`;
  courseLabel.htmlFor = course.id;
  courseWrap.append(courseLabel, course);

  const dateWrap = el('div');
  const dateLabel = el('label', '', 'Due date');
  const date = el('input');
  date.type = 'date';
  date.value = toDateInput(s.dueAt);
  date.id = `d-${s.id}`;
  dateLabel.htmlFor = date.id;
  dateWrap.append(dateLabel, date);

  const timeWrap = el('div');
  const timeLabel = el('label', '', 'Time');
  const time = el('input');
  time.type = 'time';
  time.value = toTimeInput(s.dueAt);
  time.id = `h-${s.id}`;
  timeLabel.htmlFor = time.id;
  timeWrap.append(timeLabel, time);

  form.append(titleWrap, catWrap, courseWrap, dateWrap, timeWrap);
  art.appendChild(form);

  const notes = [];
  if (!s.timeGiven) notes.push('The email gives no time, so 11:59 pm is filled in. Change it if you know better.');
  if (s.confidence === 'low') notes.push('Low confidence: check the email before adding this.');
  const dup = possibleDuplicate(s);
  if (dup) notes.push(`You may already have this: "${dup.title}" on the same day.`);
  for (const n of notes) art.appendChild(el('p', 'sg-note', n));

  if (s.notes) art.appendChild(el('p', 'sg-detail', s.notes));
  if (s.link) {
    const a = el('a', 'sg-link', 'Link from the email');
    a.href = s.link;
    a.target = '_blank';
    a.rel = 'noopener';
    art.appendChild(a);
  }

  const actions = el('div', 'sg-actions');
  const dismissBtn = el('button', 'btn-quiet', 'Dismiss');
  dismissBtn.type = 'button';
  dismissBtn.addEventListener('click', () => dismiss([s.id], s.title));
  const addBtn = el('button', 'btn-primary', 'Add to deadlines');
  addBtn.type = 'button';
  addBtn.addEventListener('click', async () => {
    const t = title.value.trim();
    if (!t) { toast('Give it a title first.', true); title.focus(); return; }
    if (!date.value) { toast('Choose a due date first.', true); date.focus(); return; }
    addBtn.disabled = true;
    try {
      const created = await data.accept(s, {
        title: t, category: cat.value, course: course.value.trim(),
        dueAt: fromInputs(date.value, time.value || '23:59'),
      });
      state.deadlines.push(created);
      state.suggestions = state.suggestions.filter((x) => x.id !== s.id);
      render();
      toast(`Added "${t}" to your deadlines.`);
    } catch (err) {
      addBtn.disabled = false;
      toast(`Could not add: ${err.message}`, true);
    }
  });
  actions.append(dismissBtn, addBtn);
  art.appendChild(actions);
  return art;
}

function render() {
  const list = $('suggestionList');
  list.textContent = '';
  state.suggestions.forEach((s) => list.appendChild(card(s)));
  $('reviewCount').textContent = state.suggestions.length;
  $('reviewEmpty').hidden = state.suggestions.length > 0;
  $('dismissAllBtn').hidden = state.suggestions.length < 2;
}

async function dismiss(ids, label) {
  try {
    await data.dismiss(ids);
    state.suggestions = state.suggestions.filter((x) => !ids.includes(x.id));
    render();
    toast(label ? `Dismissed "${label}".` : `Dismissed ${ids.length} suggestions.`);
  } catch (err) {
    toast(`Could not dismiss: ${err.message}`, true);
  }
}

async function refreshSuggestions() {
  state.suggestions = await data.listPending();
  render();
}

async function refreshProcessedLine() {
  try {
    const n = await data.processedCount();
    const line = $('processedLine');
    line.textContent = '';
    if (!n) return;
    line.append(` ${n} email${n === 1 ? ' has' : 's have'} been checked so far and will be skipped next time. `);
    const b = el('button', 'link-btn', 'Check them again');
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (!window.confirm('Forget which emails were checked, so the next scan reads them again? Deadlines found again may appear twice.')) return;
      await data.forgetProcessed();
      refreshProcessedLine();
      toast('The next scan will read all emails in the period again.');
    });
    line.appendChild(b);
  } catch { /* table missing: the load error explains it */ }
}

// Sends emails to the function in small batches, reporting progress.
async function extractAll(emails, progressId) {
  let found = 0;
  let failed = 0;
  let lastError = '';
  for (let i = 0; i < emails.length; i += BATCH) {
    progress(progressId, `Looking for deadlines in ${emails.length} email${emails.length === 1 ? '' : 's'}… ${Math.min(i + BATCH, emails.length)} of ${emails.length}`);
    try {
      const results = await data.extract(emails.slice(i, i + BATCH));
      for (const r of results) {
        if (r.error) { failed += 1; lastError = r.error; } else found += r.found || 0;
      }
    } catch (err) {
      failed += Math.min(BATCH, emails.length - i);
      lastError = err.message;
      if (/API_KEY|No AI key|daily limit|Could not reach|session/i.test(err.message)) throw err; // no point continuing
    }
  }
  return { found, failed, lastError };
}

// ---------- scan Gmail ----------

// The chosen period: a number of days, or { from, to } local-midnight Dates.
// Throws a readable error if the custom dates are missing or out of order.
function scanPeriod() {
  const choice = $('scanDays').value;
  if (choice !== 'custom') return Number(choice);
  const from = $('scanFrom').value;
  const to = $('scanTo').value;
  if (!from || !to) throw new Error('Choose both a From and a To date.');
  if (from > to) throw new Error('The From date must be on or before the To date.');
  return { from: new Date(`${from}T00:00`), to: new Date(`${to}T00:00`) };
}

function showRange() {
  const custom = $('scanDays').value === 'custom';
  $('scanRange').hidden = !custom;
  if (custom && !$('scanTo').value) {
    const today = new Date();
    $('scanTo').value = toDateInput(today.toISOString());
    $('scanFrom').value = toDateInput(new Date(today.getTime() - 7 * 86400e3).toISOString());
  }
}

async function scanGmail() {
  const btn = $('scanBtn');
  btn.disabled = true;
  try {
    const period = scanPeriod();
    progress('scanProgress', 'Asking Google for read-only access…');
    const token = await getGmailToken(state.email);
    $('disconnectBtn').hidden = false;

    progress('scanProgress', 'Searching your inbox…');
    const query = buildQuery(period, $('onlyLikely').checked);
    const ids = await listMessageIds(token, query, (n) => progress('scanProgress', `Searching your inbox… ${n} matching emails so far`));

    // Emails checked in an earlier scan are skipped, so a limited scan moves
    // on to the next unchecked ones each time.
    progress('scanProgress', `Found ${ids.length} matching emails. Skipping ones checked before…`);
    const seen = await data.alreadyProcessed(ids);
    const fresh = ids.filter((id) => !seen.has(id));
    if (!fresh.length) {
      progress('scanProgress', ids.length
        ? `No new emails: all ${ids.length} matching emails were checked before.`
        : 'No matching emails in that period.', 'ok');
      return;
    }

    const limit = Number($('scanLimit').value);
    const todo = limit ? fresh.slice(0, limit) : fresh;
    if (todo.length > CONFIRM_OVER) {
      const minutes = Math.max(1, Math.round((todo.length * 4) / 60));
      if (!window.confirm(`There are ${todo.length} new emails to check, which takes about ${minutes} minutes. Keep this page open while it runs. Continue?`)) {
        progress('scanProgress', 'Scan cancelled. Choose a shorter period or a limit under "How many emails to check".', 'ok');
        return;
      }
    }

    const emails = [];
    for (let i = 0; i < todo.length; i++) {
      progress('scanProgress', `Reading email ${i + 1} of ${todo.length}…`);
      emails.push(await getMessage(token, todo[i]));
    }

    const { found, failed, lastError } = await extractAll(emails, 'scanProgress');
    await refreshSuggestions();
    refreshProcessedLine();
    let msg = `Checked ${emails.length} new email${emails.length === 1 ? '' : 's'} and found ${found} deadline${found === 1 ? '' : 's'} to review.`;
    if (failed) msg += ` ${failed} could not be checked (${lastError}). They will be tried again next scan.`;
    const left = fresh.length - todo.length;
    if (left) msg += ` ${left} more unchecked email${left === 1 ? ' is' : 's are'} left in this period; scan again to check ${left === 1 ? 'it' : 'them'}.`;
    progress('scanProgress', msg, failed ? 'error' : 'ok');
  } catch (err) {
    progress('scanProgress', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- paste ----------

async function extractPasted() {
  const body = $('pasteBody').value.trim();
  if (body.length < 20) { progress('pasteProgress', 'Paste the email text first.', 'error'); return; }
  const btn = $('pasteBtn');
  btn.disabled = true;
  try {
    const email = { source: 'paste', subject: $('pasteSubject').value.trim(), from: '', date: new Date().toISOString(), body };
    const { found, failed, lastError } = await extractAll([email], 'pasteProgress');
    if (failed) throw new Error(lastError);
    await refreshSuggestions();
    progress('pasteProgress', found
      ? `Found ${found} deadline${found === 1 ? '' : 's'}. Review below.`
      : 'No dated tasks found in that email.', 'ok');
    if (found) { $('pasteBody').value = ''; $('pasteSubject').value = ''; }
  } catch (err) {
    progress('pasteProgress', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- start ----------

async function init() {
  const ctx = await startSignedInPage();
  if (!ctx) return;
  state.email = ctx.user.email;

  if (!isGmailConfigured()) {
    $('gmailSetup').hidden = false;
    $('scanBtn').disabled = true;
  }

  $('scanBtn').addEventListener('click', scanGmail);
  $('scanDays').addEventListener('change', showRange);
  $('disconnectBtn').addEventListener('click', () => {
    disconnectGmail();
    $('disconnectBtn').hidden = true;
    progress('scanProgress', 'Gmail access removed. The next scan will ask again.', 'ok');
  });
  $('pasteBtn').addEventListener('click', extractPasted);
  $('dismissAllBtn').addEventListener('click', () => {
    if (window.confirm(`Dismiss all ${state.suggestions.length} suggestions?`)) dismiss(state.suggestions.map((s) => s.id));
  });

  try {
    const [suggestions, deadlines] = await Promise.all([data.listPending(), listDeadlines()]);
    state.suggestions = suggestions;
    state.deadlines = deadlines;
    render();
    refreshProcessedLine();
  } catch (err) {
    $('loadError').textContent =
      `Could not load: ${err.message}. If this mentions email_suggestions, run supabase/06_email_import.sql.`;
    $('loadError').hidden = false;
  }
  finishLoading();
}

init();
