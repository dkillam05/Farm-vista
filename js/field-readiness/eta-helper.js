/* =====================================================================
/Farm-vista/js/field-readiness/eta-helper.js  (FULL FILE)
Rev: 2026-01-08b

Field ETA Helper (per Dane):
✅ Listens for "fr:eta-help"
✅ Opens a FarmVista-style modal explaining the ETA text
✅ Shows:
   - Helper explanation (what ETA means)
   - Snapshot (operation threshold, readiness now, ETA, horizon)
   - Forecast inputs table (next 7 days INCLUDING today remaining hours if available)

FIXES (this rev):
✅ Modal owns vertical scroll
✅ Background page scroll locked while modal open
✅ Forecast grid keeps horizontal scroll
===================================================================== */
'use strict';

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function mmToIn(mm){ return (Number(mm||0) / 25.4); }
function cToF(c){ return (Number(c) * 9/5) + 32; }
function round(v, d=2){
  const p = Math.pow(10,d);
  return Math.round(Number(v||0)*p)/p;
}
function parseTimeMsLocal(t){
  try{
    if (!t || typeof t !== 'string') return NaN;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : NaN;
  }catch(_){ return NaN; }
}

/* =====================================================================
   Firebase modular loader (matches your other modules)
===================================================================== */
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

async function readForecastCacheDoc(fieldId, collectionName){
  const mod = await getFirebaseMod();
  if (!mod || !(mod.getFirestore && mod.getDoc && mod.doc)) return null;

  try{
    const db = mod.getFirestore();
    const ref = mod.doc(db, String(collectionName||'field_weather_cache'), String(fieldId));
    const snap = await mod.getDoc(ref);
    if (!snap || !snap.exists || !snap.exists()) return null;
    return snap.data() || null;
  }catch(_){
    return null;
  }
}

function computeTodayRemainingFromHourly(norm){
  try{
    const hourly = Array.isArray(norm && norm.hourly) ? norm.hourly : [];
    if (!hourly.length) return null;

    const tISO = todayISO();
    const nowMs = Date.now();

    let rainMm = 0;
    let tempCSum = 0, nt=0;
    let windSum = 0, nw=0;
    let rhSum = 0, nr=0;
    let solarSum = 0, ns=0;

    for (const h of hourly){
      const time = String(h.time || '');
      if (time.length < 10) continue;
      const dayISO = time.slice(0,10);
      if (dayISO !== tISO) continue;

      const ms = parseTimeMsLocal(time);
      if (!Number.isFinite(ms)) continue;
      if (ms <= nowMs) continue;

      rainMm += Number(h.rain_mm || 0);

      const tc = Number(h.temp_c);
      if (Number.isFinite(tc)){ tempCSum += tc; nt++; }

      const w = Number(h.wind_mph);
      if (Number.isFinite(w)){ windSum += w; nw++; }

      const rh = Number(h.rh_pct);
      if (Number.isFinite(rh)){ rhSum += rh; nr++; }

      const s = Number(h.solar_wm2);
      if (Number.isFinite(s)){ solarSum += s; ns++; }
    }

    if (rainMm === 0 && nt === 0 && nw === 0 && nr === 0 && ns === 0) return null;

    return {
      dateISO: `${tISO} (remaining)`,
      rainIn: round(mmToIn(rainMm), 2),
      tempF: nt ? Math.round(cToF(tempCSum/nt)) : 0,
      windMph: nw ? Math.round(windSum/nw) : 0,
      rh: nr ? Math.round(rhSum/nr) : 0,
      solarWm2: ns ? Math.round(solarSum/ns) : 0,
      et0In: null,
      sm010: null,
      st010F: null
    };
  }catch(_){
    return null;
  }
}

