// config.js — project settings for CampusPulse AI.
//
// SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY: from your Supabase project's
// "Connect" button. The publishable key (sb_publishable_...) is safe to
// commit; never put the secret key here.
//
// ALLOWED_DOMAINS: shown in the UI and used to pre-select the right Google
// account. The database trigger (supabase/01_auth.sql) is what actually
// enforces it, so keep the two lists in step.

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_REPLACE_ME';

export const ALLOWED_DOMAINS = ['iiml.ac.in'];
