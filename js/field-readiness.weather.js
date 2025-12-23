/* =====================================================================
/Farm-vista/js/field-readiness.weather.js  (FULL FILE)
Rev: 2025-12-23w2

Weather proxy fetch + cache + normalize (Open-Meteo via your Cloud Run)
✅ Keeps existing: localStorage cache + Cloud Run fetch + normalize
✅ NEW: Firestore cache read first (field_weather_cache/{fieldId})
    - Uses firebase-init.js module if available
    - Falls back silently if Firestore isn’t available
===================================================================== */
'use strict';

/* ---------- small helpers ---------- */
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function round(v, d=2){
  const p = Math.pow(10,d);
  return Math.round(v*p)/p;
}
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function mmToIn(mm){ return (Number(mm||0) / 25.4); }
function cToF(c){ return (Number(c) * 9/5) + 32; }

function tsToMs(ts){
  if (!ts) return 0;
  if (typeof ts === 'number' && isFinite(ts)) return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds != null){
    return (Number(ts.seconds) * 1000) + Math.floor(Number(ts.nanoseconds||0) / 1e6);
  }
  return 0;
}

/* ---------- normalize hourly -> daily ---------- */
export function aggregateHourlyToDaily(hourlyCore, hourlyExt, dailyArr){
  const map = new Map();

  function ensure(dateISO){
    let row = map.get(dateISO);
    if (!row){
      row = {
        dateISO,
        rain_mm_sum:0,
        temp_c_sum:0, nt:0,
        wind_mph_sum:0, nw:0,
        rh_sum:0, nrh:0,
        solar_sum:0, ns:0,

        // extras (daily averages)
        cloud_sum:0, ncloud:0,
        vpd_sum:0, nvpd:0,
        dew_sum:0, ndew:0,
        sm010_sum:0, nsm010:0,
        st010_sum:0, nst010:0,

        // daily totals
        et0_mm:null,
        daylight_s:null,
        sunshine_s:null
      };
      map.set(dateISO, row);
    }
    return row;
  }

  for (const h of (hourlyCore||[])){
    const t = String(h.time||'');
    if (t.length < 10) continue;
    const dateISO = t.slice(0,10);
    const row = ensure(dateISO);

    row.rain_mm_sum += Number(h.rain_mm||0);

    const tc = Number(h.temp_c);
    if (isFinite(tc)){ row.temp_c_sum += tc; row.nt++; }

    const w = Number(h.wind_mph);
    if (isFinite(w)){ row.wind_mph_sum += w; row.nw++; }

    const rh = Number(h.rh_pct);
    if (isFinite(rh)){ row.rh_sum += rh; row.nrh++; }

    const s = Number(h.solar_wm2);
    if (isFinite(s)){ row.solar_sum += s; row.ns++; }
  }

  for (const h of (hourlyExt||[])){
    const t = String(h.time||'');
    if (t.length < 10) continue;
    const dateISO = t.slice(0,10);
    const row = ensure(dateISO);

    const cloud = Number(h.cloud_cover_pct);
    if (isFinite(cloud)){ row.cloud_sum += cloud; row.ncloud++; }

    const vpd = Number(h.vapour_pressure_deficit_kpa);
    if (isFinite(vpd)){ row.vpd_sum += vpd; row.nvpd++; }

    const dew = Number(h.dew_point_c);
    if (isFinite(dew)){ row.dew_sum += dew; row.ndew++; }

    const sm = Number(h.soil_moisture_0_10);
    if (isFinite(sm)){ row.sm010_sum += sm; row.nsm010++; }

    const st = Number(h.soil_temp_c_0_10);
    if (isFinite(st)){ row.st010_sum += st; row.nst010++; }
  }

  // Daily array from Cloud Run uses "date" (your current index.js normalizeDaily)
  // Some older payloads may use time/dateISO. Accept all.
  const dailyMap = new Map();
  for (const d of (dailyArr||[])){
    const iso = String(d.dateISO || d.time || d.date || '').slice(0,10);
    if (!iso) continue;
    dailyMap.set(iso, d);
  }

  const out = [...map.values()]
    .sort((a,b)=> a.dateISO.localeCompare(b.dateISO))
    .map(r=>{
      const rainIn = mmToIn(r.rain_mm_sum);
      const tempF = (r.nt ? cToF(r.temp_c_sum / r.nt) : 0);
      const windMph = (r.nw ? (r.wind_mph_sum / r.nw) : 0);
      const rh = (r.nrh ? (r.rh_sum / r.nrh) : 0);
      const solarWm2 = (r.ns ? (r.solar_sum / r.ns) : 0);

      const cloudPct = (r.ncloud ? (r.cloud_sum / r.ncloud) : null);
      const vpdKpa = (r.nvpd ? (r.vpd_sum / r.nvpd) : null);
      const dewF = (r.ndew ? cToF(r.dew_sum / r.ndew) : null);
      const sm010 = (r.nsm010 ? (r.sm010_sum / r.nsm010) : null);
      const st010F = (r.nst010 ? cToF(r.st010_sum / r.nst010) : null);

      const d0 = dailyMap.get(r.dateISO) || {};
      const et0mm = (d0 && isFinite(Number(d0.et0_mm))) ? Number(d0.et0_mm) : null;
      const et0In = (et0mm === null) ? null : mmToIn(et0mm);
      const daylightHr = (d0 && isFinite(Number(d0.daylight_s))) ? (Number(d0.daylight_s)/3600) : null;
      const sunshineHr = (d0 && isFinite(Number(d0.sunshine_s))) ? (Number(d0.sunshine_s)/3600) : null;

      return {
        dateISO: r.dateISO,
        rainIn: round(rainIn, 2),
        tempF: Math.round(tempF),
        windMph: Math.round(windMph),
        rh: Math.round(rh),
        solarWm2: Math.round(solarWm2),

        cloudPct: (cloudPct===null ? null : Math.round(cloudPct)),
        vpdKpa: (vpdKpa===null ? null : round(vpdKpa, 2)),
        dewF: (dewF===null ? null : Math.round(dewF)),
        sm010: (sm010===null ? null : round(sm010, 3)),
        st010F: (st010F===null ? null : Math.round(st010F)),

        et0In: (et0In===null ? null : round(et0In, 2)),
        daylightHr: (daylightHr===null ? null : round(daylightHr, 1)),
        sunshineHr: (sunshineHr===null ? null : round(sunshineHr, 1))
      };
    });

  // Keep your existing model behavior: history only (<= today)
  const tISO = todayISO();
  const hist = out.filter(d=> d.dateISO && d.dateISO <= tISO);
  return hist.slice(-30);
}

