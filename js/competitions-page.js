// competitions-page.js — the Case competitions page (competitions.html).

import { startSignedInPage, finishLoading } from './shell.js';
import * as data from './competitions-data.js';
import { STAGES, OUTCOMES, stageIndex, stageLabel, nextStage, DATE_SUGGESTIONS } from './competition-stages.js';
import { dueText, toDateInput, toTimeInput, fromInputs, formatDate, formatTime } from './deadline-format.js';

const $ = (id) => document.getElementById(id);

const state = {
  competitions: [],
  dates: [],
  view: 'active',
  editingId: null,     // competition open in the dialog
  editingDateId: null, // key date being edited
};

// ---------- helpers ----------

let toastTimer;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.kind = isError ? 'error' : 'ok';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 2500);
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

const isActive = (c) => !c.outcome;
const datesFor = (id) => state.dates.filter((d) => d.competitionId === id)
  .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));

// The pending date that matters most: the earliest overdue one, else the next one.
function nextDateFor(id, now = new Date()) {
  return datesFor(id).find((d) => d.status !== 'done') || null;
}

// ---------- summary + list ----------

function renderSummary() {
  const now = new Date();
  const active = state.competitions.filter(isActive);
  const won = state.competitions.filter((c) => c.outcome === 'won').length;
  if (!state.competitions.length) {
    $('summary').textContent = 'Track every competition from registration to result, with its dates feeding into your deadlines and reminders.';
    return;
  }
  const upcoming = active
    .map((c) => ({ c, d: nextDateFor(c.id) }))
    .filter((x) => x.d)
    .sort((a, b) => new Date(a.d.dueAt) - new Date(b.d.dueAt))[0];

  let text = `${active.length} active`;
  if (won) text += `, ${won} won`;
  text += '.';
  if (upcoming) {
    const late = new Date(upcoming.d.dueAt) < now;
    text += late
      ? ` Overdue: ${upcoming.d.title} for ${upcoming.c.name}.`
      : ` Next: ${upcoming.d.title} for ${upcoming.c.name}, ${formatDate(upcoming.d.dueAt)} at ${formatTime(upcoming.d.dueAt)}.`;
  }
  $('summary').textContent = text;
}

function stepper(c) {
  const ol = el('ol', 'stepper');
  ol.setAttribute('aria-label', `Stage: ${stageLabel(c.stage)}`);
  const reached = stageIndex(c.stage);
  STAGES.forEach((s, i) => {
    const li = el('li', 'step');
    li.dataset.state = i < reached ? 'done' : i === reached ? 'current' : 'todo';
    if (c.outcome === 'won' && i === reached) li.dataset.state = 'done';
    li.append(el('span', 'step-dot'), el('span', 'step-label', s.label));
    if (i === reached) li.setAttribute('aria-current', 'step');
    ol.appendChild(li);
  });
  return ol;
}

function card(c) {
  const now = new Date();
  const art = el('article', 'comp-card');
  art.dataset.outcome = c.outcome || 'active';

  const head = el('div', 'comp-head');
  const titles = el('div');
  titles.append(el('h2', 'comp-name', c.name));
  if (c.organizer) titles.append(el('p', 'comp-org', c.organizer));
  head.appendChild(titles);
  if (c.outcome) {
    head.appendChild(el('span', `comp-badge badge-${c.outcome}`, OUTCOMES[c.outcome]));
  }
  art.appendChild(head);

  art.appendChild(stepper(c));

  if (c.outcome && c.result) art.appendChild(el('p', 'comp-result', c.result));

  if (!c.outcome) {
    const next = nextDateFor(c.id, now);
    const line = el('p', 'comp-next');
    if (next) {
      line.dataset.urgency = new Date(next.dueAt) < now ? 'overdue' : 'upcoming';
      line.append(el('strong', '', next.title), ` ${dueText({ ...next, status: 'pending' }, now).replace(/^Due/, 'due')}`);
    } else {
      line.textContent = 'No upcoming dates. Open it to add them.';
      line.dataset.urgency = 'none';
    }
    art.appendChild(line);
  }

  if (c.teamName || c.teamMembers) {
    const team = [c.teamName, c.teamMembers].filter(Boolean).join(': ');
    art.appendChild(el('p', 'comp-team', team));
  }

  const actions = el('div', 'comp-actions');
  const nxt = nextStage(c.stage);
  if (!c.outcome && nxt) {
    const b = el('button', 'btn-quiet', STAGES[stageIndex(c.stage)].next);
    b.type = 'button';
    b.addEventListener('click', () => advance(c, nxt.id));
    actions.appendChild(b);
  }
  if (c.link) {
    const a = el('a', 'comp-link', 'Website');
    a.href = c.link;
    a.target = '_blank';
    a.rel = 'noopener';
    actions.appendChild(a);
  }
  const open = el('button', 'btn-primary btn-small', 'Open');
  open.type = 'button';
  open.setAttribute('aria-label', `Open ${c.name}`);
  open.addEventListener('click', () => openDialog(c.id));
  actions.appendChild(open);
  art.appendChild(actions);

  return art;
}

