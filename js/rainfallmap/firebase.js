/* =====================================================================
/Farm-vista/js/rainfallmap/firebase.js   (FULL FILE)
Rev: 2026-04-10a-auth-stable-ptr-hold

PURPOSE
✔ Initializes Firebase app/auth/db for Weather / Readiness map
✔ Waits for Firebase config injected by firebase-config.js
✔ Holds startup until auth has had time to restore on refresh/PTR
✔ Reduces false signed-out state during iPhone/PWA pull-to-refresh

WHY THIS REV
The prior version resolved init as soon as onAuthStateChanged fired once
(or after only a short timeout). During mobile pull-to-refresh, auth can
still be restoring at that point. That can make downstream page logic act
like the user got kicked out even though the session is about to return.

THIS REV
✔ Keeps the same overall structure
✔ Uses a longer timeout for slow mobile/PWA restores
✔ Requires auth state to be briefly stable before resolving
✔ Exposes settled auth info on appState for downstream callers
===================================================================== */

import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { appState } from './store.js';

const FIREBASE_CONFIG_WAIT_MS = 8000;
const AUTH_INIT_TIMEOUT_MS = 8000;
const AUTH_STABLE_WINDOW_MS = 700;

function firebaseConfig(){
  const cfg = window.FV_FIREBASE_CONFIG || null;
  if (!cfg || typeof cfg !== 'object'){
    throw new Error('Firebase config missing.');
  }
  return cfg;
}

async function waitForFirebaseConfig(timeoutMs = FIREBASE_CONFIG_WAIT_MS){
  const started = Date.now();

  while (true){
    const cfg = window.FV_FIREBASE_CONFIG || null;
    if (cfg && typeof cfg === 'object'){
      return cfg;
    }

    if ((Date.now() - started) > timeoutMs){
      throw new Error('Firebase config missing.');
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function waitForStableAuth(auth, timeoutMs = AUTH_INIT_TIMEOUT_MS){
  return await new Promise(resolve=>{
    let done = false;
    let off = null;
    let settleTimer = null;
    let hardTimeout = null;

    let lastUid = null;
    let sawEvent = false;

    const cleanup = ()=>{
      if (settleTimer){
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (hardTimeout){
        clearTimeout(hardTimeout);
        hardTimeout = null;
      }
      try{
        if (typeof off === 'function') off();
      }catch(_){}
    };

    const finish = (reason)=>{
      if (done) return;
      done = true;
      cleanup();

      const user = auth.currentUser || null;

      appState.authInitDone = true;
      appState.authInitReason = String(reason || 'resolved');
      appState.authUserUid = user && user.uid ? String(user.uid) : '';
      appState.authSignedIn = !!user;
      appState.authSettledAt = Date.now();

      resolve({
        user,
        signedIn: !!user,
        reason: String(reason || 'resolved')
      });
    };

    const scheduleStableFinish = ()=>{
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(()=>{
        finish(sawEvent ? 'auth-stable' : 'auth-timeout-stable');
      }, AUTH_STABLE_WINDOW_MS);
    };

    try{
      off = onAuthStateChanged(
        auth,
        (user)=>{
          sawEvent = true;

          const uid = user && user.uid ? String(user.uid) : '';
          lastUid = uid;

          appState.authLastObservedUid = uid;
          appState.authLastObservedAt = Date.now();

          /*
            Important:
            Do NOT resolve immediately on first event.
            On mobile PTR, auth can momentarily look empty before restore completes.
            We require a short stable window before allowing startup to continue.
          */
          scheduleStableFinish();
        },
        ()=>{
          /*
            Even auth observer errors should not hard-fail page startup immediately.
            Give the session a short stable window, then continue with whatever
            auth.currentUser says at that point.
          */
          scheduleStableFinish();
        }
      );
    }catch(_){
      scheduleStableFinish();
    }

    hardTimeout = setTimeout(()=>{
      finish(sawEvent ? 'auth-timeout-after-event' : 'auth-timeout-no-event');
    }, timeoutMs);
  });
}

export async function initFirebase(){
  if (appState.dbRef && appState.authRef){
    return {
      auth: appState.authRef,
      db: appState.dbRef
    };
  }

  appState.authInitDone = false;
  appState.authInitReason = '';
  appState.authSignedIn = false;
  appState.authUserUid = '';
  appState.authSettledAt = 0;

  const cfg = await waitForFirebaseConfig();
  firebaseConfig();

  const app = getApps().length ? getApp() : initializeApp(cfg);

  appState.authRef = getAuth(app);
  appState.dbRef = getFirestore(app);

  await waitForStableAuth(appState.authRef, AUTH_INIT_TIMEOUT_MS);

  return {
    auth: appState.authRef,
    db: appState.dbRef
  };
}