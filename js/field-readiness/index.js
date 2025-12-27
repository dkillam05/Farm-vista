/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-27c

Fix:
✅ Operation dropdown (and other prefs) now restore correctly after leaving/returning on iOS/Safari:
   - Re-apply saved op on pageshow (BFCache restore)
   - Re-apply saved op on visibilitychange (returning to tab)
✅ Does NOT rely on the browser preserving <select> state.

Keeps:
✅ Current boot flow + perms + layout fix
✅ Details forced closed on boot

===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI, applySavedOpToUI } from './prefs.js';
import { loadRangeFromLocalToUI, enforceCalendarNoFuture } from './range.js';
import { loadFarmsOptional, loadFields } from './data.js';
import { wireUIOnce } from './wiring.js';
import { renderTiles, renderDetails, refreshAll, ensureModelWeatherModules } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';
import { loadFieldReadinessPerms, canView } from './perm.js';
import { buildFarmFilterOptions } from './farm-filter.js';
import { initMap } from './map.js';
import { initLayoutFix } from './layout.js';
import { initOpThresholds } from './op-thresholds.js';

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  initLayoutFix();

  // FORCE details closed on boot
  try{
    const dp = document.getElementById('detailsPanel');
    if (dp){
      dp.open = false;
      dp.removeAttribute('open');
    }
  }catch(_){}

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // Local caches
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  // Wire UI early
  await wireUIOnce(state);

  // Firebase
  await importFirebaseInit(state);

  // Initial perms read (may be provisional)
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

  // Apply prefs once on boot
  await loadPrefsFromLocalToUI(state);

  // Range UI
  await loadRangeFromLocalToUI();
  enforceCalendarNoFuture();

  // Load remote thresholds + data
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

  // Farm options can change after farms/fields load
  buildFarmFilterOptions(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  await ensureModelWeatherModules(state);

  initMap(state);
  initOpThresholds(state);

  // Soft reload hook
  document.addEventListener('fr:soft-reload', async ()=>{
    try{ await refreshAll(state); }catch(_){}
  });

  // perms finalize hook
  document.addEventListener('fv:user-ready', async ()=>{
    try{
      const prevLoaded = !!(state.perm && state.perm.loaded);
      const prevEdit = !!(state.perm && state.perm.edit);

      await loadFieldReadinessPerms(state);

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

      const nowEdit = !!(state.perm && state.perm.loaded && state.perm.edit);
      if (!prevLoaded || (prevEdit !== nowEdit)){
        await refreshAll(state);
      }
    }catch(_){}
  });

  // ✅ iOS/Safari: restore <select> after returning to page
  const reapplyPrefs = async (why)=>{
    try{
      // re-apply op (option state can reset on BFCache)
      const changed = applySavedOpToUI(state, { fire:false });

      // re-apply farm/page UI values too (safe)
      await loadPrefsFromLocalToUI(state);

      // only refresh if something actually changed
      if (changed){
        await refreshAll(state);
      }
    }catch(_){}
  };

  window.addEventListener('pageshow', (e)=>{
    // BFCache restore or normal show
    reapplyPrefs('pageshow');
  });

  document.addEventListener('visibilitychange', ()=>{
    if (!document.hidden){
      reapplyPrefs('visible');
    }
  });

  // Initial paint
  await renderTiles(state);
  await renderDetails(state);
  await refreshAll(state);

  // global calibration wiring
  wireFieldsHiddenTap(state);

  // re-close details (edge cases)
  try{
    const dp2 = document.getElementById('detailsPanel');
    if (dp2){
      dp2.open = false;
      dp2.removeAttribute('open');
    }
  }catch(_){}
})();