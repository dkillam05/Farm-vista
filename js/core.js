/* ==========================================================
   FarmVista — Core (minimal, theme + update helpers)
   - Applies saved theme ASAP (prevents flash)
   - Keeps "system" theme in sync with OS changes
   - Exposes a tiny App API (theme + updater)
   - Surfaces version info from js/version.js (if present)
   ========================================================== */
(function (global, doc) {
  const THEME_KEY = "fv-theme";           // "system" | "light" | "dark"
  const html = doc.documentElement;

  // ----- Theme -----
  function applyTheme(mode) {
    if (!mode) mode = "system";
    try { localStorage.setItem(THEME_KEY, mode); } catch {}

    // Should we be dark?
    let dark = false;
    if (mode === "dark") dark = true;
    else if (mode === "system") {
      try {
        dark = global.matchMedia &&
               global.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch { dark = false; }
    }
    html.classList.toggle("dark", !!dark);

    // Broadcast for listeners (e.g., fv-shell)
    try { doc.dispatchEvent(new CustomEvent("fv:theme", { detail: { mode } })); } catch {}

    return mode;
  }

  function initTheme() {
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    applyTheme(saved);

    // Keep "system" in sync with OS changes
    try {
      const mq = global.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) {
        mq.addEventListener("change", () => {
          const current = (localStorage.getItem(THEME_KEY) || "system");
          if (current === "system") applyTheme("system");
        });
      }
    } catch {}
  }

  // ----- Version helpers (optional) -----
  function readVersion() {
    const num  = global.FV_BUILD || (global.FV_VERSION && global.FV_VERSION.number) || "";
    const date = global.FV_BUILD_DATE || (global.FV_VERSION && global.FV_VERSION.date) || "";
    const tag  = global.FV_TAGLINE || (global.FV_VERSION && global.FV_VERSION.tagline) || "";
    if (num)  html.setAttribute("data-fv-version", num);
    if (date) html.setAttribute("data-fv-build-date", date);
    if (tag)  html.setAttribute("data-fv-tagline", tag);
    return { number: num, date, tagline: tag };
  }

  // ----- Updater (clears caches + SW, then reloads) -----
  async function clearCachesAndSW() {
    // Best-effort cache purge
    try {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    } catch {}

    // Unregister service workers in-scope
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.unregister();
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      if (regs && regs.length) await Promise.all(regs.map(r => r.unregister()));
    } catch {}
  }

  async function checkForUpdates() {
    // We can’t truly “diff” versions offline here; the contract is:
    // clear caches + SW, then hard reload so the latest files are fetched.
    await clearCachesAndSW();
    // Little delay lets any UI (spinner/toast) render
    setTimeout(() => {
      try { location.reload(true); } catch { location.reload(); }
    }, 250);
  }

  // ----- Tiny App API -----
  const App = global.App || {};
  App.getTheme   = () => (localStorage.getItem(THEME_KEY) || "system");
  App.setTheme   = (mode) => applyTheme(mode);
  App.cycleTheme = () => {
    const order = ["system", "light", "dark"];
    const i = Math.max(0, order.indexOf(App.getTheme()));
    return applyTheme(order[(i + 1) % order.length]);
  };
  App.getVersion = () => readVersion();
  App.checkForUpdates = () => checkForUpdates();

  global.App = App;

  // Init ASAP
  initTheme();
  readVersion();
})(window, document);