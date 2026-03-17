/* =====================================================================
/Farm-vista/js/rainfallmap/app.js   (FULL FILE)
Rev: 2026-03-17a-fix-startup-mode-order

PURPOSE
✔ Starts the Weather / Readiness map
✔ Initializes layout, Firebase, Google Maps, and map shell
✔ Wires UI events
✔ Restores saved date range and map mode
✔ Triggers first render

FIX IN THIS REV
✔ Restores saved map mode BEFORE wireUi() runs
✔ Prevents startup UI from first painting Rainfall when saved mode is Readiness
✔ Keeps current date-range startup behavior intact
✔ Hard-syncs map mode UI again after first render
===================================================================== */

import { appState } from './store.js';
import { setStatus, setDebug } from './dom.js';
import { detectLayoutMode } from './layout.js';
import { initFirebase } from './firebase.js';
import { waitForGoogleMaps, ensureMap } from './map-core.js';
import { wireUi, applyMapModeUi } from './ui.js';
import {
  restoreCurrentRangeFromLocal,
  applyDefault72HourRangeToPicker,
  syncCurrentRangeFromPicker
} from './date-range.js';
import { restoreCurrentMapModeFromLocal } from './view-mode.js';
import { renderActiveMode } from './render-flow.js';
import './tap.js';

function normalizeMapMode(mode){
  return String(mode || '').toLowerCase() === 'readiness' ? 'readiness' : 'rainfall';
}

export async function startWeatherMap(){
  if (appState.startRequested && appState.startFinished) return;
  if (appState.startRequested && !appState.startFinished) return;

  appState.startRequested = true;

  try{
    detectLayoutMode();
    await initFirebase();
    await waitForGoogleMaps();
    ensureMap();

    // IMPORTANT:
    // Restore saved mode BEFORE UI wiring so dropdown/chip/sections
    // are initialized from the real last-used mode.
    appState.currentMapMode = normalizeMapMode(
      restoreCurrentMapModeFromLocal()
    );

    wireUi();

    restoreCurrentRangeFromLocal();
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(false);

    applyMapModeUi();
    await renderActiveMode(false);
    applyMapModeUi();

    appState.startFinished = true;
  }catch(e){
    appState.startRequested = false;
    appState.startFinished = false;
    console.warn('[WeatherMap] startup failed:', e);
    setStatus('Startup failed');
    setDebug(String(e && e.message ? e.message : e || 'startup error'));
  }
}