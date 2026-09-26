// google-config.js — the Google OAuth Client ID used to read Gmail.
//
// Use the SAME Client ID you pasted into Supabase for Google sign-in
// (Google Cloud -> Google Auth Platform -> Clients -> your web client).
// It ends in .apps.googleusercontent.com and is safe to publish.
// Never put the client SECRET here.

export const GOOGLE_CLIENT_ID = '56661093926-8i1h44rg5tmufn9puhr2srjcn5a9pu34.apps.googleusercontent.com';

export const isGmailConfigured = () => !GOOGLE_CLIENT_ID.startsWith('REPLACE_ME');
