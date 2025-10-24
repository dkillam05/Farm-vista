// /Farm-vista/js/auth-guard.js  (ES module)
// Single source of truth for auth redirects across the app (de-bounced + persistent flag)

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import { onAuthStateChanged, getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

// Let theme-boot know a dedicated guard is active
window.__FV_EXTERNAL_AUTH_GUARD__ = true;

// Wait until firebase-init.js signals it's ready
await ready;

/* ---------------- Public paths that never require auth ---------------- */
const PUBLIC_PREFIXES = [
  '/Farm-vista/pages/login',        // covers /login, /login/, /login/index.html
  '/Farm-vista/assets/',
  '/Farm-vista/manifest.webmanifest',
  '/Farm-vista/serviceworker.js'
];

function normalizePath(p) {
  return p.replace(/\/index\.html$/i, '').replace(/\/+$/, '');
}
function isPublicPath(pathname){
  const p = normalizePath(pathname);
  return PUBLIC_PREFIXES.some(prefix => p.startsWith(normalizePath(prefix)));
}

/* --------------- Early out: do not guard public pages ----------------- */
const herePath = location.pathname;
if (isPublicPath(herePath)) {
  // Nothing to do on public routes
} else {
  /* -------------------- Debounced redirect helper -------------------- */
  let navigating = false;
  const go = (url) => {
    if (navigating) return;
    navigating = true;
    try { location.replace(url); }
    catch { location.href = url; }
  };

  /* -------------------- Canonical auth listener ---------------------- */
  const a = auth || getAuth(window.firebaseApp);
  const hereFull = location.pathname + location.search + location.hash;
  const loginBase = '/Farm-vista/pages/login';
  const loginNorm = normalizePath(loginBase);

  onAuthStateChanged(a, (user) => {
    try {
      if (user) {
        // Persist "authed" flag for both Safari & PWA cold launches
        localStorage.setItem('fv:sessionAuthed', '1');
        return; // Stay on current page
      } else {
        // Clear flag when signed out
        localStorage.removeItem('fv:sessionAuthed');

        // Avoid loops if somehow already at login
        if (!normalizePath(location.pathname).startsWith(loginNorm)) {
          const next = encodeURIComponent(hereFull);
          go(`${loginNorm}/?next=${next}`);
        }
      }
    } catch (e) {
      // If anything odd happens, conservatively send to login
      if (!normalizePath(location.pathname).startsWith(loginNorm)) {
        const next = encodeURIComponent(hereFull);
        go(`${loginNorm}/?next=${next}`);
      }
    }
  });
}