/* =====================================================================
/Farm-vista/js/rainfallmap/tap.js   (FULL FILE)
Rev: 2026-03-15a-labeled-tap-handler

PURPOSE
✔ Handles map tap interactions
✔ Finds nearest blob/marker tap target
✔ Opens popup for selected hit
✔ Exposes map tap hooks on window

NOTE
If popups are showing old date-range rainfall values after the map changes,
the issue is usually upstream in rain rendering / tap target rebuilding.
===================================================================== */

import { appState } from './store.js';
import { nearestTapTarget, updateTapTargetsForCurrentZoom } from './map-core.js';
import { openPopupForHit } from './popups.js';

export function handleMapTap(ev){
  if (!ev || !ev.latLng || !appState.lastTapTargets.length) return;

  const lat = ev.latLng.lat();
  const lng = ev.latLng.lng();
  const hit = nearestTapTarget(lat, lng);

  if (!hit){
    if (appState.infoWindow) appState.infoWindow.close();
    return;
  }

  openPopupForHit(hit);
}

window.FVRainMapHandleTap = handleMapTap;
window.FVRainMapUpdateTapTargets = updateTapTargetsForCurrentZoom;
