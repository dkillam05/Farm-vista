// /Farm-vista/js/auth-guard.js  (ES module)
// Single source of truth for auth redirects across the app (de-bounced).

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import { onAuthStateChanged, getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

// Let theme-boot know a dedicated guard is active
window.__FV_EXTERNAL_AUTH_GUARD__ = true;

await ready;

// ---- Public paths that never require auth -----------------------------------
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

// Don’t guard public pages
const herePath = location.pathname;
if (isPublicPath(herePath)) {
  // Re-enable sync when leaving login later; nothing to do here.
  export default null;
} else {
  // De-bounce navigation so we never issue two redirects
  let navigating = false;
  const go = (url) => {
    if (navigating) return;
    navigating = true;
    try { location.replace(url); }
    catch { location.href = url; }
  };

  const a = auth || getAuth(window.firebaseApp);
  const hereFull = location.pathname + location.search + location.hash;
  const loginBase = '/Farm-vista/pages/login';

  onAuthStateChanged(a, (user) => {
    if (!user) {
      const next = encodeURIComponent(hereFull);
      // Avoid loops if somehow already at login (paranoia)
      if (!normalizePath(location.pathname).startsWith(normalizePath(loginBase))) {
        go(`${normalizePath(loginBase)}/?next=${next}`);
      }
    }
  });
}