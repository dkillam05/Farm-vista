/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26k

Based on YOUR latest Rev: 2025-12-26i (verbatim flow) with ONE addition:
✅ initLayoutFix() to prevent intermittent bottom clipping (last tile / Details summary hidden)

No other behavior changes.

===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI } from './prefs.js';
import { loadRangeFromLocalToUI, enforceCalendarNoFuture } from './range.js';
import { loadFarmsOptional, loadFields } from './data.js';
import { wireUIOnce } from './wiring.js';
import { renderTiles, renderDetails, refreshAll, ensureModelWeatherModules } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';
import { loadFieldReadinessPerms, canView } from './perm.js';
import { buildFarmFilterOptions } from './farm-filter.js';
import { initMap } from './map.js';

// ✅ NEW: layout fix for intermittent footer clipping
import { initLayoutFix } from './layout.js';

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  // ✅ run ASAP (handles late-loading fv-shell footer)
  initLayoutFix();

  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  await wireUIOnce(state);
  await importFirebaseInit(state);

  // Initial perms read (may be provisional)
  await loadFieldReadinessPerms(state);

  // If truly denied (loaded AND view=false), show message and stop
  // If not loaded yet, canView(state) returns true (prevents flash).
  if (!canView(state)){
    const grid = document.getElementById('fieldsGrid');
    if (grid){
      grid.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'help muted';
      msg.style.padding = '10px 2px';
      msg.textContent = 'You do not have permission to view Field Readiness.';
      grid.appendChild(msg);
    }
    return;
  }

  await loadPrefsFromLocalToUI(state);
  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);
  buildFarmFilterOptions(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  await ensureModelWeatherModules(state);

  initMap(state);

  document.addEventListener('fr:soft-reload', async ()=>{
    try{ await refreshAll(state); }catch(_){}
  });

  // 🔥 KEY FIX: when perms finish loading, re-check and re-render.
  document.addEventListener('fv:user-ready', async ()=>{
    try{
      const prevLoaded = !!(state.perm && state.perm.loaded);
      const prevEdit = !!(state.perm && state.perm.edit);

      await loadFieldReadinessPerms(state);

      // If now truly denied view, show message
      if (state.perm && state.perm.loaded && !state.perm.view){
        const grid = document.getElementById('fieldsGrid');
        if (grid){
          grid.innerHTML = '';
          const msg = document.createElement('div');
          msg.className = 'help muted';
          msg.style.padding = '10px 2px';
          msg.textContent = 'You do not have permission to view Field Readiness.';
          grid.appendChild(msg);
        }
        return;
      }

      // If edit permission just became available, we must re-render tiles
      // so dblclick + swipe actions are attached.
      const nowEdit = !!(state.perm && state.perm.loaded && state.perm.edit);

      if (!prevLoaded || (prevEdit !== nowEdit)){
        await refreshAll(state);
      }
    }catch(_){}
  });

  await renderTiles(state);
  await renderDetails(state);
  await refreshAll(state);

  wireFieldsHiddenTap(state);
})();