export function summarizeAvailability(wxJson){
  const out = { hourly_core:true, hourly_ext:false, daily:false, vars:{} };
  const norm = wxJson && wxJson.normalized ? wxJson.normalized : null;

  const hourly = norm && Array.isArray(norm.hourly) ? norm.hourly : [];
  const hourly_ext = norm && Array.isArray(norm.hourly_ext) ? norm.hourly_ext : [];
  const daily = norm && Array.isArray(norm.daily) ? norm.daily : [];

  out.hourly_ext = hourly_ext.length > 0;
  out.daily = daily.length > 0;

  out.vars.rain_mm = { label:'Precipitation', ok: hourly.length > 0 };
  out.vars.temp_c = { label:'Air temperature', ok: hourly.length > 0 };
  out.vars.wind_mph = { label:'Wind speed', ok: hourly.length > 0 };
  out.vars.rh_pct = { label:'Relative humidity', ok: hourly.length > 0 };
  out.vars.solar_wm2 = { label:'Shortwave radiation', ok: hourly.length > 0 };

  const extKeys = [
    ['cloud_cover_pct','Cloud cover'],
    ['vapour_pressure_deficit_kpa','VPD'],
    ['dew_point_c','Dew point'],
    ['soil_temp_c_0_10','Soil temp 0–10cm'],
    ['soil_moisture_0_10','Soil moisture 0–10cm']
  ];
  for (const [k,label] of extKeys){
    let ok = false;
    for (let i=0; i<Math.min(72, hourly_ext.length); i++){
      const v = hourly_ext[i] ? hourly_ext[i][k] : null;
      if (v !== null && v !== undefined && isFinite(Number(v))){ ok = true; break; }
    }
    out.vars[k] = { label, ok };
  }

  const extPulledNotUsed = [
    ['soil_temp_c_10_40','Soil temp 10–40cm'],
    ['soil_temp_c_40_100','Soil temp 40–100cm'],
    ['soil_temp_c_100_200','Soil temp 100–200cm'],
    ['soil_moisture_10_40','Soil moisture 10–40cm'],
    ['soil_moisture_40_100','Soil moisture 40–100cm'],
    ['soil_moisture_100_200','Soil moisture 100–200cm']
  ];
  for (const [k,label] of extPulledNotUsed){
    let ok = false;
    for (let i=0; i<Math.min(72, hourly_ext.length); i++){
      const v = hourly_ext[i] ? hourly_ext[i][k] : null;
      if (v !== null && v !== undefined && isFinite(Number(v))){ ok = true; break; }
    }
    out.vars[k] = { label, ok };
  }

  const dailyKeys = [
    ['et0_mm','ET₀'],
    ['daylight_s','Daylight duration'],
    ['sunshine_s','Sunshine duration']
  ];
  for (const [k,label] of dailyKeys){
    let ok = false;
    for (let i=0; i<Math.min(14, daily.length); i++){
      const v = daily[i] ? daily[i][k] : null;
      if (v !== null && v !== undefined && isFinite(Number(v))){ ok = true; break; }
    }
    out.vars[k] = { label, ok };
  }

  return out;
}

