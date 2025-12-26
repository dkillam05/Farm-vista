/* =====================================================================
/Farm-vista/js/field-readiness/index.js  (FULL FILE)
Rev: 2025-12-26a

Entry point for the modular Field Readiness system.
- Does not modify any existing/live files.
- Your test page should load THIS file as the module script.
===================================================================== */
'use strict';

import { createState } from './state.js';
import { importFirebaseInit } from './firebase.js';
import { initPrefs, loadPrefsToUI } from './prefs.js';
import { initRange } from './range.js';
import { initUIWiring } from './ui.js';
import { loadInitialData } from './data.js';
import { renderAll } from './ui.js';

(async function main(){
  const state = createState();
  window.__FV_FR_STATE = state; // helpful for debugging in console

  // 1) Basic UI wiring (handlers + safety guards)
  initPrefs(state);
  initRange(state);
  initUIWiring(state);

  // 2) Apply cached prefs to UI controls (op/sort/range/farm/page)
  await loadPrefsToUI(state);

  // 3) Firebase (module)
  await importFirebaseInit(state);

  // 4) Load data (thresholds, farms, fields, weather warm-up)
  await loadInitialData(state);

  // 5) First render
  renderAll(state);
})();
