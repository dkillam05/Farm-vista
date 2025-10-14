/* ==========================================================
   FarmVista — Core (minimal, stable)
   - Applies saved theme ASAP (prevents flash)
   - Keeps "system" theme in sync with OS changes
   - Exposes a tiny App API (get/set theme, get version)
   ========================================================== */
(function (global, doc) {
  const THEME_KEY = "fv-theme";           // "system" | "light" | "dark"
  const html = doc.documentElement;

  // ----- Theme -----
  function applyTheme(mode) {
    if (!mode) mode = "system";
    try { localStorage.setItem(THEME_KEY, mode); } catch {}

    let dark = false;
    if (mode === "dark") dark = true;
    else if (mode === "system") {
      try { dark = global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches; }
      catch { dark = false; }
    }
    html.classList.toggle("dark", !!dark);
    return mode;
  }

  function initTheme() {
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    applyTheme(saved);

    // Keep "system" synced with OS changes
    try {
      const mq = global.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener?.("change", () => {
        if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system");
      });
    } catch {}
  }

  // ----- Version helpers (optional) -----
  function readVersion() {
    const v = global.FV_VERSION || {};
    const num  = v.number || global.FV_BUILD || "";
    const date = v.date   || global.FV_BUILD_DATE || "";
    const tag  = v.tagline || global.FV_TAGLINE || "";
    if (num)  html.setAttribute("data-fv-version", num);
    if (date) html.setAttribute("data-fv-build-date", date);
    if (tag)  html.setAttribute("data-fv-tagline", tag);
    return { number: num, date, tagline: tag };
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

  // Broadcast theme changes
  const _setTheme = App.setTheme;
  App.setTheme = (mode) => {
    const m = _setTheme(mode);
    try { doc.dispatchEvent(new CustomEvent("fv:theme", { detail: { mode: m } })); } catch {}
    return m;
  };

  // Expose and init
  global.App = App;
  initTheme();
  readVersion();
})(window, document);