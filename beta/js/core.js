/* ==========================================================
   FarmVista — Core (theme + version) v3.1.1
   - Applies saved theme ASAP (prevents flash)
   - Keeps "system" synced with OS changes
   - Exposes App API used by fv-shell.js
   - Sets data-theme attr + updates <meta name="theme-color">
   ========================================================== */
(function (global, doc) {
  const THEME_KEY = "fv-theme";
  const html = doc.documentElement;

  function ensureThemeMeta(){
    let m = doc.querySelector('meta[name="theme-color"]');
    if (!m) { m = doc.createElement('meta'); m.setAttribute('name','theme-color'); doc.head.appendChild(m); }
    return m;
  }
  function applyThemeColorFromCSS(){
    try{
      const cs = getComputedStyle(html);
      // Prefer a token if present, fallback to brand green
      const headerBg = cs.getPropertyValue('--header-bg').trim() || cs.getPropertyValue('--green').trim() || '#3B7E46';
      ensureThemeMeta().setAttribute('content', headerBg);
    }catch{}
  }

  function computeDark(mode){
    if(mode === "dark") return true;
    if(mode === "light") return false;
    try { return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches; }
    catch { return false; }
  }
  function applyTheme(mode){
    mode = mode || "system";
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
    html.setAttribute('data-theme', mode === 'system' ? 'auto' : mode);
    html.classList.toggle("dark", computeDark(mode));
    try { doc.dispatchEvent(new CustomEvent("fv:theme", { detail:{ mode } })); } catch {}
    applyThemeColorFromCSS();
    return mode;
  }
  function initTheme(){
    let saved = "system";
    try { saved = localStorage.getItem(THEME_KEY) || "system"; } catch {}
    applyTheme(saved);
    try {
      const mq = global.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener && mq.addEventListener("change", ()=>{
        const cur = (localStorage.getItem(THEME_KEY) || "system");
        if(cur === "system") applyTheme("system");
      });
    } catch {}
  }

  function readVersion(){
    const num  = global.FV_BUILD || (global.FV_VERSION && global.FV_VERSION.number) || "";
    const date = global.FV_BUILD_DATE || (global.FV_VERSION && global.FV_VERSION.date) || "";
    const tag  = global.FV_TAGLINE || (global.FV_VERSION && global.FV_VERSION.tagline) || "";
    if (num)  html.setAttribute("data-fv-version", num);
    if (date) html.setAttribute("data-fv-build-date", date);
    if (tag)  html.setAttribute("data-fv-tagline", tag);
    return { number:num, date, tagline:tag };
  }

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

  initTheme();
  readVersion();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyThemeColorFromCSS, { once:true });
  } else {
    applyThemeColorFromCSS();
  }
})(window, document);