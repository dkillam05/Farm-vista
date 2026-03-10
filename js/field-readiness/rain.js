/* =====================================================================
/Farm-vista/js/field-readiness/rain.js  (FULL FILE)
Rev: 2026-03-10a

Changes (per Dane):
✅ Rain range can now use MRMS daily rainfall data
✅ If MRMS backfill is not complete for current day back through past 30 days,
   range rainfall is treated as NOT READY
✅ Exposes helpers for render.js to show:
   "Rainfall data still in queue"

Keeps:
✅ Existing flexible date-range parsing
✅ Existing legacy run-row rain fallback helper
===================================================================== */
'use strict';

import { round } from './utils.js';

const $ = (id)=>document.getElementById(id);

function parseYMDLocal(ymd){
  const s = String(ymd||'').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const out = new Date(y, mo, d, 12, 0, 0, 0); // local noon
  return isFinite(out.getTime()) ? out : null;
}

function parseDateLocalLoose(s){
  const raw = String(s||'').trim();
  if (!raw) return null;

  // ISO yyyy-mm-dd
  const iso = parseYMDLocal(raw);
  if (iso) return iso;

  // Try native Date parse (handles "Dec 1, 2025" and many others)
  const d = new Date(raw);
  if (isFinite(d.getTime())){
    // force local noon to prevent timezone shifting issues
    d.setHours(12,0,0,0);
    return d;
  }

  // Try MM/DD/YYYY manually
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m){
    const mm = Number(m[1]) - 1;
    const dd = Number(m[2]);
    const yy = Number(m[3]);
    const out = new Date(yy, mm, dd, 12, 0, 0, 0);
    return isFinite(out.getTime()) ? out : null;
  }

  return null;
}

export function parseRangeFromInput(){
  const inp = $('jobRangeInput');
  const raw = String(inp ? inp.value : '').trim();
  if (!raw) return { start:null, end:null };

  // Split on en dash used by your UI
  const parts = raw.split('–').map(s=>s.trim());

  if (parts.length === 2){
    const a = parseDateLocalLoose(parts[0]);
    const b = parseDateLocalLoose(parts[1]);
    if (a && b){
      a.setHours(0,0,0,0);
      b.setHours(23,59,59,999);
      return { start:a, end:b };
    }
  }

  // Single date case
  const d = parseDateLocalLoose(raw);
  if (d){
    d.setHours(0,0,0,0);
    const e = new Date(d);
    e.setHours(23,59,59,999);
    return { start:d, end:e };
  }

  return { start:null, end:null };
}

function parseISODateFromRun(dateISO){
  return parseYMDLocal(dateISO);
}

export function isDateInRange(dateISO, range){
  if (!range || !range.start || !range.end) return true;

  const d = parseISODateFromRun(dateISO);
  if (!d) return true; // fail-open
  return d >= range.start && d <= range.end;
}

/* =====================================================================
   Legacy run-row rainfall helper (kept for compatibility)
===================================================================== */
export function rainInRange(run, range){
  if (!run || !run.rows) return 0;

  const hasRange = !!(range && range.start && range.end);

  let sum = 0;
  for (const r of run.rows){
    if (!hasRange || isDateInRange(r.dateISO, range)){
      sum += Number(r.rainInAdj || 0);
    }
  }
  return round(sum, 2);
}

/* =====================================================================
   MRMS helpers
===================================================================== */
function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toYMDLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDayLocal(d){
  const out = new Date(d);
  out.setHours(0,0,0,0);
  return out;
}

function endOfDayLocal(d){
  const out = new Date(d);
  out.setHours(23,59,59,999);
  return out;
}

function addDaysLocal(d, delta){
  const out = new Date(d);
  out.setDate(out.getDate() + delta);
  return out;
}

export function getDefaultRainRange30d(){
  const today = startOfDayLocal(new Date());
  const start = startOfDayLocal(addDaysLocal(today, -29));
  const end = endOfDayLocal(today);
  return { start, end };
}

function normalizeRange(range){
  if (range && range.start && range.end) return range;
  return getDefaultRainRange30d();
}

function getMrmsDailySeries(doc){
  return Array.isArray(doc && doc.mrmsDailySeries30d) ? doc.mrmsDailySeries30d : [];
}

function getMrmsDailyMap(doc){
  const rows = getMrmsDailySeries(doc);
  const map = new Map();
  for (const r of rows){
    const key = String(r && r.dateISO || '').trim();
    if (!key) continue;
    map.set(key, r);
  }
  return map;
}

/**
 * Backfill is considered ready only when we have a full contiguous set of
 * current day back through the prior 29 days.
 */
export function mrmsBackfillReady(doc){
  if (!doc || typeof doc !== 'object') return false;

  const map = getMrmsDailyMap(doc);
  if (!map.size) return false;

  const meta = doc.mrmsHistoryMeta || {};
  if (meta && meta.fullBackfillComplete === true) return true;

  const def = getDefaultRainRange30d();
  let cursor = startOfDayLocal(def.start);
  const end = startOfDayLocal(def.end);

  while (cursor <= end){
    const key = toYMDLocal(cursor);
    if (!map.has(key)) return false;
    cursor = addDaysLocal(cursor, 1);
  }

  return true;
}

/**
 * Returns MRMS rainfall in the requested range, but only if the full rolling
 * 30-day MRMS daily history is ready.
 */
export function mrmsRainInRange(doc, range){
  if (!doc || typeof doc !== 'object'){
    return { ready:false, inches:null, mm:null, reason:'missing-doc' };
  }

  if (!mrmsBackfillReady(doc)){
    return { ready:false, inches:null, mm:null, reason:'backfill-incomplete' };
  }

  const useRange = normalizeRange(range);
  const map = getMrmsDailyMap(doc);

  let mm = 0;
  let cursor = startOfDayLocal(useRange.start);
  const end = startOfDayLocal(useRange.end);

  while (cursor <= end){
    const key = toYMDLocal(cursor);
    const row = map.get(key);
    mm += num(row && row.rainMm);
    cursor = addDaysLocal(cursor, 1);
  }

  const inches = mm / 25.4;
  return {
    ready:true,
    mm: round(mm, 2),
    inches: round(inches, 2),
    reason:'ok'
  };
}