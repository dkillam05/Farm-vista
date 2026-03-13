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
