/* =====================================================================
/Farm-vista/js/markets.js  (FULL FILE)
Rev: 2026-01-27b
Purpose:
✅ Client-side markets module for FarmVista dashboard
✅ Poll Yahoo-hack Cloud Run markets service silently (default every 30s)
✅ Render Corn + Soy (continuous) into simple containers
✅ Dispatch tap event that includes marketKey ("corn"|"soy") for modal chart

REQUIRES (HTML hooks you add on index page):
- <div data-fv="mktCorn"></div>
- <div data-fv="mktSoy"></div>
- Optional: <div data-fv="mktMeta"></div>

Cloud Run endpoints expected (NEW):
- GET  {BASE_URL}/api/markets/quotes
- GET  {BASE_URL}/api/markets/chart/corn?range=1d&interval=5m
- GET  {BASE_URL}/api/markets/chart/soy?range=1d&interval=5m

CONFIG:
- window.FV_MARKETS_BASE_URL = "https://farmvista-markets-...run.app"
===================================================================== */

(function(){
  "use strict";

  const Markets = {};
  window.FVMarkets = Markets;

  const DEFAULT_REFRESH_MS = 30_000;

  function getBaseUrl(){
    const v = (window.FV_MARKETS_BASE_URL || "").trim();
    return v.replace(/\/+$/,"");
  }

  function qs(sel, root=document){ return root.querySelector(sel); }

  function getUI(){
    return {
      corn: qs('[data-fv="mktCorn"]'),
      soy:  qs('[data-fv="mktSoy"]'),
      meta: qs('[data-fv="mktMeta"]')
    };
  }

  function fmtPrice(v){
    if(typeof v !== "number" || !isFinite(v)) return "—";
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
      return d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit", second:"2-digit" });
    }catch{ return ""; }
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function fetchQuotes(){
    const base = getBaseUrl();
    if(!base) throw new Error("FV_MARKETS_BASE_URL is not set.");
    const url = `${base}/api/markets/quotes`;
    const resp = await fetch(url, { method:"GET", cache:"no-store" });
    if(!resp.ok){
      const txt = await resp.text().catch(()=> "");
      throw new Error(`Markets quotes failed (${resp.status}): ${txt.slice(0,160)}`);
    }
    return resp.json();
  }

  // NEW: chart is by market key, not by symbol
  Markets.fetchChart = async function(marketKey, range="1d", interval="5m"){
    const base = getBaseUrl();
    if(!base) throw new Error("FV_MARKETS_BASE_URL is not set.");
    const key = String(marketKey || "").toLowerCase().trim();
    if(key !== "corn" && key !== "soy") throw new Error("fetchChart requires marketKey = 'corn' or 'soy'.");

    const url = `${base}/api/markets/chart/${encodeURIComponent(key)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const resp = await fetch(url, { method:"GET", cache:"no-store" });
    if(!resp.ok){
      const txt = await resp.text().catch(()=> "");
      throw new Error(`Markets chart failed (${resp.status}): ${txt.slice(0,160)}`);
    }
    return resp.json();
  };

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
  color: inherit;
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

  function renderCard(container, title, key, q){
    if(!container) return;

    const symbol = q?.symbol || (key === "corn" ? "ZC=F" : "ZS=F");
    const last = fmtPrice(q?.last);
    const chg  = fmtChg(q?.chg);
    const pct  = fmtPct(q?.chgPct);

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
          <div class="fv-mkt-note">Tap for chart</div>
        </div>

        <button class="fv-mkt-btn" type="button" data-fv-mkt="tap" data-market="${escapeHtml(key)}">
          <div class="fv-mkt-row">
            <div class="fv-mkt-left">
              <div class="fv-mkt-sym">${escapeHtml(symbol)}</div>
              <div class="fv-mkt-name">${escapeHtml(title)} (continuous)</div>
            </div>
            <div class="fv-mkt-right">
              <div class="fv-mkt-price">${last}</div>
              <div class="fv-mkt-chg">${chg} <span class="fv-mkt-dot">•</span> ${pct}</div>
            </div>
          </div>
        </button>
      </div>
    `;

    const btn = container.querySelector('[data-fv-mkt="tap"]');
    if(btn){
      btn.addEventListener("click", () => {
        const mk = String(btn.getAttribute("data-market") || "").toLowerCase();
        window.dispatchEvent(new CustomEvent("fv:markets:contractTap", {
          detail: { marketKey: mk }
        }));
      });
    }
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

  let timer = null;
  let lastPayload = null;

  Markets.start = function(opts={}){
    ensureBaseStyles();

    const refreshMs = (typeof opts.refreshMs === "number" && opts.refreshMs >= 10_000)
      ? Math.floor(opts.refreshMs)
      : DEFAULT_REFRESH_MS;

    Markets.refresh().catch(()=>{});

    if(timer) clearInterval(timer);
    timer = setInterval(() => { Markets.refresh().catch(()=>{}); }, refreshMs);

    window.dispatchEvent(new CustomEvent("fv:markets:started", { detail:{ refreshMs } }));
  };

  Markets.stop = function(){
    if(timer) clearInterval(timer);
    timer = null;
    window.dispatchEvent(new CustomEvent("fv:markets:stopped"));
  };

  Markets.getLast = function(){ return lastPayload; };

  Markets.refresh = async function(){
    const ui = getUI();
    const payload = await fetchQuotes();
    lastPayload = payload;

    const markets = payload?.markets || {};
    renderCard(ui.corn, "Corn", "corn", markets.corn || null);
    renderCard(ui.soy,  "Soybeans", "soy", markets.soy || null);
    renderMeta(ui, payload);

    window.dispatchEvent(new CustomEvent("fv:markets:updated", { detail:{ payload } }));
    return payload;
  };

})();
