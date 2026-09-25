// supabaseClient.js — the one shared Supabase client.
// flowType 'pkce' = OAuth 2.0 Authorization Code flow with PKCE, the
// recommended flow for browser apps (no tokens ever appear in the URL).

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export function isConfigured() {
  return (
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
    !SUPABASE_PUBLISHABLE_KEY.includes('REPLACE_ME')
  );
}

export const supabase = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true, // exchanges ?code=... for a session automatically
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