function normalizeRowForTable(r0){
  const r = r0 || {};
  const dateISO = String(r.dateISO || '—').slice(0, 32);

  const rain = Number(r.rainInAdj ?? r.rainIn ?? 0);
  const temp = Math.round(Number(r.temp ?? r.tempF ?? 0));
  const wind = Math.round(Number(r.wind ?? r.windMph ?? 0));
  const rh = Math.round(Number(r.rh ?? 0));
  const solar = Math.round(Number(r.solar ?? r.solarWm2 ?? 0));

  const et0Num = (r.et0In == null ? r.et0 : r.et0In);
  const et0 = (et0Num == null ? '—' : Number(et0Num).toFixed(2));

  const sm010 = (r.sm010 == null ? '—' : Number(r.sm010).toFixed(3));
  const st010F = (r.st010F == null ? '—' : String(Math.round(Number(r.st010F))));

  return { dateISO, rain, temp, wind, rh, solar, et0, sm010, st010F };
}

/* =====================================================================
   Modal DOM
===================================================================== */
function ensureModal(){
  let bd = document.getElementById('fvEtaHelpBackdrop');
  if (bd) return bd;

  bd = document.createElement('div');
  bd.id = 'fvEtaHelpBackdrop';
  bd.className = 'modal-backdrop pv-hide';
  bd.setAttribute('role','dialog');
  bd.setAttribute('aria-modal','true');
  bd.setAttribute('aria-labelledby','fvEtaHelpTitle');

  bd.innerHTML = `
    <div class="modal">
      <div class="modal-h">
        <h3 id="fvEtaHelpTitle">ETA Helper</h3>
        <button class="xbtn" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="muted" style="font-size:12px; margin-top:4px;" id="fvEtaHelpSub">—</div>
      </div>
      <div class="modal-b" id="fvEtaHelpBody">
        <div class="help">—</div>
      </div>
    </div>
  `;

  // scroll lock helpers
  bd._lockScroll = ()=>{
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };
  bd._unlockScroll = ()=>{
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  };

  // close behaviors
  const close = ()=>{
    bd.classList.add('pv-hide');
    bd._unlockScroll();
  };

  bd.querySelector('.xbtn')?.addEventListener('click', close);
  bd.addEventListener('click', (e)=>{ if (e.target === bd) close(); });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape' && !bd.classList.contains('pv-hide')) close(); });

  document.body.appendChild(bd);
  return bd;
}

function showModal(){
  const bd = ensureModal();
  bd.classList.remove('pv-hide');
  bd._lockScroll();

  // ensure modal body scrolls vertically
  const body = bd.querySelector('#fvEtaHelpBody');
  if (body){
    body.style.maxHeight = '70vh';
    body.style.overflowY = 'auto';
    body.style.overscrollBehavior = 'contain';
    body.style.webkitOverflowScrolling = 'touch';
  }

  return bd;
}

/* =====================================================================
   Build forecast rows (7-day view including today remaining)
===================================================================== */
async function getForecastRows7(fieldId){
  const state = window.__FV_FR || null;

  const colName =
    (state && state.CONST && state.CONST.WEATHER_CACHE_COLLECTION) ? String(state.CONST.WEATHER_CACHE_COLLECTION) :
    (window.FV_FORECAST_TUNE && window.FV_FORECAST_TUNE.WEATHER_CACHE_COLLECTION) ? String(window.FV_FORECAST_TUNE.WEATHER_CACHE_COLLECTION) :
    'field_weather_cache';

  const data = await readForecastCacheDoc(fieldId, colName);
  const norm = (data && data.normalized) ? data.normalized : null;

  const todayRemain = computeTodayRemainingFromHourly(norm);

  const fcstRaw = Array.isArray(data && data.dailySeriesFcst) ? data.dailySeriesFcst : [];
  const fcst = fcstRaw.filter(d => d && d.dateISO);

  const tISO = todayISO();
  const fcstStartsToday = fcst.length && String(fcst[0].dateISO).slice(0,10) === tISO;

  const out = [];
  if (todayRemain && !fcstStartsToday) out.push(todayRemain);

  const need = Math.max(0, 7 - out.length);
  for (const d of fcst.slice(0, need)) out.push(d);

  return out;
}

