/* =====================================================================
/Farm-vista/js/field-readiness/range.js  (FULL FILE)
Rev: 2025-12-26a

Phase 1: enforce "no future day selectable" in your calendar.
Phase 2: we will migrate parseRangeFromInput here and add persistence.
===================================================================== */
'use strict';

import { } from './utils.js';

export async function loadRangeFromLocalToUI(){
  // left intentionally blank in Phase 1 to match current working behavior
  // (your working file does not persist range yet)
}

export function enforceCalendarNoFuture(){
  const calDays = document.getElementById('calDays');
  const monthSel = document.getElementById('monthSelect');
  const yearSel = document.getElementById('yearSelect');
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
