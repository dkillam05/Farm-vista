// /Farm-vista/js/firebase-init.js  (no <script> tags!)

// Firebase CDN ESM imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';
import { getAnalytics, isSupported as analyticsSupported }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js';

// Your project config (from Firebase console)
const firebaseConfig = {
  apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
  authDomain: "dowsonfarms-illinois.firebaseapp.com",
  projectId: "dowsonfarms-illinois",
  // Bucket uses appspot.com (bucket ID), not firebasestorage.app (download host)
  storageBucket: "dowsonfarms-illinois.appspot.com",
  messagingSenderId: "300398089669",
  appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
  measurementId: "G-QHBEXVGNJT"
};

// Guard against double-init (theme-boot injects this once per page)
if (!window.firebaseApp) {
  console.log('[FV] Initializing Firebase…');

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  try { await setPersistence(auth, browserLocalPersistence); } catch(e) {}

  let analytics = null;
  try { if (await analyticsSupported()) analytics = getAnalytics(app); } catch (_) {}

  // Expose globally so other pages can use them
  window.firebaseApp = app;
  window.firebaseAuth = auth;
  window.firebaseDB = db;
  window.firebaseStorage = storage;
  window.firebaseAnalytics = analytics;

  onAuthStateChanged(auth, (user) => {
    console.log('[FV] auth state:', user ? `SIGNED IN (${user.email || user.uid})` : 'SIGNED OUT');
    window.dispatchEvent(new CustomEvent('fv:auth-state', { detail: { user } }));
  });

  console.log('[FV] Firebase ready. authDomain:', firebaseConfig.authDomain,
              'storageBucket:', firebaseConfig.storageBucket);
} else {
  console.log('[FV] firebase-init already loaded; skipping re-init.');
}