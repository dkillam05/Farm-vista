/* =====================================================================
/Farm-vista/js/markets.js  (FULL FILE)
Rev: 2026-01-28o

Fixes:
✅ Front selection skips expired + dead symbols
✅ Quotes:
   - price from intraday (1D) last close
   - change/% from 6M daily closes (prev daily close) like Yahoo
✅ Auto-hide contracts that don’t fetch real data (dead/nodata)
✅ Mobile: two tiles per crop (Front + Dec; if Front=Dec then Jan next year)
✅ Desktop: full lists, hide unusable symbols, and show change chip for ALL rows

NEW:
✅ Expose quote helpers for modal tiles:
   - FVMarkets.getQuote(symbol)
   - FVMarkets.warmQuotes(symbols, level)
✅ Lite mode no longer lies with 0.00 change; uses null => UI shows "—"

CHANGE (requested):
✅ Remove yellow bubble
✅ Bubble is GREEN when up, RED when down, GRAY when flat
✅ Bubble text ALWAYS WHITE (including arrow + $chg + %chg)

CRITICAL FIX (your issue):
✅ Change bubbles “barely showing” was caused by mode mismatch after switching UI to Yahoo tabs.
   - markets.js was still requesting "daily" / "6mo"
   - your backend + chart UI now uses "1d" / "6m" / "1y"
✅ This file now speaks Yahoo modes and also FALLBACKS to legacy modes if needed:
   - 1d -> daily
   - 5d -> weekly
   - 1m -> monthly
   - 6m -> 6mo
   - 1y -> 1y

NEW (requested by you):
✅ Desktop: move "Delayed quotes • Updated hh:mm:ss" into the Markets header area (subtle),
   while keeping mobile exactly as-is.
===================================================================== */

