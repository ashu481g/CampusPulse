// competition-stages.js — stage and outcome names, shared by the page.

export const STAGES = [
  { id: 'interested', label: 'Interested', next: 'Mark registered' },
  { id: 'registered', label: 'Registered', next: 'Mark submitted' },
  { id: 'submitted', label: 'Submitted', next: 'Mark shortlisted' },
  { id: 'shortlisted', label: 'Shortlisted', next: 'Mark finalist' },
  { id: 'finalist', label: 'Finalist', next: null },
];

export const OUTCOMES = {
  won: 'Won',
  not_selected: 'Not selected',
  withdrawn: 'Withdrawn',
};

export const stageIndex = (id) => STAGES.findIndex((s) => s.id === id);
export const stageLabel = (id) => STAGES[stageIndex(id)]?.label || id;
export const nextStage = (id) => STAGES[stageIndex(id) + 1] || null;

// Suggested key-date titles for the "Add date" box.
export const DATE_SUGGESTIONS = [
  'Registration closes',
  'Round 1 submission',
  'Round 1 results',
  'Round 2 submission',
  'Round 2 results',
  'Finals presentation',
  'Final results',
];
