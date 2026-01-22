/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-01-22c-global-storage-scale-truth-state-learning

UPDATED (per Dane — NEW MODEL CONTRACT):
✅ Global Calibration performs a % STORAGE shift across ALL fields (truth state).
✅ Tank size comes from sliders/model — calibration does NOT change tank size.
✅ Storage is truth — calibration scales storage.

UI stays the same:
- Reference field readiness (shown) = R_ref
- Slider target readiness = R_target
- percentMove = (R_target / R_ref - 1) * 100
- storageMult = 1 - (percentMove / 100)

Examples:
- If you push target UP by +10% relative to ref:
    percentMove = +10%
    storageMult = 0.90  => storageFinal decreases 10% across all fields (drier)
- If you push target DOWN by -10%:
    storageMult = 1.10  => storageFinal increases 10% (wetter)

Writes:
- field_readiness_state/{fieldId}:
    storageFinal = storageFinal_old * storageMult
    (if missing old truth, seed from current truth run first)

Keeps:
✅ 72h lockout (nextAllowedAt = now + cooldownHours)
✅ Opposite-only Wet/Dry guardrail + slider clamp direction
✅ UI theme patch
✅ fr:soft-reload after apply
✅ Learning doc write (tuning) still supported (optional future use)

No longer does:
❌ Does NOT rewrite readiness across all fields
❌ Does NOT recompute storage from readiness targets
===================================================================== */
'use strict';

import { getAPI } from './firebase.js';
import { canEdit } from './perm.js';
import { buildWxCtx, CONST, OPS, EXTRA } from './state.js';
import { getFieldParams } from './params.js';
import { getCurrentOp } from './thresholds.js';

function $(id){ return document.getElementById(id); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

/* =====================================================================
   PERSISTED TRUTH STATE COLLECTION
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';
const STATE_TTL_MS = 30000;

/* =====================================================================
   LEARNING / TUNING DOC (kept)
===================================================================== */
const FR_TUNE_COLLECTION = 'field_readiness_tuning';
const FR_TUNE_DOC = 'global';

const DRY_LOSS_MULT_MIN = 0.30;
const DRY_LOSS_MULT_MAX = 3.00;
const RAIN_EFF_MULT_MIN = 0.30;
const RAIN_EFF_MULT_MAX = 3.00;

// How aggressively one global shift changes tuning.
const TUNE_EXP = 0.50;

function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}
function safeISO10(x){
  const s = safeStr(x);
  return (s.length >= 10) ? s.slice(0,10) : s;
}
function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function nowISO(){
  try{ return new Date().toISOString(); }catch(_){ return ''; }
}

function getAuthUserIdCompat(){
  try{
    const auth = window.firebaseAuth || null;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    return user ? (user.email || user.uid || null) : null;
  }catch(_){
    return null;
  }
}
function getAuthUserIdModern(api){
  try{
    const auth = api && api.getAuth ? api.getAuth() : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;
    return user ? (user.email || user.uid || null) : null;
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Persisted truth-state load
===================================================================== */
async function loadPersistedState(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._persistLoadedAt || 0);
    if (!force && state.persistedStateByFieldId && (now - last) < STATE_TTL_MS) return;

    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.persistedStateByFieldId = out;
      state._persistLoadedAt = now;
      return;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_STATE_COLLECTION).get();

      snap.forEach(doc=>{
        const d = doc.data() || {};
        const fid = safeStr(d.fieldId || doc.id);
        if (!fid) return;

        const storageFinal = safeNum(d.storageFinal);
        const asOfDateISO = safeISO10(d.asOfDateISO);

        if (storageFinal == null || !asOfDateISO) return;

        out[fid] = {
          fieldId: fid,
          storageFinal,
          asOfDateISO,
          SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.SmaxAtSave || d.smaxAtSave) ?? 0
        };
      });

      state.persistedStateByFieldId = out;
      state._persistLoadedAt = now;
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const col = api.collection(db, FR_STATE_COLLECTION);
      const snap = await api.getDocs(col);

      snap.forEach(doc=>{
        const d = doc.data() || {};
        const fid = safeStr(d.fieldId || doc.id);
        if (!fid) return;

        const storageFinal = safeNum(d.storageFinal);
        const asOfDateISO = safeISO10(d.asOfDateISO);

        if (storageFinal == null || !asOfDateISO) return;

        out[fid] = {
          fieldId: fid,
          storageFinal,
          asOfDateISO,
          SmaxAtSave: safeNum(d.SmaxAtSave) ?? safeNum(d.SmaxAtSave || d.smaxAtSave) ?? 0
        };
      });

      state.persistedStateByFieldId = out;
      state._persistLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] persisted state load failed:', e);
    state.persistedStateByFieldId = state.persistedStateByFieldId || {};
    state._persistLoadedAt = Date.now();
  }
}

function getPersistedStateForDeps(state, fieldId){
  try{
    const fid = String(fieldId || '');
    if (!fid) return null;
    const map = (state && state.persistedStateByFieldId && typeof state.persistedStateByFieldId === 'object')
      ? state.persistedStateByFieldId
      : null;
    if (!map) return null;
    const s = map[fid];
    return (s && typeof s === 'object') ? s : null;
  }catch(_){
    return null;
  }
}

