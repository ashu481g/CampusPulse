// deadline-format.js — labels, date maths and wording shared by the
// home page and the deadlines page. No database access here.

export const CATEGORIES = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  exam: 'Exam',
  case_competition: 'Case competition',
  placement: 'Placement',
  other: 'Other',
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Whole calendar days from today to the due date (0 = today, -1 = yesterday).
export function daysFromToday(iso, now = new Date()) {
  return Math.round((startOfDay(iso) - startOfDay(now)) / DAY);
}

export function isOverdue(d, now = new Date()) {
  return d.status !== 'done' && new Date(d.dueAt) < now;
}

// 'overdue' | 'today' | 'soon' (next 2 days) | 'later' | 'done'
export function urgency(d, now = new Date()) {
  if (d.status === 'done') return 'done';
  if (isOverdue(d, now)) return 'overdue';
  const days = daysFromToday(d.dueAt, now);
  if (days === 0) return 'today';
  if (days <= 2) return 'soon';
  return 'later';
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Heading for a group of deadlines on the same day.
export function dayHeading(iso, now = new Date()) {
  const days = daysFromToday(iso, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (new Date(iso).getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return new Date(iso).toLocaleDateString('en-IN', opts);
}

// Short plain-language description of when something is due.
// withDate: false when the date is already shown in a day heading.
export function dueText(d, now = new Date(), { withDate = true } = {}) {
  if (d.status === 'done') return `Done ${formatDate(d.completedAt || d.dueAt)}`;
  const due = new Date(d.dueAt);
  const diffMs = due - now;
  const hours = Math.round(Math.abs(diffMs) / (60 * 60 * 1000));
  const days = daysFromToday(d.dueAt, now);

  if (diffMs < 0) {
    if (hours < 1) return 'Overdue by less than an hour';
    if (hours < 24) return `Overdue by ${hours} hour${hours === 1 ? '' : 's'}`;
    const late = Math.abs(days);
    return `Overdue by ${late} day${late === 1 ? '' : 's'}`;
  }
  if (days === 0) {
    if (hours < 1) return `Due within the hour, ${formatTime(d.dueAt)}`;
    return `Due today, ${formatTime(d.dueAt)}`;
  }
  if (days === 1) return `Due tomorrow, ${formatTime(d.dueAt)}`;
  return `Due in ${days} days, ${withDate ? formatDate(d.dueAt) : formatTime(d.dueAt)}`;
}

// Values for <input type="date"> and <input type="time"> in local time.
export function toDateInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function toTimeInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Combines local date + time inputs into an ISO timestamp.
export function fromInputs(date, time) {
  return new Date(`${date}T${time || '23:59'}`).toISOString();
}
