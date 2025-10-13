/* ==========================================================
   FarmVista — Service Worker
   Strategy:
     - Minimal precache: app shell + dashboard + core CSS/JS + icons/manifest
     - Navigation = Network-first with offline fallback to dashboard
     - Static assets = Stale-while-revalidate (fast, then update in background)
     - Silent updates: install -> skipWaiting, activate -> clients.claim
   Notes:
     - Absolute paths from /Farm-vista/
     - No version bump required (we refresh precache entries explicitly)
   ========================================================== */

const SCOPE_PREFIX = "/Farm-vista/";
const CACHE_STATIC = "farmvista-static";     // Single cache name (we refresh entries on install)
const RUNTIME_ASSETS = "farmvista-runtime";  // For on-the-fly cached assets

// Keep the list tight — only things we want offline on day one.
const PRECACHE_URLS = [
  `${SCOPE_PREFIX}`,                         // resolves to /Farm-vista/
  `${SCOPE_PREFIX}dashboard/`,
  `${SCOPE_PREFIX}dashboard/index.html`,
  `${SCOPE_PREFIX}manifest.webmanifest`,

  // Core CSS/JS
  `${SCOPE_PREFIX}assets/css/theme.css`,
  `${SCOPE_PREFIX}assets/css/app.css`,
  `${SCOPE_PREFIX}js/version.js`,
  `${SCOPE_PREFIX}js/core.js`,
  `${SCOPE_PREFIX}js/fv-shell.js`,
  `${SCOPE_PREFIX}js/fv-hero.js`,

  // Icons
  `${SCOPE_PREFIX}assets/icons/icon-192.png`,
  `${SCOPE_PREFIX}assets/icons/icon-512.png`,
  `${SCOPE_PREFIX}assets/icons/apple-touch-icon.png`
];

// Helper: cache a URL with a fresh fetch that bypasses the HTTP cache.
async function fetchAndPut(cache, url) {
  try {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (res && res.ok) await cache.put(url, res.clone());
  } catch (e) {
    // Ignore individual fetch failures during install — we'll still serve what we have.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // Precache (force refresh each entry so content updates without changing cache name)
    await Promise.all(PRECACHE_URLS.map((u) => fetchAndPut(cache, u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Clean unknown caches (in case we ever rename CACHE_*)
    const keep = new Set([CACHE_STATIC, RUNTIME_ASSETS]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (keep.has(k) ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Router
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only handle in-scope requests
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  // HTML navigations: Network-first with offline fallback
  if (req.mode === "navigate") {
    event.respondWith(networkFirstWithFallback(req));
    return;
  }

  // Static assets (css/js/img/font): Stale-while-revalidate
  if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: try runtime cache, then network, then fallback to dashboard
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstWithFallback(request) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    // 5s network timeout to keep things snappy when offline/poor signal
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(request, { signal: ctrl.signal });
    clearTimeout(t);
    if (res && res.ok) {
      // Cache the fresh page response in STATIC (acts like app shell)
      cache.put(request, res.clone());
      return res;
    }
    // If network returned a non-OK response, fall through to cache
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  // Fallback to dashboard shell
  return (await cache.match(`${SCOPE_PREFIX}dashboard/index.html`)) ||
         new Response("Offline", { status: 503, statusText: "Offline" });
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(RUNTIME_ASSETS);
  const cached = await runtime.match(request);
  const networkPromise = (async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok) runtime.put(request, res.clone());
      return res;
    } catch {
      return null;
    }
  })();

  // Prefer cached instantly, update in background
  if (cached) {
    eventWait(networkPromise); // don't block response
    return cached;
  }

  // No cache yet — go to network, then cache
  const res = await networkPromise;
  if (res) return res;

  // As a last resort, try STATIC cache (for core files)
  const stat = await (await caches.open(CACHE_STATIC)).match(request);
  if (stat) return stat;

  return new Response("Offline", { status: 503, statusText: "Offline" });
}

// Utility: keep SW alive for background async tasks without blocking main response
function eventWait(promise) {
  if (promise && typeof promise.then === "function") {
    try { self.registration.active && self.addEventListener; } catch { /* noop */ }
  }
}