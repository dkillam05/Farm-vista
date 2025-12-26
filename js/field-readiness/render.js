/* =====================================================================
/Farm-vista/js/field-readiness/render.js  (FULL FILE)
Rev: 2025-12-26a

Owns:
- importing locked model/weather modules once
- tile render + details render (ported from your working file)
===================================================================== */
'use strict';

import { PATHS } from './paths.js';
import { OPS, EXTRA, CONST, buildWxCtx } from './state.js';
import { $, esc, round, clamp } from './utils.js';
import { getFieldParams, ensureSelectedParamsToSliders, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';

/* ---------- module loader (model/weather) ---------- */
export async function ensureModelWeatherModules(state){
  if (state._mods.model && state._mods.weather) return;

  const [weather, model] = await Promise.all([
    import(PATHS.WEATHER),
    import(PATHS.MODEL)
  ]);

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
  const s = 70;
  const l = 38;
  return `hsl(${h.toFixed(0)} ${s}% ${l}%)`;
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

/* ---------- range helpers (still from your working file; we’ll migrate next) ---------- */
function parseRangeFromInput(){
  const inp = $('jobRangeInput');
  const raw = String(inp ? inp.value : '').trim();
  if (!raw) return { start:null, end:null };

  const parts = raw.split('–').map(s=>s.trim());
  if (parts.length === 2){
    const a = new Date(parts[0]);
    const b = new Date(parts[1]);
    if (isFinite(a.getTime()) && isFinite(b.getTime())){
      a.setHours(0,0,0,0);
      b.setHours(23,59,59,999);
      return { start:a, end:b };
    }
  }

  const d = new Date(raw);
  if (isFinite(d.getTime())){
    d.setHours(0,0,0,0);
    const e = new Date(d);
    e.setHours(23,59,59,999);
    return { start:d, end:e };
  }

  return { start:null, end:null };
}
function isDateInRange(dateISO, range){
  if (!range || !range.start || !range.end) return true;
  const d = new Date(dateISO + 'T12:00:00');
  return d >= range.start && d <= range.end;
}
function rainInRange(run, range){
  if (!run || !run.rows) return 0;
  let sum = 0;
  for (const r of run.rows){
    if (isDateInRange(r.dateISO, range)) sum += Number(r.rainInAdj||0);
  }
  return round(sum, 2);
}
function sortFields(state, fields, runsById){
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

export function renderTiles(state){
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
  const sorted = sortFields(state, filtered, state.lastRuns);
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

    const labelLeft = f.name;

    const tile = document.createElement('div');
    tile.className = 'tile' + (f.id === state.selectedFieldId ? ' active' : '');

    tile.innerHTML = `
      <div class="tile-top">
        <div class="titleline">
          <div class="name" title="${esc(labelLeft)}">${esc(labelLeft)}</div>
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

    tile.addEventListener('click', ()=> selectField(state, f.id));
    wrap.appendChild(tile);
  }

  const empty = $('emptyMsg');
  if (empty) empty.style.display = show.length ? 'none' : 'block';
}

export function selectField(state, id){
  const f = state.fields.find(x=>x.id === id);
  if (!f) return;
  state.selectedFieldId = id;
  ensureSelectedParamsToSliders(state);
  refreshAll(state);
}

export function renderDetails(state){
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

  // keep EXACT details rendering in your working file (we’re not changing it here)
  // We will migrate Beta/tables next phase into its own module.
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

  // Weather updated line (kept)
  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';

  const sum = $('mathSummary');
  if (sum){
    sum.innerHTML =
      `Model output: <b>Wet=${run.wetnessR}</b> • <b>Readiness=${run.readinessR}</b> • storage=<span class="mono">${run.storageFinal.toFixed(2)}</span>/<span class="mono">${run.factors.Smax.toFixed(2)}</span>` +
      `<br/><span class="muted">Weather updated: <span class="mono">${esc(whenTxt)}</span></span>`;
  }

  // TODO next phase: move renderBetaInputs + tables here exactly.
}

export function refreshAll(state){
  if (state.selectedFieldId){
    const a = $('soilWet');
    const b = $('drain');
    const p = getFieldParams(state, state.selectedFieldId);
    if (a) p.soilWetness = clamp(Number(a.value), 0, 100);
    if (b) p.drainageIndex = clamp(Number(b.value), 0, 100);
    state.perFieldParams.set(state.selectedFieldId, p);
    saveParamsToLocal(state);
  }

  renderTiles(state);
  renderDetails(state);
}