function render() {
  renderSummary();

  const counts = {
    active: state.competitions.filter(isActive).length,
    finished: state.competitions.filter((c) => !isActive(c)).length,
    all: state.competitions.length,
  };
  document.querySelectorAll('.tab').forEach((t) => {
    t.setAttribute('aria-pressed', t.dataset.view === state.view);
    t.querySelector('.tab-count').textContent = counts[t.dataset.view];
  });

  let list = state.competitions.filter((c) =>
    state.view === 'all' || (state.view === 'active' ? isActive(c) : !isActive(c)));

  // Active: soonest date first, competitions without dates last.
  const key = (c) => {
    const d = nextDateFor(c.id);
    return d ? new Date(d.dueAt).getTime() : Infinity;
  };
  list = list.sort((a, b) => (isActive(a) === isActive(b) ? key(a) - key(b) : isActive(a) ? -1 : 1)
    || new Date(b.updatedAt) - new Date(a.updatedAt));

  const grid = $('compGrid');
  grid.textContent = '';
  list.forEach((c) => grid.appendChild(card(c)));

  $('emptyState').hidden = list.length > 0;
  $('emptyText').textContent = !state.competitions.length
    ? 'No competitions yet. Add one you are interested in or registered for.'
    : state.view === 'active' ? 'No active competitions. Add a new one when you find it.'
      : 'Competitions get here once you record a result: won, not selected or withdrawn.';
}

async function advance(c, stage) {
  try {
    const updated = await data.patchCompetition(c.id, { stage });
    replaceCompetition(updated);
    render();
    toast(`${c.name}: ${stageLabel(stage)}.`);
  } catch (err) {
    toast(`Could not update: ${err.message}`, true);
  }
}

function replaceCompetition(updated) {
  state.competitions = state.competitions.map((x) => (x.id === updated.id ? updated : x));
}

// ---------- dialog: competition ----------

function setError(id, text) {
  $(id).textContent = text;
  $(id).hidden = !text;
}

function reflectOutcome() {
  $('resultField').hidden = !$('cOutcome').value;
}

function openDialog(id = null) {
  const c = id ? state.competitions.find((x) => x.id === id) : null;
  state.editingId = c?.id || null;
  const f = $('compForm');
  f.reset();
  setError('compError', '');
  setError('dateError', '');

  if (c) {
    f.cName.value = c.name;
    f.cOrganizer.value = c.organizer;
    f.cLink.value = c.link;
    f.cStage.value = c.stage;
    f.cOutcome.value = c.outcome || '';
    f.cResult.value = c.result;
    f.cTeam.value = c.teamName;
    f.cMembers.value = c.teamMembers;
    f.cNotes.value = c.notes;
  }
  reflectOutcome();
  reflectMode();
  resetDateForm();
  renderDates();
  $('compDialog').showModal();
  if (!c) f.cName.focus();
}

function reflectMode() {
  const editing = !!state.editingId;
  $('compDialogTitle').textContent = editing ? 'Competition' : 'Add competition';
  $('saveBtn').textContent = editing ? 'Save changes' : 'Add competition';
  $('deleteBtn').hidden = !editing;
  $('datesSection').hidden = !editing;
  $('closeBtn').textContent = editing ? 'Close' : 'Cancel';
}

