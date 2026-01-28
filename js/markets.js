/* =====================================================================
/Farm-vista/js/markets.js  (FULL FILE)
Rev: 2026-01-28f
Purpose:
✅ Dashboard Markets module
✅ /api/markets/contracts for contract lists (symbol + label)
✅ /api/markets/chart/:symbol?mode=daily for OHLC bars
✅ Derives QUOTE from last two non-null closes (tolerant of numeric strings)
✅ Mobile: TWO tiles per crop:
   - Front + Dec
   - If Front is Dec → show Jan next year
✅ "View more contracts" link on mobile opens contracts popup (event)
✅ Desktop: full lists (Corn left, Soy right)
✅ Refresh:
   - contracts every 30s
   - visible/mobile tiles every 30s
   - other contracts every 5 minutes (desktop)
===================================================================== */

(function(){
  "use strict";

  const Markets = {};
  window.FVMarkets = Markets;

  const REFRESH_CONTRACTS_MS = 30_000;
  const REFRESH_FRONT_QUOTES_MS = 30_000;
  const REFRESH_OTHER_QUOTES_MS = 5 * 60_000;

  // Limit concurrent chart fetches (avoid stampede)
  const MAX_CONCURRENCY = 6;

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
    try{ return window.matchMedia && window.matchMedia("(max-width: 899px)").matches; }
    catch{ return false; }
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

  function dirFrom(change){
    if (typeof change !== "number" || !isFinite(change)) return "flat";
    if (change > 0) return "up";
    if (change < 0) return "down";
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

  async function fetchChart(symbol, mode){
    const r = await fetch(
      `${base()}/api/markets/chart/${encodeURIComponent(symbol)}?mode=${encodeURIComponent(mode)}`,
      { cache:"no-store" }
    );
    if(!r.ok) throw new Error("Failed to load chart");
    return r.json();
  }

  Markets.fetchChart = fetchChart;

  function ensureStyles(){
    if(document.getElementById("fv-markets-style")) return;

    const css = `
.fv-mkt-card{ width:100%; }
.fv-mkt-head{ display:flex; justify-content:space-between; align-items:baseline; margin:0 0 8px 0; }
.fv-mkt-title{ font-weight:900; letter-spacing:.02em; }
.fv-mkt-note{ font-size:12px; opacity:.7; }

.fv-mkt-list{ display:flex; flex-direction:column; gap:8px; }

.fv-mkt-btn{ appearance:none; background:none; border:none; text-align:left; padding:0; cursor:pointer; color:inherit; }
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
}
.fv-mkt-right{ display:flex; flex-direction:column; align-items:flex-end; gap:2px; flex:0 0 auto; }
.fv-mkt-price{ font-weight:900; font-variant-numeric:tabular-nums; }

.fv-mkt-change{
  display:flex; align-items:center; gap:6px;
  font-size:12px; font-variant-numeric:tabular-nums;
  opacity:.92;
}
.fv-mkt-arrow{ width:18px; text-align:center; font-weight:900; }
.fv-mkt-change.up{ color:#2F6C3C; }
.fv-mkt-change.down{ color:#b42318; }
.fv-mkt-change.flat{ color:var(--muted,#67706B); }

.fv-mkt-meta{ display:flex; gap:8px; font-size:12px; opacity:.7; flex-wrap:wrap; margin-top:8px; }

.fv-mkt-more{
  margin-top:6px;
  display:flex;
  justify-content:flex-start;
}
.fv-mkt-more button{
  appearance:none;
  border:1px solid rgba(0,0,0,.12);
  background:var(--card-surface, var(--surface, #fff));
  border-radius:999px;
  padding:6px 10px;
  font-size:12px;
  color:var(--muted,#67706B);
  cursor:pointer;
}
.fv-mkt-more button:active{ transform:scale(.99); }

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

  // ---------------------------
  // Symbol parsing (month/year) for mobile tile selection
  // Supports ZCH26, ZCH26.CBT, etc.
  // ---------------------------
  const MONTH_CODE = {
    F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12
  };

  function parseSymbolYM(symbol){
    try{
      const s = String(symbol || "");
      const core = s.split(".")[0];          // ZCH26
      const mCode = core.slice(-3, -2);      // H
      const yyStr = core.slice(-2);          // 26
      const month = MONTH_CODE[mCode] || null;
      const yy = parseInt(yyStr, 10);
      if (!month || !isFinite(yy)) return null;

      // Convert yy -> full year (simple rule)
      const year = (yy <= 50) ? (2000 + yy) : (1900 + yy);
      return { year, month };
    } catch {
      return null;
    }
  }

  function findFirstByMonth(list, monthNum){
    if (!Array.isArray(list)) return null;
    for (const c of list){
      const ym = parseSymbolYM(c?.symbol);
      if (ym && ym.month === monthNum) return c;
    }
    return null;
  }

  function findJanNextYear(list, year){
    if (!Array.isArray(list)) return null;
    for (const c of list){
      const ym = parseSymbolYM(c?.symbol);
      if (ym && ym.month === 1 && ym.year === (year + 1)) return c;
    }
    return null;
  }

  function pickMobileTwoTiles(list){
    if (!Array.isArray(list) || !list.length) return [];
    const front = list[0];

    const frontYM = parseSymbolYM(front?.symbol);
    const dec = findFirstByMonth(list, 12);

    // If front is Dec -> show Jan next year as second tile
    if (frontYM && frontYM.month === 12){
      const jan = findJanNextYear(list, frontYM.year) || list[1] || null;
      const out = [front];
      if (jan && jan.symbol && jan.symbol !== front.symbol) out.push(jan);
      return out;
    }

    // Else: show Dec as second tile if available (and not same as front)
    if (dec && dec.symbol && dec.symbol !== front.symbol) return [front, dec];

    // Fallback: just next contract
    const second = list[1] || null;
    const out = [front];
    if (second && second.symbol && second.symbol !== front.symbol) out.push(second);
    return out;
  }

  // ---------------------------
  // Quote cache derived from chart bars
  // ---------------------------
  const quoteCache = new Map(); // symbol -> { price, chg, pct, updatedAtMs }
  const inflight = new Map();   // symbol -> Promise

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return (isFinite(v) ? v : null);
    }
    return null;
  }

  function deriveQuoteFromBars(bars){
    if (!Array.isArray(bars) || !bars.length) return null;

    // find last two non-null closes (accept number OR numeric-string)
    let last = null;
    let prev = null;

    for (let i = bars.length - 1; i >= 0; i--){
      const row = bars[i] || {};
      const c = toNum(row.c ?? row.close ?? row.Close);
      if (c != null){
        if (last == null) last = c;
        else { prev = c; break; }
      }
    }

    if (last == null) return null;

    const chg = (prev == null) ? 0 : (last - prev);
    const pct = (prev == null || prev === 0) ? 0 : ((chg / prev) * 100);

    return { price:last, chg, pct };
  }

  async function refreshQuoteFor(symbol){
    if (!symbol) return;

    // De-dupe concurrent requests
    if (inflight.has(symbol)) return inflight.get(symbol);

    const p = (async ()=>{
      try{
        const chart = await fetchChart(symbol, "daily");
        const bars = Array.isArray(chart) ? chart : (chart && (chart.bars || chart.data || chart.series)) || [];
        const q = deriveQuoteFromBars(bars);

        if (q){
          quoteCache.set(symbol, {
            price: q.price,
            chg: q.chg,
            pct: q.pct,
            updatedAtMs: Date.now()
          });
        } else {
          if (!quoteCache.has(symbol)) quoteCache.set(symbol, { price:null, chg:null, pct:null, updatedAtMs: Date.now() });
        }
      } catch {
        if (!quoteCache.has(symbol)) quoteCache.set(symbol, { price:null, chg:null, pct:null, updatedAtMs: Date.now() });
      } finally {
        inflight.delete(symbol);
      }
    })();

    inflight.set(symbol, p);
    return p;
  }

  async function runQueue(symbols){
    const list = Array.from(new Set(symbols.filter(Boolean)));
    if (!list.length) return;

    let idx = 0;
    const workers = new Array(Math.min(MAX_CONCURRENCY, list.length)).fill(0).map(async ()=>{
      while (idx < list.length){
        const sym = list[idx++];
        await refreshQuoteFor(sym);
      }
    });
    await Promise.all(workers);
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function renderList(container, title, list, cropKey){
    if(!container) return;

    const mobile = isMobile();
    const shown = mobile ? pickMobileTwoTiles(list || []) : (list || []);

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
          <div class="fv-mkt-note">${mobile ? "Front + Dec" : "Tap contract for chart"}</div>
        </div>

        <div class="fv-mkt-list">
          ${shown.length ? shown.map(c => {
            const sym = c.symbol || "";
            const label = c.label || "";

            const q = quoteCache.get(sym) || null;
            const price = q ? q.price : null;
            const chg = q ? q.chg : null;
            const pct = q ? q.pct : null;

            const dir = dirFrom(chg);
            const arr = arrowFor(dir);

            return `
              <button class="fv-mkt-btn" data-symbol="${escapeHtml(sym)}" aria-label="${escapeHtml(label || sym)}">
                <div class="fv-mkt-row">
                  <div class="fv-mkt-left">
                    <div class="fv-mkt-sym">${escapeHtml(sym)}</div>
                    <div class="fv-mkt-name">${escapeHtml(label)}</div>
                  </div>

                  <div class="fv-mkt-right">
                    <div class="fv-mkt-price">${escapeHtml(fmtPrice(price))}</div>
                    <div class="fv-mkt-change ${dir}">
                      <span class="fv-mkt-arrow" aria-hidden="true">${arr}</span>
                      <span>${escapeHtml(fmtSigned(chg, 2))}</span>
                      <span>${escapeHtml(fmtPct(pct))}</span>
                    </div>
                  </div>
                </div>
              </button>
            `;
          }).join("") : `<div class="fv-mkt-note">No contracts</div>`}
        </div>

        ${mobile ? `
          <div class="fv-mkt-more">
            <button type="button" data-fv-mkt-more="${escapeHtml(cropKey)}">View more contracts</button>
          </div>
        ` : ``}
      </div>
    `;

    // Tap contract → open chart
    container.querySelectorAll('[data-symbol]').forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const sym = btn.getAttribute("data-symbol");
        window.dispatchEvent(new CustomEvent("fv:markets:contractTap", { detail:{ symbol:sym } }));
      });
    });

    // Mobile "View more" → open contract list modal
    const moreBtn = container.querySelector('[data-fv-mkt-more]');
    if (moreBtn){
      moreBtn.addEventListener("click", ()=>{
        const crop = moreBtn.getAttribute("data-fv-mkt-more") || "";
        window.dispatchEvent(new CustomEvent("fv:markets:viewMore", { detail:{ crop } }));
      });
    }
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

  // ---------------------------
  // Lifecycle / timers
  // ---------------------------
  let timerContracts = null;
  let timerFrontQuotes = null;
  let timerOtherQuotes = null;

  let lastPayload = null;

  function mobileVisibleSymbols(payload){
    const out = [];
    if (!payload) return out;

    const cornTiles = pickMobileTwoTiles(payload.corn || []);
    const soyTiles  = pickMobileTwoTiles(payload.soy || []);

    cornTiles.forEach(c => c?.symbol && out.push(c.symbol));
    soyTiles.forEach(c => c?.symbol && out.push(c.symbol));

    return out;
  }

  function allSymbols(payload){
    const out = [];
    if (payload && Array.isArray(payload.corn)) payload.corn.forEach(c => c && c.symbol && out.push(c.symbol));
    if (payload && Array.isArray(payload.soy)) payload.soy.forEach(c => c && c.symbol && out.push(c.symbol));
    return out;
  }

  function redraw(){
    const U = ui();
    if (!lastPayload) return;

    renderList(U.corn, "Corn", lastPayload.corn || [], "corn");
    renderList(U.soy,  "Soybeans", lastPayload.soy || [], "soy");
    renderMeta(lastPayload);
  }

  Markets.refresh = async function(){
    const payload = await fetchContracts();
    lastPayload = payload;

    // 1) Render immediately (placeholders until quotes arrive)
    redraw();

    // 2) Fetch quotes:
    // Mobile: fetch only visible tiles (2 per crop)
    // Desktop: fetch fronts quickly, and the rest on slower cadence
    if (isMobile()){
      const vis = mobileVisibleSymbols(payload);
      await runQueue(vis);
      redraw();
    } else {
      // Desktop: first items in each crop list are the “front-ish” contracts, refresh them immediately
      const fronts = [];
      if (payload?.corn?.[0]?.symbol) fronts.push(payload.corn[0].symbol);
      if (payload?.soy?.[0]?.symbol)  fronts.push(payload.soy[0].symbol);

      await runQueue(fronts);
      redraw();

      const all = allSymbols(payload);
      const rest = all.filter(s => !fronts.includes(s));
      runQueue(rest).then(redraw).catch(()=>{});
    }

    window.dispatchEvent(new CustomEvent("fv:markets:updated", { detail:{ payload } }));
  };

  Markets.start = function(){
    ensureStyles();

    Markets.refresh().catch(()=>{});

    if (timerContracts) clearInterval(timerContracts);
    timerContracts = setInterval(()=>Markets.refresh().catch(()=>{}), REFRESH_CONTRACTS_MS);

    // Refresh visible/mobile tiles every 30s
    if (timerFrontQuotes) clearInterval(timerFrontQuotes);
    timerFrontQuotes = setInterval(async ()=>{
      try{
        if (!lastPayload) return;
        const syms = isMobile()
          ? mobileVisibleSymbols(lastPayload)
          : ([
              lastPayload?.corn?.[0]?.symbol,
              lastPayload?.soy?.[0]?.symbol
            ].filter(Boolean));

        await runQueue(syms);
        redraw();
      }catch{}
    }, REFRESH_FRONT_QUOTES_MS);

    // Desktop: refresh other quotes every 5 minutes
    if (timerOtherQuotes) clearInterval(timerOtherQuotes);
    timerOtherQuotes = setInterval(async ()=>{
      try{
        if (!lastPayload) return;
        if (isMobile()) return;

        const fronts = [];
        if (lastPayload?.corn?.[0]?.symbol) fronts.push(lastPayload.corn[0].symbol);
        if (lastPayload?.soy?.[0]?.symbol)  fronts.push(lastPayload.soy[0].symbol);

        const all = allSymbols(lastPayload);
        const rest = all.filter(s => !fronts.includes(s));
        await runQueue(rest);
        redraw();
      }catch{}
    }, REFRESH_OTHER_QUOTES_MS);
  };

  Markets.getLast = function(){ return lastPayload; };

})();