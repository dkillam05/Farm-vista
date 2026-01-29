/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-29a
Purpose:
✅ Thin UI orchestrator for Markets
   - Opens/closes modal
   - Handles contract taps
   - Handles "View more"
   - Wires chart tabs
✅ Yahoo-style ranges + labels:
   - 1D, 5D, 1M, 6M, 1Y
✅ Default tab = 1D
Delegates:
   - Chart rendering → FVMarketsChart
   - Series shaping → FVMarketsSeries
   - Quote badges → FVMarketsQuotes

Mobile fixes:
✅ View-more list shows quotes immediately (no more --- until tap)
   - Warm quotes on open (lite -> paint -> full -> paint)
   - Paint rows from FVMarkets.getQuote() so it works even if FVMarketsQuotes is slow
✅ Auto-scroll to chart after selecting a contract (mobile only)
   - Smooth scroll to chart panel so user sees the chart instantly

NEW fixes:
✅ View-more list filters like desktop:
   - Hides expired contracts (practical rule: same month + day>=21)
   - Hides dead/no-data contracts when FVMarkets.isSymbolUsable() is available
✅ Adds an “X” close button in the top-right
✅ Removes the old "Close" button (no overlap / no duplicate controls)
✅ When switching charts/tabs, clears any locked tooltip immediately

NEW (this rev):
✅ Mobile charts go TRUE fullscreen (no header/footer visible; no scrolling needed)
   - Modal + backdrop are forced fixed/inset:0 with a very high z-index
   - Chart layout uses flex so canvas fills remaining height
✅ View-more (split) on mobile:
   - Selecting a contract switches to fullscreen chart view automatically (hides the list)
   - A “List” button appears so you can jump back to the contract list
✅ Orientation-aware shaping:
   - Pass { isLandscape } into FVMarketsSeries.shape so labels update on rotate
