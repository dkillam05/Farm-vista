// /Farm-vista/js/firebase-init.js  (ES module; sets fv:sessionAuthed on auth changes)

/* Guard against double init */
if (!window.__FV_FIREBASE_READY__) {
  window.__FV_FIREBASE_READY__ = (async () => {
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

    const { initializeApp, getApps, getApp } = appMod;
    const { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signOut } = authMod;
    const { getFirestore } = firestoreMod;
    const { getStorage } = storageMod;
    const getAnalytics = analyticsMod?.getAnalytics;

    const firebaseConfig = {
      apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
      authDomain: "dowsonfarms-illinois.firebaseapp.com",
      projectId: "dowsonfarms-illinois",
      storageBucket: "dowsonfarms-illinois.appspot.com",
      messagingSenderId: "300398089669",
      appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
      measurementId: "G-QHBEXVGNJT"
    };

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);

    // Keep current behavior (persistent login). We can later split PWA vs browser if you want.
    await setPersistence(auth, browserLocalPersistence);

    const db = getFirestore(app);
    const storage = getStorage(app);
    let analytics = null;
    try { if (location.protocol === 'https:') analytics = getAnalytics?.(app) || null; } catch {}

    // ---- Helpers ----
    async function fvEnsureAuthed(opts = {}) {
      await 0;
      const next = opts.next || (location.pathname + location.search + location.hash);
      const loginUrl = opts.loginUrl || '/Farm-vista/pages/login/index.html';
      await new Promise((resolve) => {
        const stop = onAuthStateChanged(auth, (user) => {
          stop();
          if (user) resolve();
          else {
            const url = new URL(loginUrl, location.origin);
            url.searchParams.set('next', next);
            location.replace(url.toString());
          }
        });
      });
      return auth.currentUser;
    }

    async function fvSignOut(loginUrl = '/Farm-vista/pages/login/') {
      try { await signOut(auth); } catch {}
      try {
        await new Promise((resolve) => {
          const stop = onAuthStateChanged(auth, (u) => { if (!u) { stop(); resolve(); } });
        });
      } catch {}
      try { sessionStorage.clear(); } catch {}
      try { localStorage.removeItem('fv:nav:groups'); } catch {}
      const url = new URL(loginUrl, location.origin);
      url.searchParams.set('signedout','1');
      url.searchParams.set('ts', String(Date.now()));
      location.replace(url.toString());
    }

    // ---- NEW: Mirror auth state into sessionStorage (drives the pre-guard) ----
    try {
      onAuthStateChanged(auth, (user) => {
        try {
          if (user) sessionStorage.setItem('fv:sessionAuthed','1');
          else sessionStorage.removeItem('fv:sessionAuthed');
        } catch {}
        try { window.dispatchEvent(new CustomEvent('fv:user-change', { detail:user||null })); } catch {}
      });
    } catch {}

    // Expose
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseStorage = storage;
    window.fvEnsureAuthed = fvEnsureAuthed;
    window.fvSignOut = fvSignOut;

    try {
      window.FV = window.FV || {};
      window.FV.firebase = { app, auth, db, storage };
      window.dispatchEvent(new CustomEvent('fv:firebase-ready'));
    } catch {}

    return {
      app, auth, db, storage, analytics,
      fvEnsureAuthed, fvSignOut,
      _mods: { authMod, firestoreMod, storageMod }
    };
  })();
}

// ESM exports
export const ready         = window.__FV_FIREBASE_READY__;
const env                  = await window.__FV_FIREBASE_READY__;
export const app           = env.app;
export const auth          = env.auth;
export const db            = env.db;
export const storage       = env.storage;
export const fvEnsureAuthed= env.fvEnsureAuthed;
export const fvSignOut     = env.fvSignOut;
export const authMod       = env._mods.authMod;
export const firestoreMod  = env._mods.firestoreMod;
export const storageMod    = env._mods.storageMod;