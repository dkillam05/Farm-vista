/* =====================================================================
/Farm-vista/js/field-readiness/range.js  (FULL FILE)
Rev: 2025-12-26a

Owns:
- local-safe YYYY-MM-DD parsing (prevents “backs up one day”)
- default last 30 days
- clamp no future
- persists range text
- disables future days in your custom calendar UI
===================================================================== */
'use strict';

import { CONSTANTS } from './state.js';

const $ = (id)=>document.getElementById(id);

export function initRange(state){
  // Hook minimal listeners here (ui.js will wire buttons too)
  // Also enforce “no future day click” on the calendar
  queueMicrotask(()=> enforceCalendarNoFuture());
}

export function loadRangeToUI(state){
  const inp = $('jobRangeInput');
  if (!inp) return;

  let raw = '';
  try{ raw = String(localStorage.getItem(CONSTANTS.LS_RANGE_KEY) || ''); }catch(_){ raw=''; }
  raw = (raw||'').trim();

  if (raw){
    inp.value = raw;
    const clamped = clampRangeNoFuture(parseRangeFromText(raw));
    if (clamped && clamped.start && clamped.end){
      inp.value = fmtRangeText(clamped.start, clamped.end);
      try{ localStorage.setItem(CONSTANTS.LS_RANGE_KEY, inp.value); }catch(_){}
    }
    state.rangeText = inp.value;
    return;
  }

  const def = defaultLast30();
  inp.value = fmtRangeText(def.start, def.end);
  state.rangeText = inp.value;
  try{ localStorage.setItem(CONSTANTS.LS_RANGE_KEY, inp.value); }catch(_){}
}

export function saveRangeFromUI(state){
  const inp = $('jobRangeInput');
  if (!inp) return;
  const r0 = parseRangeFromText(String(inp.value||''));
  const r = clampRangeNoFuture(r0);
  if (r && r.start && r.end){
    inp.value = fmtRangeText(r.start, r.end);
  }
  state.rangeText = String(inp.value||'');
  try{ localStorage.setItem(CONSTANTS.LS_RANGE_KEY, state.rangeText); }catch(_){}
}

export function getRange(state){
  const inp = $('jobRangeInput');
  const raw = String(inp ? inp.value : state.rangeText || '').trim();
  const r0 = parseRangeFromText(raw);

  if (!r0.start || !r0.end) return defaultLast30();
  return clampRangeNoFuture(r0);
}

/* ---------- date utils (LOCAL SAFE) ---------- */
function parseYMDLocal(ymd){
  const s = String(ymd||'').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const out = new Date(y, mo, d, 12, 0, 0, 0); // local noon prevents day shift
  return isFinite(out.getTime()) ? out : null;
}
function toISODateLocal(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function endOfTodayLocal(){
  const t = new Date();
  t.setHours(23,59,59,999);
  return t;
}
function defaultLast30(){
  const end = endOfTodayLocal();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  start.setHours(0,0,0,0);
  return { start, end };
}
function fmtRangeText(start, end){
  const a = new Date(start); a.setHours(0,0,0,0);
  const b = new Date(end);   b.setHours(23,59,59,999);
  return `${toISODateLocal(a)} – ${toISODateLocal(b)}`;
}
function parseRangeFromText(raw){
  const s = String(raw||'').trim();
  if (!s) return { start:null, end:null };

  const parts = s.split('–').map(x=>x.trim());
  if (parts.length === 2){
    const a = parseYMDLocal(parts[0]);
    const b = parseYMDLocal(parts[1]);
    if (a && b){
      a.setHours(0,0,0,0);
      b.setHours(23,59,59,999);
      return { start:a, end:b };
    }
  }

  const d = parseYMDLocal(s);
  if (d){
    d.setHours(0,0,0,0);
    const e = new Date(d);
    e.setHours(23,59,59,999);
    return { start:d, end:e };
  }

  return { start:null, end:null };
}
function clampRangeNoFuture(r){
  if (!r || !r.start || !r.end) return r;
  const tEnd = endOfTodayLocal();
  if (r.end > tEnd){
    const out = { start:new Date(r.start), end:new Date(tEnd) };
    out.start.setHours(0,0,0,0);
    out.end.setHours(23,59,59,999);
    return out;
  }
  return r;
}

/* ---------- calendar future-day disable (best-effort) ---------- */
function enforceCalendarNoFuture(){
  const calDays = $('calDays');
  const monthSel = $('monthSelect');
  const yearSel = $('yearSelect');
  if (!calDays) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayY = today.getFullYear();
  const todayM0 = today.getMonth();
  const todayD = today.getDate();

  function patch(){
    const y = yearSel ? Number(yearSel.value) : todayY;
    const m = monthSel ? Number(monthSel.value) : todayM0;
    const shownM0 = (m > 11) ? (m-1) : m;

    const days = Array.from(calDays.querySelectorAll('.cal-day'));
    for (const el of days){
      const n = Number((el.textContent||'').trim());
      if (!isFinite(n) || n <= 0) continue;

      let future = false;
      if (y > todayY) future = true;
      else if (y === todayY && shownM0 > todayM0) future = true;
      else if (y === todayY && shownM0 === todayM0 && n > todayD) future = true;

      if (future){
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.35';
        el.setAttribute('aria-disabled','true');
      } else {
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.removeAttribute('aria-disabled');
      }
    }
  }

  patch();

  try{
    const mo = new MutationObserver(()=>patch());
    mo.observe(calDays, { childList:true, subtree:true });
  }catch(_){}

  if (monthSel) monthSel.addEventListener('change', ()=>setTimeout(patch,0));
  if (yearSel)  yearSel.addEventListener('change',  ()=>setTimeout(patch,0));
}
