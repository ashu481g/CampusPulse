// attendance-page.js — the Attendance page (attendance.html).

import { startSignedInPage, finishLoading } from './shell.js';
import * as data from './attendance-data.js';
import {
  STATUSES, statsFor, margin, marginText, formatPercent,
  todayIso, shiftIso, prettyDate,
} from './attendance-calc.js';

const $ = (id) => document.getElementById(id);

const state = {
  subjects: [],
  records: [],
  target: 75,
  date: todayIso(),
  editingSubjectId: null,
  historySubjectId: null,
};

// ---------- small helpers ----------

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
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const recordsFor = (subjectId) => state.records.filter((r) => r.subjectId === subjectId);
const recordOn = (subjectId, date) => state.records.find((r) => r.subjectId === subjectId && r.date === date);
const subjectLabel = (s) => (s.code ? `${s.name} (${s.code})` : s.name);

// 'safe' | 'edge' | 'below' | 'none' — drives the colour of meters and text.
function tone(stats) {
  const m = margin(stats, state.target);
  if (m.kind === 'none') return 'none';
  if (m.kind === 'safe') return m.canMiss === 0 ? 'edge' : 'safe';
  return 'below';
}

function setMeter(meter, stats) {
  const pct = stats.percentage ?? 0;
  meter.querySelector('.meter-fill').style.width = `${pct}%`;
  meter.querySelector('.meter-target').style.left = `${state.target}%`;
  meter.dataset.tone = tone(stats);
}

function meterEl(stats) {
  const m = el('div', 'meter');
  m.setAttribute('aria-hidden', 'true');
  m.append(el('span', 'meter-fill'), el('span', 'meter-target'));
  setMeter(m, stats);
  return m;
}

// ---------- rendering ----------

function renderOverview() {
  const stats = statsFor(state.records);
  $('overallPercent').textContent = formatPercent(stats.percentage);
  $('overallPercent').dataset.tone = tone(stats);
  const n = state.subjects.length;
  $('overallLine').textContent = stats.total
    ? `${stats.attended} of ${stats.total} classes attended across ${n} subject${n === 1 ? '' : 's'}.`
    : 'No classes marked yet.';
  if (document.activeElement !== $('targetInput')) $('targetInput').value = state.target;
  setMeter($('overallMeter'), stats);
}

function renderMarking() {
  const today = todayIso();
  $('markDate').value = state.date;
  $('markDate').max = today;
  $('nextDay').disabled = state.date >= today;
  $('todayBtn').disabled = state.date === today;
  $('markDateLabel').textContent = state.date === today ? `Today, ${prettyDate(state.date)}` : prettyDate(state.date);

  const list = $('markList');
  list.textContent = '';
  $('markEmpty').hidden = state.subjects.length > 0;

  for (const s of state.subjects) {
    const rec = recordOn(s.id, state.date);
    const stats = statsFor(recordsFor(s.id));
    const li = el('li', 'mark-row');
    li.dataset.status = rec?.status || 'none';

    const info = el('div', 'mark-info');
    const nameLine = el('p', 'mark-name');
    nameLine.append(subjectLabel(s), ' ');
    const editBtn = el('button', 'link-btn mark-edit', 'Edit');
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', `Edit ${s.name}`);
    editBtn.addEventListener('click', () => openSubjectDialog(s));
    nameLine.appendChild(editBtn);
    info.append(nameLine);
    info.append(el('p', 'mark-stat', stats.total
      ? `${formatPercent(stats.percentage)}, ${marginText(stats, state.target).toLowerCase()}`
      : 'No classes marked yet'));

    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `${s.name} on ${prettyDate(state.date)}`);
    for (const [value, cfg] of Object.entries(STATUSES)) {
      const b = el('button', `seg-btn seg-${value}`, cfg.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', rec?.status === value);
      b.addEventListener('click', () => mark(s, value));
      group.appendChild(b);
    }
    li.append(info, group);
    list.appendChild(li);
  }
}

function renderSubjects() {
  const body = $('subjectRows');
  body.textContent = '';
  $('subjectsEmpty').hidden = state.subjects.length > 0;
  $('subjectTable').hidden = state.subjects.length === 0;

  // Lowest attendance first, so problems are at the top.
  const rows = state.subjects
    .map((s) => ({ s, stats: statsFor(recordsFor(s.id)) }))
    .sort((a, b) => (a.stats.percentage ?? 101) - (b.stats.percentage ?? 101) || a.s.name.localeCompare(b.s.name));

  for (const { s, stats } of rows) {
    const tr = el('tr');
    tr.dataset.tone = tone(stats);

    const name = el('td', 'att-subject');
    name.append(el('span', 'att-subject-name', s.name));
    if (s.code) name.append(el('span', 'att-subject-code', s.code));

    const attended = el('td', 'num', stats.total ? `${stats.attended} / ${stats.total}` : '—');
    if (stats.total) attended.append(el('span', 'num-suffix', ' attended'));
    else attended.classList.add('num-empty');

    const pct = el('td', 'att-pct-cell');
    const top = el('div', 'att-pct-top');
    top.append(el('span', 'att-pct', formatPercent(stats.percentage)), el('span', 'att-margin', marginText(stats, state.target)));
    pct.append(top, meterEl(stats));

    const actions = el('td', 'att-actions');
    const hist = el('button', 'btn-quiet', 'History');
    hist.type = 'button';
    hist.setAttribute('aria-label', `History for ${s.name}`);
    hist.addEventListener('click', () => openHistory(s.id));
    const edit = el('button', 'btn-quiet', 'Edit');
    edit.type = 'button';
    edit.setAttribute('aria-label', `Edit subject ${s.name}`);
    edit.addEventListener('click', () => openSubjectDialog(s));
    actions.append(hist, edit);

    tr.append(name, attended, pct, actions);
    body.appendChild(tr);
  }
}

