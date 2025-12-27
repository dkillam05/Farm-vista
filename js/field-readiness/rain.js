/* =====================================================================
/Farm-vista/js/field-readiness/rain.js  (FULL FILE)
Rev: 2025-12-26b

Fix:
- Range input can be "Dec 1, 2025 – Dec 26, 2025" or "12/1/2025 – 12/26/2025"
  not just YYYY-MM-DD.
- Now parses both formats reliably (local noon to avoid day shift).

Used by:
- render.js (tiles)
- quickview.js (popup)

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

  // Try MM/DD/YYYY manually (some browsers are picky)
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

  // Split on en dash used by your UI: " – "
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
  // run rows are "YYYY-MM-DD"
  return parseYMDLocal(dateISO);
}

export function isDateInRange(dateISO, range){
  if (!range || !range.start || !range.end) return true;

  const d = parseISODateFromRun(dateISO);
  if (!d) return true; // fail-open (should not happen)
  return d >= range.start && d <= range.end;
}

export function rainInRange(run, range){
  if (!run || !run.rows) return 0;

  // If range failed to parse, do NOT pretend everything is in range.
  // Instead treat as "no range" (0 effect) by returning the existing behavior:
  // In your UI, blank range means totals might be full period; but user expects range to work.
  // We'll keep legacy: if no valid range, include all.
  const hasRange = !!(range && range.start && range.end);

  let sum = 0;
  for (const r of run.rows){
    if (!hasRange || isDateInRange(r.dateISO, range)){
      sum += Number(r.rainInAdj || 0);
    }
  }
  return round(sum, 2);
}
