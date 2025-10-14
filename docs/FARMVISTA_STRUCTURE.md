# FarmVista Project Snapshot (Light & Dark Theme Ready)

This document is meant to be dropped into GitHub so that collaborators — human or AI — can see the exact file structure _and_ the source for every file that participates in the light/dark theme experience. Each section below includes:

* **Path & purpose** – what the file is responsible for.
* **Full source** – verbatim code so downstream agents can reason about theme tokens without cloning the repo.
* **Theme notes** – quick callouts on how the file contributes to light/dark support.

---

## Directory Overview

```text
Farm-vista/
├── index.html                      # Redirect into the dashboard experience
├── dashboard/
│   └── index.html                  # Main UI shell loader
├── assets/
│   ├── css/
│   │   ├── theme.css               # Token definitions + dual-mode variables
│   │   ├── app.css                 # Global layout helpers that respect tokens
│   │   └── dashboard.css           # Dashboard page styling built on tokens
│   └── icons/
│       ├── apple-touch-icon.png
│       ├── icon-192.png
│       ├── icon-512.png
│       └── logo.png
├── js/
│   ├── core.js                     # Theme boot + public App API
│   ├── fv-hero-card.js             # Custom element for hero cards (token aware)
│   ├── fv-hero.js                  # Renders cards into the dashboard
│   ├── fv-shell.js                 # Application shell (drawers, updater, theming UI)
│   └── version.js                  # Central version/tagline info
├── manifest.webmanifest            # PWA metadata (brand colors)
├── serviceworker.js                # PWA cache logic (respects REV busting)
└── docs/
    └── FARMVISTA_STRUCTURE.md      # ← This file
```

> **Tip for theme work:** The `App` API exposed by `js/core.js` owns the theme mode (`system | light | dark`). Anything that needs to react should listen for the `fv:theme` event or read the CSS custom properties defined in `assets/css/theme.css`.

---

## Root Files

### `/index.html`
* **Purpose:** Redirect legacy entry points to the dashboard.
* **Theme notes:** Minimal; only sets `<meta name="theme-color">` so mobile address bars match the brand green.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FarmVista</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#3B7E46" />
  <meta name="robots" content="noindex" />
  <script>
    // JS redirect (clean history)
    window.location.replace("/Farm-vista/dashboard/");
  </script>
</head>
<body>
  <noscript>
    <p>JavaScript is required to continue. <a href="/Farm-vista/dashboard/">Enter Dashboard</a></p>
  </noscript>
</body>
</html>
```

### `/manifest.webmanifest`
* **Purpose:** Progressive Web App manifest.
* **Theme notes:** `background_color` and `theme_color` must line up with the light mode brand palette defined in `theme.css`.

```json
{
  "id": "/Farm-vista/",
  "name": "FarmVista",
  "short_name": "FarmVista",
  "description": "Clean farm data. Smarter reporting.",
  "start_url": "/Farm-vista/dashboard/?install_source=pwa",
  "scope": "/Farm-vista/",
  "display": "standalone",
  "display_override": ["standalone", "fullscreen"],
  "background_color": "#CBCDCB",
  "theme_color": "#3B7E46",
  "dir": "ltr",
  "lang": "en-US",
  "categories": ["productivity", "business"],
  "prefer_related_applications": false,
  "icons": [
    {
      "src": "/Farm-vista/assets/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/Farm-vista/assets/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/Farm-vista/assets/icons/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png"
    }
  ],
  "screenshots": [
    {
      "src": "/Farm-vista/assets/icons/logo.png",
      "sizes": "1024x512",
      "type": "image/png",
      "form_factor": "wide",
      "label": "FarmVista"
    }
  ]
}
```

### `/serviceworker.js`
* **Purpose:** Handles caching/offline logic.
* **Theme notes:** None directly, but the `REV` constant should be bumped when theme assets change so the new CSS is precached.

```javascript
/* FarmVista SW — v3 (cache-busted) */
const SCOPE_PREFIX = "/Farm-vista/";
const CACHE_STATIC = "farmvista-static-v3";
const RUNTIME_ASSETS = "farmvista-runtime-v3";
const REV = "2025-10-13c"; // bump this when assets change

const PRECACHE_URLS = [
  `${SCOPE_PREFIX}`,
  `${SCOPE_PREFIX}dashboard/`,
  `${SCOPE_PREFIX}dashboard/index.html?rev=${REV}`,
  `${SCOPE_PREFIX}manifest.webmanifest`,
  `${SCOPE_PREFIX}assets/css/theme.css?rev=${REV}`,
  `${SCOPE_PREFIX}assets/css/app.css?rev=${REV}`,
  `${SCOPE_PREFIX}assets/css/dashboard.css?rev=${REV}`,
  `${SCOPE_PREFIX}js/version.js?rev=${REV}`,
  `${SCOPE_PREFIX}js/core.js?rev=${REV}`,
  `${SCOPE_PREFIX}js/fv-shell.js?rev=${REV}`,
  `${SCOPE_PREFIX}js/fv-hero.js?rev=${REV}`,
  `${SCOPE_PREFIX}assets/icons/icon-192.png`,
  `${SCOPE_PREFIX}assets/icons/icon-512.png`,
  `${SCOPE_PREFIX}assets/icons/apple-touch-icon.png`
];

async function fetchAndPut(cache, url){
  try {
    const res = await fetch(new Request(url, { cache: "reload" }));
    if (res && res.ok) await cache.put(url, res.clone());
  } catch {}
}