✅ 1D day label support (if series provides it):
   - If shaped.sessionLabel exists, show “1D • Wed 1/29” in the range area
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  // Yahoo-style tab order
  const TAB_MODES = [
    { mode: "1d", label: "1D" },
    { mode: "5d", label: "5D" },
    { mode: "1m", label: "1M" },
    { mode: "6m", label: "6M" },
    { mode: "1y", label: "1Y" }
  ];

  const DEFAULT_MODE = "1d";

  function qs(sel, root=document){ return root.querySelector(sel); }

  function isMobile(){
    try{ return window.matchMedia && window.matchMedia("(max-width: 899px)").matches; }
    catch{ return false; }
  }

  function isLandscape(){
    try{
      if (window.matchMedia){
        const mq = window.matchMedia("(orientation: landscape)");
        if (mq && typeof mq.matches === "boolean") return mq.matches;
      }
      return (window.innerWidth > window.innerHeight);
    } catch {
      return false;
    }
  }

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return isFinite(v) ? v : null;
    }
    return null;
  }

  function fmtPrice(v){
    return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—";
  }
  function fmtSigned(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2);
  }
  function fmtPct(v){
    if (!(typeof v === "number" && isFinite(v))) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function dirFrom(chg){
    if (typeof chg !== "number" || !isFinite(chg)) return "flat";
    if (chg > 0) return "up";
    if (chg < 0) return "down";
    return "flat";
  }
  function arrowFor(dir){
    if (dir === "up") return "▲";
    if (dir === "down") return "▼";
    return "—";
  }

  // --------------------------------------------------
  // Contract filtering (expired + dead/noData)
  // --------------------------------------------------
  const MONTH_CODE = { F:1, G:2, H:3, J:4, K:5, M:6, N:7, Q:8, U:9, V:10, X:11, Z:12 };

  function parseSymbolYM(symbol){
    try{
      const s = String(symbol || "");
      const core = s.split(".")[0];        // ZSH26 from ZSH26.CBT
      const mCode = core.slice(-3, -2);    // H
      const yyStr = core.slice(-2);        // 26
      const month = MONTH_CODE[mCode] || null;
      const yy = parseInt(yyStr, 10);
      if (!month || !isFinite(yy)) return null;
      const year = (yy <= 50) ? (2000 + yy) : (1900 + yy);
      return { year, month };
    }catch{
      return null;
    }
  }

  // Practical expired rule (matches what you’ve been using):
  // - year < current => expired
  // - year == current and month < currentMonth => expired
  // - year == current and month == currentMonth and day >= 21 => expired
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

    return d >= 21;
  }

  function isSymbolUsable(symbol){
    try{
      if (window.FVMarkets && typeof window.FVMarkets.isSymbolUsable === "function"){
        return !!window.FVMarkets.isSymbolUsable(symbol);
      }
    }catch{}
    return true; // if we can’t check, don’t hide
  }

  function filterContracts(list){
    const out = [];
    for (const c of (list || [])){
      const sym = c?.symbol;
      if (!sym) continue;

      // hide expired
      if (isExpiredContract(sym)) continue;

      // hide dead/nodata (if available)
      if (!isSymbolUsable(sym)) continue;

      out.push(c);
    }
    return out;
  }

  // --------------------------------------------------
  // Fullscreen mobile styling (injected once)
  // --------------------------------------------------
  function ensureStyles(){
    if (document.getElementById("fv-mktm-style")) return;

    const css = document.createElement("style");
    css.id = "fv-mktm-style";
    css.textContent = `
/* Backdrop + modal should ALWAYS overlay app header/footer */
#${BACKDROP_ID}{
  position:fixed !important;
  inset:0 !important;
  z-index:999999 !important;
  background:rgba(0,0,0,0.45);
  display:none;
}
#${BACKDROP_ID}.open{ display:block; }

#${MODAL_ID}{
  position:fixed !important;
  inset:0 !important;
  width:100vw !important;
  height:100vh !important;
  max-height:100vh !important;
  margin:0 !important;
  border-radius:0 !important;
  overflow:hidden !important;
  background:var(--panel, #101513);
  color:inherit;
}

/* Body region inside modal: flex so chart can fill viewport without scroll */
#fv-mktm-body{
  height:calc(100vh - 52px); /* header area */
  overflow:hidden;
}

/* Default grid behaviors */
.fv-mktm-grid{ height:100%; }

/* Chart panel should fill available height */
.fv-mktm-chart{
  height:100%;
  display:flex;
  flex-direction:column;
  min-height:0;
}

/* Tabs + range row stays compact */
.fv-mktm-sub{
  flex:0 0 auto;
}

/* Canvas fills remaining height */
.fv-mktm-canvas{
  flex:1 1 auto;
  width:100% !important;
  height:auto !important;
  min-height:0;
  display:block;
}

/* Note area stays below but compact */
#fv-mktm-note{
  flex:0 0 auto;
}

/* Split layout on mobile: allow list OR chart fullscreen */
@media (max-width: 899px){
  .fv-mktm-split{
    display:flex;
    flex-direction:column;
    height:100%;
    min-height:0;
  }
  .fv-mktm-list{
    overflow:auto;
    -webkit-overflow-scrolling:touch;
    height:100%;
  }

  /* Fullscreen chart mode (hide list, chart takes all) */
  #${BACKDROP_ID}.fv-mktm-fullchart .fv-mktm-list{
    display:none !important;
  }
  #${BACKDROP_ID}.fv-mktm-fullchart #fv-mktm-chartpanel{
    height:100% !important;
  }

  /* When fullchart, keep header/title visible but everything else uses viewport */
  #${BACKDROP_ID}.fv-mktm-fullchart #fv-mktm-body{
    height:calc(100vh - 52px);
  }
}

/* Small helper buttons */
.fv-mktm-head-actions{
  position:absolute;
  left:0;
  top:0;
  display:flex;
  gap:8px;
  align-items:center;
  height:30px;
}
.fv-mktm-btn-mini{
  height:30px;
  padding:0 10px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.18);
  background:rgba(255,255,255,0.06);
  color:inherit;
  font-weight:600;
  cursor:pointer;
}
.fv-mktm-btn-mini:active{ transform:scale(0.98); }
`;
    document.head.appendChild(css);
  }

  // --------------------------------------------------
  // Modal shell
  // --------------------------------------------------
  function ensureModal(){
    ensureStyles();

    let back = document.getElementById(BACKDROP_ID);
    if (back) return back;

    back = document.createElement("div");
    back.id = BACKDROP_ID;
    back.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true">
        <div class="fv-mktm-head" style="position:relative;">
          <div class="fv-mktm-head-actions" id="fv-mktm-head-actions"></div>

          <h2 class="fv-mktm-title" id="fv-mktm-title">Markets</h2>

          <!-- X close (top-right) -->
          <button type="button"
                  class="fv-mktm-btn"
                  id="fv-mktm-close-x"
                  aria-label="Close"
                  style="position:absolute; right:0; top:0; width:30px; height:30px; padding:0; border-radius:999px; display:flex; align-items:center; justify-content:center;">
            ×
          </button>
        </div>

        <div id="fv-mktm-body"></div>
      </div>
    `;
    document.body.appendChild(back);

    back.addEventListener("click", e=>{
      if (e.target === back) closeModal();
    });

    const closeX = qs("#fv-mktm-close-x", back);
    if (closeX) closeX.addEventListener("click", closeModal);

    document.addEventListener("keydown", e=>{
      if (e.key === "Escape") closeModal();
    });

    return back;
  }

  function openModal(){
    const back = ensureModal();
    back.classList.add("open");
    back.classList.remove("fv-mktm-fullchart"); // reset
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("open");
    back.classList.remove("fv-mktm-fullchart");
    document.body.style.overflow = "";

    // Clear any tooltip/lock when closing
    try{
      if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
        window.FVMarketsChart.hideTip();
      }
    }catch{}
  }

  function setTitle(t){
    const el = qs("#fv-mktm-title");
    if (el) el.textContent = t || "Markets";
  }

  function setBody(html){
    const el = qs("#fv-mktm-body");
    if (el) el.innerHTML = html || "";
  }

  function setHeadActions(html){
    const el = qs("#fv-mktm-head-actions");
    if (el) el.innerHTML = html || "";
  }

  function enterFullChartMode(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    if (!isMobile()) return;
    back.classList.add("fv-mktm-fullchart");
  }

  function exitFullChartMode(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("fv-mktm-fullchart");
  }

  // --------------------------------------------------
  // Quote painting for list rows (mobile + desktop)
  // --------------------------------------------------
  function paintRowQuote(rowEl, sym){
    if (!rowEl || !sym) return;

    const q = (window.FVMarkets && typeof window.FVMarkets.getQuote === "function")
      ? window.FVMarkets.getQuote(sym)
      : null;

    const price = q ? toNum(q.price) : null;
    const chg = q ? toNum(q.chg) : null;
    const pct = q ? toNum(q.pct) : null;

    const priceEl = rowEl.querySelector('[data-q="price"]');
    const badgeEl = rowEl.querySelector('[data-q="badge"]');
    const arrEl = rowEl.querySelector('[data-q="arr"]');
    const chgEl = rowEl.querySelector('[data-q="chg"]');
    const pctEl = rowEl.querySelector('[data-q="pct"]');

    if (priceEl) priceEl.textContent = fmtPrice(price);

    const hasChange = (chg != null) && (pct != null);
    const dir = hasChange ? dirFrom(chg) : "flat";
    const arr = hasChange ? arrowFor(dir) : "—";

    if (badgeEl){
      badgeEl.classList.remove("up","down","flat");
      badgeEl.classList.add(dir);
    }
    if (arrEl) arrEl.textContent = arr;
    if (chgEl) chgEl.textContent = hasChange ? fmtSigned(chg) : "—";
    if (pctEl) pctEl.textContent = hasChange ? fmtPct(pct) : "—";
  }

  function paintAllListRows(symbols){
    const list = (symbols || []).filter(Boolean);
    if (!list.length) return;

    for (const sym of list){
      const row = document.querySelector(`.fv-mktm-row[data-mkt-sym="${CSS.escape(sym)}"]`);
      if (row) paintRowQuote(row, sym);
    }
  }

  async function warmAndPaintList(symbols){
    const syms = Array.from(new Set((symbols || []).filter(Boolean)));
    if (!syms.length) return;

    paintAllListRows(syms);

    if (window.FVMarkets && typeof window.FVMarkets.warmQuotes === "function"){
      try{ await window.FVMarkets.warmQuotes(syms, "lite"); } catch {}
      paintAllListRows(syms);

      try{ await window.FVMarkets.warmQuotes(syms, "full"); } catch {}
      paintAllListRows(syms);
      return;
    }

    if (window.FVMarketsQuotes && typeof window.FVMarketsQuotes.warmListRows === "function"){
      try{
        window.FVMarketsQuotes.warmListRows(syms.map(s=>({ symbol:s })), { wideFull:true });
      } catch {}
    }
  }

  // --------------------------------------------------
  // Mobile: auto-scroll to chart panel after selection
  // --------------------------------------------------
  function scrollToChartPanel(){
    if (!isMobile()) return;
    const chart = qs(".fv-mktm-chart");
    if (!chart) return;

    setTimeout(()=>{
      try{
        chart.scrollIntoView({ behavior:"smooth", block:"start" });
      } catch {
        const modal = qs("#" + MODAL_ID);
        if (modal) modal.scrollTop = modal.scrollHeight;
      }
    }, 60);
  }

  // --------------------------------------------------
  // Chart modal (single contract)
  // --------------------------------------------------
  function openChart(symbol){
    openModal();
    setTitle(symbol);

    // Single chart always “fullscreen chart” (there is no list to show)
    setHeadActions("");

    setBody(`
      <div class="fv-mktm-grid fv-mktm-chartonly">
        <div class="fv-mktm-chart">
          <div class="fv-mktm-chart-title" id="fv-mktm-chart-hdr"></div>

          <div class="fv-mktm-sub">
            ${renderTabs(DEFAULT_MODE)}
            <div id="fv-mktm-range"></div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    setChartHeader(symbol);
    wireTabs(()=>symbol);

    loadChart(symbol, DEFAULT_MODE);
  }

  // --------------------------------------------------
  // View more (list + chart)
  // --------------------------------------------------
  function openContractsList(crop){
    openModal();
    setTitle(crop === "corn" ? "Corn contracts" : "Soybean contracts");

    const last = window.FVMarkets?.getLast?.() || {};
    const rawList = crop === "corn" ? (last.corn || []) : (last.soy || []);

    // ✅ Filter like desktop: hide expired + dead/nodata
    const list = filterContracts(rawList);
    const symbols = (list || []).map(x=>x && x.symbol).filter(Boolean);

    const rows = list.map(c => `
      <button class="fv-mktm-row" data-mkt-sym="${c.symbol}">
        <div class="fv-mktm-row-inner">
          <div class="fv-mktm-row-left">
            <div class="fv-mktm-sym">${c.symbol}</div>
            <div class="fv-mktm-label">${c.label || ""}</div>
          </div>
          <div class="fv-mktm-row-right">
            <div class="fv-mktm-price" data-q="price">—</div>
            <div class="fv-mktm-badge flat" data-q="badge">
              <span class="arr" data-q="arr">—</span>
              <span data-q="chg">—</span>
              <span data-q="pct">—</span>
            </div>
          </div>
        </div>
      </button>
    `).join("");

    setBody(`
      <div class="fv-mktm-grid fv-mktm-split">
        <div class="fv-mktm-list" id="fv-mktm-listbox">
          ${rows || `<div class="fv-mktm-empty">No contracts</div>`}
        </div>

        <div class="fv-mktm-chart" id="fv-mktm-chartpanel">
          <div class="fv-mktm-chart-title" id="fv-mktm-chart-hdr">Select a contract</div>

          <div class="fv-mktm-sub">
            ${renderTabs(DEFAULT_MODE)}
            <div id="fv-mktm-range"></div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note">
            Tap a contract on the list to load the chart.
          </div>
        </div>
      </div>
    `);

    // Head actions: “List” button (only useful on mobile after selecting a contract)
    setHeadActions(`
      <button type="button" class="fv-mktm-btn-mini" id="fv-mktm-show-list" style="display:none;">List</button>
    `);

    const listBtn = qs("#fv-mktm-show-list");
    if (listBtn){
      listBtn.addEventListener("click", ()=>{
        // Return to list view
        exitFullChartMode();
        listBtn.style.display = "none";
        setTitle(crop === "corn" ? "Corn contracts" : "Soybean contracts");
      });
    }

    // Warm & paint list rows so we don't show --- on mobile
    warmAndPaintList(symbols).catch(()=>{});

    // Keep your existing helper too (harmless)
    if (window.FVMarketsQuotes){
      try{ window.FVMarketsQuotes.warmListRows(list, { wideFull:true }); } catch {}
    }

    let currentSymbol = null;

    wireTabs(()=>currentSymbol);

    document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll("[data-mkt-sym]").forEach(b=>b.removeAttribute("aria-current"));
        btn.setAttribute("aria-current","true");

        currentSymbol = btn.getAttribute("data-mkt-sym");
        setTitle(currentSymbol);
        setChartHeader(currentSymbol);

        const active = qs(".fv-mktm-tab[aria-selected='true']");
        const mode = active ? (active.getAttribute("data-mode") || DEFAULT_MODE) : DEFAULT_MODE;

        loadChart(currentSymbol, mode);

        // Ensure selected row gets full quote info ASAP
        if (window.FVMarkets && typeof window.FVMarkets.warmQuotes === "function"){
          window.FVMarkets.warmQuotes([currentSymbol], "full")
            .then(()=>{
              const rowEl = document.querySelector(`.fv-mktm-row[data-mkt-sym="${CSS.escape(currentSymbol)}"]`);
              if (rowEl) paintRowQuote(rowEl, currentSymbol);
            })
            .catch(()=>{});
        } else if (window.FVMarketsQuotes){
          try{ window.FVMarketsQuotes.warmAndUpdate([currentSymbol], "full"); } catch {}
        }

        // ✅ Mobile: switch to fullscreen chart view (no scrolling around)
        if (isMobile()){
          enterFullChartMode();
          if (listBtn) listBtn.style.display = "inline-flex";
        }

        scrollToChartPanel();
      });
    });
  }

  // --------------------------------------------------
  // Chart helpers
  // --------------------------------------------------
  function setChartHeader(symbol){
    const hdr = qs("#fv-mktm-chart-hdr");
    if (!hdr) return;

    const last = window.FVMarkets?.getLast?.();
    const all = [].concat(last?.corn || [], last?.soy || []);
    const hit = all.find(x => x.symbol === symbol);
    hdr.textContent = hit ? `${hit.label} — ${symbol}` : symbol;
  }

  function renderTabs(selectedMode){
    const sel = String(selectedMode || DEFAULT_MODE).toLowerCase();
    return `
      <div class="fv-mktm-tabs">
        ${TAB_MODES.map(t => {
          const on = (t.mode === sel);
          return `<button class="fv-mktm-tab" data-mode="${t.mode}" aria-selected="${on ? "true" : "false"}">${t.label}</button>`;
        }).join("")}
      </div>
    `;
  }

  function wireTabs(getSymbol){
    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const mode = (btn.getAttribute("data-mode") || DEFAULT_MODE).toLowerCase();

        document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");

        // ✅ Clear any locked tooltip immediately on tab switch
        try{
          if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
            window.FVMarketsChart.hideTip();
          }
        }catch{}

        const sym = (typeof getSymbol === "function") ? getSymbol() : null;
        if (!sym) return;
        loadChart(sym, mode);

        scrollToChartPanel();
      });
    });
  }

  // Keep last render so we can re-render on rotate/resize without refetch
  let LAST_RENDER = null; // { canvas, rows, opts }

  function rerenderIfOpen(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back || !back.classList.contains("open")) return;
    if (!LAST_RENDER) return;

    const { canvas, rows, opts } = LAST_RENDER;
    if (!canvas || !rows || !rows.length) return;

    try{
      if (window.FVMarketsChart && typeof window.FVMarketsChart.render === "function"){
        window.FVMarketsChart.render(canvas, rows, opts);
      }
    }catch{}
  }

  async function loadChart(symbol, mode){
    const canvas = qs("#fv-mktm-canvas");
    const note = qs("#fv-mktm-note");
    const range = qs("#fv-mktm-range");

    if (!canvas || !window.FVMarketsSeries || !window.FVMarketsChart) return;

    const m = String(mode || DEFAULT_MODE).toLowerCase();

    // ✅ Clear any locked tooltip immediately when loading a new series
    try{
      if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
        window.FVMarketsChart.hideTip();
      }
    }catch{}

    if (note) note.textContent = "Loading…";

    try{
      const raw = await window.FVMarkets.fetchChart(symbol, m);

      const shaped = window.FVMarketsSeries.shape(raw, m, { isLandscape: isLandscape() });

      // Range label (and 1D session label if available)
      if (range){
        const hasSession = (m === "1d") && shaped && shaped.sessionLabel;
        range.textContent = hasSession ? `${shaped.label || ""} • ${shaped.sessionLabel}` : (shaped.label || "");
      }

      if (!shaped.ok){
        window.FVMarketsChart.clear(canvas);
        LAST_RENDER = null;
        if (note) note.textContent = "No chart data at this time";
        return;
      }

      const opts = {
        kind: shaped.kind,
        xLabelFn: shaped.xLabelFn,
        xLabelCount: shaped.xLabelCount,
        timeZone: shaped.timeZone
      };

      window.FVMarketsChart.render(canvas, shaped.rows, opts);

      LAST_RENDER = { canvas, rows: shaped.rows, opts };

      if (note) note.textContent = "";
    } catch {
      window.FVMarketsChart.clear(canvas);
      LAST_RENDER = null;
      if (note) note.textContent = "No chart data at this time";
      if (range) range.textContent = "";
    }
  }

  // --------------------------------------------------
  // Events from markets.js
  // --------------------------------------------------
  function init(){
    ensureModal();

    // Re-render chart on rotate/resize so fullscreen always shows the full plot
    // (No refetch; we just re-render the last shaped rows.)
    window.addEventListener("resize", ()=>{
      // slight delay allows viewport to settle after rotate
      setTimeout(rerenderIfOpen, 120);
    });

    window.addEventListener("orientationchange", ()=>{
      setTimeout(rerenderIfOpen, 180);
    });

    window.addEventListener("fv:markets:contractTap", e=>{
      if (e?.detail?.symbol) openChart(e.detail.symbol);
    });

    window.addEventListener("fv:markets:viewMore", e=>{
      const crop = String(e?.detail?.crop || "").toLowerCase();
      if (crop === "corn" || crop === "soy") openContractsList(crop);
    });
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once:true });
  } else {
    init();
  }

})();
