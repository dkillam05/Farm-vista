/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-27a

Adds background Firestore live-sync for per-field slider params:
✅ Watches ONLY the selected field doc via onSnapshot
✅ Updates sliders + details without re-rendering 500 tiles
✅ No page refresh required

Keeps:
- Rev: 2025-12-26l flow + layout fix
- Operation Thresholds modal wiring
===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI } from './prefs.js';
import { loadRangeFromLocalToUI, enforceCalendarNoFuture } from './range.js';
import { loadFarmsOptional, loadFields, startSelectedFieldLiveSync, stopSelectedFieldLiveSync } from './data.js';
import { wireUIOnce } from './wiring.js';
import { renderTiles, renderDetails, refreshAll, refreshDetailsOnly, ensureModelWeatherModules } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';
import { loadFieldReadinessPerms, canView } from './perm.js';
import { buildFarmFilterOptions } from './farm-filter.js';
import { initMap } from './map.js';
import { initLayoutFix } from './layout.js';
import { initOpThresholds } from './op-thresholds.js';

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  // ✅ Fix intermittent footer clipping ASAP
  initLayoutFix();

  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // Local caches (fast boot)
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  await wireUIOnce(state);
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

  // ✅ restore Map button
  initMap(state);

  // ✅ restore Operation Thresholds modal
  initOpThresholds(state);

  // ✅ START: background live sync for selected field only
  document.addEventListener('fr:selected-field-changed', async (e)=>{
    try{
      const fid = e && e.detail ? String(e.detail.fieldId || '') : '';
      if (!fid) return;
      stopSelectedFieldLiveSync(state);
      startSelectedFieldLiveSync(state, fid, async ()=>{
        // Only refresh the details panel (NOT 500 tiles)
        await refreshDetailsOnly(state);
      });
    }catch(_){}
  });

  // Kick the watcher once on boot
  try{
    if (state.selectedFieldId){
      stopSelectedFieldLiveSync(state);
      startSelectedFieldLiveSync(state, state.selectedFieldId, async ()=>{
        await refreshDetailsOnly(state);
      });
    }
  }catch(_){}
  // ✅ END: background live sync

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
        // perms changed -> tiles may gain edit features
        await refreshAll(state);
      } else {
        // keep it light
        await refreshDetailsOnly(state);
      }
    }catch(_){}
  });

  await renderTiles(state);
  await renderDetails(state);
  await refreshAll(state);

  // global calibration wiring
  wireFieldsHiddenTap(state);
})();
