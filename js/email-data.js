// email-data.js — suggestions found in email, and the call to the
// extract-deadlines function.

import { supabase } from './supabaseClient.js';
import { createDeadline } from './deadlines-data.js';

function check({ data, error, count }) {
  if (error) throw new Error(error.message);
  return count !== undefined && data === null ? count : data;
}

const fromRow = (r) => ({
  id: r.id,
  source: r.source,
  subject: r.email_subject,
  from: r.email_from,
  emailDate: r.email_date,
  title: r.title,
  category: r.category,
  course: r.course,
  dueAt: r.due_at,
  timeGiven: r.time_given,
  link: r.link,
  notes: r.notes,
  confidence: r.confidence,
  status: r.status,
});

export async function listPending() {
  const data = check(await supabase.from('email_suggestions').select('*').eq('status', 'pending').order('due_at'));
  return data.map(fromRow);
}

export async function countPending() {
  const { count, error } = await supabase.from('email_suggestions')
    .select('id', { count: 'exact', head: true }).eq('status', 'pending');
  if (error) throw new Error(error.message);
  return count || 0;
}

// Which of these Gmail ids were analysed before.
export async function alreadyProcessed(ids) {
  if (!ids.length) return new Set();
  const seen = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const data = check(await supabase.from('email_processed').select('message_id').in('message_id', ids.slice(i, i + 100)));
    data.forEach((r) => seen.add(r.message_id));
  }
  return seen;
}

export async function processedCount() {
  const { count, error } = await supabase.from('email_processed').select('message_id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

// Forget which emails were scanned, so the next scan reads them again.
export async function forgetProcessed() {
  check(await supabase.from('email_processed').delete().neq('message_id', ''));
}

// Sends up to 10 emails for extraction. Returns the function's per-email results.
export async function extract(emails) {
  const { data, error } = await supabase.functions.invoke('extract-deadlines', { body: { emails } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch { /* keep generic */ }
    if (/failed to send a request|fetch/i.test(message)) {
      message = 'Could not reach the extract-deadlines function. Check it is deployed in Supabase with JWT verification off.';
    }
    throw new Error(message);
  }
  return data?.results || [];
}

// Creates the real deadline, then marks the suggestion as accepted.
export async function accept(suggestion, edits) {
  const deadline = await createDeadline({
    title: edits.title,
    category: edits.category,
    course: edits.course,
    dueAt: edits.dueAt,
    link: suggestion.link,
    notes: suggestion.notes,
    source: 'email',
  });
  check(await supabase.from('email_suggestions')
    .update({ status: 'accepted', deadline_id: deadline.id }).eq('id', suggestion.id));
  return deadline;
}

export async function dismiss(ids) {
  check(await supabase.from('email_suggestions').update({ status: 'dismissed' }).in('id', ids));
}
