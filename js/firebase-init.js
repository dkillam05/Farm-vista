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
    const { getAuth, setPersistence, browserLocalPersistence } = authMod;
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

    // Expose as ESM exports AND globals (for non-module pages)
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseStorage = storage;

    return { app, auth, db, storage, analytics,
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
export const authMod = env._mods.authMod;
export const firestoreMod = env._mods.firestoreMod;
export const storageMod = env._mods.storageMod;