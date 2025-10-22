// /Farm-vista/js/auth/login.js
// Handles sign-in + forgot password for your existing login.html

import { auth } from '../firebase-init.js';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const $ = (id) => document.getElementById(id);

// UX helpers
function setBusy(busy) {
  const btn = $('signIn');
  if (!btn) return;
  btn.disabled = !!busy;
  btn.textContent = busy ? 'Signing in…' : 'Sign In';
}
function showError(msg) {
  // Simple alert for now; swap to inline message if you prefer
  alert(msg);
}

// If already logged in, bounce to dashboard
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.replace('/Farm-vista/dashboard/');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const form = $('loginForm');
  const email = $('email');
  const pwd = $('password');
  const forgot = $('forgot');

  if (!form || !email || !pwd) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = (email.value || '').trim();
    const pw = pwd.value || '';
    if (!em || !pw) {
      showError('Please enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, em, pw);
      // onAuthStateChanged above will redirect; do a safety redirect too:
      window.location.replace('/Farm-vista/dashboard/');
    } catch (err) {
      console.error('[login] signIn error', err);
      // Map a few common errors to friendly text
      const code = (err && err.code) || '';
      const msg =
        code === 'auth/invalid-credential' ? 'Invalid email or password.' :
        code === 'auth/invalid-email' ? 'That email address is not valid.' :
        code === 'auth/user-disabled' ? 'This account is disabled.' :
        code === 'auth/user-not-found' ? 'No account found with that email.' :
        code === 'auth/wrong-password' ? 'Invalid email or password.' :
        'Sign-in failed. Please try again.';
      showError(msg);
    } finally {
      setBusy(false);
    }
  });

  // Forgot password
  if (forgot) {
    forgot.addEventListener('click', async (e) => {
      e.preventDefault();
      const em = (email.value || '').trim();
      if (!em) { showError('Enter your email first, then tap “Forgot password?”.'); return; }
      try {
        await sendPasswordResetEmail(auth, em);
        alert('Password reset email sent (check your inbox).');
      } catch (err) {
        console.error('[login] reset error', err);
        const code = (err && err.code) || '';
        const msg =
          code === 'auth/invalid-email' ? 'That email address is not valid.' :
          code === 'auth/user-not-found' ? 'No account found with that email.' :
          'Could not send reset email. Try again.';
        showError(msg);
      }
    });
  }
});