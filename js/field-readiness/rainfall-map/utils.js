export function lower(s){
  return String(s || '').trim().toLowerCase();
}

export function toNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function clamp(v, min, max){
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function escapeHtml(s){
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function retry(fn, tries=3, waitMs=250){
  let lastErr = null;
  for (let i = 0; i < tries; i++){
    try{
      return await fn();
    }catch(err){
      lastErr = err;
      if (i < tries - 1) await sleep(waitMs * (i + 1));
    }
  }
  throw lastErr;
}

export function isPermissionError(err){
  const msg = String(err && (err.message || err.code || err) || '').toLowerCase();
  return msg.includes('insufficient permissions') || msg.includes('permission-denied');
}

export function lerp(a, b, t){
  return a + ((b - a) * t);
}

export function colorFromGradientStops(t, stops){
  const x = clamp(Number(t || 0), 0, 1);
  const arr = Array.isArray(stops) ? stops.slice() : [];
  if (!arr.length) return 'rgb(88,168,255)';
  if (x <= arr[0].t) return `rgb(${arr[0].c[0]}, ${arr[0].c[1]}, ${arr[0].c[2]})`;
  if (x >= arr[arr.length - 1].t){
    const c = arr[arr.length - 1].c;
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  for (let i = 0; i < arr.length - 1; i++){
    const a = arr[i];
    const b = arr[i + 1];
    if (x >= a.t && x <= b.t){
      const localT = (x - a.t) / Math.max(0.000001, (b.t - a.t));
      const r = Math.round(lerp(a.c[0], b.c[0], localT));
      const g = Math.round(lerp(a.c[1], b.c[1], localT));
      const bb = Math.round(lerp(a.c[2], b.c[2], localT));
      return `rgb(${r}, ${g}, ${bb})`;
    }
  }

  const last = arr[arr.length - 1].c;
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
}