(function(){
  "use strict";

  const Markets = {};
  window.FVMarkets = Markets;

  const REFRESH_CONTRACTS_MS = 30_000;
  const REFRESH_FRONT_QUOTES_MS = 30_000;
  const REFRESH_OTHER_QUOTES_MS = 5 * 60_000;

  const MAX_CONCURRENCY = 6;
  const HIDE_BAD_CONTRACTS = true; // ✅ requested

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

  function fmtPrice(v){ return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—"; }
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

  // ---------------------------
  // Mode compatibility helpers
  // ---------------------------
  // Your UI now uses Yahoo-style chart modes.
  // Backend may support Yahoo modes OR legacy modes depending on deploy.
  const MODE_FALLBACK = {
    "1d": "daily",
    "5d": "weekly",
    "1m": "monthly",
    "6m": "6mo",
    "1y": "1y"
  };

  function normMode(m){
    const s = String(m || "").toLowerCase().trim();

    // Yahoo modes
    if (s === "1d" || s === "5d" || s === "1m" || s === "6m" || s === "1y") return s;

    // Legacy modes we used earlier
    if (s === "daily") return "1d";
    if (s === "weekly") return "5d";
    if (s === "monthly") return "1m";
    if (s === "6mo") return "6m";
    if (s === "1y") return "1y";

    // default
    return "1d";
  }

  async function fetchContracts(){
    const r = await fetch(`${base()}/api/markets/contracts`, { cache:"no-store" });
    if(!r.ok) throw new Error("Failed to load contracts");
    return r.json();
  }

  // Primary chart fetch used by UI + quotes.
  // Tries Yahoo mode first, then falls back to legacy if needed.
  async function fetchChart(symbol, mode){
    const wanted = normMode(mode);
    const firstTry = wanted;

    // If the caller passed legacy, we still normalize to Yahoo.
    // But also preserve a sane legacy fallback:
    const fallback = MODE_FALLBACK[firstTry] || null;

    async function doFetch(m){
      const r = await fetch(
        `${base()}/api/markets/chart/${encodeURIComponent(symbol)}?mode=${encodeURIComponent(m)}`,
        { cache:"no-store" }
      );
      if(!r.ok){
        const txt = await r.text().catch(()=> "");
        const e = new Error(`Failed to load chart (${r.status})`);
        e.status = r.status;
        e.body = txt;
        e._mode = m;
        throw e;
      }
      return r.json();
    }

    try{
      return await doFetch(firstTry);
    }catch(e){
      // Only fallback for “mode not supported / bad request / not found”
      // (keeps real 500s visible)
      const st = e && typeof e.status === "number" ? e.status : 0;
      const canFallback = !!fallback && (st === 400 || st === 404);
      if (!canFallback) throw e;
      return await doFetch(fallback);
    }
  }

  Markets.fetchChart = fetchChart;

  // ---------------------------
  // Styles
  // ---------------------------
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

/* CHANGE CHIP (bubble) — no yellow, white text always */
.fv-mkt-change{
  display:flex; align-items:center; gap:6px;
  font-size:12px; font-variant-numeric:tabular-nums;
  opacity:1;
  border-radius:10px;
  padding:3px 8px;
  color:#fff !important;
}
.fv-mkt-change *{ color:#fff !important; }
.fv-mkt-arrow{ width:18px; text-align:center; font-weight:900; color:#fff !important; }

.fv-mkt-change.up{ background:#2F6C3C; }
.fv-mkt-change.down{ background:#b42318; }
.fv-mkt-change.flat{ background:#67706B; }

.fv-mkt-meta{ display:flex; gap:8px; font-size:12px; opacity:.7; flex-wrap:wrap; margin-top:8px; }

/* ✅ Desktop subtle "header subtitle" styling */
@media (min-width: 900px){
  [data-fv="mktMeta"] .fv-mkt-meta{
    margin-top: 2px;
    margin-bottom: 8px;
    font-size: 11px;
    opacity: .55;
  }
}

.fv-mkt-more{ margin-top:6px; display:flex; justify-content:flex-start; }
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
  // Contract parsing + “expired” heuristic
  // ---------------------------
  const MONTH_CODE = { F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12 };

  function parseSymbolYM(symbol){
    try{
      const s = String(symbol || "");
      const core = s.split(".")[0];
      const mCode = core.slice(-3, -2);
      const yyStr = core.slice(-2);
      const month = MONTH_CODE[mCode] || null;
      const yy = parseInt(yyStr, 10);
      if (!month || !isFinite(yy)) return null;
      const year = (yy <= 50) ? (2000 + yy) : (1900 + yy);
      return { year, month };
    }catch{ return null; }
  }

  function isExpiredContract(symbol){
    const ym = parseSymbolYM(symbol);
    if (!ym) return false;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();

    if (ym.year < y) return true;
    if (ym.year > y) return false;

    if (ym.month < m) return true;
    if (ym.month > m) return false;

    // same month: treat late month as expired (practical)
    return d >= 21;
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

  // ---------------------------
  // Chart normalization (Cloud Run returns chart.points[])
  // ---------------------------
  function normalizePoints(chart){
    if (Array.isArray(chart)) return chart;
    if (!chart) return [];
    return chart.points || chart.bars || chart.data || chart.series || [];
  }

  function toNum2(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return (isFinite(v) ? v : null);
    }
    return null;
  }

  function lastNonNullClose(points){
    if (!Array.isArray(points) || !points.length) return null;
    for (let i = points.length - 1; i >= 0; i--){
      const c = toNum2(points[i]?.c);
      if (c != null) return c;
    }
    return null;
  }

  function lastTwoDailyCloses(points){
    if (!Array.isArray(points) || !points.length) return { last:null, prev:null };
    let last = null;
    let prev = null;
    for (let i = points.length - 1; i >= 0; i--){
      const c = toNum2(points[i]?.c);
      if (c != null){
        if (last == null) last = c;
        else { prev = c; break; }
      }
    }
    return { last, prev };
  }

  // ---------------------------
  // Symbol state + quote cache
  // ---------------------------
  // state: ok | dead | nodata | unknown
  const symbolState = new Map(); // symbol -> state
  const quoteCache = new Map();  // symbol -> { price, chg, pct, updatedAtMs }
  const inflight = new Map();    // symbol -> Promise

  function setState(sym, st){
    if (!sym) return;
    symbolState.set(sym, st);
  }

  Markets.getSymbolState = function(sym){
    return symbolState.get(sym) || "unknown";
  };

  Markets.isSymbolUsable = function(sym){
    const st = Markets.getSymbolState(sym);
    return st !== "dead" && st !== "nodata";
  };

  // ✅ Expose quote access
  Markets.getQuote = function(sym){
    return quoteCache.get(sym) || null;
  };

  // Choose a front contract that is:
  // - not expired
  // - not dead/nodata if we know it already
  function pickFront(list){
    if (!Array.isArray(list) || !list.length) return null;

    for (const c of list){
      const sym = c?.symbol;
      if (!sym) continue;
      if (isExpiredContract(sym)) continue;
      if (HIDE_BAD_CONTRACTS && !Markets.isSymbolUsable(sym)) continue;
      return c;
    }

    // fallback: first usable
    for (const c of list){
      const sym = c?.symbol;
      if (!sym) continue;
      if (HIDE_BAD_CONTRACTS && !Markets.isSymbolUsable(sym)) continue;
      return c;
    }

    return list[0] || null;
  }

  function filterList(list){
    if (!HIDE_BAD_CONTRACTS) return list || [];
    return (list || []).filter(c => c?.symbol && Markets.isSymbolUsable(c.symbol));
  }

  function pickMobileTwoTiles(list){
    const filtered = filterList(list || []);
    if (!filtered.length) return [];

    const front = pickFront(filtered) || filtered[0];
    const reordered = [front, ...filtered.filter(x => x?.symbol && x.symbol !== front.symbol)];

    const frontYM = parseSymbolYM(front?.symbol);
    const dec = findFirstByMonth(reordered, 12);

    if (frontYM && frontYM.month === 12){
      const jan = findJanNextYear(reordered, frontYM.year) || reordered[1] || null;
      const out = [front];
      if (jan && jan.symbol && jan.symbol !== front.symbol) out.push(jan);
      return out;
    }

    if (dec && dec.symbol && dec.symbol !== front.symbol) return [front, dec];

    const second = reordered[1] || null;
    const out = [front];
    if (second && second.symbol && second.symbol !== front.symbol) out.push(second);
    return out;
  }

  function isDeadishError(e){
    const body = String(e?.body || "");
    return (
      e?.status === 404 ||
      body.includes("No data found") ||
      body.includes('"result":null') ||
      body.includes('"code":"Not Found"') ||
      body.includes('"chart_failed"')
    );
  }

  async function refreshQuoteFor(symbol, level){
    if (!symbol) return;
    if (inflight.has(symbol)) return inflight.get(symbol);

    // small optimization: don’t keep hammering known-bad symbols
    if (HIDE_BAD_CONTRACTS && !Markets.isSymbolUsable(symbol)) {
      if (!quoteCache.has(symbol)) quoteCache.set(symbol, { price:null, chg:null, pct:null, updatedAtMs: Date.now() });
      return;
    }

    const modeLevel = (level === "lite") ? "lite" : "full";

    const p = (async ()=>{
      try{
        // 1) Price from intraday 1D (fast)
        const daily = await fetchChart(symbol, "1d");
        const dailyPts = normalizePoints(daily);
        const price = lastNonNullClose(dailyPts);

        // If intraday has literally no closes, treat nodata
        if (price == null){
          setState(symbol, "nodata");
          quoteCache.set(symbol, { price:null, chg:null, pct:null, updatedAtMs: Date.now() });
          return;
        }

        let chg = null, pct = null;

        if (modeLevel === "full"){
          // 2) Change/% from 6M daily closes (prev close) like Yahoo
          const six = await fetchChart(symbol, "6m");
          const sixPts = normalizePoints(six);
          const { prev } = lastTwoDailyCloses(sixPts);

          if (prev != null){
            chg = price - prev;
            pct = (prev === 0) ? 0 : (chg / prev) * 100;
          } else {
            // fallback to last two intraday closes
            let last2 = null, prev2 = null;
            for (let i = dailyPts.length - 1; i >= 0; i--){
              const c = toNum2(dailyPts[i]?.c);
              if (c != null){
                if (last2 == null) last2 = c;
                else { prev2 = c; break; }
              }
            }
            if (prev2 != null){
              chg = last2 - prev2;
              pct = (prev2 === 0) ? 0 : (chg / prev2) * 100;
            } else {
              chg = null; pct = null;
            }
          }
        } else {
          // ✅ Lite mode uses null => UI can show "—" or hide chip
          chg = null;
          pct = null;
        }

        setState(symbol, "ok");
        quoteCache.set(symbol, { price, chg, pct, updatedAtMs: Date.now() });

      } catch (e){
        if (isDeadishError(e)) setState(symbol, "dead");
        else if (!symbolState.has(symbol)) setState(symbol, "unknown");

        if (!quoteCache.has(symbol)) quoteCache.set(symbol, { price:null, chg:null, pct:null, updatedAtMs: Date.now() });
      } finally {
        inflight.delete(symbol);
      }
    })();

    inflight.set(symbol, p);
    return p;
  }

  async function runQueue(symbols, level){
    const list = Array.from(new Set((symbols || []).filter(Boolean)));
    if (!list.length) return;

    let idx = 0;
    const workers = new Array(Math.min(MAX_CONCURRENCY, list.length)).fill(0).map(async ()=>{
      while (idx < list.length){
        const sym = list[idx++];
        await refreshQuoteFor(sym, level);
      }
    });
    await Promise.all(workers);
  }

  // ✅ Expose warmQuotes for dash-markets-ui
  Markets.warmQuotes = async function(symbols, level){
    await runQueue(symbols, level);
  };

  // ---------------------------
  // Rendering
  // ---------------------------
  function renderList(container, title, list, cropKey){
    if(!container) return;

    const mobile = isMobile();
    const safeList = filterList(list || []);
    const shown = mobile ? pickMobileTwoTiles(safeList) : safeList;

    container.innerHTML = `
      <div class="fv-mkt-card">
        <div class="fv-mkt-head">
          <div class="fv-mkt-title">${escapeHtml(title)}</div>
        </div>

        <div class="fv-mkt-list">
          ${shown.length ? shown.map(c => {
            const sym = c.symbol || "";
            const label = c.label || "";

            const q = quoteCache.get(sym) || null;
            const price = q ? q.price : null;
            const chg = q ? q.chg : null;
            const pct = q ? q.pct : null;

            const hasChange = (typeof chg === "number" && isFinite(chg)) && (typeof pct === "number" && isFinite(pct));
            const dir = hasChange ? dirFrom(chg) : "flat";
            const arr = hasChange ? arrowFor(dir) : "";

            return `
              <button class="fv-mkt-btn" data-symbol="${escapeHtml(sym)}" aria-label="${escapeHtml(label || sym)}">
                <div class="fv-mkt-row">
                  <div class="fv-mkt-left">
                    <div class="fv-mkt-sym">${escapeHtml(sym)}</div>
                    <div class="fv-mkt-name">${escapeHtml(label)}</div>
                  </div>

                  <div class="fv-mkt-right">
                    <div class="fv-mkt-price">${escapeHtml(fmtPrice(price))}</div>
                    ${hasChange ? `
                      <div class="fv-mkt-change ${dir}">
                        <span class="fv-mkt-arrow" aria-hidden="true">${arr}</span>
                        <span>${escapeHtml(fmtSigned(chg, 2))}</span>
                        <span>${escapeHtml(fmtPct(pct))}</span>
                      </div>
                    ` : ``}
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

    container.querySelectorAll('[data-symbol]').forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const sym = btn.getAttribute("data-symbol");
        window.dispatchEvent(new CustomEvent("fv:markets:contractTap", { detail:{ symbol:sym } }));
      });
    });

    const moreBtn = container.querySelector('[data-fv-mkt-more]');
    if (moreBtn){
      moreBtn.addEventListener("click", ()=>{
        const crop = moreBtn.getAttribute("data-fv-mkt-more") || "";
        window.dispatchEvent(new CustomEvent("fv:markets:viewMore", { detail:{ crop } }));
      });
    }
  }

  // ✅ Find a good “Markets header” container on desktop to tuck meta under the label.
  function findDesktopMetaHost(){
    // Most reliable anchor: the element wrapping the markets area (near corn/soy containers)
    const U = ui();
    const anchor = U.corn || U.soy || U.meta;
    if (!anchor) return null;

    // Walk up to a reasonable section/card boundary
    let root = anchor;
    for (let i=0; i<6; i++){
      if (!root || !root.parentElement) break;
      root = root.parentElement;
      // If the container has both corn+soy (common), use it
      const hasCorn = !!qs('[data-fv="mktCorn"]', root);
      const hasSoy  = !!qs('[data-fv="mktSoy"]', root);
      if (hasCorn && hasSoy) break;
    }

    // Try common header containers inside that root
    const header =
      qs('[data-fv="marketsHeader"]', root) ||
      qs('#fv-markets-header', root) ||
      qs('.fv-dash-head', root) ||
      qs('.fv-card-head', root) ||
      qs('.fv-section-head', root) ||
      qs('header', root);

    return header || null;
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

    // ✅ Desktop: move this meta line into the Markets header area if we can find it.
    // Mobile: leave exactly as-is.
    if (!isMobile()){
      try{
        const host = findDesktopMetaHost();
        if (host && el.parentElement !== host){
          host.appendChild(el);
        }
      }catch{}
    }
  }

  // ---------------------------
  // Lifecycle
  // ---------------------------
  let timerContracts = null;
  let timerFrontQuotes = null;
  let timerOtherQuotes = null;

  let lastPayload = null;

  function mobileVisibleSymbols(payload){
    const out = [];
    if (!payload) return out;
    pickMobileTwoTiles(payload.corn || []).forEach(c => c?.symbol && out.push(c.symbol));
    pickMobileTwoTiles(payload.soy || []).forEach(c => c?.symbol && out.push(c.symbol));
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

    redraw();

    if (isMobile()){
      const vis = mobileVisibleSymbols(payload);
      await runQueue(vis, "full");
      redraw();
    } else {
      // ✅ Desktop: warm ALL rows in FULL so every contract can show the change chip
      const all = allSymbols(payload);
      runQueue(all, "full").then(redraw).catch(()=>{});
    }

    window.dispatchEvent(new CustomEvent("fv:markets:updated", { detail:{ payload } }));
  };

  Markets.start = function(){
    ensureStyles();

    Markets.refresh().catch(()=>{});

    if (timerContracts) clearInterval(timerContracts);
    timerContracts = setInterval(()=>Markets.refresh().catch(()=>{}), REFRESH_CONTRACTS_MS);

    if (timerFrontQuotes) clearInterval(timerFrontQuotes);
    timerFrontQuotes = setInterval(async ()=>{
      try{
        if (!lastPayload) return;
        const syms = isMobile() ? mobileVisibleSymbols(lastPayload) : allSymbols(lastPayload);
        await runQueue(syms, "full");
        redraw();
      }catch{}
    }, REFRESH_FRONT_QUOTES_MS);

    if (timerOtherQuotes) clearInterval(timerOtherQuotes);
    timerOtherQuotes = setInterval(async ()=>{
      try{
        if (!lastPayload) return;
        const all = allSymbols(lastPayload);
        await runQueue(all, "full");
        redraw();
      }catch{}
    }, REFRESH_OTHER_QUOTES_MS);
  };

  Markets.getLast = function(){ return lastPayload; };

})();