/* =====================================================================
   Tuning doc read/write (kept)
===================================================================== */
function normalizeTuneDoc(d){
  const doc = (d && typeof d === 'object') ? d : {};
  const dryLoss = safeNum(doc.DRY_LOSS_MULT);
  const rainEff = safeNum(doc.RAIN_EFF_MULT);

  return {
    DRY_LOSS_MULT: clamp((dryLoss == null ? 1.0 : dryLoss), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX),
    RAIN_EFF_MULT: clamp((rainEff == null ? 1.0 : rainEff), RAIN_EFF_MULT_MIN, RAIN_EFF_MULT_MAX),

    lastStorageMult: safeNum(doc.lastStorageMult),
    lastPercentMove: safeNum(doc.lastPercentMove),
    lastAnchorReadiness: safeNum(doc.lastAnchorReadiness),
    lastTargetReadiness: safeNum(doc.lastTargetReadiness),
    lastOp: safeStr(doc.lastOp),
    lastAsOfDateISO: safeStr(doc.lastAsOfDateISO),
    updatedBy: safeStr(doc.updatedBy),
    updatedAt: doc.updatedAt || null
  };
}

async function loadGlobalTuning(state){
  const api = getAPI(state);
  const fallback = normalizeTuneDoc(null);

  try{
    if (!api) return fallback;

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_TUNE_COLLECTION).doc(FR_TUNE_DOC).get();
      if (!snap || !snap.exists) return fallback;
      return normalizeTuneDoc(snap.data() || {});
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const ref = api.doc(db, FR_TUNE_COLLECTION, FR_TUNE_DOC);
      const snap = await api.getDoc(ref);
      if (!snap || !snap.exists || !snap.exists()) return fallback;
      return normalizeTuneDoc(snap.data() || {});
    }
  }catch(e){
    console.warn('[FieldReadiness] tuning load failed:', e);
  }
  return fallback;
}

async function writeGlobalTuning(state, payload){
  const api = getAPI(state);
  if (!api) return;

  if (api.kind === 'compat'){
    try{
      const db = window.firebase.firestore();
      await db.collection(FR_TUNE_COLLECTION).doc(FR_TUNE_DOC).set(payload, { merge:true });
    }catch(e){
      console.warn('[FieldReadiness] tuning write failed (compat):', e);
    }
    return;
  }

  try{
    const db = api.getFirestore();
    const ref = api.doc(db, FR_TUNE_COLLECTION, FR_TUNE_DOC);
    await api.setDoc(ref, payload, { merge:true });
  }catch(e){
    console.warn('[FieldReadiness] tuning write failed:', e);
  }
}

/**
 * Update tuning multipliers based on "drier/wetter intent".
 * We use "intentFactor" where:
 *  - intentFactor > 1 => you said drier (reduce storage)
 *  - intentFactor < 1 => you said wetter (increase storage)
 *
 * (This is optional future use; render.js currently reads DRY_LOSS_MULT only.)
 */
function computeNextTuning(prev, intentFactor){
  const fct = clamp(Number(intentFactor || 1), 0.10, 2.50);
  const p = normalizeTuneDoc(prev);

  const exp = clamp(Number(TUNE_EXP || 0.5), 0.10, 1.00);

  const dryMulStep = Math.pow(fct, exp);
  const rainMulStep = Math.pow(1 / Math.max(1e-6, fct), exp);

  const nextDry = clamp(p.DRY_LOSS_MULT * dryMulStep, DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX);
  const nextRain = clamp(p.RAIN_EFF_MULT * rainMulStep, RAIN_EFF_MULT_MIN, RAIN_EFF_MULT_MAX);

  return { DRY_LOSS_MULT: nextDry, RAIN_EFF_MULT: nextRain };
}

/* =====================================================================
   STATUS / UI GUARDRAILS
===================================================================== */
const STATUS_HYSTERESIS = 2;

