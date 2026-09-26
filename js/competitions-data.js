// competitions-data.js — reads/writes case_competitions and the key dates
// (deadlines rows linked by competition_id).

import { supabase } from './supabaseClient.js';
import { createDeadline, setDone, deleteDeadline } from './deadlines-data.js';

const COLS = 'id,name,organizer,link,stage,outcome,result,team_name,team_members,notes,created_at,updated_at';

const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  organizer: r.organizer,
  link: r.link,
  stage: r.stage,
  outcome: r.outcome,
  result: r.result,
  teamName: r.team_name,
  teamMembers: r.team_members,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRow = (c) => ({
  name: c.name.trim(),
  organizer: (c.organizer || '').trim(),
  link: (c.link || '').trim(),
  stage: c.stage,
  outcome: c.outcome || null,
  result: (c.result || '').trim(),
  team_name: (c.teamName || '').trim(),
  team_members: (c.teamMembers || '').trim(),
  notes: (c.notes || '').trim(),
});

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function loadAll() {
  const [comps, dates] = await Promise.all([
    supabase.from('case_competitions').select(COLS).order('created_at', { ascending: false }),
    supabase.from('deadlines')
      .select('id,title,due_at,status,completed_at,competition_id')
      .not('competition_id', 'is', null)
      .order('due_at'),
  ]);
  return {
    competitions: check(comps).map(fromRow),
    dates: check(dates).map((d) => ({
      id: d.id, title: d.title, dueAt: d.due_at, status: d.status,
      completedAt: d.completed_at, competitionId: d.competition_id,
    })),
  };
}

export async function createCompetition(input) {
  return fromRow(check(await supabase.from('case_competitions').insert(toRow(input)).select(COLS).single()));
}

// Also keeps the competition name shown on its linked deadlines in step.
export async function updateCompetition(id, input, previousName) {
  const updated = fromRow(check(await supabase.from('case_competitions')
    .update(toRow(input)).eq('id', id).select(COLS).single()));
  if (previousName !== undefined && previousName !== updated.name) {
    check(await supabase.from('deadlines').update({ course: updated.name }).eq('competition_id', id));
  }
  return updated;
}

// Quick stage/outcome change from a card.
export async function patchCompetition(id, patch) {
  return fromRow(check(await supabase.from('case_competitions').update(patch).eq('id', id).select(COLS).single()));
}

// Deleting a competition also deletes its key dates (ON DELETE CASCADE).
export async function deleteCompetition(id) {
  check(await supabase.from('case_competitions').delete().eq('id', id));
}

// ---------- key dates ----------

const toDate = (d) => ({
  id: d.id, title: d.title, dueAt: d.dueAt, status: d.status,
  completedAt: d.completedAt, competitionId: d.competitionId,
});

export async function addDate(competition, { title, dueAt }) {
  return toDate(await createDeadline({
    title, dueAt, category: 'case_competition', course: competition.name,
    link: competition.link || '', notes: '', competitionId: competition.id,
  }));
}

// Changes only the title and time, so notes added on the Deadlines page are kept.
export async function editDate(id, { title, dueAt }) {
  const d = check(await supabase.from('deadlines')
    .update({ title, due_at: dueAt }).eq('id', id)
    .select('id,title,due_at,status,completed_at,competition_id').single());
  return toDate({
    id: d.id, title: d.title, dueAt: d.due_at, status: d.status,
    completedAt: d.completed_at, competitionId: d.competition_id,
  });
}

export async function setDateDone(id, done) {
  return toDate(await setDone(id, done));
}

export async function removeDate(id) {
  await deleteDeadline(id);
}
