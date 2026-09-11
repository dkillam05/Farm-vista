// /js/dash-kpi-dynamic.js
// FarmVista Dashboard — Dynamic Needs Attention + desktop split scrolling
// Rev: 2026-09-11-v3

(function(){
  "use strict";

  const KPI_CONFIG = [
    { cardId: "wo-approve-kpi", countId: "wo-approve-count" },
    { cardId: "boundary-kpi", countId: "boundary-kpi-count" },
    { cardId: "bag-kpi", countId: "bag-kpi-count" }
  ];

  const section = document.getElementById("attention-section");
  if (!section) return;

  function readCount(el){
    if (!el) return null;
    const raw = String(el.textContent || "").replace(/,/g, "").trim();
    if (!raw || raw === "–" || raw === "-") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function permissionAllows(card){
    if (!card) return false;
    return !(
      card.hidden ||
      card.classList.contains("perm-hidden") ||
      card.getAttribute("aria-hidden") === "true"
    );
  }

  function sync(){
    let hasVisibleAttention = false;

    KPI_CONFIG.forEach(({cardId, countId}) => {
      const card = document.getElementById(cardId);
      const countEl = document.getElementById(countId);
      if (!card || !countEl) return;

      const count = readCount(countEl);
      const hasItems = count !== null && count > 0;

      card.style.display = hasItems ? "" : "none";
      card.dataset.attentionActive = hasItems ? "true" : "false";

      if (hasItems && permissionAllows(card)){
        hasVisibleAttention = true;
      }
    });

    if (hasVisibleAttention){
      section.style.display = "";
      section.hidden = false;
      section.classList.remove("perm-hidden");
      section.removeAttribute("aria-hidden");
    }else{
      section.style.display = "none";
      section.hidden = true;
      section.setAttribute("aria-hidden", "true");
    }
  }

  KPI_CONFIG.forEach(({cardId, countId}) => {
    const card = document.getElementById(cardId);
    const countEl = document.getElementById(countId);

    if (countEl){
      new MutationObserver(sync).observe(countEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    if (card){
      new MutationObserver(sync).observe(card, {
        attributes: true,
        attributeFilter: ["class", "hidden", "aria-hidden"]
      });
    }
  });

  sync();
  document.addEventListener("fv:dash-perms-ready", sync);
  document.addEventListener("fv:user-ready", sync);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden){
      setTimeout(sync, 0);
      setTimeout(sync, 250);
    }
  });
  window.addEventListener("focus", () => {
    setTimeout(sync, 0);
    setTimeout(sync, 250);
  });
})();

/*
 * Desktop dashboard behaves like a fixed two-pane workspace:
 * - the browser page itself does not scroll
 * - left and right dashboard columns scroll independently
 * - column scrollbars are hidden, but mouse wheel/trackpad still work
 * - excess bottom page padding is removed so more dashboard is visible
 *
 * Mobile/tablet keep the normal document scrolling behavior.
 */
(function(){
  "use strict";

  const style = document.createElement("style");
  style.id = "fv-dashboard-split-scroll-style";
  style.textContent = `
    @media (min-width:900px){
      html,
      body{
        height:100%;
        overflow:hidden!important;
      }

      body > fv-shell,
      body > farm-vista-shell{
        height:100dvh;
        overflow:hidden;
      }

      .page{
        padding-bottom:10px!important;
      }

      .desktop-dashboard{
        height:var(--fv-dashboard-scroll-height, calc(100dvh - 150px));
        min-height:0;
        align-items:stretch;
        overflow:hidden;
      }

      .desktop-left,
      .desktop-right{
        height:100%;
        min-height:0;
        overflow-y:auto;
        overflow-x:hidden;
        overscroll-behavior:contain;
        scrollbar-width:none;
        -ms-overflow-style:none;
        align-content:start;
        padding-bottom:4px;
      }

      .desktop-right{
        position:relative;
        top:auto;
        align-self:stretch;
        max-height:none;
      }

      .desktop-left::-webkit-scrollbar,
      .desktop-right::-webkit-scrollbar{
        width:0;
        height:0;
        display:none;
      }

      .desktop-dashboard.dashboard-single-column{
        overflow:hidden;
      }
    }
  `;

  document.head.appendChild(style);

  function sizeDesktopColumns(){
    if (!window.matchMedia("(min-width:900px)").matches){
      document.documentElement.style.removeProperty("--fv-dashboard-scroll-height");
      return;
    }

    const dashboard = document.querySelector(".desktop-dashboard");
    if (!dashboard) return;

    const rect = dashboard.getBoundingClientRect();
    const footerAllowance = 18;
    const bottomGap = 6;
    const available = Math.max(
      220,
      Math.floor(window.innerHeight - rect.top - footerAllowance - bottomGap)
    );

    document.documentElement.style.setProperty(
      "--fv-dashboard-scroll-height",
      `${available}px`
    );
  }

  sizeDesktopColumns();
  requestAnimationFrame(sizeDesktopColumns);
  setTimeout(sizeDesktopColumns, 100);
  setTimeout(sizeDesktopColumns, 400);

  window.addEventListener("resize", sizeDesktopColumns, { passive:true });
  window.addEventListener("orientationchange", sizeDesktopColumns, { passive:true });
  document.addEventListener("fv:user-ready", sizeDesktopColumns);
  document.addEventListener("fv:dash-perms-ready", sizeDesktopColumns);
})();
