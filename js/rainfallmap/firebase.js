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

export async function initFirebase(){

  const cfg = firebaseConfig();

  const app = getApps().length ? getApp() : initializeApp(cfg);

  appState.authRef = getAuth(app);
  appState.dbRef = getFirestore(app);

  await new Promise(resolve=>{
    let done = false;

    const off = onAuthStateChanged(appState.authRef, ()=>{
      if (done) return;
      done = true;
      try{ off(); }catch(_){}
      resolve();
    }, ()=>{
      if (done) return;
      done = true;
      try{ off(); }catch(_){}
      resolve();
    });

    setTimeout(()=>{
      if (done) return;
      done = true;
      try{ off(); }catch(_){}
      resolve();
    }, 3000);
  });

  return {
    auth: appState.authRef,
    db: appState.dbRef
  };
}