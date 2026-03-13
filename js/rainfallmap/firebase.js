import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { appState } from './store.js';

function firebaseConfig(){
  const cfg = window.FV_FIREBASE_CONFIG || null;
  if (!cfg || typeof cfg !== 'object'){
    throw new Error('Firebase config missing.');
  }
  return cfg;
}

async function waitForFirebaseConfig(timeoutMs = 5000){
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

export async function initFirebase(){
  if (appState.dbRef && appState.authRef){
    return {
      auth: appState.authRef,
      db: appState.dbRef
    };
  }

  const cfg = await waitForFirebaseConfig();

  const app = getApps().length ? getApp() : initializeApp(cfg);

  appState.authRef = getAuth(app);
  appState.dbRef = getFirestore(app);

  await new Promise(resolve=>{
    let done = false;

    const finish = ()=>{
      if (done) return;
      done = true;
      try{ off(); }catch(_){}
      resolve();
    };

    const off = onAuthStateChanged(
      appState.authRef,
      ()=> finish(),
      ()=> finish()
    );

    setTimeout(finish, 3000);
  });

  return {
    auth: appState.authRef,
    db: appState.dbRef
  };
}