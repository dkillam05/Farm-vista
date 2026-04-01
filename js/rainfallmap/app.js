/* =====================================================================
/Farm-vista/js/rainfallmap/app.js   (FULL FILE)
Rev: 2026-03-17b-rerender-on-return

PURPOSE
✔ Starts the Weather / Readiness map
✔ Initializes layout, Firebase, Google Maps, and map shell
✔ Wires UI events
✔ Restores saved date range and map mode
✔ Triggers first render

FIX IN THIS REV
✔ If the page returns after startup already finished, re-render instead of exiting
✔ Keeps saved mode/date-range restore behavior
✔ Prevents return-to-page state where dropdown/scale are right but blobs do not draw
✔ Forces active mode redraw on return/visibility re-entry
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
  // If startup already completed, this is a return-to-page / re-entry case.
  // Re-sync UI + state and force a redraw instead of exiting.
  if (appState.startRequested && appState.startFinished){
    try{
      detectLayoutMode();
      ensureMap();

      restoreCurrentRangeFromLocal();
      applyDefault72HourRangeToPicker({ silent:true });
      syncCurrentRangeFromPicker(false);

      appState.currentMapMode = normalizeMapMode(
        restoreCurrentMapModeFromLocal()
      );

      applyMapModeUi();
      await renderActiveMode(true);
      applyMapModeUi();
    }catch(e){
      console.warn('[WeatherMap] return render failed:', e);
      setStatus('Reload failed');
      setDebug(String(e && e.message ? e.message : e || 'return render error'));
    }
    return;
  }

  // If startup is currently running, do nothing.
  if (appState.startRequested && !appState.startFinished) return;

  appState.startRequested = true;

  try{
    detectLayoutMode();
    await initFirebase();
    await waitForGoogleMaps();
    ensureMap();

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