self.addEventListener("install", (e)=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE_STATIC);
    await Promise.all(PRECACHE_URLS.map(u=>fetchAndPut(c,u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e)=>{
  e.waitUntil((async()=>{
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
  if (!url.pathname.startsWith(SCOPE_PREFIX)) return;

  if (req.mode === "navigate") {
    e.respondWith(networkFirst(req));
  } else if (["style","script","image","font"].includes(req.destination)) {
    e.respondWith(staleWhileRevalidate(req));
  } else {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function networkFirst(request){
  const cache = await caches.open(CACHE_STATIC);
  try {
    const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(),5000);
    const res = await fetch(request, { signal: ctrl.signal }); clearTimeout(t);
    if (res && res.ok) { cache.put(request, res.clone()); return res; }
    const cached = await cache.match(request); if (cached) return cached;
  } catch { const cached = await cache.match(request); if (cached) return cached; }
  return cache.match(`${SCOPE_PREFIX}dashboard/index.html?rev=${REV}`) ||
         new Response("Offline", {status:503});
}

async function staleWhileRevalidate(request){
  const runtime = await caches.open(RUNTIME_ASSETS);
  const cached = await runtime.match(request);
  const networkPromise = (async()=>{
    try { const res = await fetch(request); if (res && res.ok) runtime.put(request, res.clone()); return res; }
    catch { return null; }
  })();
  if (cached) { networkPromise; return cached; }
  const res = await networkPromise; if (res) return res;
  return (await caches.open(CACHE_STATIC)).match(request) || new Response("Offline",{status:503});
}
```

---

## Dashboard Entry Point

### `/dashboard/index.html`
* **Purpose:** Loads the shell + hero cards and wires up bootloader sequencing.
* **Theme notes:** Pulls in `theme.css` first so variables are ready before custom elements hydrate.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>FarmVista • Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#3B7E46" />

  <link rel="manifest" href="/Farm-vista/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/Farm-vista/assets/icons/apple-touch-icon.png" />
  <link rel="icon" href="/Farm-vista/assets/icons/icon-192.png" />

  <!-- CSS (no hard-coded rev; JS bootloader will handle cache-busting) -->
  <link rel="stylesheet" href="/Farm-vista/assets/css/theme.css" />
  <link rel="stylesheet" href="/Farm-vista/assets/css/app.css" />
  <link rel="stylesheet" href="/Farm-vista/assets/css/dashboard.css" />
</head>
<body>
  <fv-shell>
    <div class="page">
      <h1 class="page-title">Dashboard</h1>
      <!-- Empty container — cards are injected dynamically -->
      <section class="hero-grid" id="hero-grid" aria-label="Quick overview"></section>
    </div>
  </fv-shell>

  <!-- Bootloader: loads JS in strict order, all sharing a single REV token -->
  <script>
    (function () {
      // If the page has ?rev=..., reuse it; else create a fresh one.
      const urlRev = new URL(location.href).searchParams.get('rev');
      const REV = urlRev || String(Date.now());

      const files = [
        '/Farm-vista/js/version.js',
        '/Farm-vista/js/core.js',
        '/Farm-vista/js/fv-hero-card.js',
        '/Farm-vista/js/fv-shell.js',
        '/Farm-vista/js/fv-hero.js'
      ];

      (async function loadSeq() {
        for (const src of files) {
          await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src + '?rev=' + REV;
            s.async = false; // preserve order
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load ' + s.src));
            document.body.appendChild(s);
          });
        }
      })().catch(err => console.error('Bootloader failed:', err));
    })();
  </script>

  <noscript>
    <div class="container">
      <div class="card">JavaScript is required for the FarmVista dashboard.</div>
    </div>
  </noscript>
</body>
</html>
```

---

## CSS (Theme Foundation)

### `/assets/css/theme.css`
* **Purpose:** Defines color tokens, safe-area vars, and base layout primitives.
* **Theme notes:** Light values live on `:root`; dark overrides live on `.dark` and `[data-theme="auto"]` when the user chooses “system”. Any new component should rely on these CSS custom properties.

```css
/* ==========================================================
   File: /assets/css/theme.css
   Brand-first color system + dual-mode (light/dark)
   ========================================================== */

/* ---------- Reset & layout ---------- */
* { box-sizing: border-box; }
html, body { height: 100%; }
html { background: var(--bg); }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.4;
  color: var(--text);
  background: var(--bg);
  overflow-x: hidden;
  overscroll-behavior-x: none;
  -webkit-text-size-adjust: 100%;
}

/* ---------- Safe-area variables ---------- */
:root {
  --safe-top: env(safe-area-inset-top);
  --safe-right: env(safe-area-inset-right);
  --safe-bottom: env(safe-area-inset-bottom);
  --safe-left: env(safe-area-inset-left);

  /* ---------- Brand palette ---------- */
  --brand-green: #3B7E46;
  --brand-green-700: #0a4c29;
  --brand-gold: #D0C542;
  --brand-gunmetal: #CBCDCB;

  /* ---------- Light theme ---------- */
  --bg: #F6F7F6;
  --surface: #FFFFFF;
  --text: #142016;
  --muted: #677a6e;
  --border: #E3E6E2;

  --header-bg: var(--brand-green);
  --header-fg: #FFFFFF;

  --footer-bg: #0B1A10;
  --footer-fg: #CFD7D1;

  --shadow: 0 12px 24px rgba(0,0,0,.14);
}

/* ---------- Dark theme (manual toggle) ---------- */
html.dark {
  --bg: #0d1210;
  --surface: #151b17;
  --text: #E8EEE9;
  --muted: #9FB2A7;
  --border: #253228;

  --header-bg: #0a2617;
  --header-fg: #E8EEE9;

  --footer-bg: #070b08;
  --footer-fg: #9FB2A7;

  --shadow: 0 12px 24px rgba(0,0,0,.5);
}

/* ---------- Auto-dark for system preference ---------- */
@media (prefers-color-scheme: dark) {
  html:not(.dark)[data-theme="auto"] {
    --bg: #0d1210;
    --surface: #151b17;
    --text: #E8EEE9;
    --muted: #9FB2A7;
    --border: #253228;

    --header-bg: #0a2617;
    --header-fg: #E8EEE9;

    --footer-bg: #070b08;
    --footer-fg: #9FB2A7;

    --shadow: 0 12px 24px rgba(0,0,0,.5);
  }
}

/* ---------- Global shell ---------- */
.app-shell, #app {
  min-height: 100vh;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}

/* ---------- Header ---------- */
.app-header {
  position: sticky; top: 0; left: 0; right: 0;
  display: grid; grid-template-columns: 1fr auto;
  align-items: center;
  height: 56px;
  padding: 0 max(12px,var(--safe-right)) 0 max(12px,var(--safe-left));
  background: var(--header-bg);
  color: var(--header-fg);
  z-index: 1000;
  width: 100%;
}
.header-left{display:flex;align-items:center;gap:10px;}
.brand-name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.header-right{display:flex;align-items:center;gap:8px;justify-self:end;}
.icon-btn{
  background:transparent;border:0;width:40px;height:40px;
  display:grid;place-items:center;border-radius:10px;color:inherit;
}
.icon-btn:focus-visible{outline:2px solid var(--brand-gold);outline-offset:2px;}

/* ---------- Card & content helpers ---------- */
.container{max-width:1100px;margin:0 auto;padding:16px;}
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:12px;
  padding:14px;
  box-shadow:var(--shadow);
}
.card h3{margin:0 0 8px;}
.cards{display:grid;gap:12px;}
.row{display:flex;gap:16px;flex-wrap:wrap;}
.stat-label{font-size:.85rem;color:var(--muted);}
.stat-value{font-weight:700;font-size:1.2rem;}

/* ---------- Tables ---------- */
.table{width:100%;border-collapse:collapse;table-layout:fixed;}
.table th,.table td{padding:14px;border-bottom:1px solid var(--border);text-align:left;}
.table td{word-break:break-word;}

/* ---------- Footer ---------- */
.app-footer{
  margin-top:auto;
  display:grid;
  place-items:center;
  color:var(--footer-fg);
  background:var(--footer-bg);
  border-top:3px solid var(--brand-gold);
  padding:10px max(16px,var(--safe-right))
           calc(10px + var(--safe-bottom))
           max(16px,var(--safe-left));
  text-align:center;
  white-space:nowrap; /* keep date + tagline in one line */
}
```

### `/assets/css/app.css`
* **Purpose:** Flex-shell glue and guardrails that sit on top of the theme tokens.
* **Theme notes:** Uses `var(--surface)`, `var(--border)`, etc., so it automatically benefits from light/dark changes.

```css
/* ==========================================================
   File: /assets/css/app.css
   Purpose: Page-level layout glue that sits on top of theme.css.
   - Prevents horizontal scroll
   - Safe-area aware side paddings
   - Flex shell so the footer sits flush at the bottom
   - Guardrails for accidental 100vw usage
   ========================================================== */

/* ---------- Safe-area variables ---------- */
:root{
  --safe-left:  env(safe-area-inset-left);
  --safe-right: env(safe-area-inset-right);
  --safe-bottom:env(safe-area-inset-bottom);
}

/* ---------- Global guards ---------- */
html, body { overflow-x: hidden; }

/* ---------- Flex shell so footer stays at bottom ---------- */
#app, .app-shell{
  min-height: 100vh;
  min-height: 100svh;              /* modern mobile viewport unit */
  display: flex;
  flex-direction: column;
}

/* ---------- Default paddings (safe-area aware) ---------- */
.app-header,
.breadcrumbs-bar,
.app-main,
.app-footer{
  padding-left:  max(16px, var(--safe-left));
  padding-right: max(16px, var(--safe-right));
}

/* Main grows; footer sits at bottom */
.app-main{ flex: 1 1 auto; }

/* Footer gets extra bottom padding for iOS home-indicator */
.app-footer{
  margin-top: auto;
  padding-bottom: calc(12px + var(--safe-bottom));
}

/* ---------- Content helpers ---------- */
.container{ max-width: 1100px; margin: 0 auto; padding: 16px; }
.cards{ display: grid; gap: 12px; }
.card  {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  box-shadow: var(--shadow);
}

/* ---------- 100vw guardrail ---------- */
[class*="vw"], [style*="100vw"]{
  width: 100% !important;
  max-width: 100% !important;
}

/* ---------- Optional: lock scroll when overlays are open ---------- */
body.drawer-open{ overflow: hidden; }
```

### `/assets/css/dashboard.css`
* **Purpose:** Dashboard-specific layout that is entirely token-driven.
* **Theme notes:** Every color reference is `var(...)`, so the cards look correct in light and dark modes without extra logic.

```css
/* =========================================
File: /assets/css/dashboard.css
Purpose: Dashboard layout that fully respects theme tokens.
- No hard-coded light colors
- Works in light, dark, and system modes
- 2x2 hero grid on phones; grows gracefully
========================================= */

/* Page frame */
.page {
  /* the shell handles overall spacing; just keep content comfy */
  padding-block: 10px 24px;
}

/* Title */
.page-title {
  margin: 12px 0 16px 0;
  line-height: 1.15;
  color: var(--text);               /* from theme.css */
}

/* ===== HERO GRID ===== */
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;   /* 2-up on most phones */
  gap: 18px;
}

/* Stack to 1-up on narrow screens (very small phones) */
@media (max-width: 420px) {
  .hero-grid { grid-template-columns: 1fr; }
}

/* Card */
.hero-card {
  display: block;
  text-decoration: none;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);        /* defined in theme.css for both modes */
  overflow: hidden;                 /* hides topline radius nicely */
}

/* Subtle gold accent */
.hero-topline {
  height: 4px;
  background: var(--brand-gold, #D0C542);
}

/* Inner layout */
.hero-body {
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 18px;
}

.hero-emoji {
  font-size: 32px;
  line-height: 1;
}

.hero-content {
  min-width: 0;
}

.hero-title {
  font-weight: 800;
  font-size: 20px;
  line-height: 1.15;
  color: var(--text);
}

.hero-sub {
  margin-top: 6px;
  font-size: 16px;
  color: var(--muted);
}

/* Hover/active affordances */
@media (hover: hover) {
  .hero-card:hover {
    border-color: color-mix(in srgb, var(--brand-gold, #D0C542) 40%, var(--border));
  }
}
.hero-card:active { transform: translateY(1px); }

/* =========================================================
   THEME BRIDGE → pass global theme tokens into <fv-hero-card>
   (No layout changes—just colors/shadows.)
   ========================================================= */
fv-hero-card {
  --fv-gold:    var(--brand-gold);
  --fv-surface: var(--surface);
  --fv-text:    var(--text);
  --fv-border:  var(--border);
  --fv-shadow:  var(--shadow);
}
```

---

## JavaScript

### `/js/version.js`
* **Purpose:** Single source of truth for version/date/tagline strings.
* **Theme notes:** Used by the shell to show version + tagline in both light/dark.

```javascript
/* FarmVista — version.js (SSOT for version + tagline)
   Bump these fields for each release. Everything else reads from here. */

const FV_NUMBER  = "2.2.5";                 // ← edit this when releasing
const FV_DATE    = "2025-10-14";            // ← optional, informational
const FV_TAGLINE = "Clean farm data - Smarter reporting";

/* ===== DO NOT EDIT BELOW ===== */
window.FV_VERSION = {
  number: FV_NUMBER,
  date:   FV_DATE,
  tagline: FV_TAGLINE
};

/* Legacy shims so older code keeps working */
window.FarmVistaVersion = FV_NUMBER;        // older pages that referenced this
window.FV_BUILD = FV_NUMBER;                // legacy fallback
window.App = window.App || {};
window.App.getVersion = () => ({            // any code calling App.getVersion()
  number: FV_NUMBER,
  date:   FV_DATE,
  tagline: FV_TAGLINE
});
```

### `/js/core.js`
* **Purpose:** Applies the saved theme mode ASAP, syncs with system preference changes, and exposes `App` helpers.
* **Theme notes:** Dispatches an `fv:theme` CustomEvent so components (like `<fv-shell>`) can stay in sync.

```javascript
/* ==========================================================
   FarmVista — Core (theme + version) v3
   - Applies saved theme ASAP (prevents flash)
   - Keeps "system" synced with OS changes
   - Exposes App API used by fv-shell.js
   ========================================================== */
(function (global, doc) {
  const THEME_KEY = "fv-theme";
  const html = doc.documentElement;

  // ----- Theme -----
  function computeDark(mode){
    if(mode === "dark") return true;
    if(mode === "light") return false;
    try { return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch { return false; }
  }
  function applyTheme(mode){
    mode = mode || "system";
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
    html.classList.toggle("dark", computeDark(mode));
    // broadcast for components
    try { doc.dispatchEvent(new CustomEvent("fv:theme", { detail:{ mode } })); } catch {}
    return mode;
  }
  function initTheme(){
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    applyTheme(saved);
    // keep system synced
    try {
      const mq = global.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener && mq.addEventListener("change", ()=>{
        const cur = (localStorage.getItem(THEME_KEY) || "system");
        if(cur === "system") applyTheme("system");
      });
    } catch {}
  }

  // ----- Version helpers (optional) -----
  function readVersion(){
    const num  = global.FV_BUILD || (global.FV_VERSION && global.FV_VERSION.number) || "";
    const date = global.FV_BUILD_DATE || (global.FV_VERSION && global.FV_VERSION.date) || "";
    const tag  = global.FV_TAGLINE || (global.FV_VERSION && global.FV_VERSION.tagline) || "";
    if (num)  html.setAttribute("data-fv-version", num);
    if (date) html.setAttribute("data-fv-build-date", date);
    if (tag)  html.setAttribute("data-fv-tagline", tag);
    return { number:num, date, tagline:tag };
  }

  // ----- App API -----
  const App = global.App || {};
  App.getTheme = () => { try { return localStorage.getItem(THEME_KEY) || "system"; } catch { return "system"; } };
  App.setTheme = (mode) => applyTheme(mode);
  App.cycleTheme = () => {
    const order = ["system","light","dark"];
    const i = Math.max(0, order.indexOf(App.getTheme()));
    return applyTheme(order[(i+1)%order.length]);
  };
  App.getVersion = () => readVersion();

  global.App = App;

  // Init immediately
  initTheme();
  readVersion();
})(window, document);
```

### `/js/fv-shell.js`
* **Purpose:** Custom element that renders the mobile-friendly shell, drawers, toast notifications, and updater.
* **Theme notes:** Provides UI to toggle theme via the `App.setTheme` API and mirrors state with aria-pressed chips. Also adjusts scroll locking when drawers are open.

```javascript
/* FarmVista — <fv-shell> v5.4
   - Maintenance: "Check for updates" now a row (matches Account/Feedback)
   - Updater: version-aware toasts (announces target version when updating)
   - Footer remains extra-slim (14px) from v5.3
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      --green:#3B7E46; --gold:#D0C542;
      --surface:var(--surface,#fff); --text:var(--text,#141514);
      --hdr-h:56px; --ftr-h:14px;
      display:block; color:var(--text); background:var(--page, var(--app-bg,#f5f7f4));
      min-height:100vh; position:relative;
    }

    /* ===== Header (fixed) ===== */
    .hdr{
      position:fixed; inset:0 0 auto 0;
      height:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      padding-top:env(safe-area-inset-top,0px);
      background:var(--brand-green,var(--green)); color:#fff;
      display:grid; grid-template-columns:56px 1fr 56px; align-items:center;
      z-index:1000; box-shadow:0 2px 0 rgba(0,0,0,.05);
    }
    .hdr .title{ text-align:center; font-weight:800; font-size:20px; }
    .iconbtn{
      display:grid; place-items:center; width:48px; height:48px;
      border:none; background:transparent; color:#fff; font-size:28px; line-height:1;
      -webkit-tap-highlight-color: transparent; margin:0 auto;
    }
    .gold-bar{
      position:fixed; top:calc(var(--hdr-h) + env(safe-area-inset-top,0px));
      left:0; right:0; height:3px; background:var(--brand-gold,var(--gold)); z-index:999;
    }

    /* ===== Footer (fixed, extra slim) ===== */
    .ftr{
      position:fixed; inset:auto 0 0 0;
      height:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px));
      padding-bottom:env(safe-area-inset-bottom,0px);
      background:var(--brand-green,var(--green)); color:#fff;
      display:flex; align-items:center; justify-content:center;
      border-top:2px solid var(--brand-gold,var(--gold)); z-index:900;
    }
    .ftr .text{ font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== Main scroll area ===== */
    .main{
      position:relative;
      padding:
        calc(var(--hdr-h) + env(safe-area-inset-top,0px) + 11px)
        16px
        calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 16px);
      min-height:100vh; box-sizing:border-box;
    }
    ::slotted(.container){ max-width:980px; margin:0 auto; }

    /* ===== Shared scrim (side + top drawers) ===== */
    .scrim{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      opacity:0; pointer-events:none; transition:opacity .2s; z-index:1100;
    }
    :host(.drawer-open) .scrim,
    :host(.top-open) .scrim{ opacity:1; pointer-events:auto; }

    /* ===== Sidebar (left drawer) ===== */
    .drawer{
      position:fixed; top:0; bottom:0; left:0; width:min(84vw, 320px);
      background:#fff; color:#222; box-shadow:0 0 36px rgba(0,0,0,.25);
      transform:translateX(-100%); transition:transform .25s; z-index:1200;
      -webkit-overflow-scrolling:touch;
      display:flex; flex-direction:column; height:100%; overflow:hidden;
      padding-bottom:env(safe-area-inset-bottom,0px);
    }
    :host(.drawer-open) .drawer{ transform:translateX(0); }

    .drawer header{
      padding:16px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:12px; flex:0 0 auto;
    }
    .org{ display:flex; align-items:center; gap:12px; }
    .org img{ width:40px; height:40px; border-radius:8px; object-fit:cover; }
    .org .org-text{ display:flex; flex-direction:column; }
    .org .org-name{ font-weight:800; line-height:1.15; }
    .org .org-loc{ font-size:13px; color:#666; }
    .drawer nav{ flex:1 1 auto; overflow:auto; }
    .drawer nav a{
      display:flex; align-items:center; gap:12px; padding:16px; text-decoration:none; color:#222; border-bottom:1px solid #f3f3
3;
    }
    .drawer-footer{
      flex:0 0 auto;
      display:flex; align-items:flex-end; justify-content:space-between; gap:12px;
      padding:12px 16px;
      padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
      border-top:1px solid #eee; background:#fff;
    }
    .df-left{ display:flex; flex-direction:column; align-items:flex-start; }
    .df-left .brand{ font-weight:800; line-height:1.15; }
    .df-left .slogan{ font-size:12.5px; color:#777; line-height:1.2; }
    .df-right{ font-size:13px; color:#777; white-space:nowrap; }

    /* ===== Top Drawer (Account) ===== */
    .topdrawer{
      position:fixed; left:0; right:0; top:0;
      transform:translateY(-105%); transition:transform .26s ease;
      z-index:1300;
      background:var(--brand-green, var(--green)); color:#fff;
      box-shadow:0 20px 44px rgba(0,0,0,.35);
      border-bottom-left-radius:16px; border-bottom-right-radius:16px;
      padding-top:calc(env(safe-area-inset-top,0px) + 8px);
      max-height:72vh; overflow:auto;
    }
    :host(.top-open) .topdrawer{ transform:translateY(0); }

    .topwrap{ padding:6px 10px 14px; }

    /* Centered brand row */
    .brandrow{
      display:flex; align-items:center; justify-content:center; gap:10px;
      padding:10px 8px 12px 8px;
    }
    .brandrow img{ width:28px; height:28px; border-radius:6px; object-fit:cover; }
    .brandrow .brandname{ font-weight:800; font-size:18px; letter-spacing:.2px; }

    /* Section headers & chips on green */
    .section-h{
      padding:12px 12px 6px;
      font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      letter-spacing:.12em; color:color-mix(in srgb,#fff 85%, transparent);
    }
    .chips{ padding:0 12px 10px; }
    .chip{
      appearance:none; border:1.5px solid color-mix(in srgb,#fff 65%, transparent);
      padding:9px 14px; border-radius:20px; background:#fff; color:#111; margin-right:10px; font-weight:700;
      display:inline-flex; align-items:center; gap:8px;
    }
    .chip[aria-pressed="true"]{
      outline:3px solid color-mix(in srgb,#fff 25%, transparent);
      background:var(--brand-gold,var(--gold)); color:#111; border-color:transparent;
    }

    /* Rows (Profile, Maintenance, Logout) */
    .row{
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 12px; text-decoration:none; color:#fff;
      border-top:1px solid color-mix(in srgb,#000 22%, var(--brand-green, var(--green)));
    }
    .row .left{ display:flex; align-items:center; gap:10px; }
    .row .ico{ width:22px; text-align:center; opacity:.95; }
    .row .txt{ font-size:16px; }
    .row .chev{ opacity:.9; }

    /* Toast */
    .toast{
      position:fixed; left:50%; bottom:calc(var(--ftr-h) + env(safe-area-inset-bottom,0px) + 12px);
      transform:translateX(-50%); background:#111; color:#fff;
      padding:12px 16px; border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.35);
      z-index:1400; font-size:14px; opacity:0; pointer-events:none; transition:opacity .18s ease, transform .18s ease;
    }
    .toast.show{ opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(-4px); }

    /* Dark mode for left drawer; top drawer stays green */
    :host-context(.dark) .drawer{ background:#171917; color:#f1f3ef; border-right:1px solid #1f231f; }
    :host-context(.dark) .drawer nav a{ color:#f1f3ef; border-color:#1f231f; }
    :host-context(.dark) .drawer-footer{ background:#171917; border-top:1px solid #1f231f; }
    :host-context(.dark) .df-left .slogan,
    :host-context(.dark) .df-right,
    :host-context(.dark) .org .org-loc{ color:#cfd3cf; }
  </style>

  <header class="hdr" part="header">
    <button class="iconbtn js-menu" aria-label="Open menu">≡</button>
    <div class="title">FarmVista</div>
    <button class="iconbtn js-account" aria-label="Account">👥</button>
  </header>
  <div class="gold-bar" aria-hidden="true"></div>

  <div class="scrim js-scrim"></div>

  <!-- ===== Left Drawer ===== -->
  <aside class="drawer" part="drawer" aria-label="Main menu">
    <header>
      <div class="org">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="org-text">
          <div class="org-name">Dowson Farms</div>
          <div class="org-loc">Divernon, Illinois</div>
        </div>
      </div>
    </header>

    <nav>
      <a href="/Farm-vista/dashboard/"><span>🏠</span> Home</a>
      <a href="#"><span>🌱</span> Crop Production</a>
      <a href="#"><span>🚜</span> Equipment</a>
      <a href="#"><span>🌾</span> Grain</a>
      <a href="#"><span>💵</span> Expenses</a>
      <a href="#"><span>📊</span> Reports</a>
      <a href="#"><span>⚙️</span> Setup</a>
    </nav>

    <footer class="drawer-footer">
      <div class="df-left">
        <div class="brand">FarmVista</div>
        <div class="slogan js-slogan">Loading…</div>
      </div>
      <div class="df-right"><span class="js-ver">v0.0.0</span></div>
    </footer>
  </aside>

  <!-- ===== Top Drawer (Account) ===== -->
  <section class="topdrawer js-top" role="dialog" aria-label="Account & settings">
    <div class="topwrap">
      <!-- Centered brand row -->
      <div class="brandrow">
        <img src="/Farm-vista/assets/icons/icon-192.png" alt="" />
        <div class="brandname">FarmVista</div>
      </div>

      <!-- Theme -->
      <div class="section-h">THEME</div>
      <div class="chips">
        <button class="chip js-theme" data-mode="system" aria-pressed="true">System</button>
        <button class="chip js-theme" data-mode="light"  aria-pressed="false">Light</button>
        <button class="chip js-theme" data-mode="dark"   aria-pressed="false">Dark</button>
      </div>

      <!-- Profile -->
      <div class="section-h">PROFILE</div>
      <a class="row" href="#"><div class="left"><div class="ico">🧾</div><div class="txt">Account details</div></div><div class="chev">›</div></a>
      <a class="row" href="#"><div class="left"><div class="ico">💬</div><div class="txt">Feedback</div></div><div class="chev">›</div></a>

      <!-- Maintenance (row style) -->
      <div class="section-h">MAINTENANCE</div>
      <a class="row js-update-row" href="#">
        <div class="left"><div class="ico">⟳</div><div class="txt">Check for updates</div></div>
        <div class="chev">›</div>
      </a>

      <!-- Logout -->
      <a class="row" href="#" id="logoutRow">
        <div class="left"><div class="ico">⏻</div><div class="txt">Logout JOHNDOE</div></div>
        <div class="chev">›</div>
      </a>
    </div>
  </section>

  <main class="main" part="main"><slot></slot></main>

  <footer class="ftr" part="footer">
    <div class="text js-footer"></div>
  </footer>

  <div class="toast js-toast" role="status" aria-live="polite"></div>
  `;

  class FVShell extends HTMLElement {
    constructor(){ super(); this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true)); }
    connectedCallback(){
      const r = this.shadowRoot;
      this._btnMenu = r.querySelector('.js-menu');
      this._btnAccount = r.querySelector('.js-account');
      this._scrim = r.querySelector('.js-scrim');
      this._drawer = r.querySelector('.drawer');
      this._top = r.querySelector('.js-top');
      this._footerText = r.querySelector('.js-footer');
      this._toast = r.querySelector('.js-toast');

      // Drawer footer refs
      this._verEl = r.querySelector('.js-ver');
      this._sloganEl = r.querySelector('.js-slogan');

      // Events
      this._btnMenu.addEventListener('click', ()=> { this.toggleTop(false); this.toggleDrawer(true); });
      this._scrim.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(false); });
      this._btnAccount.addEventListener('click', ()=> { this.toggleDrawer(false); this.toggleTop(); });
      document.addEventListener('keydown', (e)=>{
        if(e.key==='Escape'){ this.toggleDrawer(false); this.toggleTop(false); }
      });

      r.querySelectorAll('.js-theme').forEach(btn=>{
        btn.addEventListener('click', ()=> this.setTheme(btn.dataset.mode));
      });
      document.addEventListener('fv:theme', (e)=> this._syncThemeChips(e.detail.mode));
      this._syncThemeChips((window.App && App.getTheme && App.getTheme()) || 'system');

      // Version + slogan + date
      const now = new Date();
      const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });

      const verNumber = (window.FV_VERSION && window.FV_VERSION.number)
                     || (window.App && App.getVersion && App.getVersion().number)
                     || (window.FV_BUILD)
                     || '0.0.0';

      const tagline = (window.FV_VERSION && window.FV_VERSION.tagline)
                   || (window.App && App.getVersion && App.getVersion().tagline)
                   || 'Farm data, simplified';

      // Bottom app footer
      this._footerText.textContent = `© ${now.getFullYear()} FarmVista • ${dateStr}`;

      // Sidebar footer (left/right layout)
      this._verEl.textContent = `v${verNumber}`;
      this._sloganEl.textContent = tagline;

      // Update row click
      r.querySelector('.js-update-row').addEventListener('click', (e)=> {
        e.preventDefault();
        this.checkForUpdates();
      });

      // Mock logout (placeholder)
      const logoutRow = r.getElementById('logoutRow');
      if (logoutRow) {
        logoutRow.addEventListener('click', (e)=>{
          e.preventDefault();
          this._toastMsg('Logout not implemented yet.', 2000);
        });
      }

      // Hero check
      setTimeout(()=>{
        if (!customElements.get('fv-hero-card')) {
          this._toastMsg('Hero components not loaded. Check /js/fv-hero.js path or cache.', 2600);
        }
      }, 300);
    }

    /* ===== Side Drawer ===== */
    toggleDrawer(open){
      const on = (open===undefined) ? !this.classList.contains('drawer-open') : open;
      this.classList.toggle('drawer-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('top-open')) ? 'hidden' : '';
    }

    /* ===== Top Drawer ===== */
    toggleTop(open){
      const on = (open===undefined) ? !this.classList.contains('top-open') : open;
      this.classList.toggle('top-open', on);
      document.documentElement.style.overflow = (on || this.classList.contains('drawer-open')) ? 'hidden' : '';
    }

    /* ===== Theme ===== */
    _syncThemeChips(mode){
      this.shadowRoot.querySelectorAll('.js-theme').forEach(b=> b.setAttribute('aria-pressed', String(b.dataset.mode===mode)));
    }
    setTheme(mode){
      try{
        if(window.App && App.setTheme){ App.setTheme(mode); }
        else {
          document.documentElement.classList.toggle('dark',
            mode==='dark' || (mode==='system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
          );
          localStorage.setItem('fv-theme', mode);
        }
      }catch{}
      this._syncThemeChips(mode);
    }

    /* ===== Updater (version-aware) ===== */
    async checkForUpdates(){
      const current = (this._verEl && this._verEl.textContent || '').replace(/^v/i,'').trim();
      const sleep = (ms)=> new Promise(res=> setTimeout(res, ms));
      const fetchLatestVersion = async () => {
        try {
          const resp = await fetch('/Farm-vista/js/version.js?rev=' + Date.now(), { cache:'reload' });
          const txt = await resp.text();
          const m = txt.match(/number\\s*:\\s*["']([\\d.]+)["']/);
          return m ? m[1] : null;
        } catch { return null; }
      };
      const cmp = (a,b)=>{
        const pa=a.split('.').map(n=>parseInt(n||'0',10));
        const pb=b.split('.').map(n=>parseInt(n||'0',10));
        const len=Math.max(pa.length,pb.length);
        for(let i=0;i<len;i++){ const da=pa[i]||0, db=pb[i]||0; if(da>db) return 1; if(da<db) return -1; }
        return 0;
      };

      try{
        this._toastMsg('Checking for updates…', 1200);
        const latest = await fetchLatestVersion();

        if (latest && current && cmp(latest, current) <= 0) {
          this._toastMsg(`You’re on v${current} — no update found.`, 1800);
          return;
        }

        if (latest) this._toastMsg(`Updating to v${latest}…`, 1200);
        else this._toastMsg('Updating…', 1000);

        if('caches' in window){
          const keys = await caches.keys();
          await Promise.all(keys.map(k=> caches.delete(k)));
        }
        await sleep(200);

        if('serviceWorker' in navigator){
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r=> r.unregister()));
        }
        await sleep(200);

        // One more fetch to make sure the browser sees the fresh file
        try{ await fetch('/Farm-vista/js/version.js?rev=' + Date.now(), { cache:'reload' }); }catch{}

        this._toastMsg('Reloading with fresh assets…', 900);
        await sleep(500);

        const url = new URL(location.href);
        url.searchParams.set('rev', Date.now().toString());
        location.replace(url.toString());
      }catch(e){
        console.error(e);
        this._toastMsg('Update failed. Try again.', 2200);
      }
    }

    _toastMsg(msg, ms=1600){
      const t = this._toast; t.textContent = msg; t.classList.add('show');
      clearTimeout(this._tt); this._tt = setTimeout(()=> t.classList.remove('show'), ms);
    }
  }
  customElements.define('fv-shell', FVShell);
})();
```

### `/js/fv-hero-card.js`
* **Purpose:** Web component for the hero cards.
* **Theme notes:** Uses CSS variables (falling back to defaults) and adapts when the root `.dark` class is present.

```javascript
// FarmVista — Global Hero Card <fv-hero-card> v2
class FVHeroCard extends HTMLElement {
  static get observedAttributes(){ return ["emoji","title","subtitle"]; }
  constructor(){
    super();
    this.attachShadow({mode:"open"}).innerHTML = `
      <style>
        :host{
          --fv-gold:#D0C542; --fv-surface:#fff; --fv-text:#141514; --fv-border:#E3E6E2; --fv-shadow:0 10px 22px rgba(0,0,0,.12);
          display:block; border-radius:12px; background:var(--fv-surface); color:var(--fv-text);
          border:1px solid var(--fv-border); box-shadow:var(--fv-shadow); outline:none;
        }
        :host-context(.dark){ --fv-surface:#1B1D1B; --fv-text:#F2F4F1; --fv-border:#253228; --fv-shadow:0 14px 28px rgba(0,0,0,.28); }
        .accent{ height:3px; background:var(--fv-gold); border-top-left-radius:12px; border-top-right-radius:12px; }
        .wrap{ display:grid; grid-template-columns:auto 1fr; align-items:center; gap:12px; padding:18px 16px; min-height:92px; }
        .emoji{ font-size:32px; line-height:1; align-self:center; }
        .title{ font-weight:800; font-size:18px; line-height:1.2; }
        .sub{ font-size:14px; opacity:.8; }
        .title, .sub{ white-space:normal; overflow:visible; text-overflow:clip; }
        :host(:focus-visible){ box-shadow:0 0 0 3px rgba(208,197,66,.6); }
      </style>
      <div class="accent"></div>
      <div class="wrap">
        <div class="emoji"></div>
        <div class="text">
          <div class="title"></div>
          <div class="sub"></div>
        </div>
      </div>
    `;
  }
  connectedCallback(){ if(!this.hasAttribute("tabindex")) this.setAttribute("tabindex","0"); this._sync(); }
  attributeChangedCallback(){ this._sync(); }
  _sync(){
    const r=this.shadowRoot;
    r.querySelector(".emoji").textContent = this.getAttribute("emoji") ?? "📦";
    r.querySelector(".title").textContent = this.getAttribute("title") ?? "Untitled";
    const sub = this.getAttribute("subtitle") ?? "";
    r.querySelector(".sub").textContent = sub;
    r.querySelector(".sub").style.display = sub ? "block" : "none";
  }
}
customElements.define("fv-hero-card", FVHeroCard);
```

### `/js/fv-hero.js`
* **Purpose:** Injects hero cards into the dashboard grid.
* **Theme notes:** Pure DOM work; cards rely on CSS variables for theming.

```javascript
// FarmVista – Dashboard hero grid renderer (robust auto-upgrade version)
(function () {
  const CARDS = [
    { emoji: '🌱', title: 'Crop Production', subtitle: '🚧 Coming Soon' },
    { emoji: '🚜', title: 'Equipment',       subtitle: '🚧 Coming Soon' },
    { emoji: '🌾', title: 'Grain',           subtitle: '🚧 Coming Soon' },
    { emoji: '📊', title: 'Reports',         subtitle: '🚧 Coming Soon' },
  ];

  function mount() {
    const grid = document.getElementById('hero-grid');
    if (!grid) return;

    // Render immediately; custom element will upgrade when defined.
    grid.innerHTML = '';
    for (const c of CARDS) {
      const el = document.createElement('fv-hero-card');
      el.setAttribute('emoji', c.emoji);
      el.setAttribute('title', c.title);
      el.setAttribute('subtitle', c.subtitle);
      grid.appendChild(el);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
```

### `/js/core.js` consumer reminder
*Any new component can subscribe to `document.addEventListener('fv:theme', handler)` to react to mode changes, or simply bind to the CSS tokens from `theme.css`.*

---

## Assets

The PNG icons live in `assets/icons/` and are referenced by the manifest and the shell logo. They do not need to change for theme work unless you design separate light/dark variants.

---

## Next Steps for Theme Refinement

1. **Add component-level tokens** where necessary (e.g., charts) by extending `:root` / `.dark` in `theme.css`.
2. **Wire new UI pieces** to the `App` API or CSS tokens instead of hard-coded colors.
3. **Bump `REV` in `serviceworker.js`** and redeploy whenever theme assets change to avoid stale caches.

This markdown file should be enough context for ChatGPT (or any reviewer) to understand the current implementation and iterate confidently on the light/dark theming work.
