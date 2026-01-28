// /Farm-vista/js/dash-kpi-wo.js
// Rev: 2026-01-27-dash-kpi-wo-v1
//
// KPI: Work orders needing approval (fieldMaintenance.status == "needs approved").
// Extracted from your dashboard inline script.
// Respects perms hiding: if #wo-approve-kpi is perm-hidden, it will no-op.

(function(){
  "use strict";

  const kpiEl   = document.getElementById("wo-approve-kpi");
  const countEl = document.getElementById("wo-approve-count");
  const subEl   = document.getElementById("wo-approve-sub");

  if (!kpiEl || !countEl || !subEl) return;

  function applyState(count){
    const n = Number(count) || 0;
    countEl.textContent = n.toString();

    if (!n){
      kpiEl.classList.add("dash-kpi-empty");
      subEl.textContent = "All caught up — no approvals needed.";
    }else{
      kpiEl.classList.remove("dash-kpi-empty");
      subEl.textContent = n === 1
        ? "work order waiting for your approval."
        : "work orders waiting for your approval.";
    }
  }

  function isHidden(){
    return kpiEl.classList.contains("perm-hidden") || kpiEl.getAttribute("aria-hidden") === "true";
  }

  async function loadPending(){
    try{
      if (isHidden()) return;

      if (!window.FVData || typeof FVData.getWhere !== "function"){
        console.warn("[dash-kpi-wo] FVData.getWhere not available for KPI.");
        applyState(0);
        return;
      }

      await FVData.ready();

      const docs = await FVData.getWhere(
        "fieldMaintenance",
        "status",
        "==",
        "needs approved",
        { limit: 500 }
      ) || [];

      applyState(docs.length);
    }catch(err){
      console.warn("[dash-kpi-wo] failed to load work-order approvals:", err);
      applyState(0);
    }
  }

  loadPending();
  document.addEventListener("fv:dash-perms-ready", loadPending);
  document.addEventListener("visibilitychange", ()=>{
    if (document.visibilityState === "visible") loadPending();
  });

})();