// shell.js — shared set-up for every signed-in page: checks the session,
// loads the profile, fills the top bar and wires Sign out.

import { isConfigured } from './supabaseClient.js';
import { requireUser, getProfile, signOut, watchForSignOut, goToSignIn } from './auth.js';

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

// Returns { user, profile, profileError, name, avatar } or null (redirecting).
export async function startSignedInPage() {
  if (!isConfigured()) { goToSignIn(); return null; }

  const user = await requireUser();
  if (!user) return null;

  let profile = null;
  let profileError = '';
  try {
    profile = await getProfile(user.id);
  } catch (err) {
    profileError = err.message;
  }

  const meta = user.user_metadata || {};
  const name = profile?.full_name || meta.full_name || meta.name || user.email;
  const avatar = profile?.avatar_url || meta.avatar_url || meta.picture;

  document.getElementById('userName').textContent = name;
  renderAvatar(document.getElementById('userAvatar'), avatar, name, user.email);
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  watchForSignOut();

  return { user, profile, profileError, name, avatar };
}

export function finishLoading() {
  document.body.classList.remove('is-loading');
}
