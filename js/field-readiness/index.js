/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26b

Adds permissions:
- view allowed: page works normally
- edit required: (future) dblclick/swipe/save interactions
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

import { loadFieldReadinessPerms, applyPermDataAttrs } from './perm.js';

(async function init(){
  const state = createState();
  window.__FV_FR = state;

  // Close details by default
  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  // Hide Refresh Weather (API) button
  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // Load local caches
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  // Wire UI once
  await wireUIOnce(state);

  // Load firebase
  await importFirebaseInit(state);

  // Resolve perms (employees + accountRoles)
  await loadFieldReadinessPerms(state);

  // Add data-perm hooks so perm-ui.js can do its thing
  applyPermDataAttrs();

  // Gate: if cannot view, stop here
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

  // prefs
  await loadPrefsFromLocalToUI(state);
  await loadRangeFromLocalToUI();

  // calendar safety
  enforceCalendarNoFuture();

  // Firestore thresholds + data
  await loadThresholdsFromFirestore(state);
  await loadFarmsOptional(state);
  await loadFields(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  // hidden Fields tap (calibration modal)
  // You may later want this to require edit; for now keep existing behavior:
  wireFieldsHiddenTap(state);

  // Ensure model/weather modules loaded for rendering
  await ensureModelWeatherModules(state);

  // render
  renderTiles(state);
  renderDetails(state);
  refreshAll(state);
})();
