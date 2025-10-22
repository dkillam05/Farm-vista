/* /Farm-vista/js/firebase-init.js
   Single, global Firebase bootstrap with offline-aware retry.
   Exposes:
     window.firebaseApp
     window.firebaseAuth
     window.firebaseDB
     window.firebaseStorage
     window.firebaseAnalytics (may be null)
     window.firebaseReady  -> Promise that resolves when app is ready
*/

if (!window.__FV_FB_LOADER__) {
  window.__FV_FB_LOADER__ = (async () => {
    // CDN ESM imports
    const [
      appMod,
      authMod,
      dbMod,
      storageMod,
      analyticsMod
    ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js').catch(()=>({}))
    ]);

    const { initializeApp, getApps } = appMod;
    const { getAuth, setPersistence, browserLocalPersistence } = authMod;
    const { getFirestore } = dbMod;
    const { getStorage } = storageMod;
    const { getAnalytics, isSupported: analyticsSupported } = analyticsMod || {};

    // ---- YOUR CONFIG (unchanged except bucket host) ----
    const firebaseConfig = {
      apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
      authDomain: "dowsonfarms-illinois.firebaseapp.com",
      projectId: "dowsonfarms-illinois",
      storageBucket: "dowsonfarms-illinois.appspot.com", // <- bucket ID host
      messagingSenderId: "300398089669",
      appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
      measurementId: "G-QHBEXVGNJT"
    };

    // Initialize exactly once
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

    // Core services
    const auth = getAuth(app);
    // Persist session so you stay signed in until you explicitly logout
    await setPersistence(auth, browserLocalPersistence);

    const db = getFirestore(app);
    const storage = getStorage(app); // can also pass gs:// if you ever need

    // Analytics (optional/safe)
    let analytics = null;
    try {
      if (analyticsSupported && (await analyticsSupported())) {
        analytics = getAnalytics(app);
      }
    } catch (_) {}

    // Expose globals for non-module pages to consume
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDB = db;
    window.firebaseStorage = storage;
    window.firebaseAnalytics = analytics;

    return { app, auth, db, storage, analytics };
  })();
}

// Public Promise other pages can await
window.firebaseReady = (async () => {
  try {
    const ready = await window.__FV_FB_LOADER__;
    return ready;
  } catch (e) {
    throw e;
  }
})();

// Auto-retry on reconnect if first load ever failed
(function attachOnlineRetry(){
  if (window.__FV_FB_ONLINE_BOUND__) return;
  window.__FV_FB_ONLINE_BOUND__ = true;
  window.addEventListener('online', async () => {
    if (window.firebaseApp) return; // already good
    try { await import('/Farm-vista/js/firebase-init.js?retry=' + Date.now()); } catch {}
  });
})();