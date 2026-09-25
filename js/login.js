// login.js — the sign-in page (index.html).

import { isConfigured } from './supabaseClient.js';
import {
  signInWithGoogle, getCurrentSession, isAllowedEmail,
  messageFor, allowedDomainsText, pageUrl,
} from './auth.js';

const button = document.getElementById('googleBtn');
const label = button.querySelector('.google-btn-label');
const message = document.getElementById('signinMessage');

function show(text, kind = 'error') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}

async function init() {
  document.getElementById('domainNote').textContent = allowedDomainsText();

  if (!isConfigured()) {
    button.disabled = true;
    show('Setup needed: add your Supabase URL and publishable key to js/config.js.');
    return;
  }

  // Message passed from app.html (wrong domain, cancelled, signed out, ...)
  const params = new URLSearchParams(window.location.search);
  const text = messageFor(params.get('reason'), params.get('detail') || '');
  if (text) show(text, params.get('reason') === 'signed_out' ? 'info' : 'error');
  if (params.toString()) window.history.replaceState(null, '', window.location.pathname);

  // Already signed in? Go straight to the dashboard.
  try {
    const session = await getCurrentSession();
    if (session && isAllowedEmail(session.user.email)) {
      window.location.replace(pageUrl('app.html'));
      return;
    }
  } catch { /* stay on the sign-in page */ }

  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = 'Opening Google…';
    try {
      await signInWithGoogle();
    } catch (err) {
      button.disabled = false;
      label.textContent = 'Continue with Google';
      show(`Could not start sign-in: ${err.message}`);
    }
  });
}

init();
