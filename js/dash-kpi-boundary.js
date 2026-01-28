// /Farm-vista/js/dash-kpi-boundary.js
// Rev: 2026-01-27-dash-kpi-boundary-v1
//
// KPI: Field boundary fixes needed
// Reads Firestore collection: boundary_requests
// Counts docs where status normalizes to "open".
// Extracted from your dashboard inline script.
// Respects perms hiding: if #boundary-kpi is perm-hidden, it will no-op.

import { ready, getFirestore, collection, getDocs } from '/Farm-vista/js/firebase-init.js';

(async function(){
  "use strict";

  const kpiEl   = document.getElementById("boundary-kpi");
  const countEl = document.getElementById("boundary-kpi-count");
  const subEl   = document.getElementById("boundary-kpi-sub");

  if (!kpiEl || !countEl || !subEl) return;

  function applyState(count){
    const n = Number(count) || 0;
    countEl.textContent = n.toString();

    if (!n){
      kpiEl.classList.add("dash-kpi-empty");
      subEl.textContent = "No field boundary fixes pending.";
    }else{
      kpiEl.classList.remove("dash-kpi-empty");
      subEl.textContent = n === 1
        ? "boundary fix request awaiting review."
        : "boundary fix requests awaiting review.";
    }
  }

  function isHidden(){
    return kpiEl.classList.contains("perm-hidden") || kpiEl.getAttribute("aria-hidden") === "true";
  }

  async function loadBoundaryRequests(){
    try{
      if (isHidden()) return;

      await ready;
      const db = getFirestore();
      const colRef = collection(db, "boundary_requests");
      const snap = await getDocs(colRef);

      let openCount = 0;

      snap.forEach(docSnap => {
        const d = docSnap.data() || {};
        const raw = (d.status || "").toString().trim();
        const normalized = raw.replace(/\.+$/,"").toLowerCase();
        if (normalized === "open") openCount += 1;
      });

      applyState(openCount);
    }catch(err){
      console.warn("[dash-kpi-boundary] failed to load boundary KPI:", err);
      applyState(0);
    }
  }

  await loadBoundaryRequests();
  document.addEventListener("fv:dash-perms-ready", loadBoundaryRequests);
  document.addEventListener("visibilitychange", ()=>{
    if (document.visibilityState === "visible") loadBoundaryRequests();
  });

})();