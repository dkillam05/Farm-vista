/* =====================================================================
/Farm-vista/js/field-readiness/range.js  (FULL FILE)
Rev: 2025-12-26d

Fix:
- When viewing the current month, the calendar grid may show next-month days
  (e.g., Jan 1–10) marked .other-month. Those are now treated as NEXT MONTH
  and are hard-blocked if they’re in the future.

Rules:
- Determine shown month/year from selectors (value OR option text).
- For each .cal-day:
    - if .other-month and in first ~2 rows -> previous month
    - if .other-month and in last  ~2 rows -> next month
    - else -> shown month
- Any cell whose actual date is after today is disabled + unclickable.

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
  const rawVal = monthSel ? String(monthSel.value || '').trim() : '';
  const n = Number(rawVal);
  if (Number.isFinite(n)){
    if (n >= 0 && n <= 11) return n;
    if (n >= 1 && n <= 12) return n - 1;
  }

  const txt = monthSel ? getSelectedText(monthSel) : '';
  const low = txt.toLowerCase();

  for (const [k, idx] of MONTHS.entries()){
    if (low.includes(k)) return idx;
  }

  const abbr = low.slice(0,3);
  if (MONTHS.has(abbr)) return MONTHS.get(abbr);

  return null;
}

function parseYearFromAny(yearSel){
  const rawVal = yearSel ? String(yearSel.value || '').trim() : '';
  const n = Number(rawVal);
  if (Number.isFinite(n) && n > 1970 && n < 2100) return n;

  const txt = yearSel ? getSelectedText(yearSel) : '';
  const m = txt.match(/(19\d{2}|20\d{2})/);
  if (m) return Number(m[1]);

  return null;
}

function addMonths(y, m0, delta){
  let yy = y;
  let mm = m0 + delta;
  while (mm < 0){ mm += 12; yy -= 1; }
  while (mm > 11){ mm -= 12; yy += 1; }
  return { y: yy, m0: mm };
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
    return { y, m0: shownM0 };
  }

  function actualCellYM(shown, el, idx, total){
    // If not other-month -> shown
    if (!el.classList.contains('other-month')) return { y: shown.y, m0: shown.m0 };

    // Heuristic using position in grid:
    // first ~14 cells => previous month
    // last  ~14 cells => next month
    // (works for typical 35/42-day grids)
    const HEAD_CELLS = 14;
    const TAIL_CELLS = 14;

    if (idx < HEAD_CELLS){
      return addMonths(shown.y, shown.m0, -1);
    }
    if (idx >= Math.max(0, total - TAIL_CELLS)){
      return addMonths(shown.y, shown.m0, +1);
    }

    // Fallback: assume shown month
    return { y: shown.y, m0: shown.m0 };
  }

  function isFutureDate(y, m0, d){
    // Compare to today's Y/M/D
    if (y > todayY) return true;
    if (y < todayY) return false;
    if (m0 > todayM0) return true;
    if (m0 < todayM0) return false;
    return d > todayD;
  }

  function patch(){
    const shown = computeShown();
    const days = Array.from(calDays.querySelectorAll('.cal-day'));
    const total = days.length || 0;

    days.forEach((el, idx)=>{
      const n = Number((el.textContent||'').trim());
      if (!Number.isFinite(n) || n <= 0) return;

      const ym = actualCellYM(shown, el, idx, total);
      const future = isFutureDate(ym.y, ym.m0, n);

      if (future){
        el.style.opacity = '0.35';
        el.setAttribute('aria-disabled','true');
        el.style.pointerEvents = 'none';
      } else {
        el.style.opacity = '';
        el.removeAttribute('aria-disabled');
        el.style.pointerEvents = '';
      }
    });
  }

  // HARD BLOCK clicks/taps on disabled days
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

  try{
    const mo = new MutationObserver(()=>patch());
    mo.observe(calDays, { childList:true, subtree:true });
  }catch(_){}

  if (monthSel) monthSel.addEventListener('change', ()=>setTimeout(patch,0));
  if (yearSel)  yearSel.addEventListener('change',  ()=>setTimeout(patch,0));
}
