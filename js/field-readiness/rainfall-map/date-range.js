import { LS_RANGE_KEY } from './config.js';
import { appState } from './store.js';

export function startOfDay(date){
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date){
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function dateToISO(date){
  const d = startOfDay(date);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(value){
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

export function formatRangeDate(date){
  const d = startOfDay(date);
  if (!d) return '';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function getPickerApi(){
  return (window.FVDateRangePicker && typeof window.FVDateRangePicker.getRange === 'function')
    ? window.FVDateRangePicker
    : null;
}

export function getDefault72HourRange(){
  const end = endOfDay(new Date());
  const start = startOfDay(new Date(end.getTime() - (72 * 60 * 60 * 1000)));
  return { start, end };
}

export function getLast72hDateRangeISO(){
  const def = getDefault72HourRange();
  return {
    startISO: dateToISO(def.start),
    endISO: dateToISO(def.end)
  };
}

export function applyDefault72HourRangeToPicker(opts={}){
  const picker = getPickerApi();
  if (!picker) return false;

  const r = picker.getRange();
  const hasRange = !!(
    r &&
    String(r.startISO || '').trim() &&
    String(r.endISO || '').trim()
  );
  if (hasRange) return false;

  const def = getDefault72HourRange();
  picker.setRange(def.start, def.end, { silent: !!opts.silent });
  return true;
}

export function getCurrentRangeDisplay(){
  if (appState.currentRangeStartISO && appState.currentRangeEndISO){
    const s = parseISODate(appState.currentRangeStartISO);
    const e = parseISODate(appState.currentRangeEndISO);
    if (s && e) return `${formatRangeDate(s)} – ${formatRangeDate(e)}`;
  }
  const def = getDefault72HourRange();
  return `${formatRangeDate(def.start)} – ${formatRangeDate(def.end)}`;
}

export function rangeTitle(){
  if (appState.currentRangeStartISO && appState.currentRangeEndISO){
    const s = parseISODate(appState.currentRangeStartISO);
    const e = parseISODate(appState.currentRangeEndISO);
    if (s && e) return `Rain — ${formatRangeDate(s)} to ${formatRangeDate(e)}`;
  }
  const def = getDefault72HourRange();
  return `Rain — ${formatRangeDate(def.start)} to ${formatRangeDate(def.end)}`;
}

export function readinessTitle(){
  return 'Field Readiness';
}

export function getActiveRangeState(){
  const picker = getPickerApi();
  if (picker){
    const r = picker.getRange();
    const startISO = String(r && r.startISO || '').trim();
    const endISO = String(r && r.endISO || '').trim();
    if (startISO && endISO){
      return {
        key: `custom:${startISO}:${endISO}`,
        startISO,
        endISO
      };
    }
  }

  const def = getDefault72HourRange();
  const startISO = dateToISO(def.start);
  const endISO = dateToISO(def.end);

  return {
    key: `default72h:${startISO}:${endISO}`,
    startISO,
    endISO
  };
}

export function saveCurrentRangeToLocal(){
  try{
    localStorage.setItem(LS_RANGE_KEY, JSON.stringify({
      startISO: appState.currentRangeStartISO || '',
      endISO: appState.currentRangeEndISO || ''
    }));
  }catch(_){}
}

export function restoreCurrentRangeFromLocal(){
  try{
    const raw = String(localStorage.getItem(LS_RANGE_KEY) || '').trim();
    const picker = getPickerApi();
    if (!picker) return false;

    if (!raw){
      return applyDefault72HourRangeToPicker({ silent:true });
    }

    const parsed = JSON.parse(raw);
    const startISO = String(parsed && parsed.startISO || '').trim();
    const endISO = String(parsed && parsed.endISO || '').trim();

    if (startISO && endISO){
      picker.setRange(startISO, endISO, { silent:true });
      return true;
    }

    picker.clear({ silent:true });
    return applyDefault72HourRangeToPicker({ silent:true });
  }catch(_){
    return applyDefault72HourRangeToPicker({ silent:true });
  }
}

export function syncCurrentRangeFromPicker(persist=true){
  const next = getActiveRangeState();
  appState.currentRangeKey = next.key;
  appState.currentRangeStartISO = next.startISO;
  appState.currentRangeEndISO = next.endISO;
  if (persist) saveCurrentRangeToLocal();
}