/* =========================
   FV THEME PATCH
========================= */
function ensureGlobalCalThemeCSSOnce(){
  try{
    if (window.__FV_FR_GCAL_THEME__) return;
    window.__FV_FR_GCAL_THEME__ = true;

    const st = document.createElement('style');
    st.setAttribute('data-fv-fr-gcal-theme','1');
    st.textContent = `
      #adjustBackdrop .xbtn,
      #confirmAdjBackdrop .xbtn{
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        border: 1px solid var(--border) !important;
        color: var(--text) !important;
        box-shadow: 0 10px 25px rgba(0,0,0,.14) !important;
      }
      #adjustBackdrop .xbtn:active,
      #confirmAdjBackdrop .xbtn:active{
        transform: translateY(1px) !important;
      }

      #adjustBackdrop #feelSeg{
        display:flex !important;
        justify-content:center !important;
        align-items:center !important;
        gap:10px !important;
        width:100% !important;
        max-width: 520px;
        margin: 8px auto 0;
      }
      #adjustBackdrop #feelSeg .segbtn{
        flex: 0 0 auto;
        min-width: 120px;
      }

      #adjustBackdrop .segbtn{
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 94%, #ffffff 6%) !important;
        color: var(--text) !important;
        border-radius: 14px !important;
        padding: 10px 12px !important;
        font-weight: 900 !important;
        box-shadow: 0 8px 18px rgba(0,0,0,.08) !important;
      }
      #adjustBackdrop .segbtn.on{
        border-color: transparent !important;
        background: color-mix(in srgb, var(--accent, #2F6C3C) 24%, var(--surface) 76%) !important;
        outline: 2px solid color-mix(in srgb, var(--accent, #2F6C3C) 60%, transparent 40%) !important;
        outline-offset: 1px !important;
      }
      #adjustBackdrop .segbtn:disabled{
        opacity: .45 !important;
        cursor: not-allowed !important;
        transform: none !important;
        box-shadow: none !important;
      }

      #adjustBackdrop #intensityBox{
        max-width: 620px;
        margin: 0 auto;
      }
      #adjustBackdrop #intensityBox input[type="range"],
      #adjustBackdrop #adjIntensity{
        width: 100% !important;
        display:block !important;
      }
      #adjustBackdrop .intensity-scale{
        width: 100% !important;
        justify-content:space-between !important;
      }

      #adjustBackdrop .btn,
      #confirmAdjBackdrop .btn{
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        border-radius: 12px !important;
        padding: 10px 12px !important;
        font-weight: 900 !important;
      }
      #adjustBackdrop .btn:active,
      #confirmAdjBackdrop .btn:active{
        transform: translateY(1px) !important;
      }

      #adjustBackdrop .btn.btn-primary,
      #adjustBackdrop .btn-primary,
      #confirmAdjBackdrop .btn.btn-primary,
      #confirmAdjBackdrop .btn-primary{
        background: var(--accent, #2F6C3C) !important;
        border-color: transparent !important;
        color: #fff !important;
        box-shadow: 0 10px 26px rgba(47,108,60,.45) !important;
      }
      #adjustBackdrop .btn.btn-primary:disabled,
      #adjustBackdrop .btn-primary:disabled,
      #confirmAdjBackdrop .btn.btn-primary:disabled,
      #confirmAdjBackdrop .btn-primary:disabled{
        opacity: .55 !important;
        cursor: not-allowed !important;
        box-shadow: none !important;
      }

      @media (max-width: 380px){
        #adjustBackdrop #feelSeg .segbtn{ min-width: 104px; }
      }
    `;
    document.head.appendChild(st);
  }catch(_){}
}

/* =========================
   Timestamp helpers
========================= */
function tsToMs(ts){
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds && ts.nanoseconds != null){
    return (Number(ts.seconds)*1000) + Math.floor(Number(ts.nanoseconds)/1e6);
  }
  if (typeof ts === 'string'){
    const d = new Date(ts);
    return isFinite(d.getTime()) ? d.getTime() : 0;
  }
  return 0;
}
function fmtDur(ms){
  ms = Math.max(0, ms|0);
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function fmtAbs(tsMs){
  if (!tsMs) return '—';
  try{
    const d = new Date(tsMs);
    return d.toLocaleString(undefined, {
      year:'numeric', month:'short', day:'2-digit',
      hour:'numeric', minute:'2-digit'
    });
  }catch(_){ return '—'; }
}
function isoDay(iso){
  if (!iso) return '';
  const s = String(iso);
  return (s.length >= 10) ? s.slice(0,10) : s;
}

/* =========================
   Modal helpers
========================= */
function showModal(id, on){
  const el = $(id);
  if (el) el.classList.toggle('pv-hide', !on);
}
function setText(id, val){
  const el = $(id);
  if (el) el.textContent = String(val);
}
function setHtml(id, html){
  const el = $(id);
  if (!el) return;
  if (!html){
    el.style.display = 'none';
    el.innerHTML = '';
  } else {
    el.style.display = 'block';
    el.innerHTML = html;
  }
}

/* =========================
   Model run helper
========================= */
function getSelectedField(state){
  const fid = state.selectedFieldId;
  if (!fid) return null;
  return (state.fields || []).find(x=>x.id === fid) || null;
}

// For this modal, CAL must match render.js: ALL ZERO.
function getCalForShown(_state){
  return { wetBias:0, opWetBias:{}, readinessShift:0, opReadinessShift:{} };
}
function runFieldWithCal(state, f, calObj){
  if (!f) return null;
  if (!state._mods || !state._mods.model || !state._mods.weather) return null;

  const wxCtx = buildWxCtx(state);
  const opKey = getCurrentOp();

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA,
    opKey,
    CAL: calObj,
    getPersistedState: (id)=> getPersistedStateForDeps(state, id)
  };

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
}

function getRunForFieldShown(state, f){
  return runFieldWithCal(state, f, getCalForShown(state));
}

/* =========================
   CURRENT OP THRESHOLD
========================= */
function currentThreshold(state){
  const opKey = getCurrentOp();
  const v = state.thresholdsByOp && state.thresholdsByOp.get ? state.thresholdsByOp.get(opKey) : null;
  const thr = isFinite(Number(v)) ? Number(v) : 70;
  return clamp(Math.round(thr), 0, 100);
}

