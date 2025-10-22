<script type="module">
// /Farm-vista/js/firebase-init.js
// Single source of truth for Firebase + global auth guard + reliable signOut.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, setPersistence, browserLocalPersistence,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';
import {
  getAnalytics, isSupported as analyticsSupported
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';

// --- Your project config (from Firebase console) ---
const firebaseConfig = {
  apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
  authDomain: "dowsonfarms-illinois.firebaseapp.com",
  projectId: "dowsonfarms-illinois",
  // IMPORTANT: bucket uses appspot.com (bucket ID), not firebasestorage.app
  storageBucket: "dowsonfarms-illinois.appspot.com",
  messagingSenderId: "300398089669",
  appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
  measurementId: "G-QHBEXVGNJT"
};

// --- Init (idempotent) ---
if (!window.firebaseApp) {
  window.firebaseApp = initializeApp(firebaseConfig);
  window.firebaseAuth = getAuth(window.firebaseApp);
  window.firebaseDB   = getFirestore(window.firebaseApp);
  window.firebaseStore = getStorage(window.firebaseApp);

  try {
    await setPersistence(window.firebaseAuth, browserLocalPersistence);
  } catch (_) {}

  try {
    if (await analyticsSupported()) {
      window.firebaseAnalytics = getAnalytics(window.firebaseApp);
    }
  } catch (_) {}
}

// ===== Reliable Sign Out (awaits completion, then hard-redirects to login) =====
window.fvSignOut = async function fvSignOut() {
  try {
    await signOut(window.firebaseAuth);
  } catch (e) {
    // even if it throws, nuke any local state and move on
    console.warn('[FV] signOut error (continuing):', e);
  }
  try { sessionStorage.clear(); } catch(_) {}
  try { localStorage.removeItem('fv_auth_skip'); } catch(_) {}
  // Use replace() to prevent the back-button from restoring an authed page
  location.replace('/Farm-vista/pages/login/');
};

// ===== Global Auth Guard (waits for real auth state before redirecting) =====
(function authGuard(){
  const path = location.pathname;
  const isLogin = /\/pages\/login\/?$/i.test(path) || /\/pages\/login\/index\.html$/i.test(path);

  // Promise that resolves exactly once with the first stable auth state.
  if (!window.__FV_AUTH_READY__) {
    window.__FV_AUTH_READY__ = new Promise(resolve => {
      const off = onAuthStateChanged(window.firebaseAuth, user => {
        try { off(); } catch(_){}
        resolve(user || null);
      });
    });
  }

  window.__FV_AUTH_READY__.then(user => {
    // On login page:
    //  - if user exists, keep them here until they actively sign out or submit form
    //    (we do NOT auto-bounce to dashboard; avoids the “logout then bounce back” race)
    if (isLogin) return;

    // On all other pages:
    if (!user) {
      // Not signed in → send to login with return URL
      const next = encodeURIComponent(location.pathname + location.search + location.hash);
      location.replace(`/Farm-vista/pages/login/?next=${next}`);
    }
  });
})();
</script>