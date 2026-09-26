// reminders-data.js — reads/writes reminder_settings and asks the
// daily-reminders Edge Function to send a test email.

import { supabase } from './supabaseClient.js';

export const DEFAULTS = { enabled: false, send_hour: 7, days_ahead: 3, include_attendance: true, skip_empty: true };

export async function getSettings() {
  const { data, error } = await supabase.from('reminder_settings')
    .select('enabled, send_hour, days_ahead, include_attendance, skip_empty, last_sent_on, last_status')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULTS, last_sent_on: null, last_status: '', ...(data || {}) };
}

export async function saveSettings(s) {
  const { error } = await supabase.from('reminder_settings').upsert({
    enabled: s.enabled,
    send_hour: s.send_hour,
    days_ahead: s.days_ahead,
    include_attendance: s.include_attendance,
    skip_empty: s.skip_empty,
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

// Returns the function's status text, or throws with its error message.
export async function sendTestEmail() {
  const { data, error } = await supabase.functions.invoke('daily-reminders', { body: { mode: 'test' } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    if (/failed to send a request|fetch/i.test(message)) {
      message = 'Could not reach the reminder function. Check that "daily-reminders" is deployed in Supabase.';
    }
    throw new Error(message);
  }
  if (data && data.ok === false) throw new Error(data.error || 'The test email could not be sent.');
  return data?.status || 'sent';
}