/* =========================
   OP-THRESHOLD wet/dry truth
========================= */
function statusFromReadinessAndThreshold(state, run, thr){
  const r = clamp(Math.round(Number(run?.readinessR ?? 0)), 0, 100);
  const t = clamp(Math.round(Number(thr ?? 70)), 0, 100);
  const band = clamp(Math.round(Number(STATUS_HYSTERESIS)), 0, 10);

  if (r >= (t + band)) return 'dry';
  if (r <= (t - band)) return 'wet';

  const prev = String(state?._adjStatus || '');
  if (prev === 'wet' || prev === 'dry') return prev;

  return (r >= t) ? 'dry' : 'wet';
}

/* =========================
   Cooldown (72h)
========================= */
function isLocked(state){
  const nextMs = Number(state._nextAllowedMs || 0);
  if (!nextMs) return false;
  return Date.now() < nextMs;
}

async function loadCooldown(state){
  const api = getAPI(state);
  state._cooldownHours = isFinite(Number(state._cooldownHours)) ? Number(state._cooldownHours) : 72;

  if (!api){
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    return;
  }

  if (api.kind === 'compat'){
    try{
      const db = window.firebase.firestore();
      const snap = await db.collection(CONST.WEIGHTS_COLLECTION).doc(CONST.WEIGHTS_DOC).get();
      if (!snap.exists){
        state._nextAllowedMs = 0;
        state._lastAppliedMs = 0;
        state._cooldownHours = 72;
        return;
      }
      const d = snap.data() || {};
      state._nextAllowedMs = tsToMs(d.nextAllowedAt);
      state._lastAppliedMs = tsToMs(d.lastAppliedAt);
      state._cooldownHours = isFinite(Number(d.cooldownHours)) ? Number(d.cooldownHours) : 72;
      return;
    }catch(_){
      state._nextAllowedMs = 0;
      state._lastAppliedMs = 0;
      state._cooldownHours = 72;
      return;
    }
  }

  try{
    const db = api.getFirestore();
    const ref = api.doc(db, CONST.WEIGHTS_COLLECTION, CONST.WEIGHTS_DOC);
    const snap = await api.getDoc(ref);

    if (!snap || !snap.exists || !snap.exists()){
      state._nextAllowedMs = 0;
      state._lastAppliedMs = 0;
      state._cooldownHours = 72;
      return;
    }

    const d = snap.data() || {};
    state._nextAllowedMs = tsToMs(d.nextAllowedAt);
    state._lastAppliedMs = tsToMs(d.lastAppliedAt);
    state._cooldownHours = isFinite(Number(d.cooldownHours)) ? Number(d.cooldownHours) : 72;
  }catch(_){
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
  }
}

function renderCooldownCard(state){
  const now = Date.now();
  const lastMs = Number(state._lastAppliedMs || 0);
  const nextMs = Number(state._nextAllowedMs || 0);
  const cdH = Number(state._cooldownHours || 72);

  const locked = isLocked(state);
  const since = lastMs ? fmtDur(now - lastMs) : '—';
  const nextAbs = nextMs ? fmtAbs(nextMs) : '—';

  const title = locked ? 'Global calibration is locked' : 'Global calibration is available';
  const lastLine = lastMs
    ? `Last global shift: <span class="mono">${esc(since)}</span> ago`
    : `Last global shift: <span class="mono">—</span>`;
  const sub = `Next global shift allowed: <span class="mono">${esc(nextAbs)}</span>`;
  const note = `This scales STORAGE truth for all fields and lets readiness update automatically.`;

  const cardStyle =
    'border:1px solid var(--border);border-radius:14px;padding:12px;' +
    'background:color-mix(in srgb, var(--surface) 96%, #ffffff 4%);' +
    'display:grid;gap:8px;';
  const headStyle = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;';
  const hStyle = 'margin:0;font-weight:900;font-size:12px;line-height:1.2;';
  const badgeStyle =
    'padding:4px 8px;border-radius:999px;border:1px solid var(--border);' +
    'font-weight:900;font-size:12px;white-space:nowrap;' +
    (locked ? 'background:color-mix(in srgb, #b00020 10%, var(--surface) 90%);'
            : 'background:color-mix(in srgb, var(--accent) 12%, var(--surface) 88%);');

  const lineStyle = 'font-size:12px;color:var(--text);opacity:.92;';
  const mutedStyle = 'font-size:12px;color:var(--muted,#67706B);opacity:.95;line-height:1.35;';

  setHtml('calibCooldownMsg', `
    <div style="${cardStyle}">
      <div style="${headStyle}">
        <div style="${hStyle}">${esc(title)}</div>
        <div style="${badgeStyle}">${locked ? `${cdH}h rule` : 'Unlocked'}</div>
      </div>
      <div style="${lineStyle}">${lastLine}</div>
      <div style="${lineStyle}">${sub}</div>
      <div style="${mutedStyle}">${note}</div>
    </div>
  `);
}

