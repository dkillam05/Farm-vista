/* =====================================================================
/Farm-vista/js/markets.js  (NEW FILE)
Rev: 2026-01-26a
Purpose:
✅ Client-side markets module for FarmVista dashboard
✅ Poll your Cloud Run markets service silently (default every 30s)
✅ Render Corn / Soy contract rows into simple containers
✅ Emit events so your index page can stay clean

REQUIRES (HTML hooks you add on index page):
- A wrapper element for Corn:
    <div data-fv="mktCorn"></div>

- A wrapper element for Soy:
    <div data-fv="mktSoy"></div>

- Optional: a status/label area (delay + updated time):
    <div data-fv="mktMeta"></div>

- Optional: a click handler target for “tap contract”
  (this module dispatches an event you can use to open your popup modal):
    window.addEventListener("fv:markets:contractTap", (e)=>{ ... })

Cloud Run endpoints expected:
- GET  {BASE_URL}/api/markets/quotes
- GET  {BASE_URL}/api/markets/chart?symbol=ZCZ27&range=1d&interval=5m

CONFIG:
- Set window.FV_MARKETS_BASE_URL to your Cloud Run service URL (no trailing slash).
  Example (in index.html before this file loads):
    <script>window.FV_MARKETS_BASE_URL="https://farmvista-markets-xxxxx-uc.a.run.app";</script>

===================================================================== */

