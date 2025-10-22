/* Firebase init for FarmVista (static site, no bundler)
   Exposes both ES module exports and window.FV.{app,auth,db,storage,ready}  */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// --- Your project config (from Firebase console) ---
const firebaseConfig = {
  apiKey: "AIzaSyB3sLBWFDsoZRLmfQ19hKLoH_nMrHEFQME",
  authDomain: "dowsonfarms-illinois.firebaseapp.com",
  projectId: "dowsonfarms-illinois",
  // IMPORTANT: bucket uses appspot.com (bucket ID), not firebasestorage.app (download host)
  storageBucket: "dowsonfarms-illinois.appspot.com",
  messagingSenderId: "300398089669",
  appId: "1:300398089669:web:def2c52650a7eb67ea27ac",
  measurementId: "G-QHBEXVGNJT"
};

// --- Init ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// If you wanted to override explicitly: getStorage(app, "gs://dowsonfarms-illinois.appspot.com")
const storage = getStorage(app);

// Analytics only if supported/HTTPS
let analytics = null;
try {
  if (await analyticsSupported()) {
    analytics = getAnalytics(app);
  }
} catch (_) { /* ok */ }

// Tiny helper so regular pages can wait for auth ready
const ready = new Promise(resolve => {
  onAuthStateChanged(auth, () => resolve(), { timeout: 15000 });
});

// Expose to window for simple inline script usage
window.FV = Object.assign(window.FV || {}, {
  app, auth, db, storage, analytics, ready,
  // convenience auth helpers if you want them
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth)
});

// Also export (if a page wants to import directly)
export { app, auth, db, storage, analytics, ready, signInWithEmailAndPassword, signOut };