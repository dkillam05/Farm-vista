/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2025-12-27e

Fix (your bug):
✅ Double-click Quick View now SETS selectedFieldId first (critical)
   so it cannot reuse stale slider DOM values (the “random 39 / 49”).
✅ Before opening Quick View, we background-fetch THAT ONE field doc from Firestore
   (fetchAndHydrateFieldParams) and re-apply sliders.
✅ Single-click select also does the same background hydrate so reopen matches Firestore.

Why this matters:
- Your dblclick path previously called openQuickView(state, fieldId) WITHOUT selecting the field.
  That let the slider DOM keep old values and then refreshAll/save logic could “win” incorrectly.

Keeps:
✅ All prior rendering & tables behavior (NOTHING CUT)
✅ refreshDetailsOnly(state)

===================================================================== */
'use strict';

import { PATHS } from './paths.js';
import { OPS, EXTRA, CONST, buildWxCtx } from './state.js';
import { $, esc, clamp } from './utils.js';
import { getFieldParams, ensureSelectedParamsToSliders, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { canEdit } from './perm.js';
import { openQuickView } from './quickview.js';
import { initSwipeOnTiles } from './swipe.js';
import { parseRangeFromInput, rainInRange } from './rain.js';
import { fetchAndHydrateFieldParams } from './data.js';

/* ---------- module loader (model/weather) ---------- */
export async function ensureModelWeatherModules(state){
  if (state._mods.model && state._mods.weather) return;
  const [weather, model] = await Promise.all([ import(PATHS.WEATHER), import(PATHS.MODEL) ]);
  state._mods.weather = weather;
  state._mods.model = model;
}

/* ---------- colors (ported) ---------- */
function perceivedFromThreshold(readiness, thr){
  const r = clamp(Math.round(Number(readiness)), 0, 100);
  const t = clamp(Math.round(Number(thr)), 0, 100);

  if (t <= 0) return 100;
  if (t >= 100) return Math.round((r/100)*50);
  if (r === t) return 50;

  if (r > t){
    const denom = Math.max(1, 100 - t);
    const frac = (r - t) / denom;
    return clamp(Math.round(50 + frac * 50), 0, 100);
  } else {
    const denom = Math.max(1, t);
    const frac = r / denom;
    return clamp(Math.round(frac * 50), 0, 100);
  }
}
function colorForPerceived(p){
  const x = clamp(Number(p), 0, 100);
  let h;
  if (x <= 50){
    const frac = x / 50;
    h = 10 + (45 - 10) * frac;
  } else {
    const frac = (x - 50) / 50;
    h = 45 + (120 - 45) * frac;
  }
  return `hsl(${h.toFixed(0)} 70% 38%)`;
}
function gradientForThreshold(thr){
  const t = clamp(Math.round(Number(thr)), 0, 100);
  const a = `${t}%`;
  return `linear-gradient(90deg,
    hsl(10 70% 38%) 0%,
    hsl(45 75% 38%) ${a},
    hsl(120 55% 34%) 100%
  )`;
}

/* ---------- sorting ---------- */
function sortFields(fields, runsById){
  const sel = $('sortSel');
  const mode = String(sel ? sel.value : 'name_az');
  const range = parseRangeFromInput();
  const collator = new Intl.Collator(undefined, { numeric:true, sensitivity:'base' });
  const arr = fields.slice();

  arr.sort((a,b)=>{
    const ra = runsById.get(a.id);
    const rb = runsById.get(b.id);

    const nameA = `${a.name||''}`;
    const nameB = `${b.name||''}`;

    const readyA = ra ? ra.readinessR : 0;
    const readyB = rb ? rb.readinessR : 0;

    const rainA = ra ? rainInRange(ra, range) : 0;

    if (mode === 'name_az') return collator.compare(nameA, nameB);
    if (mode === 'name_za') return collator.compare(nameB, nameA);

    if (mode === 'ready_dry_wet'){ if (readyB !== readyA) return readyB - readyA; return collator.compare(nameA, nameB); }
    if (mode === 'ready_wet_dry'){ if (readyB !== readyA) return readyA - readyB; return collator.compare(nameA, nameB); }

    const rainB2 = rb ? rainInRange(rb, range) : 0;
    if (mode === 'rain_most'){ if (rainB2 !== rainA) return rainB2 - rainA; return collator.compare(nameA, nameB); }
    if (mode === 'rain_least'){ if (rainB2 !== rainA) return rainA - rainB2; return collator.compare(nameA, nameB); }

    return collator.compare(nameA, nameB);
  });

  return arr;
}

function getFilteredFields(state){
  const farmId = String(state.farmFilter || '__all__');
  if (farmId === '__all__') return state.fields.slice();
  return state.fields.filter(f => String(f.farmId||'') === farmId);
}

/* ---------- internal: set selected field safely ---------- */
function setSelectedField(state, fieldId){
  state.selectedFieldId = fieldId;

  // optional: allow any other listeners to respond
  try{
    document.dispatchEvent(new CustomEvent('fr:selected-field-changed', { detail:{ fieldId } }));
  }catch(_){}
}

/* ---------- click vs dblclick separation ---------- */
function wireTileInteractions(state, tileEl, fieldId){
  const CLICK_DELAY_MS = 220;
  tileEl._fvClickTimer = null;

  tileEl.addEventListener('click', ()=>{
    const until = Number(state._suppressClickUntil || 0);
    if (Date.now() < until) return;

    if (tileEl._fvClickTimer) clearTimeout(tileEl._fvClickTimer);
    tileEl._fvClickTimer = setTimeout(()=>{
      tileEl._fvClickTimer = null;
      selectField(state, fieldId);
    }, CLICK_DELAY_MS);
  });

  if (canEdit(state)){
    tileEl.addEventListener('dblclick', async (e)=>{
      e.preventDefault();
      e.stopPropagation();

      // cancel pending single-click select
      if (tileEl._fvClickTimer) clearTimeout(tileEl._fvClickTimer);
      tileEl._fvClickTimer = null;

      // ✅ CRITICAL: set selected field FIRST so sliders/details refer to the correct field
      setSelectedField(state, fieldId);

      // show whatever we have cached immediately (fast)
      ensureSelectedParamsToSliders(state);

      // suppress the click select race after dblclick
      state._suppressClickUntil = Date.now() + 350;

      // ✅ Background: pull ONE field doc fresh, then re-apply sliders, then open quick view
      try{
        await fetchAndHydrateFieldParams(state, fieldId);
      }catch(_){}

      // if user moved on, don't stomp
      if (String(state.selectedFieldId) !== String(fieldId)) return;

      ensureSelectedParamsToSliders(state);

      // finally open quick view for the correct field
      openQuickView(state, fieldId);
    });
  }
}

/* ---------- tile render ---------- */
export async function renderTiles(state){
  await ensureModelWeatherModules(state);

  const wrap = $('fieldsGrid');
  if (!wrap) return;
  wrap.innerHTML = '';

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (fid)=> getFieldParams(state, fid),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  state.lastRuns.clear();
  for (const f of state.fields){
    state.lastRuns.set(f.id, state._mods.model.runField(f, deps));
  }

  const filtered = getFilteredFields(state);
  const sorted = sortFields(filtered, state.lastRuns);
  const thr = getThresholdForOp(state, getCurrentOp());
  const range = parseRangeFromInput();

  const cap = (state.pageSize === -1) ? sorted.length : Math.min(sorted.length, state.pageSize);
  const show = sorted.slice(0, cap);

  for (const f of show){
    const run0 = state.lastRuns.get(f.id);
    if (!run0) continue;

    const readiness = run0.readinessR;
    const eta = state._mods.model.etaFor(run0, thr, CONST.ETA_MAX_HOURS);
    const rainRange = rainInRange(run0, range);

    const leftPos = state._mods.model.markerLeftCSS(readiness);
    const thrPos  = state._mods.model.markerLeftCSS(thr);

    const perceived = perceivedFromThreshold(readiness, thr);
    const pillBg = colorForPerceived(perceived);
    const grad = gradientForThreshold(thr);

    const tile = document.createElement('div');
    tile.className = 'tile fv-swipe-item' + (f.id === state.selectedFieldId ? ' active' : '');
    tile.dataset.fieldId = f.id;

    tile.innerHTML = `
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(f.name)}">${esc(f.name)}</div>
        </div>
        <div class="readiness-pill" style="background:${pillBg};color:#fff;">Field Readiness ${readiness}</div>
      </div>

      <p class="subline">Rain (range): <span class="mono">${rainRange.toFixed(2)}</span> in</p>

      <div class="gauge-wrap">
        <div class="chips">
          <div class="chip wet">Wet</div>
          <div class="chip readiness">Readiness</div>
        </div>

        <div class="gauge" style="background:${grad};">
          <div class="thr" style="left:${thrPos};"></div>
          <div class="marker" style="left:${leftPos};"></div>
          <div class="badge" style="left:${leftPos};background:${pillBg};color:#fff;border:1px solid rgba(255,255,255,.18);">Field Readiness ${readiness}</div>
        </div>

        <div class="ticks"><span>0</span><span>50</span><span>100</span></div>
        ${eta ? `<div class="help"><b>${esc(eta)}</b></div>` : ``}
      </div>
    `;

    wireTileInteractions(state, tile, f.id);
    wrap.appendChild(tile);
  }

  const empty = $('emptyMsg');
  if (empty) empty.style.display = show.length ? 'none' : 'block';

  // mobile-only + edit-only in swipe.js
  await initSwipeOnTiles(state, { onDetails: (fieldId)=> openQuickView(state, fieldId) });
}

/* ---------- select field ---------- */
export function selectField(state, id){
  const f = state.fields.find(x=>x.id === id);
  if (!f) return;

  // set selected field immediately
  setSelectedField(state, id);

  // Fast: show cached params immediately
  ensureSelectedParamsToSliders(state);

  // Existing behavior: selecting a field refreshes tiles/details
  // (kept — but we’ll also do a background Firestore hydrate so sliders match saved values)
  refreshAll(state);

  // Background: pull ONE doc fresh and update details only
  (async ()=>{
    try{
      const ok = await fetchAndHydrateFieldParams(state, id);
      if (!ok) return;
      if (String(state.selectedFieldId) !== String(id)) return;

      ensureSelectedParamsToSliders(state);
      await refreshDetailsOnly(state);
    }catch(_){}
  })();
}

/* ---------- Beta panel render (ported) ---------- */
function renderBetaInputs(state){
  const box = $('betaInputs');
  const meta = $('betaInputsMeta');
  if (!box || !meta) return;

  const fid = state.selectedFieldId;
  const info = fid ? state.wxInfoByFieldId.get(fid) : null;

  if (!info){
    meta.textContent = 'Weather is loading…';
    box.innerHTML = '';
    return;
  }

  const when = info.fetchedAt ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';

  meta.textContent =
    `Source: ${info.source || '—'} • Updated: ${whenTxt} • Primary + light-influence variables are used now; weights are still being tuned.`;

  const unitsHourly = info.units && info.units.hourly ? info.units.hourly : null;
  const unitsDaily = info.units && info.units.daily ? info.units.daily : null;

  const a = info.availability || { vars:{} };
  const vars = a.vars || {};

  const usedPrimary = [
    ['rain_mm','Precipitation (hourly → daily sum)', unitsHourly?.precipitation || 'mm → in'],
    ['temp_c','Air temperature (hourly avg)', unitsHourly?.temperature_2m || '°C → °F'],
    ['wind_mph','Wind speed (hourly avg)', 'mph (converted)'],
    ['rh_pct','Relative humidity (hourly avg)', unitsHourly?.relative_humidity_2m || '%'],
    ['solar_wm2','Shortwave radiation (hourly avg)', unitsHourly?.shortwave_radiation || 'W/m²']
  ];

  const usedLight = [
    ['vapour_pressure_deficit_kpa','VPD (hourly avg)', unitsHourly?.vapour_pressure_deficit || 'kPa'],
    ['cloud_cover_pct','Cloud cover (hourly avg)', unitsHourly?.cloud_cover || '%'],
    ['soil_moisture_0_10','Soil moisture 0–10cm (hourly avg)', unitsHourly?.soil_moisture_0_to_10cm || 'm³/m³'],
    ['soil_temp_c_0_10','Soil temp 0–10cm (hourly avg)', unitsHourly?.soil_temperature_0_to_10cm || '°C → °F'],
    ['et0_mm','ET₀ (daily)', unitsDaily?.et0_fao_evapotranspiration || 'mm/day → in/day'],
    ['daylight_s','Daylight duration (daily)', unitsDaily?.daylight_duration || 's/day → hr/day'],
    ['sunshine_s','Sunshine duration (daily)', unitsDaily?.sunshine_duration || 's/day → hr/day']
  ];

  const pulledNotUsed = [
    ['soil_temp_c_10_40','Soil temp 10–40cm (hourly)', unitsHourly?.soil_temperature_10_to_40cm || '°C'],
    ['soil_temp_c_40_100','Soil temp 40–100cm (hourly)', unitsHourly?.soil_temperature_40_to_100cm || '°C'],
    ['soil_temp_c_100_200','Soil temp 100–200cm (hourly)', unitsHourly?.soil_temperature_100_to_200cm || '°C'],
    ['soil_moisture_10_40','Soil moisture 10–40cm (hourly)', unitsHourly?.soil_moisture_10_to_40cm || 'm³/m³'],
    ['soil_moisture_40_100','Soil moisture 40–100cm (hourly)', unitsHourly?.soil_moisture_40_to_100cm || 'm³/m³'],
    ['soil_moisture_100_200','Soil moisture 100–200cm (hourly)', unitsHourly?.soil_moisture_100_to_200cm || 'm³/m³']
  ];

  function itemRow(k,label,u,tagClass,tagText){
    const ok = vars[k] ? !!vars[k].ok : true;
    const tag = ok ? `<div class="vtag ${tagClass}">${esc(tagText)}</div>` : `<div class="vtag tag-missing">Not in response</div>`;
    return `
      <div class="vitem">
        <div>
          <div class="vname">${esc(label)}</div>
          <div class="vmeta">${esc(u || '')}</div>
        </div>
        ${tag}
      </div>
    `;
  }
  function groupHtml(title, rows, tagClass, tagText){
    const items = rows.map(([k,label,u])=> itemRow(k,label,u,tagClass,tagText)).join('');
    return `
      <div class="vgroup">
        <div class="vgroup-title">${esc(title)}</div>
        <div class="vitems">${items}</div>
      </div>
    `;
  }

  box.innerHTML =
    groupHtml('Used now (primary drivers)', usedPrimary, 'tag-primary', 'Used') +
    groupHtml('Used now (light influence / nudges)', usedLight, 'tag-light', 'Light') +
    groupHtml('Pulled (not yet used)', pulledNotUsed, 'tag-pulled', 'Pulled');
}

/* ---------- Details + tables render (ported) ---------- */
export async function renderDetails(state){
  await ensureModelWeatherModules(state);

  const f = state.fields.find(x=>x.id === state.selectedFieldId);
  if (!f) return;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (fid)=> getFieldParams(state, fid),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  const run = state.lastRuns.get(f.id) || state._mods.model.runField(f, deps);
  if (!run) return;

  const fac = run.factors;
  const p = getFieldParams(state, f.id);

  const opKey = getCurrentOp();
  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const range = parseRangeFromInput();
  const rainRange = rainInRange(run, range);

  const farmName = state.farmsById.get(f.farmId) || '';

  const setText = (id, val) => { const el = $(id); if (el) el.textContent = String(val); };

  setText('dFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('dStatus', String(f.status||'—'));
  setText('dCounty', `${String(f.county||'—')} / ${String(f.state||'—')}`);
  setText('dAcres', (isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—'));
  setText('dGps', (f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—'));

  const btnMap = $('btnMap');
  if (btnMap) btnMap.disabled = !f.location;

  setText('dSoilType', `${p.soilWetness}/100`);
  setText('dSoilHold', `${fac.soilHold.toFixed(2)} (normalized)`);
  setText('dDrainage', `${p.drainageIndex}/100`);

  setText('dThreshold', `${thr}`);
  setText('dOperation', opLabel);

  setText('dDays', String(run.rows.length || 0));
  setText('dRangeRain', `${rainRange.toFixed(2)} in`);
  setText('dReadiness', `${run.readinessR}`);
  setText('dWetness', `${run.wetnessR}`);
  setText('dStorage', `${run.storageFinal.toFixed(2)} / ${run.factors.Smax.toFixed(2)}`);

  const param = $('paramExplain');
  if (param){
    param.innerHTML =
      `soilHold=soilWetness/100=<span class="mono">${fac.soilHold.toFixed(2)}</span> • drainPoor=drainageIndex/100=<span class="mono">${fac.drainPoor.toFixed(2)}</span><br/>
       Smax=<span class="mono">${fac.Smax.toFixed(2)}</span> (base <span class="mono">${fac.SmaxBase.toFixed(2)}</span>) • infilMult=<span class="mono">${fac.infilMult.toFixed(2)}</span> • dryMult=<span class="mono">${fac.dryMult.toFixed(2)}</span> • LOSS_SCALE=<span class="mono">${CONST.LOSS_SCALE.toFixed(2)}</span>`;
  }

  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';

  const sum = $('mathSummary');
  if (sum){
    sum.innerHTML =
      `Model output: <b>Wet=${run.wetnessR}</b> • <b>Readiness=${run.readinessR}</b> • storage=<span class="mono">${run.storageFinal.toFixed(2)}</span>/<span class="mono">${run.factors.Smax.toFixed(2)}</span>` +
      `<br/><span class="muted">Weather updated: <span class="mono">${esc(whenTxt)}</span></span>`;
  }

  // ✅ Beta panel
  renderBetaInputs(state);

  // ✅ Tank Trace table
  const trb = $('traceRows');
  if (trb){
    trb.innerHTML = '';
    const rows = Array.isArray(run.trace) ? run.trace : [];
    if (!rows.length){
      trb.innerHTML = `<tr><td colspan="7" class="muted">No trace rows.</td></tr>`;
    } else {
      for (const t of rows){
        const dateISO = String(t.dateISO || '');
        const rain = Number(t.rain ?? 0);
        const infilMult = Number(t.infilMult ?? 0);
        const add = Number(t.add ?? 0);
        const dryPwr = Number(t.dryPwr ?? 0);
        const loss = Number(t.loss ?? 0);
        const before = Number(t.before ?? 0);
        const after = Number(t.after ?? 0);

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(dateISO)}</td>
          <td class="right mono">${rain.toFixed(2)}</td>
          <td class="right mono">${infilMult.toFixed(2)}</td>
          <td class="right mono">${add.toFixed(2)}</td>
          <td class="right mono">${dryPwr.toFixed(2)}</td>
          <td class="right mono">${loss.toFixed(2)}</td>
          <td class="right mono">${before.toFixed(2)}→${after.toFixed(2)}</td>
        `;
        trb.appendChild(tr);
      }
    }
  }

  // ✅ DryPwr Breakdown table
  const drb = $('dryRows');
  if (drb){
    drb.innerHTML = '';
    const rows = Array.isArray(run.rows) ? run.rows : [];
    if (!rows.length){
      drb.innerHTML = `<tr><td colspan="15" class="muted">No rows.</td></tr>`;
    } else {
      for (const r of rows){
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(r.dateISO)}</td>
          <td class="right mono">${Math.round(Number(r.temp||0))}</td>
          <td class="right mono">${Number(r.tempN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.wind||0))}</td>
          <td class="right mono">${Number(r.windN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.rh||0))}</td>
          <td class="right mono">${Number(r.rhN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.solar||0))}</td>
          <td class="right mono">${Number(r.solarN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpd||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.vpdN||0).toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.cloud||0))}</td>
          <td class="right mono">${Number(r.cloudN||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.raw||0).toFixed(2)}</td>
          <td class="right mono">${Number(r.dryPwr||0).toFixed(2)}</td>
        `;
        drb.appendChild(tr);
      }
    }
  }

  // ✅ Weather Inputs table
  const wxb = $('wxRows');
  if (wxb){
    wxb.innerHTML = '';
    const rows = Array.isArray(run.rows) ? run.rows : [];
    if (!rows.length){
      wxb.innerHTML = `<tr><td colspan="9" class="muted">No weather rows.</td></tr>`;
    } else {
      for (const r of rows){
        const rain = Number(r.rainInAdj ?? r.rainIn ?? 0);
        const et0 = (r.et0 == null ? '—' : Number(r.et0).toFixed(2));
        const sm010 = (r.sm010 == null ? '—' : Number(r.sm010).toFixed(3));
        const st010F = (r.st010F == null ? '—' : String(Math.round(Number(r.st010F))));

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${esc(r.dateISO)}</td>
          <td class="right mono">${rain.toFixed(2)}</td>
          <td class="right mono">${Math.round(Number(r.temp||0))}</td>
          <td class="right mono">${Math.round(Number(r.wind||0))}</td>
          <td class="right mono">${Math.round(Number(r.rh||0))}</td>
          <td class="right mono">${Math.round(Number(r.solar||0))}</td>
          <td class="right mono">${esc(et0)}</td>
          <td class="right mono">${esc(sm010)}</td>
          <td class="right mono">${esc(st010F)}</td>
        `;
        wxb.appendChild(tr);
      }
    }
  }
}

/* ---------- refresh ---------- */
export async function refreshAll(state){
  if (state.selectedFieldId){
    const a = $('soilWet');
    const b = $('drain');

    // IMPORTANT: only save if sliders exist (prevents weird “random” values during boot/quickview race)
    if (a && b){
      const p = getFieldParams(state, state.selectedFieldId);
      p.soilWetness = clamp(Number(a.value), 0, 100);
      p.drainageIndex = clamp(Number(b.value), 0, 100);
      state.perFieldParams.set(state.selectedFieldId, p);
      saveParamsToLocal(state);
    }
  }

  await renderTiles(state);
  await renderDetails(state);
}

/* ---------- details-only refresh ---------- */
export async function refreshDetailsOnly(state){
  try{
    // Re-apply state params to sliders before rendering details (keeps UI stable)
    ensureSelectedParamsToSliders(state);
  }catch(_){}

  await renderDetails(state);
}
