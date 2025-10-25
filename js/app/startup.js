/**
 * FarmVista — startup.js
 * Shared bootstrap that runs on every page once theme-boot loads the module.
 * It wires authentication state to document attributes, kicks off profile
 * syncing, and ensures legacy localStorage data is mirrored to Firestore.
 */

import { ready, getAuth, onAuthStateChanged } from '../firebase-init.js';
import { initUserProfileListener } from './user-profile.js';
import { initStorageSync } from './storage-sync.js';

let started = false;

const applyAuthClass = (user) => {
  document.documentElement.classList.toggle('fv-authed', !!user);
};

const boot = async () => {
  if (started) return;
  started = true;
  const { app } = await ready;
  const auth = getAuth(app);
  if (!auth) return;
  onAuthStateChanged(auth, (user) => applyAuthClass(user));
};

initStorageSync();
initUserProfileListener();
boot().catch((err) => console.warn('[FV] startup init failed:', err));
