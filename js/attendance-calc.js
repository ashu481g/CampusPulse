// attendance-calc.js — all attendance maths lives here (ported from the
// Attendance Register's reports.js). No database access.

// Every status the app understands. To add "late" or "excused" later,
// add an entry here and to the CHECK constraint in 03_attendance.sql.
export const STATUSES = {
  present: { label: 'Present', countsTowardTotal: true, countsAsAttended: true },
  absent:  { label: 'Absent',  countsTowardTotal: true, countsAsAttended: false },
};

export const DEFAULT_TARGET = 75;

// { total, attended, absent, percentage } for a list of records.
export function statsFor(records) {
  let total = 0;
  let attended = 0;
  for (const r of records) {
    const s = STATUSES[r.status];
    if (!s) continue;
    if (s.countsTowardTotal) total += 1;
    if (s.countsAsAttended) attended += 1;
  }
  const percentage = total ? Math.round((attended / total) * 1000) / 10 : null;
  return { total, attended, absent: total - attended, percentage };
}

// How many more classes can be missed while staying at or above target,
// or how many in a row must be attended to get back to it.
//   attended / (total + k) >= p      ->  k = floor(attended / p - total)
//   (attended + n) / (total + n) >= p ->  n = ceil((p*total - attended) / (1 - p))
export function margin({ total, attended }, targetPercent) {
  const p = targetPercent / 100;
  if (!total) return { kind: 'none' };
  if (attended / total >= p) {
    const canMiss = Math.max(0, Math.floor(attended / p - total + 1e-9));
    return { kind: 'safe', canMiss };
  }
  if (p >= 1) return { kind: 'unreachable' };
  const mustAttend = Math.ceil((p * total - attended) / (1 - p) - 1e-9);
  return { kind: 'below', mustAttend };
}

export function marginText(stats, targetPercent) {
  const m = margin(stats, targetPercent);
  switch (m.kind) {
    case 'none': return 'No classes marked yet';
    case 'safe':
      return m.canMiss === 0
        ? 'Cannot miss the next class'
        : `Can miss ${m.canMiss} more class${m.canMiss === 1 ? '' : 'es'}`;
    case 'below':
      return `Attend the next ${m.mustAttend} class${m.mustAttend === 1 ? '' : 'es'} to reach ${targetPercent}%`;
    default: return `${targetPercent}% can no longer be reached`;
  }
}

export function formatPercent(p) {
  if (p === null) return '—';
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

// ---------- local-date helpers (dates are 'YYYY-MM-DD' in local time) ----------

export function todayIso() {
  return isoFromDate(new Date());
}
export function isoFromDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function shiftIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoFromDate(new Date(y, m - 1, d + days));
}
export function prettyDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', opts);
}