/* =========================
   Slider anchoring + clamp
========================= */
function sliderEl(){ return $('adjIntensity'); }
function sliderVal(){
  const el = sliderEl();
  const v = el ? Number(el.value) : 50;
  return clamp(Math.round(isFinite(v) ? v : 50), 0, 100);
}
function setSliderVal(v){
  const el = sliderEl();
  if (el) el.value = String(clamp(Math.round(Number(v)), 0, 100));
  const out = $('adjIntensityVal');
  if (out) out.textContent = String(sliderVal());
}
function setAnchor(state, anchorReadiness){
  state._adjAnchorReadiness = clamp(Math.round(Number(anchorReadiness)), 0, 100);
  const el = sliderEl();
  if (el){
    el.min = '0';
    el.max = '100';
    el.value = String(state._adjAnchorReadiness);
  }
  const out = $('adjIntensityVal');
  if (out) out.textContent = String(state._adjAnchorReadiness);
}

function enforceSliderClamp(state){
  const el = sliderEl();
  if (!el) return;

  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  let v = sliderVal();

  const status = state._adjStatus;
  const feel = state._adjFeel;

  if (!feel){
    v = anchor;
    el.value = String(v);
    setSliderVal(v);
    return;
  }

  if (status === 'wet' && feel === 'dry'){
    if (v < anchor) v = anchor;
  }
  else if (status === 'dry' && feel === 'wet'){
    if (v > anchor) v = anchor;
  } else {
    v = anchor;
  }

  el.value = String(v);
  setSliderVal(v);
}

function updateGuardText(state){
  const el = $('adjGuard');
  if (!el) return;

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')){
    el.textContent = 'Choose Wet or Dry, then move the slider to apply a STORAGE % shift to ALL fields.';
    return;
  }

  const anchor = clamp(Math.round(Number(state._adjAnchorReadiness ?? 50)), 0, 100);
  const target = sliderVal();

  let factor = 1;
  if (anchor > 0) factor = target / anchor;

  const pct = Math.round((factor - 1) * 100); // +pct => drier intent
  const storageMult = clamp(1 - (pct / 100), 0.10, 2.50);

  const dir = (pct >= 0) ? 'drier' : 'wetter';
  el.textContent =
    `This will make ALL fields ~${Math.abs(pct)}% ${dir} by scaling STORAGE (×${storageMult.toFixed(3)}).`;
}

/* =========================
   UI state
========================= */
function updateAdjustHeader(state){
  const f = getSelectedField(state);
  const sub = $('adjustSub');
  if (!sub) return;

  if (f && f.name){
    sub.textContent = `Global storage shift • ${f.name}`;
  } else {
    sub.textContent = 'Global storage shift';
  }
}

function updatePills(state, run){
  const fid = state.selectedFieldId;
  const p = getFieldParams(state, fid);

  const thr = currentThreshold(state);

  setText('adjReadiness', run ? run.readinessR : '—');
  setText('adjWetness', run ? run.wetnessR : '—');
  setText('adjSoil', `${p.soilWetness}/100`);
  setText('adjDrain', `${p.drainageIndex}/100`);

  setText('adjModelClass', (state._adjStatus || '—').toUpperCase());

  try{
    const thrEl = $('adjThreshold');
    if (thrEl) thrEl.textContent = String(thr);
  }catch(_){}
}

function updateUI(state){
  const locked = isLocked(state);

  const bWet = $('btnFeelWet');
  const bDry = $('btnFeelDry');
  const applyBtn = $('btnAdjApply');
  const s = sliderEl();

  if (bWet) bWet.disabled = locked || (state._adjStatus === 'wet');
  if (bDry) bDry.disabled = locked || (state._adjStatus === 'dry');
  if (s) s.disabled = locked;

  if (locked){
    state._adjFeel = null;
  }

  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }

  const box = $('intensityBox');
  const opposite =
    (state._adjStatus === 'wet' && state._adjFeel === 'dry') ||
    (state._adjStatus === 'dry' && state._adjFeel === 'wet');
  if (box) box.classList.toggle('pv-hide', !opposite);

  const title = $('intensityTitle');
  const left = $('intensityLeft');
  const right = $('intensityRight');
  if (opposite){
    if (state._adjStatus === 'wet'){
      if (title) title.textContent = 'How DRY is it?';
      if (left) left.textContent = 'Slightly drier';
      if (right) right.textContent = 'Extremely drier';
    } else {
      if (title) title.textContent = 'How WET is it?';
      if (left) left.textContent = 'Slightly wetter';
      if (right) right.textContent = 'Extremely wetter';
    }
  }

  const hint = $('adjHint');
  if (hint){
    const thr = currentThreshold(state);
    const band = clamp(Math.round(Number(STATUS_HYSTERESIS)), 0, 10);

    if (locked){
      hint.textContent = 'Global shift is locked (72h rule).';
    } else if (state._adjStatus === 'wet'){
      hint.textContent =
        `This reference field is WET for the current operation (Readiness below threshold ${thr}). ` +
        `Only “Dry” is allowed. (Stability band ±${band} around threshold)`;
    } else if (state._adjStatus === 'dry'){
      hint.textContent =
        `This reference field is DRY for the current operation (Readiness at/above threshold ${thr}). ` +
        `Only “Wet” is allowed. (Stability band ±${band} around threshold)`;
    } else {
      hint.textContent = 'Choose Wet or Dry.';
    }
  }

  if (applyBtn){
    const hasChoice = (state._adjFeel === 'wet' || state._adjFeel === 'dry');
    applyBtn.disabled = locked || !hasChoice;
  }

  enforceSliderClamp(state);
  updateGuardText(state);
}