/* =====================================================================
   Event listener
===================================================================== */
(function wireOnce(){
  try{
    if (window.__FV_FR_ETA_HELP_WIRED__) return;
    window.__FV_FR_ETA_HELP_WIRED__ = true;

    document.addEventListener('fr:eta-help', async (e)=>{
      try{
        const d = (e && e.detail) ? e.detail : {};
        const fieldId = String(d.fieldId || '');
        if (!fieldId) return;

        const bd = showModal();

        const title = `ETA Helper • ${d.fieldName ? String(d.fieldName) : fieldId}`;
        bd.querySelector('#fvEtaHelpTitle').textContent = title;

        const opKey = String(d.opKey || '');
        const thr = Number(d.threshold);
        const readinessNow = Number(d.readinessNow);
        const etaText = String(d.etaText || '');
        const horizon = Number(d.horizonHours || 168);

        bd.querySelector('#fvEtaHelpSub').textContent =
          `Operation threshold: ${Number.isFinite(thr) ? thr : '—'} • Readiness now: ${Number.isFinite(readinessNow) ? readinessNow : '—'} • ETA: ${etaText || '—'}`;

        const helperText = `
          <div style="font-size:14px; line-height:1.35;">
            <b>What does this ETA mean?</b><br/>
            This is the <b>forecast-based time until the field reaches your selected operation threshold</b>.
            We start from your <b>current readiness</b> (based on recent weather history), then simulate the next <b>${esc(horizon)} hours</b>
            using the <b>7-day</b> forecast inputs. Forecast rain pushes the field wetter; forecast drying conditions pull it drier.
            The ETA is the first time the simulation reaches the threshold for <b>${esc(opKey || 'the selected operation')}</b>.
          </div>
        `;

        let tableHtml = '';
        const rows = await getForecastRows7(fieldId);

        if (rows && rows.length){
          const trs = rows.map(r=>{
            const x = normalizeRowForTable(r);
            return `
              <tr>
                <td class="mono">${esc(x.dateISO)}</td>
                <td class="right mono">${Number(x.rain).toFixed(2)}</td>
                <td class="right mono">${esc(x.temp)}</td>
                <td class="right mono">${esc(x.wind)}</td>
                <td class="right mono">${esc(x.rh)}</td>
                <td class="right mono">${esc(x.solar)}</td>
                <td class="right mono">${esc(x.et0)}</td>
                <td class="right mono">${esc(x.sm010)}</td>
                <td class="right mono">${esc(x.st010F)}</td>
              </tr>
            `;
          }).join('');

          tableHtml = `
            <div style="margin-top:14px;">
              <div style="font-weight:900; font-size:13px; margin-bottom:8px;">Forecast inputs (next 7 days)</div>
              <div class="table-scroll" style="overflow-x:auto;">
                <table aria-label="ETA Forecast Inputs">
                  <thead>
                    <tr>
                      <th style="width:130px;">Date</th>
                      <th class="right">Rain</th>
                      <th class="right">Temp</th>
                      <th class="right">Wind</th>
                      <th class="right">RH</th>
                      <th class="right">Solar</th>
                      <th class="right">ET0</th>
                      <th class="right">SM 0–10</th>
                      <th class="right">ST 0–10</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${trs}
                  </tbody>
                </table>
              </div>
              <div class="help muted" style="margin-top:8px;">
                Note: “(remaining)” represents forecast hours later today after the current time, so you can see rain that hasn’t fallen yet.
              </div>
            </div>
          `;
        } else {
          tableHtml = `
            <div class="help muted" style="margin-top:14px;">
              Forecast series is not available yet for this field (dailySeriesFcst missing).
            </div>
          `;
        }

        const body = bd.querySelector('#fvEtaHelpBody');
        body.innerHTML = `
          ${helperText}
          ${tableHtml}
        `;
      }catch(_){}
    });
  }catch(_){}
})();