/* =====================================================================
/Farm-vista/js/dash-markets-ui.js  (FULL FILE)
Rev: 2026-01-28h
Purpose:
✅ Thin UI orchestrator for Markets
   - Opens/closes modal
   - Handles contract taps
   - Handles "View more"
   - Wires chart tabs
Delegates:
   - Chart rendering → FVMarketsChart
   - Series shaping → FVMarketsSeries
   - Quote badges → FVMarketsQuotes
===================================================================== */

(function(){
  "use strict";

  const MODAL_ID = "fv-mkt-modal";
  const BACKDROP_ID = "fv-mkt-backdrop";

  function qs(sel, root=document){ return root.querySelector(sel); }

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
            ${renderTabs()}
            <div id="fv-mktm-range"></div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note"></div>
        </div>
      </div>
    `);

    setChartHeader(symbol);
    wireTabs(symbol);

    loadChart(symbol, "daily");
  }

  // --------------------------------------------------
  // View more (list + chart)
  // --------------------------------------------------
  function openContractsList(crop){
    openModal();
    setTitle(crop === "corn" ? "Corn contracts" : "Soybean contracts");

    const last = window.FVMarkets?.getLast?.() || {};
    const list = crop === "corn" ? (last.corn || []) : (last.soy || []);

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
            ${renderTabs()}
            <div id="fv-mktm-range"></div>
          </div>

          <canvas class="fv-mktm-canvas" id="fv-mktm-canvas"></canvas>
          <div class="fv-mktm-sub" id="fv-mktm-note">
            Tap a contract on the left to load the chart.
          </div>
        </div>
      </div>
    `);

    // warm quote badges
    if (window.FVMarketsQuotes){
      window.FVMarketsQuotes.warmListRows(list, { wideFull:true });
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
        loadChart(currentSymbol, "daily");

        if (window.FVMarketsQuotes){
          window.FVMarketsQuotes.warmAndUpdate([currentSymbol], "full");
        }
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

  function renderTabs(){
    return `
      <div class="fv-mktm-tabs">
        <button class="fv-mktm-tab" data-mode="daily" aria-selected="true">Daily</button>
        <button class="fv-mktm-tab" data-mode="weekly">Weekly</button>
        <button class="fv-mktm-tab" data-mode="monthly">Monthly</button>
        <button class="fv-mktm-tab" data-mode="6mo">6mo</button>
        <button class="fv-mktm-tab" data-mode="1y">1Y</button>
      </div>
    `;
  }

  function wireTabs(symbolOrFn){
    document.querySelectorAll(".fv-mktm-tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const mode = btn.getAttribute("data-mode");
        document.querySelectorAll(".fv-mktm-tab").forEach(b=>b.setAttribute("aria-selected","false"));
        btn.setAttribute("aria-selected","true");

        const sym = (typeof symbolOrFn === "function") ? symbolOrFn() : symbolOrFn;
        if (!sym) return;
        loadChart(sym, mode);
      });
    });
  }

  async function loadChart(symbol, mode){
    const canvas = qs("#fv-mktm-canvas");
    const note = qs("#fv-mktm-note");
    const range = qs("#fv-mktm-range");

    if (!canvas || !window.FVMarketsSeries || !window.FVMarketsChart) return;

    note.textContent = "Loading…";

    try{
      const raw = await window.FVMarkets.fetchChart(symbol, mode);
      const shaped = window.FVMarketsSeries.shape(raw, mode);

      range.textContent = shaped.label || "";

      if (!shaped.ok){
        window.FVMarketsChart.clear(canvas);
        note.textContent = "No chart data at this time";
        return;
      }

      window.FVMarketsChart.render(canvas, shaped.rows, {
        kind: shaped.kind,
        xLabelFn: shaped.xLabelFn,
        xLabelCount: shaped.xLabelCount,
        timeZone: shaped.timeZone
      });

      note.textContent = "";
    } catch {
      window.FVMarketsChart.clear(canvas);
      note.textContent = "No chart data at this time";
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
