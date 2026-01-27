/* =====================================================================
/Farm-vista/js/markets.js  (FULL FILE)
Rev: 2026-01-28a
Purpose:
✅ Client-side markets module for FarmVista dashboard
✅ Uses NEW Cloud Run backend:
   - /api/markets/contracts
   - /api/markets/chart/:symbol?mode=daily|weekly|6mo|1y
✅ Auto-rolling contracts (current year + next 2 years)
✅ Mobile: simple (front contract only)
✅ Desktop: full contract lists (corn left, soy right)
✅ Silent refresh every 30s
===================================================================== */

(function(){
  "use strict";

  const Markets = {};
  window.FVMarkets = Markets;

  const REFRESH_MS = 30_000;

  function base(){
    const v = (window.FV_MARKETS_BASE_URL || "").trim();
    return v.replace(/\/+$/,"");
  }

  function qs(sel, root=document){ return root.querySelector(sel); }

  function ui(){
    return {
      corn: qs('[data-fv="mktCorn"]'),
      soy:  qs('[data-fv="mktSoy"]'),
      meta: qs('[data-fv="mktMeta"]')
    };
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function fmtPrice(v){
    return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—";
  }

  function fmtPct(v){
    return (typeof v === "number" && isFinite(v))
      ? ((v > 0 ? "+" : "") + v.toFixed(2) + "%")
      : "—";
  }

  function fmtTime(iso){
    try{
      if(!iso) return "";
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit", second:"2-digit" });
    }catch{ return ""; }
  }

  async function fetchContracts(){
    const r = await fetch(`${base()}/api/markets/contracts`, { cache:"no-store" });
    if(!r.ok) throw new Error("Failed to load contracts");
    return r.json();
  }

  Markets.fetchChart = async function(symbol, mode){
    const r = await fetch(
      `${base()}/api/markets/chart/${encodeURIComponent(symbol)}?mode=${encodeURIComponent(mode)}`,
      { cache:"no-store" }
    );
    if(!r.ok) throw new Error("Failed to load chart");
    return r.json();
  };

  function ensureStyles(){
    if(document.getElementById("fv-markets-style")) return;

    const css = `
.fv-mkt-card{ width:100%; }
.fv-mkt-head{
  display:flex; justify-content:space-between; align-items:baseline;
  margin:0 0 8px 0;
}
.fv-mkt-title{ font-weight:800; }
.fv-mkt-note{ font-size:12px; opacity:.7; }
.fv-mkt-list{ display:flex; flex-direction:column; gap:6px; }
.fv-mkt-row{
  display:flex; justify-content:space-between; gap:10px;
  padding:8px 10px;
  border:1px solid rgba(0,0,0,.12);
  border-radius:10px;
}
.fv-mkt-left{ display:flex; flex-direction:column; }
.fv-mkt-sym{ font-weight:700; }
.fv-mkt-name{ font-size:12px; opacity:.75; }
.fv-mkt-price{ font-weight:800; }
.fv-mkt-btn{
  appearance:none; background:none; border:none;
  text-align:left; padding:0; cursor:pointer; color:inherit;
}
.fv-mkt-meta{
  display:flex; gap:8px; font-size:12px; opacity:.7; flex-wrap:wrap;
}
`;
    const st = document.createElement("style");
    st.id = "fv-markets-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function renderList(container, title, list){
    if(!container) return;

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
          <div class="fv-mkt-note">Tap contract for chart</div>
        </div>
        <div class="fv-mkt-list">
          ${list.map(c => `
            <button class="fv-mkt-btn" data-symbol="${escapeHtml(c.symbol)}">
              <div class="fv-mkt-row">
                <div class="fv-mkt-left">
                  <div class="fv-mkt-sym">${escapeHtml(c.symbol)}</div>
                  <div class="fv-mkt-name">${escapeHtml(c.label)}</div>
                </div>
              </div>
            </button>
          `).join("")}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-symbol]').forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const sym = btn.getAttribute("data-symbol");
        window.dispatchEvent(new CustomEvent("fv:markets:contractTap", {
          detail:{ symbol:sym }
        }));
      });
    });
  }

  function renderMeta(payload){
    const el = ui().meta;
    if(!el) return;
    el.innerHTML = `
      <div class="fv-mkt-meta">
        <span>${escapeHtml(payload.delayNote)}</span>
        <span>•</span>
        <span>Updated ${fmtTime(payload.asOfUtc)}</span>
      </div>
    `;
  }

  let timer = null;
  let last = null;

  Markets.start = function(){
    ensureStyles();
    Markets.refresh().catch(()=>{});
    if(timer) clearInterval(timer);
    timer = setInterval(()=>Markets.refresh().catch(()=>{}), REFRESH_MS);
  };

  Markets.refresh = async function(){
    const payload = await fetchContracts();
    last = payload;

    const U = ui();

    // Mobile-friendly: first contract is nearest/front
    renderList(U.corn, "Corn", payload.corn);
    renderList(U.soy,  "Soybeans", payload.soy);

    renderMeta(payload);

    window.dispatchEvent(new CustomEvent("fv:markets:updated", {
      detail:{ payload }
    }));
  };

  Markets.getLast = function(){ return last; };

})();