/* =====================================================================
/Farm-vista/js/rainfallmap/app.js   (FULL FILE)
Rev: 2026-03-15a-startup-sequence-labeled

PURPOSE
✔ Starts the Weather / Readiness map
✔ Initializes layout, Firebase, Google Maps, and map shell
✔ Wires UI events
✔ Restores saved date range and map mode
✔ Triggers first render

NOTES
✔ Keeps current startup flow intact
✔ Restores saved date range first
✔ Applies default 72-hour range only when nothing is already selected
✔ Syncs active range into appState before first render
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

export async function startWeatherMap(){
  if (appState.startRequested && appState.startFinished) return;
  if (appState.startRequested && !appState.startFinished) return;

  appState.startRequested = true;

  try{
    detectLayoutMode();
    await initFirebase();
    await waitForGoogleMaps();
    ensureMap();
    wireUi();

    restoreCurrentRangeFromLocal();
    applyDefault72HourRangeToPicker({ silent:true });
    syncCurrentRangeFromPicker(false);

    appState.currentMapMode = restoreCurrentMapModeFromLocal();
    applyMapModeUi();

    await renderActiveMode(false);
    appState.startFinished = true;
  }catch(e){
    appState.startRequested = false;
    appState.startFinished = false;
    console.warn('[WeatherMap] startup failed:', e);
    setStatus('Startup failed');
    setDebug(String(e && e.message ? e.message : e || 'startup error'));
  }
}
