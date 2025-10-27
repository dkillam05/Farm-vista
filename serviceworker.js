/* FarmVista SW — dynamic versioned precache (PROJECT scope) */
const SCOPE_PREFIX = "/Farm-vista/";

/* derive version number by reading /Farm-vista/js/version.js */
async function readVersionNumber() {
  try {
    const r = await fetch(`${SCOPE_PREFIX}js/version.js?ts=${Date.now()}`, { cache: "reload" });
    const t = await r.text();
    let m = t.match(/number\s*:\s*["']([\d.]+)["']/) || t.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
    return (m && m[1]) || String(Date.now());
  } catch {
    return String(Date.now());
  }
}

async function makeNames() {
  const ver = await readVersionNumber();
  const CACHE_STATIC = `farmvista-static-v${ver}`;
  const RUNTIME_ASSETS = `farmvista-runtime-v${ver}`;
  const REV = ver;
  const PRECACHE_URLS = [
    `${SCOPE_PREFIX}`,
    `${SCOPE_PREFIX}dashboard/index.html?rev=${REV}`,
    `${SCOPE_PREFIX}manifest.webmanifest`,
    `${SCOPE_PREFIX}assets/css/theme.css?rev=${REV}`,
    `${SCOPE_PREFIX}assets/css/app.css?rev=${REV}`,
    `${SCOPE_PREFIX}js/version.js?rev=${REV}`,
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

self.addEventListener("install", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, PRECACHE_URLS } = await makeNames();
    const c = await caches.open(CACHE_STATIC);
    await Promise.all(PRECACHE_URLS.map(u=>fetchAndPut(c,u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async()=>{
    const { CACHE_STATIC, RUNTIME_ASSETS } = await makeNames();
    const keep = new Set([CACHE_STATIC, RUNTIME_ASSETS]);
    const keys = await caches.keys();
    await Promise.all(keys.map(k => keep.has(k) ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e)=>{
  const {request:req} = e;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Only handle requests under our project path
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(request){
  const { CACHE_STATIC } = await makeNames();
  const cache = await caches.open(CACHE_STATIC);
  try {
    const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(),5000);
    const res = await fetch(request, { signal: ctrl.signal }); clearTimeout(t);
    if (res && res.ok) { cache.put(request, res.clone()); return res; }
    const cached = await cache.match(request); if (cached) return cached;
  } catch { const cached = await cache.match(request); if (cached) return cached; }
  // Fallback to dashboard under project scope instead of a bare Offline/404
  return caches.match(`${SCOPE_PREFIX}dashboard/index.html`) || new Response("Offline", {status:503});
}

async function staleWhileRevalidate(request){
  const { RUNTIME_ASSETS } = await makeNames();
  const runtime = await caches.open(RUNTIME_ASSETS);
  const cached = await runtime.match(request);
  const networkPromise = (async()=>{
    try { const res = await fetch(request); if (res && res.ok) runtime.put(request, res.clone()); return res; }
    catch { return null; }
  })();
  if (cached) { networkPromise; return cached; }
  const res = await networkPromise; if (res) return res;
  const { CACHE_STATIC } = await makeNames();
  return (await caches.open(CACHE_STATIC)).match(request) || new Response("Offline",{status:503});
}

self.addEventListener('message', (e)=>{
  if (e && e.data === 'SKIP_WAITING') self.skipWaiting();
});