/* =========================
   Firestore writes (TRUTH STATE + LEARNING DOC)
========================= */
function futureTimestamp(api, ms){
  try{
    if (api && api.Timestamp && typeof api.Timestamp.fromMillis === 'function'){
      return api.Timestamp.fromMillis(ms);
    }
  }catch(_){}
  return new Date(ms);
}

async function writeWeightsLock(state, nowMs){
  const api = getAPI(state);
  const cdH = Number(state._cooldownHours || 72);
  const nextMs = nowMs + Math.round(cdH * 3600 * 1000);

  state._lastAppliedMs = nowMs;
  state._nextAllowedMs = nextMs;

  if (!api) return;

  if (api.kind === 'compat'){
    try{
      const db = window.firebase.firestore();
      await db.collection(CONST.WEIGHTS_COLLECTION).doc(CONST.WEIGHTS_DOC).set({
        lastAppliedAt: new Date(nowMs).toISOString(),
        nextAllowedAt: new Date(nextMs).toISOString(),
        cooldownHours: cdH
      }, { merge:true });
    }catch(e){
      console.warn('[FieldReadiness] weights update failed:', e);
    }
    return;
  }

  try{
    const db = api.getFirestore();
    const ref = api.doc(db, CONST.WEIGHTS_COLLECTION, CONST.WEIGHTS_DOC);

    await api.setDoc(ref, {
      lastAppliedAt: api.serverTimestamp ? api.serverTimestamp() : new Date(nowMs).toISOString(),
      nextAllowedAt: futureTimestamp(api, nextMs),
      cooldownHours: cdH
    }, { merge:true });
  }catch(e){
    console.warn('[FieldReadiness] weights update failed:', e);
  }
}

async function writeTruthStateDocCompat(db, fieldId, payload){
  await db.collection(FR_STATE_COLLECTION).doc(String(fieldId)).set(payload, { merge:true });
}
async function writeTruthStateDocModern(api, db, fieldId, payload){
  const ref = api.doc(db, FR_STATE_COLLECTION, String(fieldId));
  await api.setDoc(ref, payload, { merge:true });
}

/**
 * NEW: Apply STORAGE scaling to ALL fields truth:
 * storageFinal_new = storageFinal_old * storageMult
 *
 * If a field has no truth yet, we seed it from the current truth run first.
 */
async function writeGlobalTruthStateStorageScale(state, storageMult, asOfDateISO){
  const api = getAPI(state);
  if (!api) return;

  await loadPersistedState(state, { force:true });

  const fields = Array.isArray(state.fields) ? state.fields : [];
  if (!fields.length) return;

  const mult = clamp(Number(storageMult || 1), 0.10, 2.50);

  let createdBy = null;
  if (api.kind === 'compat') createdBy = getAuthUserIdCompat();
  else createdBy = getAuthUserIdModern(api);

  // Ensure we have model modules loaded (global-calibration runs from UI; model is usually ready)
  // We’ll use the current truth run only to seed missing docs (rare).
  function seedFromRun(f){
    try{
      const run = getRunForFieldShown(state, f);
      if (!run) return null;
      const s = safeNum(run.storageFinal);
      const smax = safeNum(run?.factors?.Smax);
      let asOf = '';
      try{
        const rows = Array.isArray(run.rows) ? run.rows : [];
        const last = rows.length ? rows[rows.length - 1] : null;
        asOf = isoDay(last && last.dateISO ? last.dateISO : '');
      }catch(_){}
      if (!asOf) asOf = isoDay(new Date().toISOString());

      return { storageFinal: (s==null?0:s), SmaxAtSave: (smax==null?0:smax), asOfDateISO: asOf };
    }catch(_){
      return null;
    }
  }

  if (api.kind === 'compat'){
    const db = window.firebase.firestore();
    const updatedAtISO = nowISO();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;
        const fid = String(f.id);

        const cur = state.persistedStateByFieldId ? state.persistedStateByFieldId[fid] : null;
        let baseStorage = safeNum(cur && cur.storageFinal);
        let asOf = safeISO10(cur && cur.asOfDateISO);

        let smaxAtSave = safeNum(cur && cur.SmaxAtSave);

        if (baseStorage == null || !asOf){
          const seed = seedFromRun(f);
          if (!seed) continue;
          baseStorage = safeNum(seed.storageFinal) ?? 0;
          asOf = safeISO10(seed.asOfDateISO) || safeISO10(asOfDateISO) || isoDay(new Date().toISOString());
          smaxAtSave = safeNum(seed.SmaxAtSave) ?? 0;
        }

        const nextStorage = Math.max(0, baseStorage * mult);

        const payload = {
          fieldId: fid,
          fieldName: String(f.name || ''),
          asOfDateISO: String(safeISO10(asOfDateISO) || asOf),
          storageFinal: nextStorage,
          SmaxAtSave: smaxAtSave || 0,
          source: 'global-storage-scale',
          storageMult: mult,
          updatedAt: updatedAtISO,
          updatedBy: createdBy || null
        };

        await writeTruthStateDocCompat(db, fid, payload);

        state.persistedStateByFieldId = state.persistedStateByFieldId || {};
        state.persistedStateByFieldId[fid] = {
          ...(state.persistedStateByFieldId[fid]||{}),
          fieldId: fid,
          storageFinal: nextStorage,
          asOfDateISO: String(safeISO10(asOfDateISO) || asOf),
          SmaxAtSave: smaxAtSave || 0
        };
      }catch(e){
        console.warn('[FieldReadiness] truth state storage-scale write failed (compat):', e);
      }
    }

    state._persistLoadedAt = Date.now();
    return;
  }

  try{
    const db = api.getFirestore();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;
        const fid = String(f.id);

        const cur = state.persistedStateByFieldId ? state.persistedStateByFieldId[fid] : null;
        let baseStorage = safeNum(cur && cur.storageFinal);
        let asOf = safeISO10(cur && cur.asOfDateISO);
        let smaxAtSave = safeNum(cur && cur.SmaxAtSave);

        if (baseStorage == null || !asOf){
          const seed = seedFromRun(f);
          if (!seed) continue;
          baseStorage = safeNum(seed.storageFinal) ?? 0;
          asOf = safeISO10(seed.asOfDateISO) || safeISO10(asOfDateISO) || isoDay(new Date().toISOString());
          smaxAtSave = safeNum(seed.SmaxAtSave) ?? 0;
        }

        const nextStorage = Math.max(0, baseStorage * mult);

        const payload = {
          fieldId: fid,
          fieldName: String(f.name || ''),
          asOfDateISO: String(safeISO10(asOfDateISO) || asOf),
          storageFinal: nextStorage,
          SmaxAtSave: smaxAtSave || 0,
          source: 'global-storage-scale',
          storageMult: mult,
          updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
          updatedBy: createdBy || null
        };

        await writeTruthStateDocModern(api, db, fid, payload);

        state.persistedStateByFieldId = state.persistedStateByFieldId || {};
        state.persistedStateByFieldId[fid] = {
          ...(state.persistedStateByFieldId[fid]||{}),
          fieldId: fid,
          storageFinal: nextStorage,
          asOfDateISO: String(safeISO10(asOfDateISO) || asOf),
          SmaxAtSave: smaxAtSave || 0
        };
      }catch(e){
        console.warn('[FieldReadiness] truth state storage-scale write failed:', e);
      }
    }

    state._persistLoadedAt = Date.now();
  }catch(e){
    console.warn('[FieldReadiness] truth state storage-scale write failed (setup):', e);
  }
}

