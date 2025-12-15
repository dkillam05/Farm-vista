/* FarmVista SW — robust 404-friendly fetch (auto scope)
   FIXES:
   - Do NOT fetch version.js on every request (was causing unstable cache names on mobile).
   - Do NOT cache firebase-init/firebase-config/theme-boot/startup (must be network-fresh).
   - Keep version.js network-only.
*/

const SCOPE_PREFIX = self.location.pathname.replace(/serviceworker\.js$/, "");

// ---------------- Version + cache names (computed once per SW lifetime) ----------------
let NAMES_PROMISE = null;
let NAMES = null;

async function readVersionNumberOnce() {
  try {
    // IMPORTANT: no Date.now() here; we only need "fresh enough" at SW startup.
    // Also avoid cache-busting every request.
    const r = await fetch(`${SCOPE_PREFIX}js/version.js`, { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/number\s*:\s*["']([\d.]+)["']/) || t.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
    return (m && m[1]) || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function makeNamesOnce() {
  if (NAMES) return NAMES;
  if (!NAMES_PROMISE) {
    NAMES_PROMISE = (async () => {
      const ver = await readVersionNumberOnce();
      const CACHE_STATIC = `farmvista-static-v${ver}`;
      const RUNTIME_ASSETS = `farmvista-runtime-v${ver}`;
      const REV = ver;

      const PRECACHE_URLS = [
        `${SCOPE_PREFIX}`,
        `${SCOPE_PREFIX}dashboard/index.html?rev=${REV}`,
        `${SCOPE_PREFIX}manifest.webmanifest`,
        `${SCOPE_PREFIX}assets/css/theme.css?rev=${REV}`,
        `${SCOPE_PREFIX}assets/css/app.css?rev=${REV}`,
        `${SCOPE_PREFIX}js/core.js?rev=${REV}`,
        `${SCOPE_PREFIX}js/fv-shell.js?rev=${REV}`,
        `${SCOPE_PREFIX}assets/icons/icon-192.png`,
        `${SCOPE_PREFIX}assets/icons/icon-512.png`,
        `${SCOPE_PREFIX}assets/icons/apple-touch-icon.png`
      ];

      NAMES = { CACHE_STATIC, RUNTIME_ASSETS, PRECACHE_URLS, REV };
      return NAMES;
    })();
  }
  return await NAMES_PROMISE;
}

async function fetchAndPut(cache, url){
  try {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (res && res.ok) await cache.put(url, res.clone());
  } catch {}
}

// ---------------- Install / Activate ----------------
self.addEventListener("install", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, PRECACHE_URLS } = await makeNamesOnce();
    const c = await caches.open(CACHE_STATIC);
    await Promise.all(PRECACHE_URLS.map(u=>fetchAndPut(c,u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, RUNTIME_ASSETS } = await makeNamesOnce();
    const keep = new Set([CACHE_STATIC, RUNTIME_ASSETS]);
    const keys = await caches.keys();
    await Promise.all(keys.map(k => keep.has(k) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

// ---------------- Fetch rules ----------------
function isBypassPath(pathname){
  // Never cache boot-critical JS. Always network-fresh.
  const p = pathname;
  return (
    p === `${SCOPE_PREFIX}js/version.js` ||
    p === `${SCOPE_PREFIX}js/firebase-init.js` ||
    p === `${SCOPE_PREFIX}js/firebase-config.js` ||
    p === `${SCOPE_PREFIX}js/theme-boot.js` ||
    p === `${SCOPE_PREFIX}js/startup.js`
  );
}

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  if (!/^https?:$/.test(url.protocol)) return;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  // Always network-only for boot-critical stuff (prevents stale stub builds on iOS)
  if (isBypassPath(url.pathname)) {
    e.respondWith(
      fetch(req, { cache: "no-store" }).catch(async ()=>{
        // fallback: if offline, try cache (but do NOT promote cache over network)
        try{
          const { CACHE_STATIC } = await makeNamesOnce();
          const cached = await (await caches.open(CACHE_STATIC)).match(req);
          return cached || new Response("Offline", { status: 503 });
        }catch{
          return new Response("Offline", { status: 503 });
        }
      })
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(networkFirstAllow404(req));
  } else {
    e.respondWith(staleWhileRevalidateAllow404(req));
  }
});

// ---------------- Strategies ----------------
async function networkFirstAllow404(request){
  const { CACHE_STATIC } = await makeNamesOnce();
  const cache = await caches.open(CACHE_STATIC);
  try {
    const ctrl = new AbortController();
    const t=setTimeout(()=>ctrl.abort(),6000);
    const res = await fetch(request, { signal: ctrl.signal });
    clearTimeout(t);

    if (res) {
      if (res.ok) { cache.put(request, res.clone()); }
      return res;
    }
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
  }

  const fallback = await caches.match(`${SCOPE_PREFIX}dashboard/index.html`);
  return fallback || new Response("Offline", { status: 503, headers:{ "Content-Type":"text/plain" }});
}

async function staleWhileRevalidateAllow404(request){
  const { RUNTIME_ASSETS, CACHE_STATIC } = await makeNamesOnce();
  const runtime = await caches.open(RUNTIME_ASSETS);
  const cached = await runtime.match(request);

  const networkPromise = (async()=>{
    try {
      const res = await fetch(request);
      if (res && res.ok) { runtime.put(request, res.clone()); }
      return res || null;
    } catch { return null; }
  })();

  if (cached) { networkPromise; return cached; }

  const res = await networkPromise;
  if (res) return res;

  const stat = await (await caches.open(CACHE_STATIC)).match(request);
  return stat || new Response("Offline", { status: 503, headers:{ "Content-Type":"text/plain" }});
}

// ---------------- Messages ----------------
self.addEventListener('message', async (e)=>{
  const msg = e && e.data;
  if (msg === 'SKIP_WAITING') {
    await self.skipWaiting();
    return;
  }
  if (msg === 'NUKE_CACHES') {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    const clientsArr = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clientsArr.forEach(c => c.postMessage('CACHES_CLEARED'));
    return;
  }
});

// Push handlers unchanged (keep yours as-is)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (err) {
    try { data = { body: event.data && event.data.text ? event.data.text() : '' }; } catch {}
  }

  const title = data.title || 'FarmVista';
  const body  = data.body  || 'You have a new notification.';
  let url     = data.url   || `${SCOPE_PREFIX}`;

  try {
    const u = new URL(url, self.location.origin);
    if (!u.pathname.startsWith(SCOPE_PREFIX)) {
      url = `${SCOPE_PREFIX.replace(/\/$/,'')}${u.pathname}`;
      if (u.search) url += u.search;
      if (u.hash)   url += u.hash;
    } else {
      url = u.pathname + u.search + u.hash;
    }
  } catch {
    url = `${SCOPE_PREFIX}`;
  }

  const options = {
    body,
    icon: `${SCOPE_PREFIX}assets/icons/icon-192.png`,
    badge: `${SCOPE_PREFIX}assets/icons/icon-192.png`,
    data: { url }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) ||
                    `${SCOPE_PREFIX}`;

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of allClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && clientUrl.pathname.startsWith(SCOPE_PREFIX)) {
          await client.focus();
          if (targetUrl && clientUrl.pathname + clientUrl.search + clientUrl.hash !== targetUrl) {
            client.navigate(targetUrl);
          }
          return;
        }
      } catch {}
    }
    await self.clients.openWindow(targetUrl);
  })());
});
