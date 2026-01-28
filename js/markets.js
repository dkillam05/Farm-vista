/* =====================================================================
/Farm-vista/js/markets.js  (FULL FILE)
Rev: 2026-01-28b
Purpose:
✅ Client-side markets module for FarmVista dashboard
✅ Uses Cloud Run backend:
   - /api/markets/contracts
   - /api/markets/chart/:symbol?mode=daily|weekly|6mo|1y
✅ Auto-rolling contracts (current year + next 2 years)
✅ Mobile: front contract only (tile-like)
✅ Desktop: full contract lists (corn left, soy right)
✅ Each row shows:
   - symbol
   - label (real-world contract name)
   - current price
   - change amount
   - change %
   - up/down/flat arrow
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

  function isMobile(){
    try{
      return window.matchMedia && window.matchMedia("(max-width: 899px)").matches;
    }catch{
      return false;
    }
  }

  function fmtPrice(v){
    return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—";
  }

  function fmtSigned(v, decimals){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    const d = (typeof decimals === "number") ? decimals : 2;
    const s = v.toFixed(d);
    return (v > 0 ? "+" : "") + s;
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

  // Accept multiple possible backend keys without breaking
  function readNumber(obj, keys){
    if (!obj) return null;
    for (const k of keys){
      const v = obj[k];
      const n = (typeof v === "string") ? Number(v) : v;
      if (typeof n === "number" && isFinite(n)) return n;
    }
    return null;
  }

  function pickPrice(c){
    // Common candidates your backend might return
    return readNumber(c, [
      "price","last","lastPrice","settle","settlement","tradePrice","current","close"
    ]);
  }

  function pickChange(c){
    return readNumber(c, [
      "change","chg","delta","changeAmount","netChange"
    ]);
  }

  function pickChangePct(c){
    return readNumber(c, [
      "changePct","chgPct","pctChange","percentChange","changePercent"
    ]);
  }

  function dirFrom(change, changePct){
    const v = (typeof change === "number" && isFinite(change)) ? change
            : (typeof changePct === "number" && isFinite(changePct)) ? changePct
            : 0;
    if (v > 0) return "up";
    if (v < 0) return "down";
    return "flat";
  }

  function arrowFor(dir){
    if (dir === "up") return "▲";
    if (dir === "down") return "▼";
    return "—";
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
.fv-mkt-title{ font-weight:900; letter-spacing:.02em; }
.fv-mkt-note{ font-size:12px; opacity:.7; }
.fv-mkt-list{ display:flex; flex-direction:column; gap:8px; }

.fv-mkt-btn{
  appearance:none; background:none; border:none;
  text-align:left; padding:0; cursor:pointer; color:inherit;
}
.fv-mkt-row{
  display:flex; justify-content:space-between; align-items:center;
  gap:12px;
  padding:10px 12px;
  border:1px solid rgba(0,0,0,.12);
  border-radius:12px;
  background:var(--card-surface, var(--surface, #fff));
}
.fv-mkt-left{ display:flex; flex-direction:column; min-width:0; }
.fv-mkt-sym{ font-weight:900; letter-spacing:.02em; }
.fv-mkt-name{
  font-size:12px; opacity:.78;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  max-width:56vw;
}
@media (min-width: 900px){
  .fv-mkt-name{ max-width:420px; }
}
.fv-mkt-right{
  display:flex; flex-direction:column; align-items:flex-end;
  gap:2px; flex:0 0 auto;
}
.fv-mkt-price{ font-weight:900; font-variant-numeric:tabular-nums; }
.fv-mkt-change{
  display:flex; align-items:center; gap:6px;
  font-size:12px; font-variant-numeric:tabular-nums;
  opacity:.92;
}
.fv-mkt-arrow{
  width:18px; text-align:center;
  font-weight:900;
}
.fv-mkt-change.up{ color:#2F6C3C; }
.fv-mkt-change.down{ color:#b42318; }
.fv-mkt-change.flat{ color:var(--muted,#67706B); }

.fv-mkt-meta{
  display:flex; gap:8px; font-size:12px; opacity:.7; flex-wrap:wrap;
  margin-top:8px;
}

/* Mobile “tile” feel: make it a touch bigger */
@media (max-width: 899px){
  .fv-mkt-row{ padding:12px 12px; border-radius:14px; }
  .fv-mkt-price{ font-size:18px; }
  .fv-mkt-sym{ font-size:15px; }
}
`;
    const st = document.createElement("style");
    st.id = "fv-markets-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function renderList(container, title, list){
    if(!container) return;

    const mobile = isMobile();
    const shown = mobile ? (list && list.length ? [list[0]] : []) : (list || []);

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
          <div class="fv-mkt-note">${mobile ? "Front contract" : "Tap contract for chart"}</div>
        </div>
        <div class="fv-mkt-list">
          ${shown.length ? shown.map(c => {
            const price = pickPrice(c);
            const chg = pickChange(c);
            const pct = pickChangePct(c);

            const dir = dirFrom(chg, pct);
            const arr = arrowFor(dir);

            return `
              <button class="fv-mkt-btn" data-symbol="${escapeHtml(c.symbol)}" aria-label="${escapeHtml(c.label || c.symbol)}">
                <div class="fv-mkt-row">
                  <div class="fv-mkt-left">
                    <div class="fv-mkt-sym">${escapeHtml(c.symbol)}</div>
                    <div class="fv-mkt-name">${escapeHtml(c.label || "")}</div>
                  </div>

                  <div class="fv-mkt-right">
                    <div class="fv-mkt-price">${escapeHtml(fmtPrice(price))}</div>
                    <div class="fv-mkt-change ${dir}">
                      <span class="fv-mkt-arrow" aria-hidden="true">${arr}</span>
                      <span class="fv-mkt-chg">${escapeHtml(fmtSigned(chg, 2))}</span>
                      <span class="fv-mkt-pct">${escapeHtml(fmtPct(pct))}</span>
                    </div>
                  </div>
                </div>
              </button>
            `;
          }).join("") : `<div class="fv-mkt-note">No contracts</div>`}
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

    const delay = (payload && payload.delayNote) ? String(payload.delayNote) : "";
    const asOf = (payload && payload.asOfUtc) ? String(payload.asOfUtc) : "";

    const parts = [];
    if (delay) parts.push(escapeHtml(delay));
    if (asOf) parts.push(`Updated ${escapeHtml(fmtTime(asOf))}`);

    el.innerHTML = `
      <div class="fv-mkt-meta">
        ${parts.length ? parts.map((p,i)=> (i ? `<span>•</span><span>${p}</span>` : `<span>${p}</span>`)).join("") : `<span>Markets loaded</span>`}
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

    renderList(U.corn, "Corn", payload.corn || []);
    renderList(U.soy,  "Soybeans", payload.soy || []);

    renderMeta(payload);

    window.dispatchEvent(new CustomEvent("fv:markets:updated", {
      detail:{ payload }
    }));
  };

  Markets.getLast = function(){ return last; };

})();