/**
 * Learning write: record intent and update tuning doc.
 * intentFactor:
 *  - >1 means drier intent (we reduced storage)
 *  - <1 means wetter intent
 */
async function writeLearningFromStorageShift(state, {
  storageMult,
  percentMove,
  anchorR,
  targetR,
  asOfDateISO,
  refFieldId,
  refFieldName,
  opKey
}){
  const api = getAPI(state);
  if (!api) return;

  const prev = await loadGlobalTuning(state);

  // Convert storage multiplier to “intent factor”
  // storageMult < 1 => drier => intentFactor > 1
  const sm = clamp(Number(storageMult || 1), 0.10, 2.50);
  const intentFactor = clamp(1 / Math.max(1e-6, sm), 0.10, 2.50);

  const next = computeNextTuning(prev, intentFactor);
  const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);

  const payload = {
    DRY_LOSS_MULT: next.DRY_LOSS_MULT,
    RAIN_EFF_MULT: next.RAIN_EFF_MULT,

    lastStorageMult: sm,
    lastPercentMove: clamp(Number(percentMove || 0), -90, 90),
    lastAnchorReadiness: clamp(Number(anchorR || 0), 0, 100),
    lastTargetReadiness: clamp(Number(targetR || 0), 0, 100),
    lastOp: String(opKey || ''),
    lastAsOfDateISO: String(asOfDateISO || ''),
    lastRefFieldId: String(refFieldId || ''),
    lastRefFieldName: String(refFieldName || ''),

    updatedBy: createdBy || null,
    updatedAt: (api.kind === 'compat')
      ? nowISO()
      : (api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString())
  };

  await writeGlobalTuning(state, payload);
}