function readCompForm() {
  const f = $('compForm');
  const v = {
    name: f.cName.value.trim(),
    organizer: f.cOrganizer.value.trim(),
    link: f.cLink.value.trim(),
    stage: f.cStage.value,
    outcome: f.cOutcome.value || null,
    result: f.cResult.value.trim(),
    teamName: f.cTeam.value.trim(),
    teamMembers: f.cMembers.value.trim(),
    notes: f.cNotes.value.trim(),
  };
  if (!v.name) return { error: 'Enter the competition name.' };
  if (v.link && !/^https?:\/\//i.test(v.link)) return { error: 'Links must start with http:// or https://.' };
  if (!v.outcome) v.result = '';
  return { value: v };
}

async function saveCompetition(e) {
  e.preventDefault();
  const { value, error } = readCompForm();
  if (error) { setError('compError', error); return; }
  setError('compError', '');

  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    if (state.editingId) {
      const before = state.competitions.find((x) => x.id === state.editingId);
      const updated = await data.updateCompetition(state.editingId, value, before?.name);
      replaceCompetition(updated);
      $('compDialog').close();
      toast('Changes saved.');
    } else {
      const created = await data.createCompetition(value);
      state.competitions.unshift(created);
      // Stay open so the key dates can be added straight away.
      state.editingId = created.id;
      reflectMode();
      renderDates();
      $('dTitle').focus();
      toast(`Added ${created.name}. Now add its key dates.`);
    }
    render();
  } catch (err) {
    setError('compError', `Could not save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function deleteCompetition() {
  const c = state.competitions.find((x) => x.id === state.editingId);
  if (!c) return;
  const n = datesFor(c.id).length;
  const extra = n ? ` Its ${n} key date${n === 1 ? '' : 's'} will be removed from your deadlines too.` : '';
  if (!window.confirm(`Delete ${c.name}?${extra} This cannot be undone.`)) return;
  try {
    await data.deleteCompetition(c.id);
    state.competitions = state.competitions.filter((x) => x.id !== c.id);
    state.dates = state.dates.filter((d) => d.competitionId !== c.id);
    $('compDialog').close();
    render();
    toast(`Deleted ${c.name}.`);
  } catch (err) {
    setError('compError', `Could not delete: ${err.message}`);
  }
}

// ---------- dialog: key dates ----------

function renderDates() {
  const list = $('datesList');
  list.textContent = '';
  if (!state.editingId) return;
  const now = new Date();
  const dates = datesFor(state.editingId);
  if (!dates.length) {
    list.appendChild(el('li', 'dates-empty', 'No dates yet. Add the registration deadline and each round below.'));
    return;
  }
  for (const d of dates) {
    const li = el('li', 'date-row');
    const overdue = d.status !== 'done' && new Date(d.dueAt) < now;
    li.dataset.state = d.status === 'done' ? 'done' : overdue ? 'overdue' : 'pending';

    const check = el('button', 'dl-check');
    check.type = 'button';
    check.setAttribute('aria-pressed', d.status === 'done');
    check.setAttribute('aria-label', d.status === 'done' ? `Mark "${d.title}" as not done` : `Mark "${d.title}" as done`);
    check.addEventListener('click', () => toggleDate(d));

    const text = el('div', 'date-text');
    text.append(el('span', 'date-title', d.title),
      el('span', 'date-when', `${formatDate(d.dueAt)}, ${formatTime(d.dueAt)}${overdue ? ' (overdue)' : ''}`));

    const edit = el('button', 'btn-quiet btn-tiny', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit "${d.title}"`);
    edit.addEventListener('click', () => startEditDate(d));

    const del = el('button', 'btn-quiet btn-tiny', 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', `Delete "${d.title}"`);
    del.addEventListener('click', () => deleteDate(d));

    li.append(check, text, edit, del);
    list.appendChild(li);
  }
}

function resetDateForm() {
  state.editingDateId = null;
  $('dTitle').value = '';
  $('dDate').value = '';
  $('dTime').value = '23:59';
  $('dSave').textContent = 'Add date';
  $('dCancel').hidden = true;
  setError('dateError', '');
}

function startEditDate(d) {
  state.editingDateId = d.id;
  $('dTitle').value = d.title;
  $('dDate').value = toDateInput(d.dueAt);
  $('dTime').value = toTimeInput(d.dueAt);
  $('dSave').textContent = 'Update date';
  $('dCancel').hidden = false;
  $('dTitle').focus();
}

async function saveDate() {
  const c = state.competitions.find((x) => x.id === state.editingId);
  if (!c) return;
  const title = $('dTitle').value.trim();
  if (!title) { setError('dateError', 'Say what happens on this date, e.g. "Round 1 submission".'); return; }
  if (!$('dDate').value) { setError('dateError', 'Choose a date.'); return; }
  const dueAt = fromInputs($('dDate').value, $('dTime').value);

  const btn = $('dSave');
  btn.disabled = true;
  try {
    if (state.editingDateId) {
      const updated = await data.editDate(state.editingDateId, { title, dueAt });
      state.dates = state.dates.map((x) => (x.id === updated.id ? updated : x));
      toast('Date updated.');
    } else {
      state.dates.push(await data.addDate(c, { title, dueAt }));
      toast(`Added "${title}". It is on your Deadlines page too.`);
    }
    resetDateForm();
    renderDates();
    render();
  } catch (err) {
    setError('dateError', `Could not save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function toggleDate(d) {
  try {
    const updated = await data.setDateDone(d.id, d.status !== 'done');
    state.dates = state.dates.map((x) => (x.id === d.id ? updated : x));
    renderDates();
    render();
  } catch (err) {
    setError('dateError', `Could not update: ${err.message}`);
  }
}

async function deleteDate(d) {
  if (!window.confirm(`Delete "${d.title}"? It will also disappear from your deadlines.`)) return;
  try {
    await data.removeDate(d.id);
    state.dates = state.dates.filter((x) => x.id !== d.id);
    if (state.editingDateId === d.id) resetDateForm();
    renderDates();
    render();
  } catch (err) {
    setError('dateError', `Could not delete: ${err.message}`);
  }
}

// ---------- start ----------

function wire() {
  $('addBtn').addEventListener('click', () => openDialog());
  $('emptyAddBtn').addEventListener('click', () => openDialog());
  $('compForm').addEventListener('submit', saveCompetition);
  $('cOutcome').addEventListener('change', reflectOutcome);
  $('deleteBtn').addEventListener('click', deleteCompetition);
  $('closeBtn').addEventListener('click', () => $('compDialog').close());

  $('dSave').addEventListener('click', saveDate);
  $('dCancel').addEventListener('click', resetDateForm);
  for (const id of ['dTitle', 'dDate', 'dTime']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveDate(); } });
  }

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { state.view = t.dataset.view; render(); }));
}

function fillStatic() {
  for (const s of STAGES) $('cStage').add(new Option(s.label, s.id));
  for (const [v, label] of Object.entries(OUTCOMES)) $('cOutcome').add(new Option(label, v));
  for (const t of DATE_SUGGESTIONS) $('dateSuggestions').appendChild(new Option(t));
}

async function init() {
  // Read the deep link first: the sign-in check tidies the address bar.
  const openId = new URLSearchParams(window.location.search).get('open');
  const ctx = await startSignedInPage();
  if (!ctx) return;
  fillStatic();
  wire();
  try {
    Object.assign(state, await data.loadAll());
    render();
    // Deep link from the Deadlines page: competitions.html?open=<id>
    if (openId && state.competitions.some((c) => c.id === openId)) {
      const c = state.competitions.find((x) => x.id === openId);
      if (!isActive(c)) state.view = 'all';
      render();
      openDialog(openId);
      window.history.replaceState(null, '', window.location.pathname);
    }
  } catch (err) {
    $('loadError').textContent =
      `Could not load competitions: ${err.message}. If this mentions case_competitions or competition_id, run supabase/05_competitions.sql.`;
    $('loadError').hidden = false;
  }
  finishLoading();
}

init();
