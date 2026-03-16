/* ======================================================================
/Farm-vista/js/rainfallmap/rain-data.js   (FULL FILE)
Rev: 2026-03-15b-labeled-active-range-rain-math

PURPOSE
✔ Converts MRMS daily-series data into rainfall totals for the map
✔ Builds rainfall point rows and rainfall popup summaries
✔ Uses appState current selected range when available
✔ Falls back to default 72-hour range only when no full selected range exists

IMPORTANT NOTE
This file already uses appState.currentRangeStartISO/currentRangeEndISO.
If the map still behaves like 72 hours, the likely problem is upstream in
the date-range picker, where a full start/end range is not being committed.
====================================================================== */

import { appState } from './store.js';
import { lower, toNum } from './utils.js';
import { getLast72hDateRangeISO } from './date-range.js';

export function pointLabelFromKey(key){
  const k = lower(key);
  if (!k || k === 'center' || k === 'c') return 'Center';
  if (k === 'nw' || k === 'northwest') return 'NW';
  if (k === 'ne' || k === 'northeast') return 'NE';
  if (k === 'sw' || k === 'southwest') return 'SW';
  if (k === 'se' || k === 'southeast') return 'SE';
  if (k === 'n' || k === 'north') return 'North';
  if (k === 's' || k === 'south') return 'South';
  if (k === 'e' || k === 'east') return 'East';
  if (k === 'w' || k === 'west') return 'West';
  return String(key || 'Point').toUpperCase();
}

export function sumDailySeriesWithinDates(parentDoc, startISO, endISO){
  const rows = Array.isArray(parentDoc && parentDoc.mrmsDailySeries30d) ? parentDoc.mrmsDailySeries30d.slice() : null;
  if (!rows || !rows.length) return null;

  if (!startISO || !endISO){
    const r = getLast72hDateRangeISO();
    startISO = r.startISO;
    endISO = r.endISO;
  }

  return rows.reduce((sum, row)=>{
    const iso = String(row && row.dateISO || '').trim();
    if (!iso) return sum;
    if (iso < startISO || iso > endISO) return sum;
    return sum + (toNum(row && row.rainMm) || 0);
  }, 0);
}

export function totalRainMmForActiveRange(parentDoc){
  if (!parentDoc || typeof parentDoc !== 'object') return null;
  return sumDailySeriesWithinDates(parentDoc, appState.currentRangeStartISO, appState.currentRangeEndISO);
}

export function totalRainInLast72h(parentDoc){
  if (!parentDoc || typeof parentDoc !== 'object') return 0;
  const r = getLast72hDateRangeISO();
  const mm = sumDailySeriesWithinDates(parentDoc, r.startISO, r.endISO);
  return Number.isFinite(mm) ? (mm / 25.4) : 0;
}

export function extractSampleGeometry(parentDoc){
  const samples = Array.isArray(parentDoc && parentDoc.mrmsHourlyLatest && parentDoc.mrmsHourlyLatest.samples)
    ? parentDoc.mrmsHourlyLatest.samples
    : [];

  const out = [];
  samples.forEach(sample=>{
    const lat = toNum(sample && sample.lat);
    const lng = toNum(sample && sample.lon);
    if (lat == null || lng == null) return;
    out.push({
      key: String((sample && sample.key) || 'center'),
      lat,
      lng
    });
  });

  return out;
}

export function hasUsableRainData(parentDoc){
  const totalMm = totalRainMmForActiveRange(parentDoc);
  const geom = extractSampleGeometry(parentDoc);
  return Number.isFinite(totalMm) || geom.length > 0;
}

export function buildFieldPoints(row){
  const totalMm = totalRainMmForActiveRange(row.raw);
  if (!Number.isFinite(totalMm) && !extractSampleGeometry(row.raw).length) return [];

  const totalInches = Number.isFinite(totalMm) ? (totalMm / 25.4) : 0;
  let geom = extractSampleGeometry(row.raw);

  if (!geom.length){
    geom = [{
      key: 'center',
      lat: row.location.lat,
      lng: row.location.lng
    }];
  }

  return geom.map(g => ({
    fieldId: row.fieldId,
    fieldName: row.fieldName,
    farmId: row.farmId,
    pointLabel: pointLabelFromKey(g.key),
    lat: g.lat,
    lng: g.lng,
    rainInches: totalInches
  }));
}

export function buildRainSummary(row){
  const totalMm = totalRainMmForActiveRange(row.raw);
  if (!Number.isFinite(totalMm) && !extractSampleGeometry(row.raw).length) return null;

  return {
    kind: 'rainfall',
    fieldId: row.fieldId,
    fieldName: row.fieldName,
    farmId: row.farmId,
    lat: row.location.lat,
    lng: row.location.lng,
    rainInches: Number.isFinite(totalMm) ? (totalMm / 25.4) : 0
  };
}