/* =========================
   Apply
========================= */
async function applyAdjustment(state){
  if (isLocked(state)) return;

  const f = getSelectedField(state);
  if (!f) return;

  await loadPersistedState(state, { force:true });

  const runShown = getRunForFieldShown(state, f);
  if (!runShown) return;

  const thr = currentThreshold(state);
  state._adjStatus = statusFromReadinessAndThreshold(state, runShown, thr);

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return;

  if (state._adjStatus === 'wet' && feel !== 'dry') return;
  if (state._adjStatus === 'dry' && feel !== 'wet') return;

  const anchorR = clamp(Math.round(Number(state._adjAnchorReadiness ?? runShown.readinessR ?? 0)), 0, 100);
  const targetR = clamp(Math.round(Number(sliderVal())), 0, 100);

  // percentMove from reference (kept)
  let factor = 1;
  if (anchorR > 0) factor = targetR / anchorR;

  const percentMove = clamp((factor - 1) * 100, -90, 90); // + => drier intent
  const storageMult = clamp(1 - (percentMove / 100), 0.10, 2.50); // +10% drier => 0.90

  // Choose as-of date aligned to weather series end.
  let asOf = '';
  try{
    const rows = Array.isArray(runShown.rows) ? runShown.rows : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    asOf = isoDay(last && last.dateISO ? last.dateISO : '');
  }catch(_){}
  if (!asOf) asOf = isoDay(new Date().toISOString());

  // 1) Write truth storage state (today) for all fields (storage scaling)
  await writeGlobalTruthStateStorageScale(state, storageMult, asOf);

  // 2) Write learning/tuning doc (optional future use)
  await writeLearningFromStorageShift(state, {
    storageMult,
    percentMove,
    anchorR,
    targetR,
    asOfDateISO: asOf,
    refFieldId: String(f.id || ''),
    refFieldName: String(f.name || ''),
    opKey: String(getCurrentOp() || '')
  });

  const nowMs = Date.now();
  await writeWeightsLock(state, nowMs);

  renderCooldownCard(state);
  updateUI(state);

  closeAdjust(state);

  try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
}

/* =========================
   Open / Close
========================= */
async function openAdjust(state){
  ensureGlobalCalThemeCSSOnce();
  if (!canEdit(state)) return;

  await loadPersistedState(state, { force:true });

  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  const f = getSelectedField(state);
  if (!f) return;

  updateAdjustHeader(state);

  await loadCooldown(state);
  renderCooldownCard(state);

  const runShown = getRunForFieldShown(state, f);
  if (!runShown) return;

  const thr = currentThreshold(state);
  const status = statusFromReadinessAndThreshold(state, runShown, thr);

  state._adjStatus = status;
  state._adjFeel = null;

  state._adjAnchorReadiness = clamp(Math.round(Number(runShown?.readinessR ?? 50)), 0, 100);

  setAnchor(state, state._adjAnchorReadiness);
  setSliderVal(state._adjAnchorReadiness);

  updatePills(state, runShown);
  updateUI(state);

  showModal('adjustBackdrop', true);

  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = setInterval(async ()=>{
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);

    const f2 = getSelectedField(state);
    const run2 = getRunForFieldShown(state, f2);
    if (run2){
      const thr2 = currentThreshold(state);
      state._adjStatus = statusFromReadinessAndThreshold(state, run2, thr2);
      updatePills(state, run2);
    }
    updateUI(state);
  }, 30000);
}

function closeAdjust(state){
  showModal('adjustBackdrop', false);
  showModal('confirmAdjBackdrop', false);
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = null;
}

/* =========================
   Wiring
========================= */
function wireOnce(state){
  if (state._globalCalWired) return;
  state._globalCalWired = true;

  const btnX = $('btnAdjX');
  if (btnX) btnX.addEventListener('click', ()=> closeAdjust(state));

  const btnCancel = $('btnAdjCancel');
  if (btnCancel) btnCancel.addEventListener('click', ()=> closeAdjust(state));

  const back = $('adjustBackdrop');
  if (back){
    back.addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'adjustBackdrop') closeAdjust(state);
    });
  }

  const seg = $('feelSeg');
  if (seg){
    seg.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
      if (!btn) return;
      const feel = btn.getAttribute('data-feel');
      if (feel !== 'wet' && feel !== 'dry') return;
      if (isLocked(state)) return;

      if (state._adjStatus === 'wet'){
        state._adjFeel = 'dry';
      } else if (state._adjStatus === 'dry'){
        state._adjFeel = 'wet';
      } else {
        state._adjFeel = feel;
      }

      setSliderVal(state._adjAnchorReadiness);
      updateUI(state);
    });
  }

  const s = sliderEl();
  if (s){
    s.addEventListener('input', ()=>{
      enforceSliderClamp(state);
      updateGuardText(state);
    });
  }

  const btnApply = $('btnAdjApply');
  if (btnApply){
    btnApply.addEventListener('click', ()=>{
      if (btnApply.disabled) return;
      showModal('confirmAdjBackdrop', true);
    });
  }

  const btnNo = $('btnAdjNo');
  if (btnNo) btnNo.addEventListener('click', ()=> showModal('confirmAdjBackdrop', false));

  const btnYes = $('btnAdjYes');
  if (btnYes){
    btnYes.addEventListener('click', async ()=>{
      showModal('confirmAdjBackdrop', false);
      await applyAdjustment(state);
    });
  }

  const hot = $('fieldsTitle');
  if (hot){
    hot.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit(state)) return;
      await openAdjust(state);
    }, { passive:false });
  }
}

/* =========================
   Public init
========================= */
export function initGlobalCalibration(state){
  ensureGlobalCalThemeCSSOnce();

  try{
    const hot = $('fieldsTitle');
    if (hot){
      if (!canEdit(state)){
        hot.style.display = 'none';
        hot.style.pointerEvents = 'none';
        hot.setAttribute('aria-hidden','true');
      } else {
        hot.style.display = 'inline';
        hot.style.pointerEvents = 'auto';
        hot.removeAttribute('aria-hidden');
      }
    }
  }catch(_){}

  if (!canEdit(state)) return;

  wireOnce(state);

  (async ()=>{
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);
  })();
}
