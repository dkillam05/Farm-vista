/* FarmVista SW — versioned caches; NO bounce-to-index on non-200 navigations */

/* ----- Scope detection (works at /Farm-vista/ or /) ----- */
const SCOPE_PREFIX = (() => {
  try {
    const u = new URL(self.registration.scope);
    return u.pathname.endsWith('/') ? u.pathname : (u.pathname + '/');
  } catch {
    return '/';
  }
})();

/* ----- Globals set during install/activate ----- */
let FV_VER = '0';
let CACHE_STATIC = 'farmvista-static-v0';
let CACHE_RUNTIME = 'farmvista-runtime-v0';
let PRECACHE_URLS = [];

function scoped(path) {
  const p = String(path || '').replace(/^\//, '');
  return SCOPE_PREFIX + p;
}

/* read js/version.js ONCE at install/activate (not during fetch) */
async function readVersionNumberOnce() {
  try {
    const r = await fetch(scoped('js/version.js') + `?ts=${Date.now()}`, { cache: 'reload' });
    const t = await r.text();
    const m = t.match(/number\s*:\s*["']([\d.]+)["']/) || t.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
    return (m && m[1]) || String(Date.now());
  } catch {
    return String(Date.now());
  }
}

async function initNames() {
  FV_VER = await readVersionNumberOnce();
  CACHE_STATIC  = `farmvista-static-v${FV_VER}`;
  CACHE_RUNTIME = `farmvista-runtime-v${FV_VER}`;
  const REV = FV_VER;
  PRECACHE_URLS = [
    scoped(''),
    scoped(`index.html?rev=${REV}`),
    scoped('manifest.webmanifest'),
    scoped(`assets/css/theme.css?rev=${REV}`),
    scoped(`assets/css/app.css?rev=${REV}`),
    scoped(`js/version.js?rev=${REV}`),
    scoped(`js/core.js?rev=${REV}`),
    scoped(`js/fv-shell.js?rev=${REV}`),
    scoped('assets/icons/icon-192.png'),
    scoped('assets/icons/icon-512.png'),
    scoped('assets/icons/apple-touch-icon.png')
  ];
}

async function putIfCachable(cache, req, res) {
  try {
    if (!res) return;
    if (res.ok && (res.type === 'basic' || res.type === 'default')) {
      await cache.put(req, res.clone());
    }
  } catch {}
}

const READY = (async()=>{ await initNames(); })();

/* -------------------- INSTALL -------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await READY;
    const c = await caches.open(CACHE_STATIC);
    await Promise.all(
      PRECACHE_URLS.map(async (u) => {
        try {
          const res = await fetch(new Request(u, { cache: 'reload' }));
          if (res && res.ok) await c.put(u, res.clone());
        } catch {}
      })
    );
    await self.skipWaiting();
  })());
});

/* -------------------- ACTIVATE -------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await READY;
    const keep = new Set([CACHE_STATIC, CACHE_RUNTIME]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (keep.has(k) ? Promise.resolve() : caches.delete(k))));
    await self.clients.claim();
  })());
});

/* -------------------- FETCH -------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  event.respondWith(READY.then(async () => {
    // Navigations: try network; if it fails (timeout/offline), only then fall back to cached index
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      return networkFirstNav_noBounce(req);
    }

    if (['style', 'script', 'image', 'font'].includes(req.destination)) {
      return staleWhileRevalidate(req);
    }
    return staleWhileRevalidate(req);
  }));
});

/* -------------------- STRATEGIES -------------------- */

async function networkFirstNav_noBounce(request) {
  const staticCache = await caches.open(CACHE_STATIC);

  // Try network with timeout
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(request, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);

    // IMPORTANT CHANGE:
    // Return whatever the server returned (200, 404, 500, etc.) — do NOT swap in index.html.
    // This prevents the “bounce back to Dashboard”.
    if (res) {
      // opportunistically update cache on success
      if (res.ok) await putIfCachable(staticCache, request, res);
      return res;
    }
  } catch {
    // Network failed → we are offline; fall back to cached index if available
    const bustedIndex = await staticCache.match(scoped(`index.html?rev=${FV_VER}`));
    if (bustedIndex) return bustedIndex;
    const plainIndex = await staticCache.match(scoped('index.html'));
    if (plainIndex) return plainIndex;
  }

  // Last resort minimal offline page
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title><h1>Offline</h1><p>No cached copy available.</p>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
  );
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(CACHE_RUNTIME);
  const cached = await runtime.match(request);
  const net = (async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok) await putIfCachable(runtime, request, res);
      return res;
    } catch {
      return null;
    }
  })();

  if (cached) { net.catch(() => {}); return cached; }
  const res = await net;
  if (res) return res;

  const staticCache = await caches.open(CACHE_STATIC);
  const fallback = await staticCache.match(request);
  return fallback || new Response('', { status: 504, statusText: 'Gateway Timeout' });
}

/* -------------------- MESSAGES -------------------- */
self.addEventListener('message', (e) => {
  if (e && (e.data === 'SKIP_WAITING' || (e.data && e.data.type === 'SKIP_WAITING'))) {
    self.skipWaiting();
  }
});