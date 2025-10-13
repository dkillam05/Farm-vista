/* FarmVista PWA Service Worker (root-level) */
const ASSET_PREFIX = "/Farm-vista/";
const CACHE_NAME = "farmvista-cache-v2-2025-10-13a";

const PRECACHE = [
  `${ASSET_PREFIX}`,
  `${ASSET_PREFIX}index.html`,
  `${ASSET_PREFIX}manifest.webmanifest`,
  `${ASSET_PREFIX}assets/css/theme.css`,
  `${ASSET_PREFIX}js/core.js`,
  `${ASSET_PREFIX}js/index.js`,
  `${ASSET_PREFIX}js/ui-nav.js`,
  `${ASSET_PREFIX}js/ui-subnav.js`,
  `${ASSET_PREFIX}assets/icons/icon-192.png`,
  `${ASSET_PREFIX}assets/icons/icon-512.png`,
  `${ASSET_PREFIX}assets/icons/apple-touch-icon.png`
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

async function handleNavigation(event) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(event.request, { signal: ctrl.signal });
    clearTimeout(timeout);
    const cache = await caches.open(CACHE_NAME);
    cache.put(event.request, res.clone());
    return res;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    // Try exact match first
    const cached = await cache.match(event.request);
    if (cached) return cached;
    // Fallback to app shell
    return cache.match(`${ASSET_PREFIX}index.html`);
  }
}

async function handleAsset(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  try {
    const res = await fetch(event.request);
    cache.put(event.request, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle in-scope requests
  if (!url.pathname.startsWith(ASSET_PREFIX)) return;

  if (req.mode === "navigate") {
    event.respondWith(handleNavigation(event));
  } else if (["style", "script", "image", "font"].includes(req.destination)) {
    event.respondWith(handleAsset(event));
  } else {
    event.respondWith(handleAsset(event));
  }
});
