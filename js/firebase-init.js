/**
 * FarmVista — firebase-init.js
 * Unified entry point for authentication. Attempts to load Firebase using
 * window.FV_FIREBASE_CONFIG. If the config is missing or the CDN fails, we
 * fall back to a lightweight in-memory auth shim so the UI keeps working.
 */

const CDN_APP = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
const CDN_AUTH = 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
const STUB_KEY = 'fv:stub:user';

const toStr = (val) => (typeof val === 'string' ? val : '').trim();
const sanitizeUser = (user) => {
  if (!user) return null;
  const email = toStr(user.email);
  const displayName = toStr(user.displayName) || toStr(user.name) || (email ? email.split('@')[0] : 'FarmVista User');
  return {
    uid: toStr(user.uid) || 'stub-user',
    displayName,
    email,
    photoURL: toStr(user.photoURL),
    phoneNumber: toStr(user.phoneNumber),
    isAnonymous: false
  };
};

const loadStubUser = () => {
  try {
    const raw = localStorage.getItem(STUB_KEY);
    if (raw) return sanitizeUser(JSON.parse(raw));
  } catch (err) {
    console.warn('[FV] stub auth storage read failed:', err);
  }
  if (window.FV_DEFAULT_USER) return sanitizeUser(window.FV_DEFAULT_USER);
  return sanitizeUser({ displayName: 'FarmVista User' });
};

const saveStubUser = (user) => {
  try {
    if (user) localStorage.setItem(STUB_KEY, JSON.stringify(user));
    else localStorage.removeItem(STUB_KEY);
  } catch (err) {
    console.warn('[FV] stub auth storage write failed:', err);
  }
};

const createStubAuth = () => {
  const listeners = new Set();
  const auth = {
    currentUser: loadStubUser(),
    _listeners: listeners,
    _emit() {
      window.__FV_USER = auth.currentUser || null;
      listeners.forEach((cb) => {
        try { cb(auth.currentUser); }
        catch (err) { console.error('[FV] stub auth listener error:', err); }
      });
    },
    signOut() {
      auth.currentUser = null;
      saveStubUser(null);
      auth._emit();
      return Promise.resolve();
    },
    _setUser(user) {
      auth.currentUser = sanitizeUser(user);
      saveStubUser(auth.currentUser);
      auth._emit();
      return Promise.resolve(auth.currentUser);
    }
  };
  auth._emit();
  return auth;
};

const stubSubscribe = (authInstance, cb) => {
  if (!authInstance || typeof cb !== 'function') return () => {};
  authInstance._listeners.add(cb);
  try { cb(authInstance.currentUser); }
  catch (err) { console.error('[FV] stub auth callback error:', err); }
  return () => authInstance._listeners.delete(cb);
};

const stubSignOut = (authInstance) => {
  if (!authInstance || typeof authInstance.signOut !== 'function') return Promise.resolve();
  return authInstance.signOut();
};

const stubAuth = createStubAuth();
let app = null;
let auth = stubAuth;
export let mode = 'stub';

let onAuthStateChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
let onIdTokenChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
let signOutImpl = (instance) => stubSignOut(instance || auth);
let getAuthImpl = () => auth;

const ensureStubGlobals = () => {
  if (!window.firebase) window.firebase = {};
  if (!window.firebase.auth) {
    window.firebase.auth = () => ({
      currentUser: auth.currentUser,
      signOut: () => auth.signOut()
    });
  }
  if (!('firestore' in window.firebase)) window.firebase.firestore = undefined;
  if (!('storage' in window.firebase)) window.firebase.storage = undefined;
  window.firebaseAuth = auth;
  window.firebaseApp = app;
  window.fvSignOut = () => auth.signOut();
};

ensureStubGlobals();

export const ready = (async () => {
  const cfg = window.FV_FIREBASE_CONFIG;
  if (!cfg) {
    mode = 'stub';
    return { app, auth, mode };
  }

  try {
    const [{ initializeApp }, authMod] = await Promise.all([
      import(CDN_APP),
      import(CDN_AUTH)
    ]);

    app = initializeApp(cfg);
    auth = authMod.getAuth(app);
    mode = 'firebase';

    onAuthStateChangedImpl = (instance, cb) => authMod.onAuthStateChanged(instance || auth, cb);
    onIdTokenChangedImpl = (instance, cb) => authMod.onIdTokenChanged(instance || auth, cb);
    signOutImpl = (instance) => authMod.signOut(instance || auth);
    getAuthImpl = (appInstance) => authMod.getAuth(appInstance || app);

    window.firebase = window.firebase || {};
    window.firebase.auth = window.firebase.auth || (() => auth);
    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.fvSignOut = () => authMod.signOut(auth);

    return { app, auth, mode };
  } catch (err) {
    console.warn('[FV] Firebase init failed, using stub auth instead:', err);
    app = null;
    auth = stubAuth;
    mode = 'stub';
    onAuthStateChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
    onIdTokenChangedImpl = (instance, cb) => stubSubscribe(instance || auth, cb);
    signOutImpl = (instance) => stubSignOut(instance || auth);
    getAuthImpl = () => auth;
    ensureStubGlobals();
    return { app, auth, mode };
  }
})();

export const getApp = () => app;
export const getAuth = (appInstance) => getAuthImpl(appInstance);
export const onAuthStateChanged = (instance, cb) => onAuthStateChangedImpl(instance || auth, cb);
export const onIdTokenChanged = (instance, cb) => onIdTokenChangedImpl(instance || auth, cb);
export const signOut = (instance) => signOutImpl(instance || auth);
export const isStub = () => mode !== 'firebase';
export const setStubUser = (user) => stubAuth._setUser(user);
export const getStubUser = () => stubAuth.currentUser;

// Expose for legacy scripts that expect a synchronous user object
window.__FV_USER = stubAuth.currentUser || null;
