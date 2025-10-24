// /Farm-vista/js/auth-guard.js  (ES module)
// Redirects ONLY after Firebase reports auth state. Sole writer of fv:sessionAuthed.

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import { onAuthStateChanged, getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

window.__FV_EXTERNAL_AUTH_GUARD__ = true;
await ready;

/* Public routes (no auth required) */
const PUBLIC_PREFIXES = [
  '/Farm-vista/pages/login',
  '/Farm-vista/assets/',
  '/Farm-vista/manifest.webmanifest',
  '/Farm-vista/serviceworker.js'
];

function norm(p){ return p.replace(/\/index\.html$/i,'').replace(/\/+$/,''); }
function isPublic(path){ const x = norm(path); return PUBLIC_PREFIXES.some(pr => x.startsWith(norm(pr))); }

const herePath = location.pathname;
if (!isPublic(herePath)) {
  let navigating = false;
  const go = (url) => {
    if (navigating) return;
    navigating = true;
    try { location.replace(url); } catch { location.href = url; }
  };

  const a = auth || getAuth(window.firebaseApp);
  const hereFull = location.pathname + location.search + location.hash;
  const loginBase = norm('/Farm-vista/pages/login');

  // If a signout is in progress, don't ever re-set the authed flag
  let signoutInProgress = false;
  window.addEventListener('storage', (ev)=>{
    if (ev.key === 'fv:auth:op' && ev.newValue && ev.newValue.startsWith('signout:')) {
      signoutInProgress = true;
      try { localStorage.removeItem('fv:sessionAuthed'); } catch {}
    }
  });

  onAuthStateChanged(a, (user) => {
    try{
      if (user && !signoutInProgress) {
        localStorage.setItem('fv:sessionAuthed','1');
        // stay
      } else {
        localStorage.removeItem('fv:sessionAuthed');
        if (!norm(location.pathname).startsWith(loginBase)) {
          const next = encodeURIComponent(hereFull);
          go(`${loginBase}/?next=${next}`);
        }
      }
    }catch(e){
      // fail-safe
      localStorage.removeItem('fv:sessionAuthed');
      if (!norm(location.pathname).startsWith(loginBase)) {
        const next = encodeURIComponent(hereFull);
        go(`${loginBase}/?next=${next}`);
      }
    }
  });
}