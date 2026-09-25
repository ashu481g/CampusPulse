// app.js — the signed-in home page (app.html). Part 1 shows who you are;
// later parts add the dashboard modules here.

import { isConfigured } from './supabaseClient.js';
import { requireUser, getProfile, signOut, watchForSignOut, goToSignIn } from './auth.js';

const $ = (id) => document.getElementById(id);

const ROLE_LABELS = { student: 'Student', cr: 'Course Representative', admin: 'Administrator' };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function initials(name, email) {
  const parts = (name || email || '?').trim().split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function renderAvatar(el, url, name, email) {
  el.textContent = '';
  if (!url) { el.textContent = initials(name, email); return; }
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.referrerPolicy = 'no-referrer'; // Google profile photos need this
  img.addEventListener('error', () => { el.textContent = initials(name, email); });
  el.appendChild(img);
}

async function init() {
  if (!isConfigured()) { goToSignIn(); return; }

  const user = await requireUser();
  if (!user) return;

  let profile = null;
  let profileNote = '';
  try {
    profile = await getProfile(user.id);
    if (!profile) profileNote = 'Your profile record is missing. Run supabase/01_auth.sql, then sign out and sign in again.';
  } catch (err) {
    profileNote = `Could not load your profile: ${err.message}`;
  }

  const meta = user.user_metadata || {};
  const name = profile?.full_name || meta.full_name || meta.name || user.email;
  const avatar = profile?.avatar_url || meta.avatar_url || meta.picture;

  $('greeting').textContent = `${greeting()}, ${name.split(/\s+/)[0]}.`;
  $('userName').textContent = name;
  renderAvatar($('userAvatar'), avatar, name, user.email);

  $('detailName').textContent = name;
  $('detailEmail').textContent = user.email;
  $('detailRole').textContent = ROLE_LABELS[profile?.role] || 'Student';
  $('detailSince').textContent = formatDate(profile?.created_at || user.created_at);
  $('detailLast').textContent = formatDate(user.last_sign_in_at);

  if (profileNote) {
    $('profileNote').textContent = profileNote;
    $('profileNote').hidden = false;
  }

  $('signOutBtn').addEventListener('click', signOut);
  watchForSignOut();
  document.body.classList.remove('is-loading');
}

init();