function render() {
  renderOverview();
  renderMarking();
  renderSubjects();
  if ($('historyDialog').open) renderHistory();
}

// ---------- marking ----------

async function mark(subject, status) {
  const date = state.date;
  const existing = recordOn(subject.id, date);
  try {
    if (existing?.status === status) {
      // Pressing the selected button again clears the mark.
      await data.clearMark(subject.id, date);
      state.records = state.records.filter((r) => r !== existing);
      toast(`Cleared ${subject.name} for ${prettyDate(date, { day: 'numeric', month: 'short' })}.`);
    } else {
      const saved = await data.setMark(subject.id, date, status);
      state.records = state.records.filter((r) => !(r.subjectId === subject.id && r.date === date));
      state.records.push(saved);
      toast(`${subject.name}: ${STATUSES[status].label}.`);
    }
    render();
  } catch (err) {
    toast(`Could not save: ${err.message}`, true);
  }
}

function setDate(iso) {
  const today = todayIso();
  state.date = iso > today ? today : iso;
  renderMarking();
}

// ---------- target ----------

async function saveTarget() {
  const value = Number($('targetInput').value);
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    $('targetInput').value = state.target;
    toast('Enter a target between 1 and 100.', true);
    return;
  }
  const rounded = Math.round(value);
  if (rounded === state.target) return;
  try {
    await data.saveTarget(rounded);
    state.target = rounded;
    render();
    toast(`Target set to ${rounded}%.`);
  } catch (err) {
    $('targetInput').value = state.target;
    toast(`Could not save target: ${err.message}`, true);
  }
}

// ---------- subject dialog ----------

function openSubjectDialog(s = null) {
  state.editingSubjectId = s?.id || null;
  const f = $('subjectForm');
  f.reset();
  $('subjectError').hidden = true;
  $('subjectDialogTitle').textContent = s ? 'Edit subject' : 'Add subject';
  $('saveSubjectBtn').textContent = s ? 'Save changes' : 'Add subject';
  $('deleteSubjectBtn').hidden = !s;
  if (s) {
    f.subName.value = s.name;
    f.subCode.value = s.code;
    f.subDesc.value = s.description;
  }
  $('subjectDialog').showModal();
  f.subName.focus();
}

function subjectError(text) {
  $('subjectError').textContent = text;
  $('subjectError').hidden = !text;
}

