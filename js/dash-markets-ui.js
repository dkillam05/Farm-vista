/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28j
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

  function ensureModal(){
    let back = document.getElementById(BACKDROP_ID);
    if (back) return back;

    back = document.createElement("div");
    back.id = BACKDROP_ID;
    back.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true">
        <div class="fv-mktm-head">
          <h2 class="fv-mktm-title" id="fv-mktm-title">Markets</h2>
          <button class="fv-mktm-btn" id="fv-mktm-close">Close</button>
        </div>
        <div id="fv-mktm-body"></div>
      </div>
    `;
    document.body.appendChild(back);

    back.addEventListener("click", e=>{
      if (e.target === back) closeModal();
    });
    qs("#fv-mktm-close", back).addEventListener("click", closeModal);

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

    // If we don't have change/% yet, keep placeholders but still show price.
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

    // Paint anything already cached immediately
    paintAllListRows(syms);

    // If we have FVMarkets.warmQuotes, use it directly (fast + reliable)
    if (window.FVMarkets && typeof window.FVMarkets.warmQuotes === "function"){
      // 1) Lite warm first (gets price quickly)
      try{
        await window.FVMarkets.warmQuotes(syms, "lite");
      } catch {}
      paintAllListRows(syms);

      // 2) Full warm (fills change/%)
      try{
        await window.FVMarkets.warmQuotes(syms, "full");
      } catch {}
      paintAllListRows(syms);
      return;
    }

    // Fallback: try the quotes helper if present
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

    // Let layout settle (especially after innerHTML updates)
    setTimeout(()=>{
      try{
        chart.scrollIntoView({ behavior:"smooth", block:"start" });
      } catch {
        // fallback: manual scroll inside modal
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
    const list = crop === "corn" ? (last.corn || []) : (last.soy || []);
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
        <div class="fv-mktm-list">
          ${rows || `<div class="fv-mktm-empty">No contracts</div>`}
        </div>

        <div class="fv-mktm-chart">
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

    // ✅ Mobile + desktop: warm & paint list rows so we don't show ---
    warmAndPaintList(symbols).catch(()=>{});

    // warm quote badges (keep your existing helper too; harmless)
    if (window.FVMarketsQuotes){
      try{ window.FVMarketsQuotes.warmListRows(list, { wideFull:true }); } catch {}
    }

    let currentSymbol = null;

    // Tabs should drive whatever is currently selected (or do nothing until selected)
    wireTabs(()=>currentSymbol);

    document.querySelectorAll("[data-mkt-sym]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll("[data-mkt-sym]").forEach(b=>b.removeAttribute("aria-current"));
        btn.setAttribute("aria-current","true");

        currentSymbol = btn.getAttribute("data-mkt-sym");
        setTitle(currentSymbol);
        setChartHeader(currentSymbol);

        // Load using currently selected tab; default to 1D
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

        // ✅ Mobile: jump user to the chart after selection
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

        const sym = (typeof getSymbol === "function") ? getSymbol() : null;
        if (!sym) return; // in list mode, don’t auto-load until selection
        loadChart(sym, mode);

        // On mobile, if user already selected a contract and taps a tab, keep them at chart
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
    if (note) note.textContent = "Loading…";

    try{
      // IMPORTANT: Cloud Run now should accept mode=1d|5d|1m|6m|1y
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
