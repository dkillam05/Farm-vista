/* =====================================================================
/Farm-vista/js/dash-markets-quotes.js  (FULL FILE)
Rev: 2026-01-28a
Purpose:
✅ Quote badge + row-updater helper for FarmVista Markets UI (standalone)
✅ Handles:
   - Formatting price / $chg / %chg
   - Direction (up/down/flat) + arrow
   - Updating DOM rows (main list + view-more list)
   - Warming quotes via FVMarkets.warmQuotes(symbols, level)
   - Safe CSS.escape fallback for older browsers
✅ Safe global API:
   window.FVMarketsQuotes = {
     updateRow(sym),
     warmAndUpdate(symbols, level),
     warmListRows(list, {wideFull:true/false})
   }
Requirements:
   - window.FVMarkets.getQuote(symbol)
   - window.FVMarkets.warmQuotes(symbols, level)
===================================================================== */

(function(){
  "use strict";

  const API = {};
  window.FVMarketsQuotes = API;

  const UP = "#2F6C3C";
  const DOWN = "#b42318";

  // CSS.escape fallback
  const cssEscape = (function(){
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape.bind(window.CSS);
    return function(s){
      // Minimal escape: good enough for symbols like ZCH26.CBT
      return String(s || "").replace(/["\\#.;?%&,[\]()=:+*~'!^$|\/@{}<>]/g, "\\$&");
    };
  })();

  function toNum(x){
    if (typeof x === "number" && isFinite(x)) return x;
    if (typeof x === "string"){
      const v = parseFloat(x);
      return isFinite(v) ? v : null;
    }
    return null;
  }

  function fmtPrice(v){ return (typeof v === "number" && isFinite(v)) ? v.toFixed(2) : "—"; }
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

  function renderBadge(q){
    const price = q ? q.price : null;
    const chg = q ? q.chg : null;
    const pct = q ? q.pct : null;

    const hasChange = (typeof chg === "number" && isFinite(chg)) && (typeof pct === "number" && isFinite(pct));
    const dir = hasChange ? dirFrom(chg) : "flat";
    const arr = hasChange ? arrowFor(dir) : "—";

    return {
      priceTxt: fmtPrice(price),
      chgTxt: hasChange ? fmtSigned(chg) : "—",
      pctTxt: hasChange ? fmtPct(pct) : "—",
      dir,
      arr,
      hasChange
    };
  }

  // Update a row in DOM if present:
  // expects markup:
  //   .fv-mktm-row[data-mkt-sym="SYM"]
  //     [data-q="price"]
  //     [data-q="badge"]  (has .up/.down/.flat classes)
  //       [data-q="arr"] [data-q="chg"] [data-q="pct"]
  API.updateRow = function(sym){
    try{
      const row = document.querySelector(`.fv-mktm-row[data-mkt-sym="${cssEscape(sym)}"]`);
      if (!row) return;

      const q = (window.FVMarkets && typeof window.FVMarkets.getQuote === "function") ? window.FVMarkets.getQuote(sym) : null;
      const b = renderBadge(q);

      const priceEl = row.querySelector('[data-q="price"]');
      const badgeEl = row.querySelector('[data-q="badge"]');
      const arrEl = row.querySelector('[data-q="arr"]');
      const chgEl = row.querySelector('[data-q="chg"]');
      const pctEl = row.querySelector('[data-q="pct"]');

      if (priceEl) priceEl.textContent = b.priceTxt;

      if (badgeEl){
        badgeEl.classList.remove("up","down","flat");
        badgeEl.classList.add(b.dir);
        // Optional: give it a slightly stronger tint based on direction using inline style (only if you want)
        // Leaving as CSS-driven keeps it consistent.
      }
      if (arrEl) arrEl.textContent = b.arr;
      if (chgEl) chgEl.textContent = b.chgTxt;
      if (pctEl) pctEl.textContent = b.pctTxt;
    } catch {}
  };

  API.warmAndUpdate = async function(symbols, level){
    const syms = Array.from(new Set((symbols || []).filter(Boolean)));
    if (!syms.length) return;

    // first paint from cache
    for (const s of syms) API.updateRow(s);

    if (!window.FVMarkets || typeof window.FVMarkets.warmQuotes !== "function") return;

    try{
      await window.FVMarkets.warmQuotes(syms, level || "lite");
    } catch {}

    for (const s of syms) API.updateRow(s);
  };

  // For view-more lists: warm lite first, then (optionally) full on wide screens
  // list: array of {symbol,...}
  API.warmListRows = function(list, opts){
    const o = opts || {};
    const syms = Array.from(new Set((list || []).map(x => x && x.symbol).filter(Boolean)));
    if (!syms.length) return;

    API.warmAndUpdate(syms, "lite").then(()=>{
      if (o.wideFull && window.matchMedia && window.matchMedia("(min-width: 900px)").matches){
        API.warmAndUpdate(syms, "full").catch(()=>{});
      }
    }).catch(()=>{});
  };

})();