async function saveSubject(e) {
  e.preventDefault();
  const f = $('subjectForm');
  const input = { name: f.subName.value.trim(), code: f.subCode.value.trim(), description: f.subDesc.value.trim() };
  if (!input.name) { subjectError('Enter a subject name.'); return; }

  // Same rule as the database, checked first for a quicker message.
  const clash = state.subjects.some((s) => s.id !== state.editingSubjectId && (
    s.name.trim().toLowerCase() === input.name.toLowerCase()
    || (input.code && s.code.trim().toLowerCase() === input.code.toLowerCase())));
  if (clash) { subjectError('A subject with this name or code already exists.'); return; }

  const btn = $('saveSubjectBtn');
  btn.disabled = true;
  try {
    if (state.editingSubjectId) {
      const updated = await data.updateSubject(state.editingSubjectId, input);
      state.subjects = state.subjects.map((s) => (s.id === updated.id ? updated : s));
      toast('Subject updated.');
    } else {
      const created = await data.createSubject(input);
      state.subjects.push(created);
      toast(`Added ${created.name}.`);
    }
    state.subjects.sort((a, b) => a.name.localeCompare(b.name));
    $('subjectDialog').close();
    render();
  } catch (err) {
    subjectError(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function deleteSubject() {
  const s = state.subjects.find((x) => x.id === state.editingSubjectId);
  if (!s) return;
  const count = recordsFor(s.id).length;
  const detail = count ? ` and its ${count} attendance record${count === 1 ? '' : 's'}` : '';
  if (!window.confirm(`Delete ${s.name}${detail}? This cannot be undone.`)) return;
  try {
    await data.deleteSubject(s.id);
    state.subjects = state.subjects.filter((x) => x.id !== s.id);
    state.records = state.records.filter((r) => r.subjectId !== s.id);
    $('subjectDialog').close();
    render();
    toast(`Deleted ${s.name}.`);
  } catch (err) {
    subjectError(`Could not delete: ${err.message}`);
  }
}

// ---------- history dialog ----------

function openHistory(subjectId) {
  state.historySubjectId = subjectId;
  renderHistory();
  $('historyDialog').showModal();
}

function renderHistory() {
  const s = state.subjects.find((x) => x.id === state.historySubjectId);
  if (!s) { $('historyDialog').close(); return; }
  const recs = recordsFor(s.id).sort((a, b) => b.date.localeCompare(a.date));
  const stats = statsFor(recs);

  $('historyTitle').textContent = subjectLabel(s);
  $('historySummary').textContent = stats.total
    ? `${stats.attended} of ${stats.total} attended (${formatPercent(stats.percentage)}). ${marginText(stats, state.target)}.`
    : '';
  $('historyEmpty').hidden = recs.length > 0;

  const list = $('historyList');
  list.textContent = '';
  for (const r of recs) {
    const li = el('li', 'history-row');
    li.dataset.status = r.status;

    li.append(el('span', 'history-date', prettyDate(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })));

    const select = el('select', 'history-status');
    select.setAttribute('aria-label', `Status on ${r.date}`);
    for (const [value, cfg] of Object.entries(STATUSES)) select.add(new Option(cfg.label, value, false, value === r.status));
    select.addEventListener('change', () => saveRecord(r, { status: select.value }));

    const remarks = el('input', 'history-remarks');
    remarks.type = 'text';
    remarks.maxLength = 300;
    remarks.placeholder = 'Remarks';
    remarks.value = r.remarks;
    remarks.setAttribute('aria-label', `Remarks for ${r.date}`);
    remarks.addEventListener('change', () => saveRecord(r, { remarks: remarks.value }));

    const del = el('button', 'btn-quiet history-delete', 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', `Delete record for ${r.date}`);
    del.addEventListener('click', () => removeRecord(r));

    li.append(select, remarks, del);
    list.appendChild(li);
  }
}

async function saveRecord(r, patch) {
  try {
    const updated = await data.updateRecord(r.id, { status: patch.status ?? r.status, remarks: patch.remarks ?? r.remarks });
    state.records = state.records.map((x) => (x.id === r.id ? updated : x));
    render();
    toast('Saved.');
  } catch (err) {
    toast(`Could not save: ${err.message}`, true);
    render();
  }
}

async function removeRecord(r) {
  if (!window.confirm(`Delete the record for ${prettyDate(r.date)}?`)) return;
  try {
    await data.deleteRecord(r.id);
    state.records = state.records.filter((x) => x.id !== r.id);
    render();
    toast('Record deleted.');
  } catch (err) {
    toast(`Could not delete: ${err.message}`, true);
  }
}

// ---------- import ----------

async function handleImport(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast('That file is not valid JSON.', true);
    return;
  }
  const check = data.validateBackup(parsed);
  if (!check.valid) { toast(check.reason, true); return; }
  if (!window.confirm(`Import ${parsed.subjects.length} subjects and ${parsed.attendance.length} attendance records?`)) return;

  try {
    const result = await data.importBackup(parsed, state.subjects);
    Object.assign(state, await data.loadAll());
    render();
    const skipped = result.recordsSkipped ? ` ${result.recordsSkipped} already existed and were kept as they were.` : '';
    toast(`Imported ${result.subjectsAdded} new subjects and ${result.recordsAdded} records.${skipped}`);
  } catch (err) {
    Object.assign(state, await data.loadAll().catch(() => ({})));
    render();
    toast(`Import stopped: ${err.message}`, true);
  }
}

// ---------- start ----------

function wire() {
  $('addSubjectBtn').addEventListener('click', () => openSubjectDialog());
  $('subjectForm').addEventListener('submit', saveSubject);
  $('cancelSubjectBtn').addEventListener('click', () => $('subjectDialog').close());
  $('deleteSubjectBtn').addEventListener('click', deleteSubject);
  $('closeHistoryBtn').addEventListener('click', () => $('historyDialog').close());
  $('historyEditBtn').addEventListener('click', () => {
    const s = state.subjects.find((x) => x.id === state.historySubjectId);
    $('historyDialog').close();
    if (s) openSubjectDialog(s);
  });

  $('prevDay').addEventListener('click', () => setDate(shiftIso(state.date, -1)));
  $('nextDay').addEventListener('click', () => setDate(shiftIso(state.date, 1)));
  $('todayBtn').addEventListener('click', () => setDate(todayIso()));
  $('markDate').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });

  $('targetInput').addEventListener('change', saveTarget);

  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) handleImport(file);
  });
}

async function init() {
  const ctx = await startSignedInPage();
  if (!ctx) return;
  wire();
  try {
    Object.assign(state, await data.loadAll());
    render();
  } catch (err) {
    $('loadError').textContent =
      `Could not load attendance: ${err.message}. If this mentions att_subjects not existing, run supabase/03_attendance.sql.`;
    $('loadError').hidden = false;
  }
  finishLoading();
}

init();
