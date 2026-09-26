// deadlines-page.js — the Deadlines page (deadlines.html):
// list, filter, search, add, edit, mark done, delete.

import { startSignedInPage, finishLoading } from './shell.js';
import { listDeadlines, createDeadline, updateDeadline, setDone, deleteDeadline } from './deadlines-data.js';
import {
  CATEGORIES, isOverdue, urgency, dueText, dayHeading,
  daysFromToday, toDateInput, toTimeInput, fromInputs,
} from './deadline-format.js';

const $ = (id) => document.getElementById(id);

const state = {
  deadlines: [],
  view: 'upcoming', // upcoming | overdue | done | all
  category: '',
  search: '',
  editingId: null,
};

// ---------- messages ----------

let toastTimer;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.kind = isError ? 'error' : 'ok';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3000);
}

// ---------- filtering ----------

function matchesFilters(d) {
  if (state.category && d.category !== state.category) return false;
  if (state.search) {
    const hay = `${d.title} ${d.course} ${d.notes}`.toLowerCase();
    if (!hay.includes(state.search)) return false;
  }
  return true;
}

function inView(d, view, now) {
  if (view === 'done') return d.status === 'done';
  if (view === 'overdue') return isOverdue(d, now);
  if (view === 'upcoming') return d.status !== 'done' && !isOverdue(d, now);
  return true;
}

function visibleDeadlines(now) {
  const list = state.deadlines.filter((d) => inView(d, state.view, now) && matchesFilters(d));
  if (state.view === 'done') {
    list.sort((a, b) => new Date(b.completedAt || b.dueAt) - new Date(a.completedAt || a.dueAt));
  } else if (state.view === 'overdue') {
    list.sort((a, b) => new Date(b.dueAt) - new Date(a.dueAt)); // most recent first
  } else {
    list.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt));
  }
  return list;
}

// ---------- rendering ----------

function renderCounts(now) {
  for (const view of ['upcoming', 'overdue', 'done', 'all']) {
    const n = state.deadlines.filter((d) => inView(d, view, now)).length;
    const el = document.querySelector(`[data-view="${view}"] .tab-count`);
    if (el) el.textContent = n;
  }
}

function emptyMessage() {
  const filtered = state.category || state.search;
  if (filtered) return 'No deadlines match these filters. Clear the search or choose All categories.';
  switch (state.view) {
    case 'upcoming': return state.deadlines.length
      ? 'Nothing coming up. Add a deadline when you get the next one.'
      : 'Add your first deadline: an assignment, quiz, case competition or placement date.';
    case 'overdue': return 'Nothing overdue.';
    case 'done': return 'Deadlines you mark as done will appear here.';
    default: return 'No deadlines yet. Choose Add deadline to create one.';
  }
}

function rowFor(d, now) {
  const li = document.createElement('li');
  li.className = 'dl-row';
  li.dataset.urgency = urgency(d, now);

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'dl-check';
  check.setAttribute('aria-pressed', d.status === 'done');
  check.setAttribute('aria-label', d.status === 'done' ? `Mark "${d.title}" as not done` : `Mark "${d.title}" as done`);
  check.addEventListener('click', () => toggleDone(d));

  const main = document.createElement('div');
  main.className = 'dl-main';
  const title = document.createElement('p');
  title.className = 'dl-title';
  title.textContent = d.title;
  const meta = document.createElement('p');
  meta.className = 'dl-meta';
  const cat = document.createElement('span');
  cat.className = 'dl-cat';
  cat.dataset.category = d.category;
  cat.textContent = CATEGORIES[d.category];
  meta.appendChild(cat);
  if (d.course) {
    const course = document.createElement('span');
    course.textContent = d.course;
    meta.appendChild(course);
  }
  if (d.link) {
    const a = document.createElement('a');
    a.href = d.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Open link';
    meta.appendChild(a);
  }
  main.append(title, meta);
  if (d.notes) {
    const notes = document.createElement('p');
    notes.className = 'dl-notes';
    notes.textContent = d.notes;
    main.appendChild(notes);
  }

  const due = document.createElement('p');
  due.className = 'dl-due';
  due.textContent = dueText(d, now, { withDate: false });

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'btn-quiet dl-edit';
  edit.textContent = 'Edit';
  edit.setAttribute('aria-label', `Edit "${d.title}"`);
  edit.addEventListener('click', () => openDialog(d));

  li.append(check, main, due, edit);
  return li;
}

function render() {
  const now = new Date();
  renderCounts(now);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.setAttribute('aria-pressed', tab.dataset.view === state.view);
  });

  // Nudge on the Upcoming tab if anything is overdue.
  const overdueCount = state.deadlines.filter((d) => isOverdue(d, now)).length;
  const nudge = $('overdueNudge');
  nudge.hidden = !(state.view === 'upcoming' && overdueCount);
  $('overdueNudgeText').textContent =
    `${overdueCount} deadline${overdueCount === 1 ? ' is' : 's are'} overdue.`;

  const container = $('deadlineGroups');
  container.textContent = '';
  const items = visibleDeadlines(now);

  $('emptyState').hidden = items.length > 0;
  $('emptyStateText').textContent = emptyMessage();

  // Group by calendar day of the due date.
  let currentKey = null;
  let list = null;
  for (const d of items) {
    const key = toDateInput(d.dueAt);
    if (key !== currentKey) {
      currentKey = key;
      const section = document.createElement('section');
      section.className = 'day-group';
      const h = document.createElement('h2');
      h.className = 'day-heading';
      h.textContent = dayHeading(d.dueAt, now);
      if (daysFromToday(d.dueAt, now) === 0) h.dataset.today = 'true';
      list = document.createElement('ul');
      list.className = 'dl-list';
      section.append(h, list);
      container.appendChild(section);
    }
    list.appendChild(rowFor(d, now));
  }
}

