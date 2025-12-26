/* =====================================================================
/Farm-vista/js/field-readiness/range.js  (FULL FILE)
Rev: 2025-12-26c

Fix:
- Future months like January were clickable because monthSelect.value was non-numeric (NaN).
- Now we parse month/year from selected option TEXT (and/or value when numeric).

Behavior:
- Future days are greyed out AND hard-blocked (capture-phase stop).
- Future months (any month after current month in current year, or any future year) are fully blocked.

===================================================================== */
'use strict';

export async function loadRangeFromLocalToUI(){
  // Phase later: persistence; keep current behavior for now.
}

const MONTHS = new Map([
  ['jan',0],['january',0],
  ['feb',1],['february',1],
  ['mar',2],['march',2],
  ['apr',3],['april',3],
  ['may',4],
  ['jun',5],['june',5],
  ['jul',6],['july',6],
  ['aug',7],['august',7],
  ['sep',8],['sept',8],['september',8],
  ['oct',9],['october',9],
  ['nov',10],['november',10],
  ['dec',11],['december',11],
]);

function getSelectedText(sel){
  try{
    const i = sel.selectedIndex;
    if (i >= 0 && sel.options && sel.options[i]) return String(sel.options[i].textContent || '').trim();
  }catch(_){}
  return '';
}

function parseMonthFromAny(monthSel){
  // 1) numeric value (0-11 or 1-12)
  const rawVal = monthSel ? String(monthSel.value || '').trim() : '';
  const n = Number(rawVal);
  if (Number.isFinite(n)){
    if (n >= 0 && n <= 11) return n;
    if (n >= 1 && n <= 12) return n - 1;
  }

  // 2) try from selected option text
  const txt = monthSel ? getSelectedText(monthSel) : '';
  const low = txt.toLowerCase();

  // look for month name tokens
  for (const [k, idx] of MONTHS.entries()){
    if (low.includes(k)) return idx;
  }

  // 3) try first 3 letters of text
  const abbr = low.slice(0,3);
  if (MONTHS.has(abbr)) return MONTHS.get(abbr);

  return null;
}

function parseYearFromAny(yearSel){
  // 1) numeric value
  const rawVal = yearSel ? String(yearSel.value || '').trim() : '';
  const n = Number(rawVal);
  if (Number.isFinite(n) && n > 1970 && n < 2100) return n;

  // 2) option text
  const txt = yearSel ? getSelectedText(yearSel) : '';
  const m = txt.match(/(19\d{2}|20\d{2})/);
  if (m) return Number(m[1]);

  return null;
}

export function enforceCalendarNoFuture(){
  const calDays  = document.getElementById('calDays');
  const monthSel = document.getElementById('monthSelect');
  const yearSel  = document.getElementById('yearSelect');
  if (!calDays) return;

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayY  = today.getFullYear();
  const todayM0 = today.getMonth();
  const todayD  = today.getDate();

  function computeShown(){
    const y = parseYearFromAny(yearSel) ?? todayY;
    const m0 = parseMonthFromAny(monthSel);
    const shownM0 = (m0 == null ? todayM0 : m0);
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
      if (!Number.isFinite(n) || n <= 0) continue;

      const future = isFutureDay(n, shown);

      if (future){
        el.style.opacity = '0.35';
        el.setAttribute('aria-disabled','true');
        el.style.pointerEvents = 'none';
      } else {
        el.style.opacity = '';
        el.removeAttribute('aria-disabled');
        el.style.pointerEvents = '';
      }
    }
  }

  // HARD BLOCK: capture phase stop (even if picker tries to handle it)
  function blockIfDisabled(ev){
    const t = ev.target && ev.target.closest ? ev.target.closest('.cal-day[aria-disabled="true"]') : null;
    if (!t) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    return false;
  }

  calDays.addEventListener('pointerdown', blockIfDisabled, true);
  calDays.addEventListener('pointerup', blockIfDisabled, true);
  calDays.addEventListener('click', blockIfDisabled, true);
  calDays.addEventListener('touchstart', blockIfDisabled, true);

  patch();

  // Re-patch when calendar re-renders
  try{
    const mo = new MutationObserver(()=>patch());
    mo.observe(calDays, { childList:true, subtree:true });
  }catch(_){}

  if (monthSel) monthSel.addEventListener('change', ()=>setTimeout(patch,0));
  if (yearSel)  yearSel.addEventListener('change',  ()=>setTimeout(patch,0));
}
