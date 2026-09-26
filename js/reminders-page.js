// reminders-page.js — the Reminders page (reminders.html).

import { startSignedInPage, finishLoading } from './shell.js';
import { getSettings, saveSettings, sendTestEmail } from './reminders-data.js';

const $ = (id) => document.getElementById(id);
let saved = null;

function hourLabel(h) {
  const d = new Date(2000, 0, 1, h, 0);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function fillSelects() {
  for (let h = 5; h <= 23; h++) $('sendHour').add(new Option(hourLabel(h), h));
  for (const d of [1, 2, 3, 5, 7, 14]) $('daysAhead').add(new Option(d === 1 ? 'Tomorrow only' : `Next ${d} days`, d));
}

function readForm() {
  return {
    enabled: $('enabled').checked,
    send_hour: Number($('sendHour').value),
    days_ahead: Number($('daysAhead').value),
    include_attendance: $('includeAttendance').checked,
    skip_empty: $('skipEmpty').checked,
  };
}

function fillForm(s) {
  $('enabled').checked = s.enabled;
  if (![...$('sendHour').options].some((o) => Number(o.value) === s.send_hour)) {
    $('sendHour').add(new Option(hourLabel(s.send_hour), s.send_hour));
  }
  $('sendHour').value = s.send_hour;
  $('daysAhead').value = s.days_ahead;
  $('includeAttendance').checked = s.include_attendance;
  $('skipEmpty').checked = s.skip_empty;
  reflectEnabled();
}

function reflectEnabled() {
  const on = $('enabled').checked;
  $('reminderOptions').dataset.off = String(!on);
  $('summaryLine').textContent = on
    ? `A summary will be emailed every day at ${hourLabel(Number($('sendHour').value))} India time.`
    : 'Daily reminders are off.';
}

function isDirty() {
  return saved && JSON.stringify(readForm()) !== JSON.stringify({
    enabled: saved.enabled, send_hour: saved.send_hour, days_ahead: saved.days_ahead,
    include_attendance: saved.include_attendance, skip_empty: saved.skip_empty,
  });
}

function updateSaveState() {
  $('saveBtn').disabled = !isDirty();
  $('saveNote').textContent = isDirty() ? 'You have unsaved changes.' : '';
}

function showStatus(s) {
  $('lastStatus').textContent = s.last_status
    ? `Last activity: ${s.last_status}`
    : 'No reminder has been sent yet.';
}

async function handleSave(e) {
  e.preventDefault();
  const values = readForm();
  $('saveBtn').disabled = true;
  $('saveNote').textContent = 'Saving…';
  try {
    await saveSettings(values);
    saved = { ...saved, ...values };
    $('saveNote').textContent = values.enabled ? 'Saved. Reminders are on.' : 'Saved. Reminders are off.';
  } catch (err) {
    $('saveNote').textContent = `Could not save: ${err.message}`;
    $('saveBtn').disabled = false;
  }
}

async function handleTest() {
  const btn = $('testBtn');
  const out = $('testResult');
  btn.disabled = true;
  out.dataset.kind = 'info';
  out.textContent = 'Sending…';
  out.hidden = false;
  try {
    const status = await sendTestEmail();
    out.dataset.kind = 'ok';
    out.textContent = `Test email ${status}. It can take a minute to arrive; check spam if you don't see it.`;
    showStatus(await getSettings());
  } catch (err) {
    out.dataset.kind = 'error';
    out.textContent = `Test email failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const ctx = await startSignedInPage();
  if (!ctx) return;

  fillSelects();
  $('recipient').textContent = ctx.user.email;

  try {
    saved = await getSettings();
    fillForm(saved);
    showStatus(saved);
  } catch (err) {
    $('loadError').textContent =
      `Could not load reminder settings: ${err.message}. If this mentions reminder_settings not existing, run supabase/04_reminders.sql.`;
    $('loadError').hidden = false;
  }

  $('reminderForm').addEventListener('input', () => { reflectEnabled(); updateSaveState(); });
  $('reminderForm').addEventListener('submit', handleSave);
  $('testBtn').addEventListener('click', handleTest);
  updateSaveState();
  finishLoading();
}

init();