// ---------- actions ----------

async function reload() {
  state.deadlines = await listDeadlines();
  render();
}

async function toggleDone(d) {
  const done = d.status !== 'done';
  try {
    const updated = await setDone(d.id, done);
    state.deadlines = state.deadlines.map((x) => (x.id === d.id ? updated : x));
    render();
    toast(done ? `Marked "${d.title}" as done.` : `Moved "${d.title}" back to pending.`);
  } catch (err) {
    toast(`Could not update: ${err.message}`, true);
  }
}

// ---------- dialog ----------

const dialog = () => $('deadlineDialog');

function setFormError(text) {
  $('formError').textContent = text;
  $('formError').hidden = !text;
}

function openDialog(d = null) {
  state.editingId = d?.id || null;
  const form = $('deadlineForm');
  form.reset();
  setFormError('');

  $('dialogTitle').textContent = d ? 'Edit deadline' : 'Add deadline';
  $('saveBtn').textContent = d ? 'Save changes' : 'Add deadline';
  $('deleteBtn').hidden = !d;

  if (d) {
    form.dlTitle.value = d.title;
    form.category.value = d.category;
    form.course.value = d.course;
    form.dueDate.value = toDateInput(d.dueAt);
    form.dueTime.value = toTimeInput(d.dueAt);
    form.link.value = d.link;
    form.notes.value = d.notes;
  } else {
    // Sensible default: tomorrow, end of day.
    const t = new Date();
    t.setDate(t.getDate() + 1);
    form.dueDate.value = toDateInput(t.toISOString());
    form.dueTime.value = '23:59';
    if (state.category) form.category.value = state.category;
  }

  dialog().showModal();
  form.dlTitle.focus();
}

function readForm() {
  const f = $('deadlineForm');
  const title = f.dlTitle.value.trim();
  const link = f.link.value.trim();
  if (!title) return { error: 'Enter a title.' };
  if (!f.dueDate.value) return { error: 'Choose a due date.' };
  if (link && !/^https?:\/\//i.test(link)) return { error: 'Links must start with http:// or https://.' };
  return {
    value: {
      title,
      category: f.category.value,
      course: f.course.value.trim(),
      dueAt: fromInputs(f.dueDate.value, f.dueTime.value),
      link,
      notes: f.notes.value.trim(),
    },
  };
}

async function handleSave(e) {
  e.preventDefault();
  const { value, error } = readForm();
  if (error) { setFormError(error); return; }

  const btn = $('saveBtn');
  btn.disabled = true;
  try {
    if (state.editingId) {
      const updated = await updateDeadline(state.editingId, value);
      state.deadlines = state.deadlines.map((x) => (x.id === updated.id ? updated : x));
      toast('Changes saved.');
    } else {
      const created = await createDeadline(value);
      state.deadlines.push(created);
      toast(`Added "${created.title}".`);
    }
    dialog().close();
    render();
  } catch (err) {
    setFormError(`Could not save: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

async function handleDelete() {
  const d = state.deadlines.find((x) => x.id === state.editingId);
  if (!d || !window.confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
  try {
    await deleteDeadline(d.id);
    state.deadlines = state.deadlines.filter((x) => x.id !== d.id);
    dialog().close();
    render();
    toast(`Deleted "${d.title}".`);
  } catch (err) {
    setFormError(`Could not delete: ${err.message}`);
  }
}

// ---------- start ----------

function wireEvents() {
  $('addBtn').addEventListener('click', () => openDialog());
  $('emptyAddBtn').addEventListener('click', () => openDialog());
  $('deadlineForm').addEventListener('submit', handleSave);
  $('cancelBtn').addEventListener('click', () => dialog().close());
  $('deleteBtn').addEventListener('click', handleDelete);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => { state.view = tab.dataset.view; render(); });
  });
  $('showOverdueBtn').addEventListener('click', () => { state.view = 'overdue'; render(); });

  $('categoryFilter').addEventListener('change', (e) => { state.category = e.target.value; render(); });
  $('searchInput').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });

  // Keep "Due in 3 hours" wording fresh if the page stays open.
  setInterval(render, 60 * 1000);
}

async function init() {
  const ctx = await startSignedInPage();
  if (!ctx) return;

  // Fill both category dropdowns from one list.
  for (const select of [$('categoryFilter'), $('deadlineForm').category]) {
    for (const [value, label] of Object.entries(CATEGORIES)) {
      select.add(new Option(label, value));
    }
  }

  wireEvents();
  try {
    await reload();
  } catch (err) {
    $('loadError').textContent =
      `Could not load deadlines: ${err.message}. If this mentions "deadlines" not existing, run supabase/02_deadlines.sql.`;
    $('loadError').hidden = false;
  }
  finishLoading();
}

init();
