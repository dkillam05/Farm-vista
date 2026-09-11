// /js/dash-kpi-dynamic.js
// FarmVista Dashboard — Dynamic Needs Attention + desktop split scrolling
// Rev: 2026-09-11-v2

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
 * Desktop dashboard scrolling now follows the same pattern as the
 * grain-ticket detail page: the main/left column stays in the normal
 * document flow, while the right column stays beside it and gets its
 * own scroll area only when its content is taller than the viewport.
 */
(function(){
  "use strict";

  const style = document.createElement("style");
  style.id = "fv-dashboard-split-scroll-style";
  style.textContent = `
    @media (min-width:900px){
      .desktop-right{
        position:sticky;
        top:calc(var(--hdr-h,56px) + 12px);
        align-self:start;
        max-height:calc(100dvh - var(--hdr-h,56px) - var(--ftr-h,42px) - 24px);
        overflow-y:auto;
        overflow-x:hidden;
        overscroll-behavior:contain;
        scrollbar-width:none;
        -ms-overflow-style:none;
        padding-bottom:2px;
      }

      .desktop-right::-webkit-scrollbar{
        width:0;
        height:0;
        display:none;
      }
    }
  `;

  document.head.appendChild(style);
})();
