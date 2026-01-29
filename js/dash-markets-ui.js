/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-29d
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

Landscape-only mobile improvement:
✅ Mobile landscape modal is TRUE fullscreen (covers header/footer)
✅ Canvas auto-fits the screen in landscape fullscreen
✅ DOES NOT affect desktop or mobile portrait

PWA FIX:
✅ "Mobile" detection no longer flips false in iOS PWA landscape (width can exceed 899px)

ROOT FIX:
✅ Disable FV Shell PTR while modal is open by toggling body class:
   document.body.classList.add/remove('fv-modal-open')
   (fv-shell.js PTR must respect this flag)

Tap / details (landscape):
✅ Touch bridge bound to the chart canvas in landscape fullscreen
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  const LANDSCAPE_CLASS = "fv-mkt-landscape-full";
  const LANDSCAPE_STYLE_ID = "fv-mkt-landscape-full-style";

  // Yahoo-style tab order
  const TAB_MODES = [
    { mode: "1d", label: "1D" },
    { mode: "5d", label: "5D" },
    { mode: "1m", label: "1M" },
    { mode: "6m", label: "6M" },
    { mode: "1y", label: "1Y" }
  ];

  const DEFAULT_MODE = "1d";

  const LAST_RENDER = {
    symbol: null,
    mode: null,
    rows: null,
    opts: null
  };

  function qs(sel, root=document){ return root.querySelector(sel); }

  // PWA-safe mobile detection
  function isMobile(){
    try{
      if (window.matchMedia){
        if (window.matchMedia("(pointer: coarse)").matches) return true;
        return window.matchMedia("(max-width: 899px)").matches;
      }
    }catch{}
    return false;
  }

  function isLandscape(){
    try{
      if (window.matchMedia && window.matchMedia("(orientation: landscape)").matches) return true;
    }catch{}
    try{
      return (window.innerWidth || 0) > (window.innerHeight || 0);
    }catch{
      return false;
    }
  }

  // --------------------------------------------------
  // Body flag so fv-shell PTR can disable itself
  // --------------------------------------------------
  function markModalOpen(on){
    try{
      if (!document.body) return;
      document.body.classList.toggle("fv-modal-open", !!on);
    }catch{}
  }

  // --------------------------------------------------
  // iOS PWA LANDSCAPE: Touch bridge for chart canvas
  // (Only active in mobile landscape fullscreen)
  // --------------------------------------------------
  let _fvMktTouchBridgeOn = false;

  function _fvMktIsLandscapeFullscreenActive(){
    const back = document.getElementById(BACKDROP_ID);
    return !!(back && back.classList.contains("open") && back.classList.contains(LANDSCAPE_CLASS));
  }

  function _fvMktBindTouchBridge(canvas){
    if (!canvas) return;

    if (canvas._fvTouchBridgeBound) return;
    canvas._fvTouchBridgeBound = true;

    function shouldBridge(){
      return _fvMktIsLandscapeFullscreenActive() && isMobile() && isLandscape();
    }

    function pointFromTouch(ev){
      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return null;
      const r = canvas.getBoundingClientRect();
      return {
        clientX: t.clientX,
        clientY: t.clientY,
        offsetX: t.clientX - r.left,
        offsetY: t.clientY - r.top
      };
    }

    function defineOffsets(e, p){
      try{
        Object.defineProperty(e, "offsetX", { value: p.offsetX });
        Object.defineProperty(e, "offsetY", { value: p.offsetY });
      }catch{}
    }

    function dispatchMouse(type, p, target){
      try{
        const e = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: p.clientX,
          clientY: p.clientY,
          buttons: (type === "mousedown" ? 1 : 0)
        });
        defineOffsets(e, p);
        target.dispatchEvent(e);
      }catch{}
    }

    canvas.addEventListener("touchstart", (ev)=>{
      if (!shouldBridge()) return;
      const p = pointFromTouch(ev);
      if (!p) return;
      _fvMktTouchBridgeOn = true;
      ev.preventDefault();
      dispatchMouse("mousemove", p, canvas);
    }, { passive:false });

    canvas.addEventListener("touchmove", (ev)=>{
      if (!shouldBridge() || !_fvMktTouchBridgeOn) return;
      const p = pointFromTouch(ev);
      if (!p) return;
      ev.preventDefault();
      dispatchMouse("mousemove", p, canvas);
    }, { passive:false });

    canvas.addEventListener("touchend", (ev)=>{
      if (!shouldBridge()) return;
      const p = pointFromTouch(ev);
      if (!p) return;
      ev.preventDefault();
      dispatchMouse("mousemove", p, canvas);
      dispatchMouse("mousedown", p, canvas);
      dispatchMouse("click", p, canvas);
      _fvMktTouchBridgeOn = false;
    }, { passive:false });

    canvas.addEventListener("touchcancel", ()=>{
      _fvMktTouchBridgeOn = false;
    }, { passive:true });
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
  // Contract filtering
  // --------------------------------------------------
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
    }catch{
      return null;
    }
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

    return d >= 21;
  }

  function isSymbolUsable(symbol){
    try{
      if (window.FVMarkets && typeof window.FVMarkets.isSymbolUsable === "function"){
        return !!window.FVMarkets.isSymbolUsable(symbol);
      }
    }catch{}
    return true;
  }

  function filterContracts(list){
    const out = [];
    for (const c of (list || [])){
      const sym = c?.symbol;
      if (!sym) continue;
      if (isExpiredContract(sym)) continue;
      if (!isSymbolUsable(sym)) continue;
      out.push(c);
    }
    return out;
  }

  // --------------------------------------------------
  // Landscape-only fullscreen + auto-fit canvas
  // --------------------------------------------------
  function ensureLandscapeStyle(){
    if (document.getElementById(LANDSCAPE_STYLE_ID)) return;

    const st = document.createElement("style");
    st.id = LANDSCAPE_STYLE_ID;
    st.textContent = `
      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS}{
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100dvh !important;
        z-index: 2147483000 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        display: block !important;
        background: rgba(0,0,0,0.35);
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID}{
        position: absolute !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        border-radius: 0 !important;
        margin: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-head{
        flex: 0 0 auto !important;
        position: relative !important;
        z-index: 5 !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} #fv-mktm-body{
        flex: 1 1 auto !important;
        overflow: hidden !important;
        min-height: 0 !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-grid{
        height: 100% !important;
        min-height: 0 !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-chart{
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-canvas{
        display: block !important;
        width: 100% !important;
        position: relative !important;
        z-index: 50 !important;
        pointer-events: auto !important;
        touch-action: manipulation !important;
      }

      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-split{
        grid-template-columns: 1fr !important;
      }
      #${BACKDROP_ID}.open.${LANDSCAPE_CLASS} #${MODAL_ID} .fv-mktm-list{
        display: none !important;
      }
    `;
    document.head.appendChild(st);
  }

  function shouldGoLandscapeFullscreen(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return false;
    if (!back.classList.contains("open")) return false;
    if (!isMobile()) return false;
    if (!isLandscape()) return false;
    return true;
  }

  function isLandscapeFullscreenActive(){
    const back = document.getElementById(BACKDROP_ID);
    return !!(back && back.classList.contains("open") && back.classList.contains(LANDSCAPE_CLASS));
  }

  function fitCanvasToPanel(){
    if (!isLandscapeFullscreenActive()) return;

    const chart = qs(".fv-mktm-chart");
    const canvas = qs("#fv-mktm-canvas");
    if (!chart || !canvas) return;

    const title = qs("#fv-mktm-chart-hdr");
    const sub = chart.querySelector(".fv-mktm-sub");
    const note = qs("#fv-mktm-note");

    const chartH = chart.clientHeight || 0;
    const used =
      (title ? title.offsetHeight : 0) +
      (sub ? sub.offsetHeight : 0) +
      (note ? note.offsetHeight : 0);

    const pad = 16;
    let avail = chartH - used - pad;
    if (!isFinite(avail) || avail < 120) avail = 120;

    canvas.style.height = `${Math.floor(avail)}px`;
    canvas.style.width = "100%";

    try{
      if (LAST_RENDER.rows && LAST_RENDER.opts && window.FVMarketsChart && typeof window.FVMarketsChart.render === "function"){
        window.FVMarketsChart.render(canvas, LAST_RENDER.rows, LAST_RENDER.opts);
      }
    }catch{}
  }

  function updateLandscapeFullscreen(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;

    if (shouldGoLandscapeFullscreen()){
      back.classList.add(LANDSCAPE_CLASS);
      setTimeout(()=>{ fitCanvasToPanel(); }, 120);
      setTimeout(()=>{ fitCanvasToPanel(); }, 260);
    } else {
      back.classList.remove(LANDSCAPE_CLASS);
      const canvas = qs("#fv-mktm-canvas");
      if (canvas){
        canvas.style.height = "";
        canvas.style.width = "";
      }
    }
  }

  // --------------------------------------------------
  // Modal shell
  // --------------------------------------------------
  function ensureModal(){
    let back = document.getElementById(BACKDROP_ID);
    if (back) return back;

    back = document.createElement("div");
    back.id = BACKDROP_ID;
    back.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true">
        <div class="fv-mktm-head" style="position:relative;">
          <h2 class="fv-mktm-title" id="fv-mktm-title">Markets</h2>

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

    ensureLandscapeStyle();

    // ✅ Touch-close too (avoid relying on click synthesis)
    back.addEventListener("touchstart", (e)=>{
      if (e.target === back) closeModal();
    }, { passive:true });

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
    ensureModal().classList.add("open");
    markModalOpen(true);
    document.body.style.overflow = "hidden";
    updateLandscapeFullscreen();
  }

  function closeModal(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("open");
    back.classList.remove(LANDSCAPE_CLASS);
    document.body.style.overflow = "";
    markModalOpen(false);

    try{
      if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
        window.FVMarketsChart.hideTip();
      }
    }catch{}

    LAST_RENDER.symbol = null;
    LAST_RENDER.mode = null;
    LAST_RENDER.rows = null;
    LAST_RENDER.opts = null;
  }

  function setTitle(t){
    const el = qs("#fv-mktm-title");
    if (el) el.textContent = t || "Markets";
  }

  function setBody(html){
    const el = qs("#fv-mktm-body");
    if (el) el.innerHTML = html || "";
    updateLandscapeFullscreen();
    setTimeout(fitCanvasToPanel, 60);
  }

  // --------------------------------------------------
  // Quote painting
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
  // Mobile: auto-scroll
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

    _fvMktBindTouchBridge(qs("#fv-mktm-canvas"));

    setChartHeader(symbol);
    wireTabs(()=>symbol);

    fitCanvasToPanel();
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
            Tap a contract on the left to load the chart.
          </div>
        </div>
      </div>
    `);

    _fvMktBindTouchBridge(qs("#fv-mktm-canvas"));

    warmAndPaintList(symbols).catch(()=>{});

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

        fitCanvasToPanel();
        loadChart(currentSymbol, mode);

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

        try{
          if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
            window.FVMarketsChart.hideTip();
          }
        }catch{}

        const sym = (typeof getSymbol === "function") ? getSymbol() : null;
        if (!sym) return;

        fitCanvasToPanel();
        loadChart(sym, mode);

        scrollToChartPanel();
      });
    });
  }

  async function loadChart(symbol, mode){
    const canvas = qs("#fv-mktm-canvas");
    const note = qs("#fv-mktm-note");
    const range = qs("#fv-mktm-range");

    if (!canvas || !window.FVMarketsSeries || !window.FVMarketsChart) return;

    _fvMktBindTouchBridge(canvas);

    const m = String(mode || DEFAULT_MODE).toLowerCase();

    try{
      if (window.FVMarketsChart && typeof window.FVMarketsChart.hideTip === "function"){
        window.FVMarketsChart.hideTip();
      }
    }catch{}

    if (note) note.textContent = "Loading…";

    try{
      const raw = await window.FVMarkets.fetchChart(symbol, m);
      const shaped = window.FVMarketsSeries.shape(raw, m);

      if (range) range.textContent = shaped.label || "";

      if (!shaped.ok){
        window.FVMarketsChart.clear(canvas);
        if (note) note.textContent = "No chart data at this time";
        LAST_RENDER.symbol = symbol;
        LAST_RENDER.mode = m;
        LAST_RENDER.rows = null;
        LAST_RENDER.opts = null;
        return;
      }

      fitCanvasToPanel();

      const opts = {
        kind: shaped.kind,
        xLabelFn: shaped.xLabelFn,
        xLabelCount: shaped.xLabelCount,
        timeZone: shaped.timeZone
      };

      window.FVMarketsChart.render(canvas, shaped.rows, opts);

      LAST_RENDER.symbol = symbol;
      LAST_RENDER.mode = m;
      LAST_RENDER.rows = shaped.rows;
      LAST_RENDER.opts = opts;

      if (note) note.textContent = "";

      setTimeout(fitCanvasToPanel, 80);
    } catch {
      window.FVMarketsChart.clear(canvas);
      if (note) note.textContent = "No chart data at this time";
      if (range) range.textContent = "";
      LAST_RENDER.symbol = symbol;
      LAST_RENDER.mode = m;
      LAST_RENDER.rows = null;
      LAST_RENDER.opts = null;
    }
  }

  // --------------------------------------------------
  // Events from markets.js
  // --------------------------------------------------
  function init(){
    ensureModal();

    window.addEventListener("orientationchange", ()=>{
      setTimeout(()=>{ updateLandscapeFullscreen(); fitCanvasToPanel(); }, 180);
    });

    window.addEventListener("resize", ()=>{
      updateLandscapeFullscreen();
      setTimeout(fitCanvasToPanel, 60);
    });

    if (window.visualViewport){
      try{
        window.visualViewport.addEventListener("resize", ()=>{
          updateLandscapeFullscreen();
          setTimeout(fitCanvasToPanel, 60);
        });
      }catch{}
    }

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