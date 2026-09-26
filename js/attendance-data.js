// attendance-data.js — the only module that reads or writes the
// att_subjects, att_records and att_settings tables.

import { supabase } from './supabaseClient.js';
import { DEFAULT_TARGET } from './attendance-calc.js';

function check({ data, error }) {
  if (error) {
    // Friendlier wording for the unique-name / unique-code rules.
    if (error.code === '23505' && /att_subjects/.test(error.message)) {
      throw new Error('A subject with this name or code already exists.');
    }
    throw new Error(error.message);
  }
  return data;
}

const subjectFromRow = (r) => ({
  id: r.id, name: r.name, code: r.code, description: r.description, createdAt: r.created_at,
});
const recordFromRow = (r) => ({
  id: r.id, subjectId: r.subject_id, date: r.date, status: r.status, remarks: r.remarks,
});

const SUBJECT_COLS = 'id,name,code,description,created_at';
const RECORD_COLS = 'id,subject_id,date,status,remarks';

// ---------- loading ----------

async function fetchAllRecords() {
  const rows = [];
  const PAGE = 1000; // Supabase returns at most 1000 rows per request
  for (let from = 0; ; from += PAGE) {
    const data = check(await supabase.from('att_records').select(RECORD_COLS)
      .order('date').order('id').range(from, from + PAGE - 1));
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Everything the attendance page needs, in one go.
export async function loadAll() {
  const [subjects, records, settings] = await Promise.all([
    supabase.from('att_subjects').select(SUBJECT_COLS).order('name'),
    fetchAllRecords(),
    supabase.from('att_settings').select('target_percent').maybeSingle(),
  ]);
  return {
    subjects: check(subjects).map(subjectFromRow),
    records: records.map(recordFromRow),
    target: Number(check(settings)?.target_percent ?? DEFAULT_TARGET),
  };
}

// ---------- subjects ----------

const subjectToRow = (s) => ({
  name: s.name.trim(), code: (s.code || '').trim(), description: (s.description || '').trim(),
});

export async function createSubject(input) {
  return subjectFromRow(check(await supabase.from('att_subjects')
    .insert(subjectToRow(input)).select(SUBJECT_COLS).single()));
}

export async function updateSubject(id, input) {
  return subjectFromRow(check(await supabase.from('att_subjects')
    .update(subjectToRow(input)).eq('id', id).select(SUBJECT_COLS).single()));
}

// Deletes the subject and (via ON DELETE CASCADE) all of its records.
export async function deleteSubject(id) {
  check(await supabase.from('att_subjects').delete().eq('id', id));
}

// ---------- records ----------

// Sets the status for one subject on one date (creates or replaces).
export async function setMark(subjectId, date, status) {
  return recordFromRow(check(await supabase.from('att_records')
    .upsert({ subject_id: subjectId, date, status }, { onConflict: 'user_id,subject_id,date' })
    .select(RECORD_COLS).single()));
}

export async function clearMark(subjectId, date) {
  check(await supabase.from('att_records').delete().eq('subject_id', subjectId).eq('date', date));
}

export async function updateRecord(id, { status, remarks }) {
  return recordFromRow(check(await supabase.from('att_records')
    .update({ status, remarks: (remarks || '').trim() }).eq('id', id).select(RECORD_COLS).single()));
}

export async function deleteRecord(id) {
  check(await supabase.from('att_records').delete().eq('id', id));
}

// ---------- settings ----------

export async function saveTarget(targetPercent) {
  check(await supabase.from('att_settings')
    .upsert({ target_percent: targetPercent }, { onConflict: 'user_id' }));
}

// ---------- import from the Attendance Register app's backup file ----------

// Returns { valid, reason } for a parsed backup file.
export function validateBackup(data) {
  if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.attendance)) {
    return { valid: false, reason: 'This is not an Attendance Register backup file (subjects/attendance missing).' };
  }
  const okSubjects = data.subjects.every((s) => s && typeof s.id === 'string' && typeof s.name === 'string');
  const okRecords = data.attendance.every((a) => a && typeof a.subjectId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && ['present', 'absent'].includes(String(a.status).toLowerCase()));
  if (!okSubjects || !okRecords) return { valid: false, reason: 'Some records in the file are incomplete.' };
  return { valid: true };
}

// Merges a backup into the student's data. Subjects are matched by name
// (case-insensitive); existing marks for the same subject and date are kept.
export async function importBackup(data, existingSubjects) {
  const byName = new Map(existingSubjects.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const idMap = new Map(); // old subject id -> new uuid
  let subjectsAdded = 0;

  for (const s of data.subjects) {
    const key = s.name.trim().toLowerCase();
    if (byName.has(key)) {
      idMap.set(s.id, byName.get(key));
      continue;
    }
    // Drop a clashing code rather than fail the whole import.
    let created;
    try {
      created = await createSubject({ name: s.name, code: s.code || '', description: s.description || '' });
    } catch {
      created = await createSubject({ name: s.name, code: '', description: s.description || '' });
    }
    byName.set(key, created.id);
    idMap.set(s.id, created.id);
    subjectsAdded += 1;
  }

  const rows = data.attendance
    .filter((a) => idMap.has(a.subjectId))
    .map((a) => ({
      subject_id: idMap.get(a.subjectId),
      date: a.date,
      status: String(a.status).toLowerCase(),
      remarks: (a.remarks || '').slice(0, 300),
    }));

  let recordsAdded = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = check(await supabase.from('att_records')
      .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,subject_id,date', ignoreDuplicates: true })
      .select('id'));
    recordsAdded += inserted.length;
  }

  return { subjectsAdded, recordsAdded, recordsSkipped: rows.length - recordsAdded };
}
