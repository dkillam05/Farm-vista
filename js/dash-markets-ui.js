/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28k
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

Mobile fixes in this rev:
✅ View-more list shows quotes immediately (no more --- until tap)
   - Warm quotes on open (lite -> paint -> full -> paint)
   - Paint rows from FVMarkets.getQuote() so it works even if FVMarketsQuotes is slow
✅ Auto-scroll to chart after selecting a contract (mobile only)
   - Smooth scroll to chart panel so user sees the chart instantly

NEW fixes in this rev:
✅ View-more list filters like desktop:
   - Hides expired contracts (practical rule: same month + day>=21)
   - Hides dead/no-data contracts when FVMarkets.isSymbolUsable() is available
✅ Adds an “X” close button in the top-right (in addition to Close)
✅ When switching charts/tabs, clears any locked tooltip immediately
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

          <!-- X close (top-right) -->
          <button type="button"
                  class="fv-mktm-btn"
                  id="fv-mktm-close-x"
                  aria-label="Close"
                  style="position:absolute; right:0; top:0; width:30px; height:30px; padding:0; border-radius:999px; display:flex; align-items:center; justify-content:center;">
            ×
          </button>

          <button class="fv-mktm-btn" id="fv-mktm-close">Close</button>
        </div>
        <div id="fv-mktm-body"></div>
      </div>
    `;
    document.body.appendChild(back);

    back.addEventListener("click", e=>{
      if (e.target === back) closeModal();
    });

    const closeBtn = qs("#fv-mktm-close", back);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const closeX = qs("#fv-mktm-close-x", back);
    if (closeX) closeX.addEventListener("click", closeModal);

    document.addEventListener("keydown", e=>{
      if (e.key === "Escape") closeModal();
    });

    return back;
  }

  function openModal(){
    ensureModal().classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    const back = document.getElementById(BACKDROP_ID);
    if (!back) return;
    back.classList.remove("open");
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
            Tap a contract on the left to load the chart.
          </div>
        </div>
      </div>
    `);

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
      const shaped = window.FVMarketsSeries.shape(raw, m);

      if (range) range.textContent = shaped.label || "";

      if (!shaped.ok){
        window.FVMarketsChart.clear(canvas);
        if (note) note.textContent = "No chart data at this time";
        return;
      }

      window.FVMarketsChart.render(canvas, shaped.rows, {
        kind: shaped.kind,
        xLabelFn: shaped.xLabelFn,
        xLabelCount: shaped.xLabelCount,
        timeZone: shaped.timeZone
      });

      if (note) note.textContent = "";
    } catch {
      window.FVMarketsChart.clear(canvas);
      if (note) note.textContent = "No chart data at this time";
      if (range) range.textContent = "";
    }
  }

  // --------------------------------------------------
  // Events from markets.js
  // --------------------------------------------------
  function init(){
    ensureModal();

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
