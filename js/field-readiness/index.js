/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26h

Restores Map button wiring via initMap(state).
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

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  await wireUIOnce(state);

  await importFirebaseInit(state);

  await loadFieldReadinessPerms(state);

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

  // ✅ restore map button behavior
  initMap(state);

  document.addEventListener('fr:soft-reload', async ()=>{
    try{ await refreshAll(state); }catch(_){}
  });

  await renderTiles(state);
  await renderDetails(state);
  await refreshAll(state);

  // global calibration wiring
  wireFieldsHiddenTap(state);
})();
