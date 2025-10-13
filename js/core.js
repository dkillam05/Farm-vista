/* ==========================================================
   FarmVista — Core (minimal)
   - Applies saved theme ASAP (prevents flash)
   - Keeps "system" theme in sync with OS changes
   - Exposes a tiny App API you can use later
   - Surfaces version info from js/version.js (if present)
   ========================================================== */
(function (global, doc) {
  const THEME_KEY = "fv-theme";           // "system" | "light" | "dark"
  const html = doc.documentElement;

  // ----- Theme -----
  function applyTheme(mode) {
    // Default to "system"
    if (!mode) mode = "system";

    // Persist choice
    try { localStorage.setItem(THEME_KEY, mode); } catch {}

    // Compute whether we should be dark
    let dark = false;
    if (mode === "dark") dark = true;
    else if (mode === "system") {
      try {
        dark = global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch { dark = false; }
    }

    // Toggle class on <html> (fv-shell + components follow it)
    html.classList.toggle("dark", !!dark);
    return mode;
  }

  function initTheme() {
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    applyTheme(saved);

    // Keep "system" in sync with OS changes
    try {
      const mq = global.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener && mq.addEventListener("change", () => {
        const current = (localStorage.getItem(THEME_KEY) || "system");
        if (current === "system") applyTheme("system");
      });
    } catch {}
  }

  // ----- Version helpers (optional) -----
  function readVersion() {
    const num  = global.FV_BUILD || (global.FV_VERSION && global.FV_VERSION.number) || "";
    const date = global.FV_BUILD_DATE || (global.FV_VERSION && global.FV_VERSION.date) || "";
    const tag  = global.FV_TAGLINE || (global.FV_VERSION && global.FV_VERSION.tagline) || "";
    // Store on <html> for easy CSS/diagnostics if needed
    if (num)  html.setAttribute("data-fv-version", num);
    if (date) html.setAttribute("data-fv-build-date", date);
    if (tag)  html.setAttribute("data-fv-tagline", tag);
    return { number: num, date, tagline: tag };
  }

  // ----- Tiny App API (safe stubs you can call later) -----
  const App = global.App || {};
  App.getTheme   = () => (localStorage.getItem(THEME_KEY) || "system");
  App.setTheme   = (mode) => applyTheme(mode);
  App.cycleTheme = () => {
    const order = ["system", "light", "dark"];
    const i = Math.max(0, order.indexOf(App.getTheme()));
    return applyTheme(order[(i + 1) % order.length]);
  };
  App.getVersion = () => readVersion();

  // Optional: broadcast a theme-change event (useful later)
  function notifyTheme(mode) {
    try {
      doc.dispatchEvent(new CustomEvent("fv:theme", { detail: { mode } }));
    } catch {}
  }
  const _setTheme = App.setTheme;
  App.setTheme = (mode) => { const m = _setTheme(mode); notifyTheme(m); return m; };

  // Expose
  global.App = App;

  // Init immediately (ASAP to avoid flash)
  initTheme();
  readVersion();
})(window, document);