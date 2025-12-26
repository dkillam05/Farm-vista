/* =====================================================================
/Farm-vista/js/field-readiness/quickview.js  (FULL FILE)
Rev: 2025-12-26b

Save now performs a SOFT reload:
- dispatches fr:soft-reload
- modal stays open
===================================================================== */
'use strict';

import { buildWxCtx, EXTRA, CONST, OPS } from './state.js';
import { getAPI } from './firebase.js';
import { getFieldParams, saveParamsToLocal } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { esc, clamp } from './utils.js';
import { canEdit } from './perm.js';

function $(id){ return document.getElementById(id); }

function ensureBuiltOnce(state){
  if (state._qvBuilt) return;
  state._qvBuilt = true;

  const wrap = document.createElement('div');
  wrap.id = 'frQvBackdrop';
  wrap.className = 'modal-backdrop pv-hide';
  wrap.setAttribute('role','dialog');
  wrap.setAttribute('aria-modal','true');

  wrap.innerHTML = `
    <div class="modal" style="width:min(740px, 96vw);">
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
            <button id="frQvClose" class="btn" type="button">Close</button>
            <button id="frQvSave" class="btn btn-primary" type="button">Save</button>
          </div>
        </div>

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
  const c = $('frQvClose'); if (c) c.addEventListener('click', close);

  wrap.addEventListener('click', (e)=>{
    if (e.target && e.target.id === 'frQvBackdrop') close();
  });

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  if (soil){
    soil.addEventListener('input', ()=>{
      if (soilVal) soilVal.textContent = String(clamp(Number(soil.value),0,100));
    });
  }
  if (drain){
    drain.addEventListener('input', ()=>{
      if (drainVal) drainVal.textContent = String(clamp(Number(drain.value),0,100));
    });
  }

  const save = $('frQvSave');
  if (save){
    save.addEventListener('click', async ()=>{
      if (!canEdit(state)) return;
      if (state._qvSaving) return;
      await saveQuickView(state);
    });
  }
}

export function openQuickView(state, fieldId){
  ensureBuiltOnce(state);

  const f = state.fields.find(x=>x.id===fieldId);
  if (!f) return;

  state._qvFieldId = fieldId;
  state.selectedFieldId = fieldId;

  const b = $('frQvBackdrop');
  if (b) b.classList.remove('pv-hide');
  state._qvOpen = true;

  fillQuickView(state);
}

export function closeQuickView(state){
  const b = $('frQvBackdrop');
  if (b) b.classList.add('pv-hide');
  state._qvOpen = false;
}

function fillQuickView(state){
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

  const run = state.lastRuns.get(f.id) || state._mods.model.runField(f, deps);

  const farmName = state.farmsById.get(f.farmId) || '';
  const opKey = getCurrentOp();
  const opLabel = (OPS.find(o=>o.key===opKey)?.label) || opKey;
  const thr = getThresholdForOp(state, opKey);

  const title = $('frQvTitle');
  const sub = $('frQvSub');
  if (title) title.textContent = f.name || 'Field';
  if (sub) sub.textContent = farmName ? `${farmName} • Field details` : 'Field details';

  const p = getFieldParams(state, f.id);
  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const soilVal = $('frQvSoilVal');
  const drainVal = $('frQvDrainVal');

  if (soil) soil.value = String(p.soilWetness);
  if (drain) drain.value = String(p.drainageIndex);
  if (soilVal) soilVal.textContent = String(p.soilWetness);
  if (drainVal) drainVal.textContent = String(p.drainageIndex);

  const hint = $('frQvHint');
  const saveBtn = $('frQvSave');
  const inputsPanel = $('frQvInputsPanel');

  if (!canEdit(state)){
    if (hint) hint.textContent = 'View only. You do not have edit permission.';
    if (saveBtn) saveBtn.disabled = true;
    if (inputsPanel) inputsPanel.style.opacity = '0.75';
  } else {
    if (hint) hint.textContent = 'Changes save to fields collection.';
    if (saveBtn) saveBtn.disabled = false;
    if (inputsPanel) inputsPanel.style.opacity = '1';
  }

  const setText = (id,val)=>{ const el=$(id); if(el) el.textContent = String(val); };

  setText('frQvFieldName', farmName ? `${farmName} • ${f.name}` : (f.name || '—'));
  setText('frQvCounty', `${String(f.county||'—')} / ${String(f.state||'—')}`);
  setText('frQvAcres', isFinite(f.tillable) ? `${f.tillable.toFixed(2)} ac` : '—');
  setText('frQvGps', f.location ? `${f.location.lat.toFixed(6)}, ${f.location.lng.toFixed(6)}` : '—');
  setText('frQvOp', opLabel);
  setText('frQvThr', thr);

  setText('frQvRain', '—');
  setText('frQvReadiness', run ? run.readinessR : '—');
  setText('frQvWetness', run ? run.wetnessR : '—');
  setText('frQvStorage', run ? `${run.storageFinal.toFixed(2)} / ${run.factors.Smax.toFixed(2)}` : '—');

  const info = state.wxInfoByFieldId.get(f.id) || null;
  const when = (info && info.fetchedAt) ? new Date(info.fetchedAt) : null;
  const whenTxt = when ? when.toLocaleString() : '—';
  const wxMeta = $('frQvWxMeta');
  if (wxMeta){
    wxMeta.innerHTML = `Weather updated: <span class="mono">${esc(whenTxt)}</span>`;
  }

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
}

async function saveQuickView(state){
  const fid = state._qvFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  const soil = $('frQvSoil');
  const drain = $('frQvDrain');
  const saveBtn = $('frQvSave');
  const hint = $('frQvHint');

  const soilWetness = clamp(Number(soil ? soil.value : 60), 0, 100);
  const drainageIndex = clamp(Number(drain ? drain.value : 45), 0, 100);

  state._qvSaving = true;
  if (saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  if (hint) hint.textContent = 'Saving…';

  try{
    const p = getFieldParams(state, fid);
    p.soilWetness = soilWetness;
    p.drainageIndex = drainageIndex;
    state.perFieldParams.set(fid, p);
    saveParamsToLocal(state);

    f.soilWetness = soilWetness;
    f.drainageIndex = drainageIndex;

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

    if (hint) hint.textContent = 'Saved.';
    if (saveBtn){ saveBtn.textContent = 'Save'; saveBtn.disabled = false; }

    state._qvSaving = false;

    // SOFT reload (keeps modal open)
    try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}

    // Re-fill so numbers reflect immediately
    fillQuickView(state);

  }catch(e){
    console.warn('[FieldReadiness] quick save failed:', e);
    if (hint) hint.textContent = `Save failed: ${e.message || e}`;
    if (saveBtn){ saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    state._qvSaving = false;
  }
}
