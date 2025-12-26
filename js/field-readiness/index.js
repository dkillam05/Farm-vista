/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26c

Now integrates FarmVista permission system via FVUserContext:
- crop-field-readiness.view gates page visibility
- crop-field-readiness.edit gates dblclick/swipe/quick save (added in later module)
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

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  // Close details by default
  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  // Hide Refresh Weather (API) button
  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // Local caches
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  // Wire UI once
  await wireUIOnce(state);

  // Firebase (needed because user-context reads Firestore)
  await importFirebaseInit(state);

  // Permissions from FVUserContext
  await loadFieldReadinessPerms(state);

  // Gate: no view → stop
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

  // Prefs (existing behavior)
  await loadPrefsFromLocalToUI(state);
  await loadRangeFromLocalToUI();

  // Calendar safety (no future)
  enforceCalendarNoFuture();

  // Firestore thresholds + data
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  // Load model/weather deps
  await ensureModelWeatherModules(state);

  // Render
  renderTiles(state);
  renderDetails(state);
  refreshAll(state);

  // Hidden Fields tap (calibration modal)
  // Optional: you can later change this to require edit; for now leave it.
  wireFieldsHiddenTap(state);
})();