/* ---------- cache helpers (caller supplies constants + state maps) ---------- */
function cacheKey(prefix, fieldId){ return prefix + String(fieldId||''); }

function readWxCache(prefix, ttlMs, fieldId){
  try{
    const raw = localStorage.getItem(cacheKey(prefix, fieldId));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.fetchedAt || !Array.isArray(obj.daily)) return null;
    if ((Date.now() - Number(obj.fetchedAt)) > ttlMs) return null;
    return obj;
  }catch(_){ return null; }
}

function writeWxCache(prefix, fieldId, obj){
  try{
    localStorage.setItem(cacheKey(prefix, fieldId), JSON.stringify(obj));
  }catch(_){}
}

/* ---------- Firestore cache read (NEW) ---------- */
let __fbModPromise = null;
async function getFirebaseMod(){
  if (__fbModPromise) return __fbModPromise;
  __fbModPromise = (async()=>{
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      if (mod && mod.ready) await mod.ready;
      return mod;
    }catch(_){
      return null;
    }
  })();
  return __fbModPromise;
}

async function readFromFirestoreCache(fieldId, collectionName){
  const mod = await getFirebaseMod();
  if (!mod) return null;

  // Need modular methods
  if (!(mod.getFirestore && mod.getDoc && mod.doc)) return null;

  try{
    const db = mod.getFirestore();
    const ref = mod.doc(db, String(collectionName||'field_weather_cache'), String(fieldId));
    const snap = await mod.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()) return null;

    const data = snap.data() || {};
    const norm = data.normalized || {};
    const hourlyCore = Array.isArray(norm.hourly) ? norm.hourly : [];
    const hourlyExt  = Array.isArray(norm.hourly_ext) ? norm.hourly_ext : [];
    const dailyArr   = Array.isArray(norm.daily) ? norm.daily : [];

    const dailySeries = aggregateHourlyToDaily(hourlyCore, hourlyExt, dailyArr);

    const fetchedAtMs = tsToMs(data.fetchedAt) || Date.now();
    const availability = summarizeAvailability({ normalized: norm });

    const wxInfo = {
      source: String(data.source || 'firestore'),
      fetchedAt: fetchedAtMs,
      units: (norm.meta && norm.meta.units) ? norm.meta.units : null,
      availability
    };

    return { fetchedAt: fetchedAtMs, daily: dailySeries, wxInfo };
  }catch(_){
    return null;
  }
}

