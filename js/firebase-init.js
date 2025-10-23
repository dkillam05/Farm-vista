// /Farm-vista/js/firebase-init.js  (ES module)

// Guard against double init
if (!window.__FV_FIREBASE_READY__) {
  window.__FV_FIREBASE_READY__ = (async () => {
    // Load Firebase SDK (ESM from Google CDN)
    const [
      appMod,
      authMod,
      firestoreMod,
      storageMod,
      analyticsMod
    ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js').catch(() => null),
    ]);

    const { initializeApp, getApps } = appMod;
    const { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signOut } = authMod;
    const { getFirestore } = firestoreMod;
    const { getStorage } = storageMod;
    const getAnalytics = analyticsMod?.getAnalytics;

    // Your config (bucket uses appspot.com)
    const firebaseConfig = {
      apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
      authDomain: "dowsonfarms-illinois.firebaseapp.com",
      projectId: "dowsonfarms-illinois",
      storageBucket: "dowsonfarms-illinois.appspot.com",
      messagingSenderId: "300398089669",
      appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
      measurementId: "G-QHBEXVGNJT"
    };

    const app = getApps().length ? appMod.getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await setPersistence(auth, browserLocalPersistence);   // stay signed in until explicit logout
    const db = getFirestore(app);
    const storage = getStorage(app);
    let analytics = null;
    try { if (location.protocol === 'https:') analytics = getAnalytics?.(app) || null; } catch {}

    // ---- Helpers (added) ----
    // Force a user to be signed in; if not, redirect to login with ?next=<current URL>
    async function fvEnsureAuthed(opts = {}) {
      await 0; // allow microtask queue to settle
      const next = opts.next || (location.pathname + location.search);
      const loginUrl = opts.loginUrl || '/Farm-vista/pages/login/index.html';

      // Wait for the first auth snapshot, then decide
      await new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
          unsub();
          if (user) resolve();
          else {
            const url = new URL(loginUrl, location.origin);
            url.searchParams.set('next', next);
            location.replace(url.toString());
          }
        });
      });
      // If we’re here, user exists.
      return auth.currentUser;
    }

    // Sign out and bounce to login
    async function fvSignOut(loginUrl = '/Farm-vista/pages/login/') {
      try { await signOut(auth); } catch {}
      try { sessionStorage.clear(); } catch {}
      try { localStorage.removeItem('fv:nav:groups'); } catch {}
      location.replace(loginUrl);
    }

    // Expose as ESM exports AND globals (for non-module pages)
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseStorage = storage;
    window.fvEnsureAuthed = fvEnsureAuthed;
    window.fvSignOut = fvSignOut;

    return {
      app, auth, db, storage, analytics,
      fvEnsureAuthed, fvSignOut,
      // re-export helpers other modules may want
      _mods: { authMod, firestoreMod, storageMod }
    };
  })();
}

// ESM exports for module imports
export const ready = window.__FV_FIREBASE_READY__;
const env = await window.__FV_FIREBASE_READY__;
export const app = env.app;
export const auth = env.auth;
export const db = env.db;
export const storage = env.storage;
export const fvEnsureAuthed = env.fvEnsureAuthed;
export const fvSignOut = env.fvSignOut;
export const authMod = env._mods.authMod;
export const firestoreMod = env._mods.firestoreMod;
export const storageMod = env._mods.storageMod;

// === SAFE EXPORTS (non-breaking) ===
// Mirrors initialized objects to a stable global for helper modules,
// and announces readiness. Does NOT re-init or alter auth flow.
try {
  window.FV = window.FV || {};
  window.FV.firebase = window.FV.firebase || {};
  if (typeof window.FV.firebase.app       === 'undefined' && typeof app       !== 'undefined') window.FV.firebase.app       = app;
  if (typeof window.FV.firebase.auth      === 'undefined' && typeof auth      !== 'undefined') window.FV.firebase.auth      = auth;
  if (typeof window.FV.firebase.db        === 'undefined' && typeof db        !== 'undefined') window.FV.firebase.db        = db;
  if (typeof window.FV.firebase.storage   === 'undefined' && typeof storage   !== 'undefined') window.FV.firebase.storage   = storage;
  if (typeof window.FV.firebase.functions === 'undefined' && typeof functions !== 'undefined') window.FV.firebase.functions = functions;

  // Let listeners know Firebase is ready (harmless if they already proceeded).
  try { window.dispatchEvent(new CustomEvent('fv:firebase-ready')); } catch {}
} catch (e) {
  console.warn('[FV] safe exports skipped:', e);
}