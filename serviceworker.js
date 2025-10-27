/* FarmVista SW — dynamic versioned precache (scope-aware, no fetch-time version lookups) */

/* ----- Scope detection (works at /Farm-vista/ or /) ----- */
const SCOPE_PREFIX = (() => {
  try {
    const u = new URL(self.registration.scope);
    // Ensure trailing slash so startsWith checks are clean
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
  // Accept absolute “/foo” or bare “foo”
  const p = String(path || '').replace(/^\//, '');
  return SCOPE_PREFIX + p;
}

/* derive version number by reading js/version.js ONCE (install/activate time only) */
async function readVersionNumberOnce() {
  try {
    // Important: request WITHIN scope so SW doesn’t consider it cross-origin
    const r = await fetch(scoped('js/version.js') + `?ts=${Date.now()}`, { cache: 'reload' });
    const t = await r.text();
    const m = t.match(/number\s*:\s*["']([\d.]+)["']/) || t.match(/FV_NUMBER\s*=\s*["']([\d.]+)["']/);
    return (m && m[1]) || String(Date.now());
  } catch {
    return String(Date.now());
  }
}

async function initNames() {
  FV_VER = await readVersionNumberOnce();     // e.g., "10.27.05"
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

/* small helper: cache.put only if OK/basic */
async function putIfCachable(cache, req, res) {
  try {
    if (!res) return;
    if (res.ok && (res.type === 'basic' || res.type === 'default')) {
      await cache.put(req, res.clone());
    }
  } catch {}
}

/* Initialize once; fetch will wait on this before responding */
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

  // Only handle GET, under our scope
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  event.respondWith(READY.then(async () => {
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      return networkFirstNav(req);
    }

    // Static-ish assets: CSS/JS/images/fonts → stale-while-revalidate
    if (['style', 'script', 'image', 'font'].includes(req.destination)) {
      return staleWhileRevalidate(req);
    }

    // Default: stale-while-revalidate as well
    return staleWhileRevalidate(req);
  }));
});

/* -------------------- STRATEGIES -------------------- */

async function networkFirstNav(request) {
  const staticCache = await caches.open(CACHE_STATIC);

  // Prefer network (with a reasonable timeout), then cache, then last-resort minimal offline
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(request, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res && res.ok) {
      await putIfCachable(staticCache, request, res);
      return res;
    }
  } catch {}

  // Fallback to cached navigation (try cache-busted index first, then plain index)
  const bustedIndex = await staticCache.match(scoped(`index.html?rev=${FV_VER}`));
  if (bustedIndex) return bustedIndex;

  const plainIndex = await staticCache.match(scoped('index.html'));
  if (plainIndex) return plainIndex;

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

  if (cached) {
    // Kick off network update in background; return cache immediately
    net.catch(() => {});
    return cached;
  }
  const res = await net;
  if (res) return res;

  // Last fallback to static cache (often precached)
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