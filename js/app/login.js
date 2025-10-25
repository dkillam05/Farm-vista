/**
 * FarmVista — login.js
 * Handles email/password authentication using the firebase-init bridge. The
 * module keeps the previous login behaviour (email memo + forgot password)
 * while automatically provisioning stub accounts when Firebase config is
 * missing.
 */

import {
  ready,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  isStub
} from '../firebase-init.js';
import { ensureUserProfile } from './user-profile.js';

const form = document.getElementById('loginForm');
if (!form) {
  console.warn('[FV] login form not found');
} else {
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errBox = document.getElementById('errBox');
  const signInBtn = document.getElementById('signIn');
  const forgotLink = document.getElementById('forgot');
  const qs = new URLSearchParams(location.search);
  const nextUrl = qs.get('next');
  const defaultRedirect = '/Farm-vista/dashboard/';

  let authInstance = null;
  let listenerBound = false;

  const redirect = () => {
    const target = (typeof nextUrl === 'string' && nextUrl.startsWith('/Farm-vista/')) ? nextUrl : defaultRedirect;
    location.replace(target);
  };

  const resetError = () => {
    if (errBox) {
      errBox.textContent = '';
      errBox.style.color = '';
    }
  };

  const showError = (message) => {
    if (!errBox) return;
    errBox.style.color = '';
    errBox.textContent = message || '';
  };

  const showMessage = (message) => {
    if (!errBox) return;
    errBox.style.color = '#2F6C3C';
    errBox.textContent = message || '';
  };

  const setBusy = (busy) => {
    if (!signInBtn) return;
    signInBtn.disabled = busy;
    signInBtn.textContent = busy ? 'Signing in…' : 'Sign In';
  };

  const ensureAuth = async () => {
    if (authInstance) return authInstance;
    const { app } = await ready;
    authInstance = getAuth(app);
    if (!authInstance) throw new Error('Authentication unavailable');
    try {
      const persistence = browserLocalPersistence();
      if (persistence) await setPersistence(authInstance, persistence);
    } catch (err) {
      console.warn('[FV] persistence setup failed:', err);
    }
    if (!listenerBound) {
      onAuthStateChanged(authInstance, (user) => { if (user) redirect(); });
      listenerBound = true;
    }
    return authInstance;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    resetError();
    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';
    if (!email || !password) {
      showError('Enter email and password.');
      return;
    }
    setBusy(true);
    try {
      const auth = await ensureAuth();
      let credential;
      try {
        credential = await signInWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (isStub() && err && err.code === 'auth/user-not-found') {
          credential = await createUserWithEmailAndPassword(auth, email, password, { displayName: email.split('@')[0] });
        } else {
          throw err;
        }
      }
      if (credential && credential.user) {
        await ensureUserProfile(credential.user);
        try { localStorage.setItem('fv_last_email', email); } catch {}
        redirect();
      }
    } catch (err) {
      console.warn('[FV] sign-in error:', err);
      const code = err?.code || '';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) {
        showError('Wrong email or password.');
      } else if (code.includes('user-not-found')) {
        showError('No account found for this email.');
      } else if (code.includes('too-many-requests')) {
        showError('Too many attempts. Try again later.');
      } else if (code.includes('invalid-email')) {
        showError('Enter a valid email address.');
      } else {
        showError('Sign-in failed.');
      }
    } finally {
      setBusy(false);
    }
  });

  if (forgotLink) {
    forgotLink.addEventListener('click', async (event) => {
      event.preventDefault();
      resetError();
      const email = (emailInput?.value || '').trim();
      if (!email) {
        showError('Enter your email first, then tap “Forgot password?”.');
        return;
      }
      try {
        const auth = await ensureAuth();
        await sendPasswordResetEmail(auth, email);
        showMessage('Reset link sent (if the email exists).');
        setTimeout(() => resetError(), 4500);
      } catch (err) {
        console.warn('[FV] reset email failed:', err);
        showError('Unable to send reset email.');
      }
    });
  }

  ensureAuth().catch((err) => console.warn('[FV] auth bootstrap failed:', err));
}
