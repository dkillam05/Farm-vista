/* FarmVista SW — robust 404-friendly fetch (PROJECT scope) */
const SCOPE_PREFIX = "/Farm-vista/";

/* ---- Versioning ---- */
async function readVersionNumber() {
  try {
    const r = await fetch(`${SCOPE_PREFIX}js/version.js?ts=${Date.now()}`, { cache: "reload" });
    const t = await r.text();
    const m = t.match(/number\s*:\s*["']([\d.]+)["']/) || t.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
    return (m && m[1]) || String(Date.now());
  } catch { return String(Date.now()); }
}

async function makeNames() {
  const ver = await readVersionNumber();
  const CACHE_STATIC = `farmvista-static-v${ver}`;
  const RUNTIME_ASSETS = `farmvista-runtime-v${ver}`;
  const REV = ver;

  // IMPORTANT: do NOT precache version.js (must be network-fresh)
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
  return { CACHE_STATIC, RUNTIME_ASSETS, PRECACHE_URLS };
}

async function fetchAndPut(cache, url){
  try {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (res && res.ok) await cache.put(url, res.clone());
  } catch {}
}

/* ---- Install / Activate ---- */
self.addEventListener("install", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, PRECACHE_URLS } = await makeNames();
    const c = await caches.open(CACHE_STATIC);
    await Promise.all(PRECACHE_URLS.map(u=>fetchAndPut(c,u)));
    await self.skipWaiting(); // take over immediately
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, RUNTIME_ASSETS } = await makeNames();
    const keep = new Set([CACHE_STATIC, RUNTIME_ASSETS]);
    const keys = await caches.keys();
    await Promise.all(keys.map(k => keep.has(k) ? null : caches.delete(k)));
    await self.clients.claim(); // control all open tabs
  })());
});

/* ---- Fetch rules ---- */
self.addEventListener("fetch", (e)=>{
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Ignore non-http(s) and cross-origin; also ignore outside project path
  if (!/^https?:$/.test(url.protocol)) return;
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  // Always network-fresh for version.js (never cache)
  if (url.pathname === `${SCOPE_PREFIX}js/version.js`) {
    e.respondWith(fetch(req, { cache: "no-store" }).catch(()=> new Response("0.0.0", { status: 200 })));
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(networkFirstAllow404(req));
  } else {
    e.respondWith(staleWhileRevalidateAllow404(req));
  }
});

/* ---- Strategies ---- */
async function networkFirstAllow404(request){
  const { CACHE_STATIC } = await makeNames();
  const cache = await caches.open(CACHE_STATIC);
  try {
    const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(),6000);
    const res = await fetch(request, { signal: ctrl.signal }); clearTimeout(t);
    // Return network even if 404; only cache OK responses
    if (res) {
      if (res.ok) { cache.put(request, res.clone()); }
      return res;
    }
  } catch {
    const cached = await cache.match(request); if (cached) return cached;
  }
  // Offline fallback to dashboard shell if available
  const fallback = await caches.match(`${SCOPE_PREFIX}dashboard/index.html`);
  return fallback || new Response("Offline", { status: 503, headers:{ "Content-Type":"text/plain" }});
}

async function staleWhileRevalidateAllow404(request){
  const { RUNTIME_ASSETS } = await makeNames();
  const runtime = await caches.open(RUNTIME_ASSETS);
  const cached = await runtime.match(request);

  const networkPromise = (async()=>{
    try {
      const res = await fetch(request);
      if (res && res.ok) { runtime.put(request, res.clone()); }
      return res || null; // return 404s too (don’t mask)
    } catch { return null; }
  })();

  if (cached) { networkPromise; return cached; }
  const res = await networkPromise;
  if (res) return res;

  const { CACHE_STATIC } = await makeNames();
  const stat = await (await caches.open(CACHE_STATIC)).match(request);
  return stat || new Response("Offline", { status: 503, headers:{ "Content-Type":"text/plain" }});
}

/* ---- Messages (optional helpers) ---- */
self.addEventListener('message', async (e)=>{
  const msg = e && e.data;
  if (msg === 'SKIP_WAITING') {
    await self.skipWaiting();
    return;
  }
  if (msg === 'NUKE_CACHES') {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // Tell all clients to reload themselves if you want:
    const clientsArr = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clientsArr.forEach(c => c.postMessage('CACHES_CLEARED'));
    return;
  }
});