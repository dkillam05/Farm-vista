/* =====================================================================
/Farm-vista/js/field-readiness/quickview.js  (FULL FILE)
Rev: 2025-12-26d

Changes (per Dane):
✅ Popup footer has ONE button: "Save & Close" (saves + closes)
✅ Popup includes a live Field Tile preview above Inputs
✅ Tile preview updates live as Soil Wetness / Drainage sliders move
✅ Save writes to Firestore fields/{id} soilWetness + drainageIndex
✅ Uses soft reload event so page updates without full refresh

Depends on:
- state._mods.model + state._mods.weather already loaded by index/render
- shared rain/range helpers in rain.js
===================================================================== */
'use strict';

import { buildWxCtx, EXTRA, CONST, OPS } from './state.js';
import { getAPI } from './firebase.js';
import { getFieldParams, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { esc, clamp } from './utils.js';
import { canEdit } from './perm.js';
import { parseRangeFromInput, rainInRange } from './rain.js';

function $(id){ return document.getElementById(id); }

/* ---------- tile preview color helpers (match tiles) ---------- */
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

/* ---------- modal build ---------- */
function ensureBuiltOnce(state){
  if (state._qvBuilt) return;
  state._qvBuilt = true;

  const wrap = document.createElement('div');
  wrap.id = 'frQvBackdrop';
  wrap.className = 'modal-backdrop pv-hide';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-modal','true');

  wrap.innerHTML = `
    <div class="modal" style="width:min(760px, 96vw);">
      <div class="modal-h">
        <h3 id="frQvTitle">Field</h3>
        <button id="frQvX" class="xbtn" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="muted" style="font-size:12px; margin-top:4px;" id="frQvSub">—</div>
      </div>

      <div class="modal-b" style="display:grid;gap:12px;">
        <!-- LIVE TILE PREVIEW -->
        <div id="frQvTilePreview"></div>

        <!-- INPUTS -->
        <div class="panel" style="margin:0;" id="frQvInputsPanel">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Inputs (field-specific)</h3>

          <div style="display:grid;gap:12px;grid-template-columns:1fr 1fr;align-items:start;">
            <div class="field">
              <label for="frQvSoil">Soil Wetness (0–100)</label>
              <input id="frQvSoil" type="range" min="0" max="100" step="1" value="60"/>
              <div class="help muted" style="margin-top:6px;">Current: <span class="mono" id="frQvSoilVal">60</span>/100</div>
            </div>

            <div class="field">
              <label for="frQvDrain">Drainage Index (0–100)</label>
              <input id="frQvDrain" type="range" min="0" max="100" step="1" value="45"/>
              <div class="help muted" style="margin-top:6px;">Current: <span class="mono" id="frQvDrainVal">45</span>/100</div>
            </div>
          </div>

          <div class="actions" style="margin-top:12px;justify-content:flex-end;">
            <div class="help muted" id="frQvHint" style="margin:0;flex:1 1 auto;align-self:center;">—</div>
            <button id="frQvSaveClose" class="btn btn-primary" type="button">Save &amp; Close</button>
          </div>
        </div>

        <!-- FIELD + SETTINGS -->
        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Field + Settings</h3>
          <div class="kv">
            <div class="k">Field</div><div class="v" id="frQvFieldName">—</div>
            <div class="k">County / State</div><div class="v" id="frQvCounty">—</div>
            <div class="k">Tillable</div><div class="v" id="frQvAcres">—</div>
            <div class="k">GPS</div><div class="v mono" id="frQvGps">—</div>
            <div class="k">Operation</div><div class="v" id="frQvOp">—</div>
            <div class="k">Threshold</div><div class="v" id="frQvThr">—</div>
          </div>
          <div class="help" id="frQvParamExplain">—</div>
        </div>

        <!-- WEATHER + OUTPUT -->
        <div class="panel" style="margin:0;">
          <h3 style="margin:0 0 8px;font-size:13px;font-weight:900;">Weather + Output</h3>
          <div class="kv">
            <div class="k">Range rain</div><div class="v" id="frQvRain">—</div>
            <div class="k">Readiness</div><div class="v" id="frQvReadiness">—</div>
            <div class="k">Wetness</div><div class="v" id="frQvWetness">—</div>
            <div class="k">Storage</div><div class="v" id="frQvStorage">—</div>
          </div>
          <div class="help" id="frQvWxMeta">—</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrap);

  const close = ()=> closeQuickView(state);

  const x = $('frQvX'); if (x) x.addEventListener('click', close);

  wrap.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'frQvBackdrop') close();
  });

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  // Live preview updates on slider move (no save yet)
  function onSliderChange(){
    if (soilVal) soilVal.textContent = String(clamp(Number(soil.value),0,100));
    if (drainVal) drainVal.textContent = String(clamp(Number(drain.value),0,100));

    // Update TEMP params in memory (not persisted yet)
    const fid = state._qvFieldId;
    if (!fid) return;
    const p = getFieldParams(state, fid);
    p.soilWetness = clamp(Number(soil.value),0,100);
    p.drainageIndex = clamp(Number(drain.value),0,100);
    state.perFieldParams.set(fid, p);

    // Rerun model and update tile + output section live
    fillQuickView(state, { live:true });
  }

  if (soil) soil.addEventListener('input', onSliderChange);
  if (drain) drain.addEventListener('input', onSliderChange);

  const saveClose = $('frQvSaveClose');
  if (saveClose){
    saveClose.addEventListener('click', async ()=>{
      if (!canEdit(state)) return;
      if (state._qvSaving) return;
      await saveAndClose(state);
    });
  }
}

/* ---------- open/close ---------- */
export function openQuickView(state, fieldId){
  ensureBuiltOnce(state);

  const f = state.fields.find(x=>x.id===fieldId);
  if (!f) return;

  state._qvFieldId = fieldId;
  state.selectedFieldId = fieldId;

  const b = $('frQvBackdrop');
  if (b) b.classList.remove('pv-hide');
  state._qvOpen = true;

  fillQuickView(state, { live:false });
}

export function closeQuickView(state){
  const b = $('frQvBackdrop');
  if (b) b.classList.add('pv-hide');
  state._qvOpen = false;
}

/* ---------- render inside modal ---------- */
function setText(id,val){
  const el = $(id);
  if (el) el.textContent = String(val);
}

function renderTilePreview(state, run, thr){
  const wrap = $('frQvTilePreview');
  if (!wrap) return;

  const f = state.fields.find(x=>x.id===state._qvFieldId);
  if (!f || !run) return;

  const readiness = run.readinessR;
  const range = parseRangeFromInput();
  const rainRange = rainInRange(run, range);

  const leftPos = state._mods.model.markerLeftCSS(readiness);
  const thrPos  = state._mods.model.markerLeftCSS(thr);

  const perceived = perceivedFromThreshold(readiness, thr);
  const pillBg = colorForPerceived(perceived);
  const grad = gradientForThreshold(thr);

  const eta = state._mods.model.etaFor(run, thr, CONST.ETA_MAX_HOURS);

  wrap.innerHTML = `
    <div class="tile" style="cursor:default; user-select:none;">
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
    </div>
  `;
}

function fillQuickView(state, { live=false } = {}){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  // Recompute each time sliders change so you see the effect
  const run = state._mods.model.runField(f, deps);

  const farmName = state.farmsById.get(f.farmId) || '';
  const opKey = getCurrentOp();
  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const title = $('frQvTitle');
  const sub = $('frQvSub');
  if (title) title.textContent = f.name || 'Field';
  if (sub) sub.textContent = farmName ? `${farmName} • Field details` : 'Field details';

  // Sync slider values from state params
  const p = getFieldParams(state, f.id);
  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  if (!live){
    if (soil) soil.value = String(p.soilWetness);
    if (drain) drain.value = String(p.drainageIndex);
    if (soilVal) soilVal.textContent = String(p.soilWetness);
    if (drainVal) drainVal.textContent = String(p.drainageIndex);
  }

  // Button state
  const hint = $('frQvHint');
  const saveBtn = $('frQvSaveClose');
  const inputsPanel = $('frQvInputsPanel');

  if (!canEdit(state)){
    if (hint) hint.textContent = 'View only. You do not have edit permission.';
    if (saveBtn) saveBtn.disabled = true;
    if (inputsPanel) inputsPanel.style.opacity = '0.75';
  } else {
    if (hint) hint.textContent = 'Adjust sliders → preview updates live → Save & Close.';
    if (saveBtn) saveBtn.disabled = false;
    if (inputsPanel) inputsPanel.style.opacity = '1';
  }

  // Field + settings section
  setText('frQvFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('frQvCounty', `${String(f.county||'—')} / ${String(f.state||'—')}`);
  setText('frQvAcres', isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—');
  setText('frQvGps', f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—');
  setText('frQvOp', opLabel);
  setText('frQvThr', thr);

  // Weather + output section
  const range = parseRangeFromInput();
  const rr = rainInRange(run, range);
  setText('frQvRain', `${rr.toFixed(2)} in`);
  setText('frQvReadiness', run ? run.readinessR : '—');
  setText('frQvWetness', run ? run.wetnessR : '—');
  setText('frQvStorage', run ? `${run.storageFinal.toFixed(2)} / ${run.factors.Smax.toFixed(2)}` : '—');

  // Weather timestamp
  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';
  const wxMeta = $('frQvWxMeta');
  if (wxMeta){
    wxMeta.innerHTML = `Weather updated: <span class="mono">${esc(whenTxt)}</span>`;
  }

  // Param explain (same style as details)
  const pe = $('frQvParamExplain');
  if (pe && run && run.factors){
    const fac = run.factors;
    pe.innerHTML =
      `soilHold=soilWetness/100=<span class="mono">${fac.soilHold.toFixed(2)}</span> • ` +
      `drainPoor=drainageIndex/100=<span class="mono">${fac.drainPoor.toFixed(2)}</span><br/>` +
      `Smax=<span class="mono">${fac.Smax.toFixed(2)}</span> (base <span class="mono">${fac.SmaxBase.toFixed(2)}</span>) • ` +
      `infilMult=<span class="mono">${fac.infilMult.toFixed(2)}</span> • dryMult=<span class="mono">${fac.dryMult.toFixed(2)}</span> • ` +
      `LOSS_SCALE=<span class="mono">${CONST.LOSS_SCALE.toFixed(2)}</span>`;
  }

  // Live tile preview at top
  renderTilePreview(state, run, thr);
}

/* ---------- Save & Close ---------- */
async function saveAndClose(state){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const btn = $('frQvSaveClose');
  const hint = $('frQvHint');

  const soilWetness = clamp(Number(soil ? soil.value : 60), 0, 100);
  const drainageIndex = clamp(Number(drain ? drain.value : 45), 0, 100);

  state._qvSaving = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  if (hint) hint.textContent = 'Saving…';

  try{
    // Update local cache
    const p = getFieldParams(state, fid);
    p.soilWetness = soilWetness;
    p.drainageIndex = drainageIndex;
    state.perFieldParams.set(fid, p);
    saveParamsToLocal(state);

    // Update field object
    f.soilWetness = soilWetness;
    f.drainageIndex = drainageIndex;

    // Firestore write
    const api = getAPI(state);
    if (api && api.kind !== 'compat'){
      const db = api.getFirestore();
      const auth = api.getAuth ? api.getAuth() : null;
      const user = auth && auth.currentUser ? auth.currentUser : null;

      const ref = api.doc(db, 'fields', fid);
      await api.updateDoc(ref, {
        soilWetness,
        drainageIndex,
        updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
        updatedBy: user ? (user.email || user.uid || null) : null
      });
    } else if (api && api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      await db.collection('fields').doc(fid).set({
        soilWetness,
        drainageIndex,
        updatedAt: new Date().toISOString()
      }, { merge:true });
    }

    // Soft refresh page (keeps everything responsive)
    try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}

    // Close modal
    closeQuickView(state);

  }catch(e){
    console.warn('[FieldReadiness] Save & Close failed:', e);
    if (hint) hint.textContent = `Save failed: ${e.message || e}`;
    if (btn){ btn.disabled = false; btn.textContent = 'Save & Close'; }
    state._qvSaving = false;
    return;
  }

  state._qvSaving = false;
  if (btn){ btn.disabled = false; btn.textContent = 'Save & Close'; }
  if (hint) hint.textContent = 'Saved.';
}