(function(){
  "use strict";

  const Markets = {};
  window.FVMarkets = Markets; // simple global for easy use

  // ----------------------------
  // Config
  // ----------------------------
  const DEFAULT_REFRESH_MS = 30_000;

  // You can override via window.FV_MARKETS_BASE_URL
  function getBaseUrl(){
    const v = (window.FV_MARKETS_BASE_URL || "").trim();
    return v.replace(/\/+$/,""); // remove trailing slash
  }

  // Optional override: supply exact symbols list for UI ordering
  // If not provided, we’ll derive from the quotes payload.
  // Example:
  // window.FV_MARKETS_SYMBOLS = {
  //   corn: ["ZCH27","ZCK27","ZCN27","ZCU27","ZCZ27","ZCH28","ZCZ28","ZCH29","ZCZ29"],
  //   soy:  ["ZSH27","ZSK27","ZSN27","ZSQ27","ZSU27","ZSX27","ZSH28","ZSX28","ZSH29","ZSX29"]
  // };
  function getSymbolPrefs(){
    const prefs = window.FV_MARKETS_SYMBOLS || null;
    if(!prefs || typeof prefs !== "object") return null;
    return {
      corn: Array.isArray(prefs.corn) ? prefs.corn.map(s=>String(s).toUpperCase()) : null,
      soy:  Array.isArray(prefs.soy)  ? prefs.soy.map(s=>String(s).toUpperCase()) : null
    };
  }

  // ----------------------------
  // DOM hooks
  // ----------------------------
  function qs(sel, root=document){ return root.querySelector(sel); }

  function getUI(){
    return {
      corn: qs('[data-fv="mktCorn"]'),
      soy:  qs('[data-fv="mktSoy"]'),
      meta: qs('[data-fv="mktMeta"]')
    };
  }

  // ----------------------------
  // Formatting
  // ----------------------------
  function fmtPrice(v){
    if(typeof v !== "number" || !isFinite(v)) return "—";
    // Futures typically show 2 decimals (you can change to 4 if you want)
    return v.toFixed(2);
  }

  function fmtChg(v){
    if(typeof v !== "number" || !isFinite(v)) return "—";
    const s = (v > 0) ? "+" : "";
    return s + v.toFixed(2);
  }

  function fmtPct(v){
    if(typeof v !== "number" || !isFinite(v)) return "—";
    const s = (v > 0) ? "+" : "";
    return s + v.toFixed(2) + "%";
  }

  function fmtLocalTimeFromIso(iso){
    try{
      if(!iso) return "";
      const d = new Date(iso);
      if(isNaN(d.getTime())) return "";
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }catch(_){
      return "";
    }
  }

  // ----------------------------
  // Data fetch
  // ----------------------------
  async function fetchQuotes(){
    const base = getBaseUrl();
    if(!base) throw new Error("FV_MARKETS_BASE_URL is not set.");
    const url = `${base}/api/markets/quotes`;
    const resp = await fetch(url, { method: "GET", cache: "no-store" });
    if(!resp.ok){
      const txt = await resp.text().catch(()=> "");
      throw new Error(`Markets quotes failed (${resp.status}): ${txt.slice(0,120)}`);
    }
    return resp.json();
  }

  // Public helper (for your popup)
  Markets.fetchChart = async function(symbol, range="1d", interval="5m"){
    const base = getBaseUrl();
    if(!base) throw new Error("FV_MARKETS_BASE_URL is not set.");
    const sym = String(symbol || "").toUpperCase().trim();
    if(!sym) throw new Error("fetchChart requires symbol");
    const url = `${base}/api/markets/chart?symbol=${encodeURIComponent(sym)}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const resp = await fetch(url, { method: "GET", cache: "no-store" });
    if(!resp.ok){
      const txt = await resp.text().catch(()=> "");
      throw new Error(`Markets chart failed (${resp.status}): ${txt.slice(0,120)}`);
    }
    return resp.json();
  };

  // ----------------------------
  // Grouping logic
  // ----------------------------
  function isCornSymbol(sym){ return /^ZC[A-Z]\d{2}$/.test(sym); }
  function isSoySymbol(sym){  return /^ZS[A-Z]\d{2}$/.test(sym); }

  function buildGroups(quotesPayload){
    const quotes = quotesPayload?.quotes || {};
    const allSyms = Object.keys(quotes).map(s=>s.toUpperCase());

    const prefs = getSymbolPrefs();

    const cornList = (prefs?.corn && prefs.corn.length)
      ? prefs.corn.filter(s => quotes[s])
      : allSyms.filter(isCornSymbol).sort();

    const soyList = (prefs?.soy && prefs.soy.length)
      ? prefs.soy.filter(s => quotes[s])
      : allSyms.filter(isSoySymbol).sort();

    return { cornList, soyList, quotes };
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function ensureBaseStyles(){
    if(document.getElementById("fv-markets-style")) return;

    const css = `
/* --- FarmVista Markets module --- */
.fv-mkt-card{ width:100%; }
.fv-mkt-head{
  display:flex; align-items:baseline; justify-content:space-between;
  gap:10px; margin:0 0 8px 0;
}
.fv-mkt-title{ font-weight:800; letter-spacing:.2px; }
.fv-mkt-note{ opacity:.75; font-size:12px; white-space:nowrap; }
.fv-mkt-list{ display:flex; flex-direction:column; gap:8px; }
.fv-mkt-row{
  display:flex; align-items:center; justify-content:space-between;
  gap:10px; padding:10px 12px;
  border:1px solid rgba(0,0,0,.12);
  border-radius:12px;
  background: rgba(255,255,255,.06);
}
.fv-mkt-left{ display:flex; flex-direction:column; gap:2px; min-width:110px; }
.fv-mkt-sym{ font-weight:900; }
.fv-mkt-name{ font-size:12px; opacity:.8; line-height:1.2; }
.fv-mkt-right{ display:flex; flex-direction:column; gap:2px; align-items:flex-end; }
.fv-mkt-price{ font-weight:900; font-size:18px; }
.fv-mkt-chg{ font-size:12px; opacity:.85; }
.fv-mkt-btn{
  appearance:none; border:none; background:transparent; padding:0; margin:0;
  cursor:pointer; text-align:left; width:100%;
  color: inherit; /* avoid blue link look */
}
.fv-mkt-btn:active{ transform: scale(.995); }
.fv-mkt-meta{
  display:flex; gap:10px; flex-wrap:wrap; align-items:center;
  font-size:12px; opacity:.8;
}
.fv-mkt-dot{ opacity:.45; }
`;
    const style = document.createElement("style");
    style.id = "fv-markets-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderList(container, title, symbolList, quotesPayload){
    if(!container) return;

    const { quotes } = buildGroups(quotesPayload);

    const rowsHtml = symbolList.map(sym => {
      const q = quotes[sym] || {};
      const last = fmtPrice(q.last);
      const chg = fmtChg(q.chg);
      const pct = fmtPct(q.chgPct);
      const name = (q.name && q.name !== sym) ? q.name : "";

      // We wrap the row in a button so tapping is easy (and not blue)
      return `
        <button class="fv-mkt-btn" type="button" data-fv-mkt="tap" data-symbol="${sym}">
          <div class="fv-mkt-row">
            <div class="fv-mkt-left">
              <div class="fv-mkt-sym">${sym}</div>
              ${name ? `<div class="fv-mkt-name">${escapeHtml(name)}</div>` : ``}
            </div>
            <div class="fv-mkt-right">
              <div class="fv-mkt-price">${last}</div>
              <div class="fv-mkt-chg">${chg} <span class="fv-mkt-dot">•</span> ${pct}</div>
            </div>
          </div>
        </button>
      `;
    }).join("");

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
          <div class="fv-mkt-note">Tap contract for chart</div>
        </div>
        <div class="fv-mkt-list">
          ${rowsHtml || `<div style="opacity:.75;">No contracts found.</div>`}
        </div>
      </div>
    `;

    // bind taps
    container.querySelectorAll('[data-fv-mkt="tap"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const sym = String(btn.getAttribute("data-symbol") || "").toUpperCase();
        if(!sym) return;
        window.dispatchEvent(new CustomEvent("fv:markets:contractTap", { detail: { symbol: sym } }));
      });
    });
  }

  function renderMeta(ui, payload){
    if(!ui.meta) return;
    const updated = fmtLocalTimeFromIso(payload?.asOfUtc);
    const note = payload?.delayNote || "Delayed quotes";
    ui.meta.innerHTML = `
      <div class="fv-mkt-meta">
        <span>${escapeHtml(note)}</span>
        ${updated ? `<span class="fv-mkt-dot">•</span><span>Updated ${escapeHtml(updated)}</span>` : ``}
      </div>
    `;
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // ----------------------------
  // Poll loop
  // ----------------------------
  let timer = null;
  let lastPayload = null;

  Markets.start = function(opts={}){
    ensureBaseStyles();

    const ui = getUI();
    const refreshMs = (typeof opts.refreshMs === "number" && opts.refreshMs >= 10_000)
      ? Math.floor(opts.refreshMs)
      : DEFAULT_REFRESH_MS;

    // one immediate refresh
    Markets.refresh().catch(()=>{});

    // restart timer
    if(timer) clearInterval(timer);
    timer = setInterval(() => { Markets.refresh().catch(()=>{}); }, refreshMs);

    // helpful signal
    window.dispatchEvent(new CustomEvent("fv:markets:started", { detail: { refreshMs } }));
  };

  Markets.stop = function(){
    if(timer) clearInterval(timer);
    timer = null;
    window.dispatchEvent(new CustomEvent("fv:markets:stopped"));
  };

  Markets.getLast = function(){
    return lastPayload;
  };

  Markets.refresh = async function(){
    const ui = getUI();
    const payload = await fetchQuotes();
    lastPayload = payload;

    const groups = buildGroups(payload);
    renderList(ui.corn, "Corn", groups.cornList, payload);
    renderList(ui.soy, "Soybeans", groups.soyList, payload);
    renderMeta(ui, payload);

    window.dispatchEvent(new CustomEvent("fv:markets:updated", { detail: { payload } }));
    return payload;
  };

})();