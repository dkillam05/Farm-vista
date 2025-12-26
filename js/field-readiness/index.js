/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26a

Modular entry point. This is the ONLY script your test page needs to load.

- Does not override any working file.
- Uses model/weather as locked dependencies (paths.js).
- Removes the duplicate init issue by design (single init here).
===================================================================== */
'use strict';

import { createState, buildWxCtx } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { loadThresholdsFromLocal, loadThresholdsFromFirestore } from './thresholds.js';
import { loadParamsFromLocal } from './params.js';
import { loadPrefsFromLocalToUI } from './prefs.js';
import { loadRangeFromLocalToUI, enforceCalendarNoFuture } from './range.js';
import { loadFarmsOptional, loadFields } from './data.js';
import { wireUIOnce } from './wiring.js';
import { renderTiles, renderDetails, refreshAll } from './render.js';
import { wireFieldsHiddenTap } from './adjust.js';

(async function init(){
  const state = createState();
  window.__FV_FR = state; // debug handle if you want it in console

  // Details closed by default (matches old)
  const dp = document.getElementById('detailsPanel');
  if (dp) dp.open = false;

  // Hide refresh weather button (matches old)
  const br = document.getElementById('btnRegen');
  if (br){ br.style.display = 'none'; br.disabled = true; }

  // local caches
  loadParamsFromLocal(state);
  loadThresholdsFromLocal(state);

  // wire UI (only once)
  await wireUIOnce(state);

  // prefs
  await loadPrefsFromLocalToUI(state);
  await loadRangeFromLocalToUI(state);

  // calendar safety (no future)
  enforceCalendarNoFuture();

  // firebase
  const ok = await importFirebaseInit(state);
  if (!ok){
    const err = document.getElementById('err');
    if (err){ err.hidden = false; err.textContent = 'firebase-init.js failed to import as a module.'; }
  }

  // thresholds from Firestore (if available)
  await loadThresholdsFromFirestore(state);

  // farms + fields
  await loadFarmsOptional(state);
  await loadFields(state);

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  // hidden “Fields” tap target = open calibration modal
  wireFieldsHiddenTap(state);

  // initial render
  renderTiles(state);
  renderDetails(state);

  // keep sliders synced
  refreshAll(state);
})();
