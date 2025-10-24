// /Farm-vista/js/auth-guard.js  (ES module)
// Single source of truth for auth redirects across the app.

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import {
  onAuthStateChanged,
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

// Signal to theme-boot that a dedicated guard is active (so it won't also guard)
window.__FV_EXTERNAL_AUTH_GUARD__ = true;

await ready;

// ---- Public paths that never require auth ----
const PUBLIC_PREFIXES = [
  '/Farm-vista/pages/login',        // covers /login, /login/, /login/index.html (normalized below)
  '/Farm-vista/assets/',
  '/Farm-vista/manifest.webmanifest',
  '/Farm-vista/serviceworker.js'
];

// Normalize path so /x, /x/, /x/index.html behave the same
function normalizePath(p) {
  return p.replace(/\/index\.html$/i, '').replace(/\/+$/,'');
}

function isPublicPath(pathname){
  const p = normalizePath(pathname);
  return PUBLIC_PREFIXES.some(prefix => p.startsWith(normalizePath(prefix)));
}

const herePath = location.pathname;
const hereFull = location.pathname + location.search + location.hash;

// If we're on a public page, do nothing.
if (!isPublicPath(herePath)) {
  const a = auth || getAuth(window.firebaseApp);
  onAuthStateChanged(a, (user) => {
    if (!user) {
      // Not signed in → redirect to login with ?next=<return>
      const loginBase = '/Farm-vista/pages/login';
      const next = encodeURIComponent(hereFull);
      // Avoid redirect loops if we somehow already are at login
      if (!normalizePath(location.pathname).endsWith(normalizePath(loginBase))) {
        location.replace(`${loginBase}/?next=${next}`);
      }
    }
  });
}