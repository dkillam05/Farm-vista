/* =====================================================================
/Farm-vista/js/field-readiness/rain.js  (FULL FILE)
Rev: 2025-12-26a

Shared rain-range helpers used by:
- render.js (tiles)
- quickview.js (popup)

Fixes the classic date shift bug by parsing YYYY-MM-DD in LOCAL time.
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
  const out = new Date(y, mo, d, 12, 0, 0, 0); // local noon = no day shift
  return isFinite(out.getTime()) ? out : null;
}

export function parseRangeFromInput(){
  const inp = $('jobRangeInput');
  const raw = String(inp ? inp.value : '').trim();
  if (!raw) return { start:null, end:null };

  const parts = raw.split('–').map(s=>s.trim());
  if (parts.length === 2){
    const a = parseYMDLocal(parts[0]);
    const b = parseYMDLocal(parts[1]);
    if (a && b){
      a.setHours(0,0,0,0);
      b.setHours(23,59,59,999);
      return { start:a, end:b };
    }
  }

  const d = parseYMDLocal(raw);
  if (d){
    d.setHours(0,0,0,0);
    const e = new Date(d);
    e.setHours(23,59,59,999);
    return { start:d, end:e };
  }

  return { start:null, end:null };
}

export function isDateInRange(dateISO, range){
  if (!range || !range.start || !range.end) return true;

  const d = parseYMDLocal(dateISO);
  if (!d) return true; // fail-open
  // compare using local time
  return d >= range.start && d <= range.end;
}

export function rainInRange(run, range){
  if (!run || !run.rows) return 0;
  let sum = 0;
  for (const r of run.rows){
    if (isDateInRange(r.dateISO, range)){
      sum += Number(r.rainInAdj || 0);
    }
  }
  return round(sum, 2);
}
