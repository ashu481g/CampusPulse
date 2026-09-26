// CampusPulse AI — daily-reminders Edge Function
//
// Two ways in:
//   1. The hourly scheduler (pg_cron) sends header x-cron-secret.
//      -> emails every student whose chosen hour (India time) is now and
//         who hasn't had today's email yet.
//   2. A signed-in student presses "Send me a test email" in the app.
//      -> emails just that student, right now.
//
// Secrets to set under Edge Functions -> Secrets:
//   RESEND_API_KEY  (required)  from resend.com -> API Keys
//   APP_URL         (required)  e.g. https://campus-pulse-rust-three.vercel.app
//   REMINDER_FROM   (optional)  default "CampusPulse AI <onboarding@resend.dev>"
// SUPABASE_URL and the secret key are provided by Supabase automatically.
//
// Deploy with "Verify JWT" turned OFF: this function checks callers itself.

import { createClient } from 'npm:@supabase/supabase-js@2';

const TZ = 'Asia/Kolkata';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function secretKey() {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    if (keys.default) return keys.default;
    const first = Object.values(keys)[0];
    if (first) return first;
  } catch { /* fall through to the legacy key */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

// ---------- India-time helpers ----------

function istParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Midnight at the END of the IST day that is `days` days after today, as a Date.
function endOfIstDay(todayIso, days) {
  const [y, m, d] = todayIso.split('-').map(Number);
  // IST is UTC+05:30 with no daylight saving.
  return new Date(Date.UTC(y, m - 1, d + days + 1, 0, 0) - 5.5 * 3600e3);
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fmtLongDate = (iso) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

// ---------- content ----------

const CATEGORIES = {
  assignment: 'Assignment', quiz: 'Quiz', exam: 'Exam',
  case_competition: 'Case competition', placement: 'Placement', other: 'Other',
};

// Same maths as js/attendance-calc.js in the web app.
function attendanceMargin(total, attended, target) {
  const p = target / 100;
  if (!total) return null;
  if (attended / total >= p) return { kind: 'safe', canMiss: Math.max(0, Math.floor(attended / p - total + 1e-9)) };
  if (p >= 1) return { kind: 'unreachable' };
  return { kind: 'below', mustAttend: Math.ceil((p * total - attended) / (1 - p) - 1e-9) };
}

export function buildDigest({ deadlines, subjects, records, target, settings, now, todayIst }) {
  const horizon = endOfIstDay(todayIst, settings.days_ahead);
  const endToday = endOfIstDay(todayIst, 0);
  const pending = deadlines.filter((d) => d.status !== 'done');

  const overdue = pending.filter((d) => new Date(d.due_at) < now);
  const today = pending.filter((d) => new Date(d.due_at) >= now && new Date(d.due_at) < endToday);
  const soon = pending.filter((d) => new Date(d.due_at) >= endToday && new Date(d.due_at) < horizon);

  const watch = [];
  if (settings.include_attendance) {
    for (const s of subjects) {
      const recs = records.filter((r) => r.subject_id === s.id);
      const total = recs.length;
      const attended = recs.filter((r) => r.status === 'present').length;
      const m = attendanceMargin(total, attended, target);
      if (!m) continue;
      if (m.kind === 'safe' && m.canMiss > 0) continue;
      const pct = Math.round((attended / total) * 1000) / 10;
      const advice = m.kind === 'below'
        ? `attend the next ${m.mustAttend} class${m.mustAttend === 1 ? '' : 'es'} to reach ${target}%`
        : m.kind === 'safe' ? 'cannot miss the next class' : `${target}% can no longer be reached`;
      watch.push({ name: s.name, pct, attended, total, advice, below: m.kind !== 'safe' });
    }
    watch.sort((a, b) => a.pct - b.pct);
  }

  const isEmpty = !overdue.length && !today.length && !soon.length && !watch.length;
  return { overdue, today, soon, watch, isEmpty };
}

function subjectLine(digest) {
  const bits = [];
  if (digest.today.length) bits.push(`${digest.today.length} due today`);
  if (digest.overdue.length) bits.push(`${digest.overdue.length} overdue`);
  if (digest.soon.length) bits.push(`${digest.soon.length} coming up`);
  if (!bits.length && digest.watch.length) bits.push('attendance to watch');
  return bits.length ? `CampusPulse: ${bits.join(', ')}` : 'CampusPulse: nothing due';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderEmail({ name, digest, todayIst, daysAhead, appUrl, isTest, hour = 7 }) {
  const first = (name || '').split(/\s+/)[0] || 'there';
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const maroon = '#8C1D2B';

  const dlRow = (d, when) => `
    <tr><td style="padding:10px 0;border-top:1px solid #E2DADC;">
      <div style="font-weight:600;color:#1E2230;">${esc(d.title)}</div>
      <div style="font-size:13px;color:#5D5A66;">${esc([CATEGORIES[d.category], d.course].filter(Boolean).join(', '))}</div>
    </td><td style="padding:10px 0 10px 12px;border-top:1px solid #E2DADC;text-align:right;white-space:nowrap;font-size:13px;color:#5D5A66;">${esc(when)}</td></tr>`;

  const section = (title, rows, colour = '#1E2230') => rows.length ? `
    <h2 style="font-size:16px;margin:24px 0 4px;color:${colour};">${esc(title)}</h2>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows.join('')}</table>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#F4F2F3;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:12px;border-top:4px solid ${maroon};">
  <tr><td style="padding:24px 24px 28px;">
    <div style="font-weight:700;color:${maroon};font-size:14px;">CampusPulse AI${isTest ? ' (test email)' : ''}</div>
    <h1 style="font-size:22px;margin:10px 0 4px;color:#5B0F1A;">${hello}, ${esc(first)}.</h1>
    <div style="color:#5D5A66;font-size:14px;">Your plan for ${esc(fmtLongDate(todayIst))}.</div>
    ${digest.isEmpty ? `<p style="margin:20px 0 0;color:#1E2230;">Nothing is due in the next ${daysAhead} day${daysAhead === 1 ? '' : 's'}, and your attendance is on track.</p>` : ''}
    ${section('Overdue', digest.overdue.map((d) => dlRow(d, `was due ${fmtDay(d.due_at)}`)), maroon)}
    ${section('Due today', digest.today.map((d) => dlRow(d, fmtTime(d.due_at))))}
    ${section(`Next ${daysAhead} day${daysAhead === 1 ? '' : 's'}`, digest.soon.map((d) => dlRow(d, `${fmtDay(d.due_at)}, ${fmtTime(d.due_at)}`)))}
    ${section('Attendance to watch', digest.watch.map((w) => `
      <tr><td style="padding:10px 0;border-top:1px solid #E2DADC;">
        <div style="font-weight:600;color:#1E2230;">${esc(w.name)}</div>
        <div style="font-size:13px;color:${w.below ? maroon : '#8A5A00'};">${esc(w.pct)}% (${w.attended} of ${w.total}), ${esc(w.advice)}</div>
      </td></tr>`))}
    <p style="margin:28px 0 0;"><a href="${esc(appUrl)}/app.html" style="background:${maroon};color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block;">Open CampusPulse</a></p>
  </td></tr></table>
  <p style="font-size:12px;color:#5D5A66;max-width:560px;margin:14px auto 0;">You get this email because daily reminders are on. Change the time or turn them off on the <a href="${esc(appUrl)}/reminders.html" style="color:${maroon};">Reminders page</a>.</p>
  </td></tr></table></body></html>`;

  const list = (title, items) => items.length ? `\n${title}\n${items.map((x) => `- ${x}`).join('\n')}\n` : '';
  const text = [
    `${hello}, ${first}. Your plan for ${fmtLongDate(todayIst)}.`,
    digest.isEmpty ? `\nNothing is due in the next ${daysAhead} days, and your attendance is on track.` : '',
    list('OVERDUE', digest.overdue.map((d) => `${d.title} (was due ${fmtDay(d.due_at)})`)),
    list('DUE TODAY', digest.today.map((d) => `${d.title} (${fmtTime(d.due_at)})`)),
    list(`NEXT ${daysAhead} DAYS`, digest.soon.map((d) => `${d.title} (${fmtDay(d.due_at)}, ${fmtTime(d.due_at)})`)),
    list('ATTENDANCE TO WATCH', digest.watch.map((w) => `${w.name}: ${w.pct}%, ${w.advice}`)),
    `\nOpen CampusPulse: ${appUrl}/app.html`,
    `Change reminders: ${appUrl}/reminders.html`,
  ].join('\n');

  return { subject: `${isTest ? '[Test] ' : ''}${subjectLine(digest)}`, html, text };
}

// ---------- sending ----------

async function sendEmail(to, { subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('REMINDER_FROM') || 'CampusPulse AI <onboarding@resend.dev>',
      to: [to], subject, html, text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function loadUserData(admin, userId) {
  const [profile, deadlines, subjects, records, target] = await Promise.all([
    admin.from('profiles').select('email, full_name').eq('id', userId).maybeSingle(),
    admin.from('deadlines').select('title, category, course, due_at, status').eq('user_id', userId).eq('status', 'pending'),
    admin.from('att_subjects').select('id, name').eq('user_id', userId),
    admin.from('att_records').select('subject_id, status').eq('user_id', userId).limit(10000),
    admin.from('att_settings').select('target_percent').eq('user_id', userId).maybeSingle(),
  ]);
  for (const r of [profile, deadlines, subjects, records, target]) if (r.error) throw new Error(r.error.message);
  return {
    profile: profile.data,
    deadlines: deadlines.data,
    subjects: subjects.data,
    records: records.data,
    target: Number(target.data?.target_percent ?? 75),
  };
}

async function remindOne(admin, userId, settings, { isTest }) {
  const now = new Date();
  const { date: todayIst, hour } = istParts(now);
  const data = await loadUserData(admin, userId);
  if (!data.profile?.email) throw new Error('No email address on the profile.');

  const digest = buildDigest({ ...data, settings, now, todayIst });
  if (digest.isEmpty && settings.skip_empty && !isTest) return 'skipped (nothing to report)';

  const email = renderEmail({
    name: data.profile.full_name, digest, todayIst,
    daysAhead: settings.days_ahead, appUrl: (Deno.env.get('APP_URL') || '').replace(/\/+$/, ''), isTest, hour,
  });
  await sendEmail(data.profile.email, email);
  return `sent to ${data.profile.email}`;
}

const DEFAULT_SETTINGS = { enabled: false, send_hour: 7, days_ahead: 3, include_attendance: true, skip_empty: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!Deno.env.get('RESEND_API_KEY')) return json({ error: 'RESEND_API_KEY secret is not set.' }, 500);

  const admin = createClient(Deno.env.get('SUPABASE_URL'), secretKey(), { auth: { persistSession: false } });

  // ---- 1. Scheduler ----
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret) {
    const { data: ok, error } = await admin.rpc('reminders_check_secret', { p_secret: cronSecret });
    if (error || !ok) return json({ error: 'Not allowed.' }, 401);

    const { date: todayIst, hour } = istParts();
    const { data: due, error: e2 } = await admin.from('reminder_settings')
      .select('user_id, send_hour, days_ahead, include_attendance, skip_empty, last_sent_on')
      .eq('enabled', true).eq('send_hour', hour)
      .or(`last_sent_on.is.null,last_sent_on.lt.${todayIst}`);
    if (e2) return json({ error: e2.message }, 500);

    const results = [];
    for (const s of due) {
      let status;
      try {
        status = await remindOne(admin, s.user_id, s, { isTest: false });
        await admin.from('reminder_settings')
          .update({ last_sent_on: todayIst, last_status: `${todayIst} ${String(hour).padStart(2, '0')}:00 IST: ${status}` })
          .eq('user_id', s.user_id);
      } catch (err) {
        status = `failed: ${err.message}`;
        await admin.from('reminder_settings')
          .update({ last_status: `${todayIst} ${String(hour).padStart(2, '0')}:00 IST: ${status}` })
          .eq('user_id', s.user_id);
      }
      results.push(status);
      await sleep(600); // stay under Resend's 2 requests per second
    }
    return json({ hour, date: todayIst, processed: results.length, results });
  }

  // ---- 2. Test email for the signed-in student ----
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first.' }, 401);
  const { data: userData, error: authError } = await admin.auth.getUser(token);
  if (authError || !userData?.user) return json({ error: 'Your session has expired. Sign in again.' }, 401);
  const userId = userData.user.id;

  const { data: row } = await admin.from('reminder_settings').select('*').eq('user_id', userId).maybeSingle();
  const settings = { ...DEFAULT_SETTINGS, ...(row || {}) };
  const { date: todayIst } = istParts();
  try {
    const status = await remindOne(admin, userId, settings, { isTest: true });
    if (row) await admin.from('reminder_settings').update({ last_status: `${todayIst}: test ${status}` }).eq('user_id', userId);
    return json({ ok: true, status });
  } catch (err) {
    return json({ ok: false, error: err.message }, 502);
  }
});
