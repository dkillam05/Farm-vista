import { appState } from './store.js';
import { escapeHtml } from './utils.js';
import { rangeTitle, readinessTitle } from './date-range.js';
import { formatReadinessValue } from './legend.js';

export function buildRainPopupHtml(summary, pointLabel){
  return (
    '<div class="popup-card">' +
      '<div class="name">' + escapeHtml(summary.fieldName || 'Field') + '</div>' +
      '<div>' + escapeHtml(rangeTitle()) + '</div>' +
      '<div>Rain: <span class="mono">' + Number(summary.rainInches || 0).toFixed(2) + ' in</span></div>' +
      (pointLabel ? '<div>Tap zone: ' + escapeHtml(pointLabel) + '</div>' : '') +
    '</div>'
  );
}

export function buildReadinessPopupHtml(summary){
  const farmLine = summary.farmName ? ('<div class="muted">' + escapeHtml(summary.farmName) + '</div>') : '';
  const locBits = [summary.county || '', summary.state || ''].filter(Boolean).join(' / ');
  const locLine = locBits ? ('<div class="muted">' + escapeHtml(locBits) + '</div>') : '';

  return (
    '<div class="popup-card">' +
      '<div class="name">' + escapeHtml(summary.fieldName || 'Field') + '</div>' +
      farmLine +
      locLine +
      '<div style="margin-top:6px;">' + escapeHtml(readinessTitle()) + '</div>' +
      '<div>Readiness: <span class="mono">' + escapeHtml(formatReadinessValue(summary.readiness || 0)) + '</span></div>' +
      '<div>Last 72h rain: <span class="mono">' + Number(summary.rain72hInches || 0).toFixed(2) + ' in</span></div>' +
    '</div>'
  );
}

export function openPopupForHit(hit){
  if (!hit) return;

  const summary = appState.lastFieldSummaries.find(x => x.fieldId === hit.fieldId);
  if (!summary){
    if (appState.infoWindow) appState.infoWindow.close();
    return;
  }

  let html = '';
  if (summary.kind === 'readiness'){
    html = buildReadinessPopupHtml(summary);
  } else {
    html = buildRainPopupHtml(summary, hit.pointLabel);
  }

  appState.infoWindow.setContent(html);
  appState.infoWindow.setPosition({ lat:Number(hit.lat), lng:Number(hit.lng) });
  appState.infoWindow.open({
    map: appState.map,
    shouldFocus: false
  });
}
