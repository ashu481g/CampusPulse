// deadlines-data.js — the only module that reads or writes the
// public.deadlines table. Pages work with plain objects in camelCase.

import { supabase } from './supabaseClient.js';

const COLUMNS = 'id,title,category,course,due_at,link,notes,status,completed_at,source,created_at,competition_id';

const fromRow = (r) => ({
  id: r.id,
  title: r.title,
  category: r.category,
  course: r.course,
  dueAt: r.due_at,
  link: r.link,
  notes: r.notes,
  status: r.status,
  completedAt: r.completed_at,
  source: r.source,
  createdAt: r.created_at,
  competitionId: r.competition_id,
});

const toRow = (d) => ({
  title: d.title,
  category: d.category,
  course: d.course || '',
  due_at: d.dueAt,
  link: d.link || '',
  notes: d.notes || '',
  // Only sent when given, so editing from the Deadlines page keeps the link.
  ...(d.competitionId !== undefined ? { competition_id: d.competitionId } : {}),
  ...(d.source ? { source: d.source } : {}),
});

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// All of the signed-in user's deadlines, earliest first.
export async function listDeadlines() {
  const data = check(await supabase.from('deadlines').select(COLUMNS).order('due_at'));
  return data.map(fromRow);
}

export async function createDeadline(input) {
  const data = check(await supabase.from('deadlines').insert(toRow(input)).select(COLUMNS).single());
  return fromRow(data);
}

export async function updateDeadline(id, input) {
  const data = check(await supabase.from('deadlines').update(toRow(input)).eq('id', id).select(COLUMNS).single());
  return fromRow(data);
}

export async function setDone(id, done) {
  const patch = done
    ? { status: 'done', completed_at: new Date().toISOString() }
    : { status: 'pending', completed_at: null };
  const data = check(await supabase.from('deadlines').update(patch).eq('id', id).select(COLUMNS).single());
  return fromRow(data);
}

export async function deleteDeadline(id) {
  check(await supabase.from('deadlines').delete().eq('id', id));
}
