/* Weather map uses the same farm-scoped Firebase session as the shell.
   Do not initialize a second SDK/auth instance: it races persistence restore
   and can leave the first field query unauthenticated after a PWA refresh. */
import { ready } from '/js/firebase/firebase-init.js';
import { appState } from './store.js';

let initializing = null;

export function initFirebase(){
  if (initializing) return initializing;
  initializing = (async () => {
    appState.authInitDone = false;
    const ctx = await ready;
    if (ctx.mode !== 'firebase' || !ctx.auth || !ctx.firestore){
      throw new Error('Map connection is unavailable. Please try refreshing again.');
    }

    // Await Firebase's actual persistence restoration, not an arbitrary delay.
    await ctx.auth.authStateReady();
    const user = ctx.auth.currentUser;
    appState.authSignedIn = !!user;
    appState.authUserUid = user?.uid || '';
    if (!user){
      throw new Error('Waiting for your FarmVista sign-in.');
    }

    appState.authRef = ctx.auth;
    appState.dbRef = ctx.firestore;
    appState.authInitDone = true;
    appState.authInitReason = 'shared-auth-ready';
    appState.authSettledAt = Date.now();
    return { auth: ctx.auth, db: ctx.firestore };
  })().finally(() => { initializing = null; });
  return initializing;
}
