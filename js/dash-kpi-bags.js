// /Farm-vista/js/dash-kpi-bags.js
// Rev: 2026-01-27-dash-kpi-bags-v1
//
// KPI: Grain bag inventory on hand
// Reads Firestore collection: inventoryGrainBagMovements
// Sums bags and estimates bushels using FVGrainCapacity if present.
// Extracted from your dashboard inline script.
// Respects perms hiding: if #bag-kpi is perm-hidden, it will no-op.

import { ready, getFirestore, collection, getDocs } from '/Farm-vista/js/firebase-init.js';

(async function(){
  "use strict";

  const kpiEl   = document.getElementById("bag-kpi");
  const countEl = document.getElementById("bag-kpi-count");
  const subEl   = document.getElementById("bag-kpi-sub");

  if (!kpiEl || !countEl || !subEl) return;

  const fmtInt = (n) => (Number(n) || 0).toLocaleString();

  function applyState(totalBags, skuCount, totalBu){
    const bags = Number(totalBags) || 0;
    const skus = Number(skuCount) || 0;
    const bu   = Number(totalBu) || 0;

    countEl.textContent = bags.toString();

    if (!bags){
      kpiEl.classList.add("dash-kpi-empty");
      subEl.textContent = "No grain bags on hand in inventory.";
    }else{
      kpiEl.classList.remove("dash-kpi-empty");
      const skuLabel = skus === 1 ? "SKU" : "SKUs";

      if (bu > 0){
        subEl.textContent = `≈ ${fmtInt(bu)} bu on hand across ${fmtInt(bags)} bags and ${skus || 1} ${skuLabel}.`;
      }else{
        subEl.textContent = `Total bags on hand across ${skus || 1} ${skuLabel}.`;
      }
    }
  }

  function isHidden(){
    return kpiEl.classList.contains("perm-hidden") || kpiEl.getAttribute("aria-hidden") === "true";
  }

  async function loadBagInventory(){
    try{
      if (isHidden()) return;

      await ready;
      const db = getFirestore();
      const colRef = collection(db, "inventoryGrainBagMovements");
      const snap = await getDocs(colRef);

      let totalBags = 0;
      let skuCount  = 0;
      let totalBu   = 0;

      snap.forEach(docSnap => {
        const d = docSnap.data() || {};

        let bags = (d.onHand != null) ? Number(d.onHand) : (d.qty != null ? Number(d.qty) : 0);
        if (!Number.isFinite(bags) || bags <= 0) return;

        totalBags += bags;
        skuCount  += 1;

        let perBagCornBu = 0;
        if (d.cornBuPerBag != null) perBagCornBu = Number(d.cornBuPerBag);
        else if (d.bagCornBu != null) perBagCornBu = Number(d.bagCornBu);
        else if (d.bushelsPerBag != null) perBagCornBu = Number(d.bushelsPerBag);
        else if (d.capacityCornBu != null) perBagCornBu = Number(d.capacityCornBu);

        if (!Number.isFinite(perBagCornBu) || perBagCornBu <= 0) return;

        const ratedCornTotal = bags * perBagCornBu;

        const crop = (d.crop || d.cropType || "corn").toString().trim().toLowerCase() || "corn";

        let effBu = ratedCornTotal;
        try{
          if (window.FVGrainCapacity && typeof FVGrainCapacity.capacityForCrop === "function") {
            effBu = FVGrainCapacity.capacityForCrop(ratedCornTotal, crop, { round:false });
          }
        }catch(e){
          console.warn("[dash-kpi-bags] FVGrainCapacity error:", e);
        }

        if (Number.isFinite(effBu) && effBu > 0) totalBu += effBu;
      });

      applyState(totalBags, skuCount, totalBu);
    }catch(err){
      console.warn("[dash-kpi-bags] failed to load grain-bag inventory KPI:", err);
      applyState(0, 0, 0);
    }
  }

  await loadBagInventory();
  document.addEventListener("fv:dash-perms-ready", loadBagInventory);
  document.addEventListener("visibilitychange", ()=>{
    if (document.visibilityState === "visible") loadBagInventory();
  });

})();