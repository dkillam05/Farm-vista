// /Farm-vista/js/auth-guard.js  (ES module)
// Redirects signed-out users to the login page on ALL pages except the public ones.

import { ready, auth } from '/Farm-vista/js/firebase-init.js';
import { onAuthStateChanged, getAuth } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

await ready;

const PUBLIC_PREFIXES = [
  '/Farm-vista/pages/login/',   // login page
  '/Farm-vista/assets/',        // static assets
  '/Farm-vista/manifest.webmanifest',
  '/Farm-vista/serviceworker.js'
];

function isPublicPath(pathname){
  return PUBLIC_PREFIXES.some(p => pathname.startsWith(p));
}

const here = location.pathname;

// If we’re on a public path, do not guard.
if (!isPublicPath(here)) {
  const a = auth || getAuth(window.firebaseApp);
  onAuthStateChanged(a, user => {
    if (!user) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`/Farm-vista/pages/login/?next=${next}`);
    }
  });
}