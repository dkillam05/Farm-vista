// /Farm-vista/js/app/login.js
// Works under <base href="/Farm-vista/">

import {
  ready,
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  isStub
} from '../firebase-init.js'; // base-relative import

const els = {
  form: document.getElementById('loginForm'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  err: document.getElementById('errBox'),
  forgot: document.getElementById('forgot')
};

function showErr(msg){
  if (!els.err) return;
  els.err.textContent = msg || '';
}

// Use your real home: /Farm-vista/index.html (works with <base href="/Farm-vista/">)
const DEFAULT_HOME = 'index.html';

function resolveUnderBase(pathLike){
  // Respect <base href="/Farm-vista/">
  try {
    const u = new URL(pathLike, document.baseURI || location.href);
    return u.pathname.replace(location.origin, '') + (u.search || '') + (u.hash || '');
  } catch {
    return pathLike;
  }
}

function samePath(a, b){
  try {
    const ua = new URL(a, document.baseURI || location.href);
    const ub = new URL(b, document.baseURI || location.href);
    return ua.pathname === ub.pathname && ua.search === ub.search;
  } catch {
    return a === b;
  }
}

function nextUrl() {
  const qs = new URLSearchParams(location.search);
  const hint = qs.get('next');
  // If no ?next=, go to the app home (index.html under the base)
  const target = hint && hint.trim() ? hint.trim() : DEFAULT_HOME;
  return resolveUnderBase(target);
}

(async function boot(){
  let ctx, auth;

  try {
    // Initialize Firebase (or stub)
    const mod = await import('../firebase-init.js');
    ctx = await ready;
    auth = ctx && ctx.auth ? ctx.auth : getAuth(ctx && ctx.app);
  } catch (e) {
    console.warn('[Login] firebase-init load failed:', e);
    showErr('Unable to initialize authentication.');
    return;
  }

  // If already signed in and we’re on login, bounce to home/next (avoid loops & 404s)
  try {
    const unsub = onAuthStateChanged(auth, (user)=>{
      if (!user) return;
      const dest = nextUrl();
      // If we’re already at dest, do nothing
      if (!samePath(location.href, dest)) {
        location.replace(dest);
      }
      // Prevent multiple firings
      try { unsub(); } catch {}
    });
  } catch (e) {
    console.warn('[Login] onAuthStateChanged setup failed:', e);
  }

  // Submit handler
  els.form?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    showErr('');

    const email = (els.email?.value || '').trim();
    const pass  = els.password?.value || '';

    if (!email || !pass) {
      showErr('Enter your email and password.');
      return;
    }

    // Remember last email
    try { localStorage.setItem('fv_last_email', email); } catch {}

    // In stub/offline mode, just continue
    if (ctx && isStub && isStub()) {
      location.replace(nextUrl());
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      location.replace(nextUrl());
    } catch (err) {
      console.warn('[Login] sign-in error:', err);
      const code = (err && err.code) || '';
      let msg = 'Sign in failed. Please check your email and password.';
      if (code === 'auth/invalid-email') msg = 'That email address looks invalid.';
      else if (code === 'auth/user-disabled') msg = 'This account has been disabled.';
      else if (code === 'auth/user-not-found' || code === 'auth/wrong-password') msg = 'Incorrect email or password.';
      else if (code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
      showErr(msg);
    }
  });

  // Forgot password handler
  els.forgot?.addEventListener('click', async (e)=>{
    e.preventDefault();
    showErr('');
    const email = (els.email?.value || '').trim();
    if (!email) {
      showErr('Enter your email above, then tap “Forgot password?”.');
      return;
    }

    if (ctx && isStub && isStub()) {
      showErr('Password reset is unavailable in offline mode.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      showErr('Reset link sent if the email exists.');
    } catch (err) {
      console.warn('[Login] reset error:', err);
      showErr('Could not send reset link. Please try again later.');
    }
  });
})();