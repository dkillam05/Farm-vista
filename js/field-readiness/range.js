/* =====================================================================
/Farm-vista/js/field-readiness/range.js  (FULL FILE)
Rev: 2025-12-26b

- Greys out future days
- HARD blocks clicks/taps on future days (even if picker re-renders)
===================================================================== */
'use strict';

export async function loadRangeFromLocalToUI(){
  // Phase later: persistence; keep current behavior for now.
}

export function enforceCalendarNoFuture(){
  const calDays = document.getElementById('calDays');
  const monthSel = document.getElementById('monthSelect');
  const yearSel  = document.getElementById('yearSelect');
  if (!calDays) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayY = today.getFullYear();
  const todayM0 = today.getMonth();
  const todayD = today.getDate();

  function computeShown(){
    const y = yearSel ? Number(yearSel.value) : todayY;
    const m = monthSel ? Number(monthSel.value) : todayM0;
    const shownM0 = (m > 11) ? (m-1) : m; // tolerate 1-12 or 0-11
    return { y, shownM0 };
  }

  function isFutureDay(dayNum, shown){
    if (shown.y > todayY) return true;
    if (shown.y === todayY && shown.shownM0 > todayM0) return true;
    if (shown.y === todayY && shown.shownM0 === todayM0 && dayNum > todayD) return true;
    return false;
  }

  function patch(){
    const shown = computeShown();
    const days = Array.from(calDays.querySelectorAll('.cal-day'));
    for (const el of days){
      const n = Number((el.textContent||'').trim());
      if (!isFinite(n) || n <= 0) continue;

      const future = isFutureDay(n, shown);
      if (future){
        el.style.opacity = '0.35';
        el.setAttribute('aria-disabled','true');
        // best-effort: stop pointer events
        el.style.pointerEvents = 'none';
      } else {
        el.style.opacity = '';
        el.removeAttribute('aria-disabled');
        el.style.pointerEvents = '';
      }
    }
  }

  // HARD BLOCK: if anything marked aria-disabled is clicked, kill it (capture phase)
  function blockIfDisabled(ev){
    const t = ev.target && ev.target.closest ? ev.target.closest('.cal-day[aria-disabled="true"]') : null;
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    return false;
  }

  // Attach blockers once
  calDays.addEventListener('pointerdown', blockIfDisabled, true);
  calDays.addEventListener('pointerup', blockIfDisabled, true);
  calDays.addEventListener('click', blockIfDisabled, true);

  patch();

  // Re-patch on redraws
  try{
    const mo = new MutationObserver(()=>patch());
    mo.observe(calDays, { childList:true, subtree:true });
  }catch(_){}

  if (monthSel) monthSel.addEventListener('change', ()=>setTimeout(patch,0));
  if (yearSel)  yearSel.addEventListener('change',  ()=>setTimeout(patch,0));
}
