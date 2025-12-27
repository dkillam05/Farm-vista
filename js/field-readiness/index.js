/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-27d

Fix:
✅ Persist + restore (iOS/Safari BFCache safe):
   - Operation (already)
   - Farm (already)
   - Sort (NEW)
   - Rain range (NEW) via localStorage key: fv_fr_range_v1
✅ Re-apply on pageshow + visibilitychange so it sticks after leaving/returning

===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI, applySavedOpToUI, applySavedSortToUI } from './prefs.js';
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

const LS_RANGE_KEY = 'fv_fr_range_v1';

function applySavedRangeToUI(){
  try{
    const inp = document.getElementById('jobRangeInput');
    if (!inp) return false;

    const raw = String(localStorage.getItem(LS_RANGE_KEY) || '').trim();
    // allow empty (meaning default 30d) but still apply if it differs
    if (String(inp.value || '').trim() !== raw){
      inp.value = raw;
      return true;
    }
    return false;
  }catch(_){
    return false;
  }
}

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

  // Apply saved range string (if any)
  applySavedRangeToUI();

  // Range UI module (calendar behavior) + enforcement
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

  document.addEventListener('fr:soft-reload', async ()=>{
    try{ await refreshAll(state); }catch(_){}
  });

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

  // ✅ iOS/Safari: re-apply selects + range after returning to page
  const reapplyPrefs = async (why)=>{
    try{
      const opChanged = applySavedOpToUI(state, { fire:false });
      const sortChanged = applySavedSortToUI({ fire:false });
      const rangeChanged = applySavedRangeToUI();

      // keep farm/page in sync too
      await loadPrefsFromLocalToUI(state);

      // range module constraints (safe)
      enforceCalendarNoFuture();

      if (opChanged || sortChanged || rangeChanged){
        await refreshAll(state);
      }
    }catch(_){}
  };

  window.addEventListener('pageshow', ()=>{
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