/* ---------- public API ---------- */
export async function fetchWeatherForField(field, ctx, force=false){
  // ctx requires:
  // { WX_ENDPOINT, WX_TTL_MS, WX_CACHE_PREFIX, timezone, weatherByFieldId, wxInfoByFieldId, weather30 }
  if (!field || !field.location) return null;

  // 1) LocalStorage cache (existing)
  if (!force){
    const cached = readWxCache(ctx.WX_CACHE_PREFIX, ctx.WX_TTL_MS, field.id);
    if (cached){
      ctx.weatherByFieldId.set(field.id, cached.daily || []);
      ctx.wxInfoByFieldId.set(field.id, cached.wxInfo || { source:'cache', fetchedAt: cached.fetchedAt });
      return cached.daily || [];
    }
  }

  // 2) Firestore cache (NEW) — uses scheduled batch results
  if (!force){
    const col = (ctx && ctx.WX_FIRESTORE_COLLECTION) ? String(ctx.WX_FIRESTORE_COLLECTION) : 'field_weather_cache';
    const fsCached = await readFromFirestoreCache(field.id, col);
    if (fsCached && Array.isArray(fsCached.daily)){
      ctx.weatherByFieldId.set(field.id, fsCached.daily || []);
      ctx.wxInfoByFieldId.set(field.id, fsCached.wxInfo || { source:'firestore', fetchedAt: fsCached.fetchedAt });

      // mirror into localStorage so paging/sorting stays fast and offline-friendly
      writeWxCache(ctx.WX_CACHE_PREFIX, field.id, {
        fetchedAt: fsCached.fetchedAt,
        daily: fsCached.daily,
        wxInfo: fsCached.wxInfo
      });

      if (!ctx.weather30.length && fsCached.daily && fsCached.daily.length){
        ctx.weather30 = fsCached.daily.slice();
      }

      return fsCached.daily || [];
    }
  }

  // 3) Cloud Run (existing fallback)
  const lat = field.location.lat;
  const lng = field.location.lng;

  const url =
    `${ctx.WX_ENDPOINT}?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}` +
    `&days=30&timezone=${encodeURIComponent(ctx.timezone || 'America/Chicago')}`;

  const r = await fetch(url, { method:'GET', cache:'no-store' });
  if (!r.ok) throw new Error(`Weather proxy ${r.status}`);

  const json = await r.json();
  if (!json || json.ok !== true) throw new Error('Weather proxy response not ok');

  const norm = json.normalized || {};
  const hourlyCore = Array.isArray(norm.hourly) ? norm.hourly : [];
  const hourlyExt = Array.isArray(norm.hourly_ext) ? norm.hourly_ext : [];
  const dailyArr  = Array.isArray(norm.daily) ? norm.daily : [];

  const dailySeries = aggregateHourlyToDaily(hourlyCore, hourlyExt, dailyArr);

  ctx.weatherByFieldId.set(field.id, dailySeries);

  const availability = summarizeAvailability(json);
  const wxInfo = {
    source: String(json.source || 'open-meteo'),
    fetchedAt: Date.now(),
    units: (norm.meta && norm.meta.units) ? norm.meta.units : null,
    availability
  };
  ctx.wxInfoByFieldId.set(field.id, wxInfo);

  writeWxCache(ctx.WX_CACHE_PREFIX, field.id, { fetchedAt: wxInfo.fetchedAt, daily: dailySeries, wxInfo });

  if (!ctx.weather30.length && dailySeries && dailySeries.length){
    ctx.weather30 = dailySeries.slice();
  }

  return dailySeries;
}

export async function warmWeatherForFields(fields, ctx, opts){
  const force = !!(opts && opts.force);
  const onEach = (opts && typeof opts.onEach === 'function') ? opts.onEach : null;

  const list = (fields||[]).slice();
  if (!list.length) return;

  const maxConc = 4;
  let idx = 0;

  async function worker(){
    while (idx < list.length){
      const my = list[idx++];
      try{
        await fetchWeatherForField(my, ctx, force);
      }catch(e){
        console.warn('[FieldReadiness] weather fetch failed for', my?.name, e?.message || e);
      }finally{
        if (onEach) onEach();
      }
    }
  }

  const workers = [];
  for (let i=0; i<Math.min(maxConc, list.length); i++) workers.push(worker());
  await Promise.all(workers);
}

export function getWeatherSeriesForFieldId(fieldId, ctx){
  const s = ctx.weatherByFieldId.get(fieldId);
  if (s && s.length) return s;
  if (ctx.weather30 && ctx.weather30.length) return ctx.weather30;
  return [];
}
