// /Farm-vista/js/auth-actions.js  (ES module)
// One-tap, hardened sign-out that clears persistence, IndexedDB, caches, then hard-redirects.

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import {
  signOut, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

export async function signOutHard(options = {}) {
  const {
    redirectTo = '/Farm-vista/pages/login/',
    bust = 'v=' + Date.now()
  } = options;

  await ready;

  // single-flight guard so multiple taps do nothing
  if (window.__FV_LOGOUT_BUSY__) return;
  window.__FV_LOGOUT_BUSY__ = true;

  // Broadcast that signout started; guard will stop re-setting flags
  try { localStorage.setItem('fv:auth:op', 'signout:' + Date.now()); } catch {}

  // Disable any logout buttons visually (optional)
  try {
    document.querySelectorAll('.js-logout').forEach(btn=>{
      btn.setAttribute('disabled','disabled');
      btn.style.opacity = '.6';
      btn.style.pointerEvents = 'none';
    });
  } catch {}

  // Ensure persistence is local (so signOut fully clears stored session)
  try { await setPersistence(auth, browserLocalPersistence); } catch {}

  // Firebase sign out
  try { await signOut(auth); } catch {}

  // Clear our app flags
  try { localStorage.removeItem('fv:sessionAuthed'); } catch {}

  // Nuke Firebase local stores so iOS PWA can’t resurrect an old session
  try { indexedDB && indexedDB.deleteDatabase && indexedDB.deleteDatabase('firebaseLocalStorageDb'); } catch {}
  try { indexedDB && indexedDB.deleteDatabase && indexedDB.deleteDatabase('firebase-installations-database'); } catch {}

  // Clear SW caches (best effort)
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch {}

  // Ask SW to update (best effort)
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
  } catch {}

  // Small settle delay to let storage events propagate
  await new Promise(r => setTimeout(r, 120));

  // Hard redirect to login (cache-busted)
  const sep = redirectTo.includes('?') ? '&' : '?';
  location.replace(redirectTo + sep + bust);
}