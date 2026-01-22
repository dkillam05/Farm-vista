/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-01-22e-global-FORCE-target-readiness-scale-storage-reset30d

WHAT CHANGED (per Dane):
✅ Global Calibration slider FORCES the reference field to the exact target readiness.
✅ Then scales ALL other fields by the same STORAGE multiplier.

Important:
- Works with the current model reversal: "dry credit" is applied in readiness.
- Therefore, forcing readiness must compute the storage needed BEFORE/AFTER credit.

Keeps:
✅ Reset (rebuild) truth from last ~30 days weather
✅ 72h lockout + guardrails
✅ learning doc write (optional)
✅ fr:soft-reload after apply
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
   Collections
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';
const STATE_TTL_MS = 30000;

const FR_TUNE_COLLECTION = 'field_readiness_tuning';
const FR_TUNE_DOC = 'global';

const DRY_LOSS_MULT_MIN = 0.30;
const DRY_LOSS_MULT_MAX = 3.00;
const RAIN_EFF_MULT_MIN = 0.30;
const RAIN_EFF_MULT_MAX = 3.00;

const TUNE_EXP = 0.50;

/* =====================================================================
   Reversal constants (MUST MATCH model.js)
===================================================================== */
const SMAX_MIN = 3.0;
const SMAX_MAX = 5.0;
const REV_POINTS_MAX = 15;

function dryCreditInchesFromSmax(Smax){
  const s = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const tightness = (SMAX_MAX - s) / (SMAX_MAX - SMAX_MIN); // 0 at 5, 1 at 3
  return tightness * (REV_POINTS_MAX / 100) * s;
}

/* =====================================================================
   Small helpers
===================================================================== */
function safeStr(x){ const s = String(x || ''); return s ? s : ''; }
function safeISO10(x){ const s = safeStr(x); return (s.length >= 10) ? s.slice(0,10) : s; }
function safeNum(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function nowISO(){ try{ return new Date().toISOString(); }catch(_){ return ''; } }

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
function setText(id, val){
  const el = $(id);
  if (el) el.textContent = String(val);
}
function showModal(id, on){
  const el = $(id);
  if (el) el.classList.toggle('pv-hide', !on);
}

/* =====================================================================
   Auth helpers
===================================================================== */
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
   Tuning doc (kept)
===================================================================== */
function normalizeTuneDoc(d){
  const doc = (d && typeof d === 'object') ? d : {};
  const dryLoss = safeNum(doc.DRY_LOSS_MULT);
  const rainEff = safeNum(doc.RAIN_EFF_MULT);

  return {
    DRY_LOSS_MULT: clamp((dryLoss == null ? 1.0 : dryLoss), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX),
    RAIN_EFF_MULT: clamp((rainEff == null ? 1.0 : rainEff), RAIN_EFF_MULT_MIN, RAIN_EFF_MULT_MAX),
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

/* =====================================================================
   Cooldown (72h) - kept
===================================================================== */
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
  const note = `Apply forces target readiness for the reference field, then scales storage for all fields. Reset rebuilds truth from last ~30 days weather.`;

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

/* =====================================================================
   UI helpers
===================================================================== */
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

const STATUS_HYSTERESIS = 2;

function currentThreshold(state){
  const opKey = getCurrentOp();
  const v = state.thresholdsByOp && state.thresholdsByOp.get ? state.thresholdsByOp.get(opKey) : null;
  const thr = isFinite(Number(v)) ? Number(v) : 70;
  return clamp(Math.round(thr), 0, 100);
}

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

function updateGuardText(state, storageMult, forcedStorage){
  const el = $('adjGuard');
  if (!el) return;

  if (storageMult != null && Number.isFinite(storageMult)){
    const msg = `Will FORCE ref field storage to ${forcedStorage.toFixed(2)} in, then scale all fields storage by ×${storageMult.toFixed(3)}.`;
    el.textContent = msg;
    return;
  }

  el.textContent = 'Choose Wet or Dry, then move the slider to force target readiness and scale all fields.';
}

/* =====================================================================
   Theme patch (kept) + reset button styling
===================================================================== */
function ensureGlobalCalThemeCSSOnce(){
  try{
    if (window.__FV_FR_GCAL_THEME__) return;
    window.__FV_FR_GCAL_THEME__ = true;

    const st = document.createElement('style');
    st.setAttribute('data-fv-fr-gcal-theme','1');
    st.textContent = `
      #btnAdjReset30{
        border: 1px solid var(--border) !important;
        background: color-mix(in srgb, var(--surface) 92%, #ffffff 8%) !important;
        color: var(--text) !important;
        border-radius: 12px !important;
        padding: 10px 12px !important;
        font-weight: 900 !important;
      }
      #btnAdjReset30:active{ transform: translateY(1px) !important; }
      #btnAdjReset30:disabled{ opacity:.55 !important; cursor:not-allowed !important; }
    `;
    document.head.appendChild(st);
  }catch(_){}
}

/* =====================================================================
   Model run helper
===================================================================== */
function getSelectedField(state){
  const fid = state.selectedFieldId;
  if (!fid) return null;
  return (state.fields || []).find(x=>x.id === fid) || null;
}

// CAL must match render.js: ALL ZERO.
function getCalForShown(_state){
  return { wetBias:0, opWetBias:{}, readinessShift:0, opReadinessShift:{} };
}

function runFieldWithCal(state, f, calObj, extraOpts){
  if (!f) return null;
  if (!state._mods || !state._mods.model || !state._mods.weather) return null;

  const wxCtx = buildWxCtx(state);
  const opKey = getCurrentOp();

  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA, // (global-cal UI; learning applied only during reset)
    opKey,
    CAL: calObj,
    getPersistedState: (id)=> getPersistedStateForDeps(state, id),
    ...(extraOpts && typeof extraOpts === 'object' ? extraOpts : {})
  };

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
}

function getRunForFieldShown(state, f){
  return runFieldWithCal(state, f, getCalForShown(state));
}

/* =====================================================================
   FORCE target readiness → required storage (accounts for dry credit)
===================================================================== */
function storageNeededForTargetReadiness(targetR, Smax){
  const r = clamp(Math.round(Number(targetR)), 0, 100);
  const smax = clamp(Number(Smax), SMAX_MIN, SMAX_MAX);
  const creditIn = dryCreditInchesFromSmax(smax);

  // readiness = 100 - wetness
  const wetPct = clamp(100 - r, 0, 100);
  const storageForReadiness = smax * (wetPct / 100);

  // model uses: storageForReadiness = clamp(storageEff - creditIn, 0..Smax)
  // so storageEff needed is storageForReadiness + creditIn
  const storageEff = clamp(storageForReadiness + creditIn, 0, smax);
  return { storageEff, creditIn };
}

/* =====================================================================
   Firestore writes
===================================================================== */
async function writeTruthStateDocCompat(db, fieldId, payload){
  await db.collection(FR_STATE_COLLECTION).doc(String(fieldId)).set(payload, { merge:true });
}
async function writeTruthStateDocModern(api, db, fieldId, payload){
  const ref = api.doc(db, FR_STATE_COLLECTION, String(fieldId));
  await api.setDoc(ref, payload, { merge:true });
}

/* =====================================================================
   APPLY: FORCE reference → scale all fields
===================================================================== */
async function applyForcedCalibration(state){
  if (isLocked(state)) return;

  const api = getAPI(state);
  if (!api) return;

  const refField = getSelectedField(state);
  if (!refField) return;

  await loadPersistedState(state, { force:true });

  const runRef = getRunForFieldShown(state, refField);
  if (!runRef || !runRef.factors || !Number.isFinite(Number(runRef.factors.Smax))) return;

  const SmaxRef = Number(runRef.factors.Smax);
  const targetR = sliderVal();

  // Current truth storage for ref (what we scale FROM)
  const curStorageRef = safeNum(runRef.storageFinal);
  const curStorageRefSafe = Math.max(0, Number.isFinite(curStorageRef) ? curStorageRef : 0);

  // Force storage for ref to hit target readiness
  const forced = storageNeededForTargetReadiness(targetR, SmaxRef);
  const forcedStorageRef = forced.storageEff;

  // Compute multiplier (scale everyone by same %)
  const denom = Math.max(1e-6, curStorageRefSafe);
  let storageMult = forcedStorageRef / denom;

  // safety clamp (prevents explosions if storageRef is ~0)
  storageMult = clamp(storageMult, 0.05, 5.0);

  // As-of = last date in series (today)
  let asOf = '';
  try{
    const rows = Array.isArray(runRef.rows) ? runRef.rows : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    asOf = isoDay(last && last.dateISO ? last.dateISO : '');
  }catch(_){}
  if (!asOf) asOf = isoDay(new Date().toISOString());

  const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);

  const fields = Array.isArray(state.fields) ? state.fields : [];
  if (!fields.length) return;

  // Update guard text so user sees what’s about to happen
  updateGuardText(state, storageMult, forcedStorageRef);

  // Write updates
  if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
    const db = window.firebase.firestore();
    const updatedAtISO = nowISO();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const run = getRunForFieldShown(state, f);
        if (!run || !run.factors || !Number.isFinite(Number(run.factors.Smax))) continue;

        const smax = Number(run.factors.Smax);
        const cur = Math.max(0, Number(run.storageFinal || 0));
        let next = cur * storageMult;

        // clamp to tank
        next = clamp(next, 0, smax);

        // Force reference field exactly
        if (String(f.id) === String(refField.id)){
          next = clamp(forcedStorageRef, 0, smax);
        }

        await writeTruthStateDocCompat(db, String(f.id), {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          asOfDateISO: String(asOf),
          storageFinal: next,
          SmaxAtSave: smax,
          source: 'global-cal-force',
          storageMult,
          targetReadiness: targetR,
          refFieldId: String(refField.id),
          updatedAt: updatedAtISO,
          updatedBy: createdBy || null
        });

        state.persistedStateByFieldId = state.persistedStateByFieldId || {};
        state.persistedStateByFieldId[String(f.id)] = {
          fieldId: String(f.id),
          storageFinal: Number(next),
          asOfDateISO: String(asOf),
          SmaxAtSave: Number(smax)
        };
      }catch(e){
        console.warn('[FieldReadiness] force cal write failed:', e);
      }
    }

    state._persistLoadedAt = Date.now();
    await writeWeightsLock(state, Date.now());
    try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
    return;
  }

  if (api.kind !== 'compat'){
    const db = api.getFirestore();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const run = getRunForFieldShown(state, f);
        if (!run || !run.factors || !Number.isFinite(Number(run.factors.Smax))) continue;

        const smax = Number(run.factors.Smax);
        const cur = Math.max(0, Number(run.storageFinal || 0));
        let next = cur * storageMult;
        next = clamp(next, 0, smax);

        if (String(f.id) === String(refField.id)){
          next = clamp(forcedStorageRef, 0, smax);
        }

        await writeTruthStateDocModern(api, db, String(f.id), {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          asOfDateISO: String(asOf),
          storageFinal: next,
          SmaxAtSave: smax,
          source: 'global-cal-force',
          storageMult,
          targetReadiness: targetR,
          refFieldId: String(refField.id),
          updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
          updatedBy: createdBy || null
        });

        state.persistedStateByFieldId = state.persistedStateByFieldId || {};
        state.persistedStateByFieldId[String(f.id)] = {
          fieldId: String(f.id),
          storageFinal: Number(next),
          asOfDateISO: String(asOf),
          SmaxAtSave: Number(smax)
        };
      }catch(e){
        console.warn('[FieldReadiness] force cal write failed:', e);
      }
    }

    state._persistLoadedAt = Date.now();
    await writeWeightsLock(state, Date.now());
    try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
  }
}

/* =====================================================================
   RESET / REBUILD TRUTH FROM LAST ~30 DAYS WEATHER (kept)
===================================================================== */
async function rebuildTruthFromLast30Days(state){
  try{
    if (!state) return;
    if (!canEdit(state)) return;

    const ok = window.confirm(
      'Reset/Rebuild Truth?\n\nThis will recompute TODAY storage truth for ALL fields using the last ~30 days of weather and your current field sliders.\n\nProceed?'
    );
    if (!ok) return;

    if (!state._mods || !state._mods.model || !state._mods.weather){
      window.alert('Model/weather modules are not loaded yet. Open the readiness page and wait for tiles to load, then try again.');
      return;
    }

    const api = getAPI(state);
    if (!api){
      window.alert('Firebase is not ready. Try again after the app finishes loading.');
      return;
    }

    let dryLossMult = 1.0;
    try{
      const tuned = await loadGlobalTuning(state);
      if (tuned && safeNum(tuned.DRY_LOSS_MULT) != null){
        dryLossMult = clamp(Number(tuned.DRY_LOSS_MULT), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX);
      }
    }catch(_){}

    const wxCtx = buildWxCtx(state);
    const opKey = getCurrentOp();
    const CAL0 = { wetBias:0, opWetBias:{}, readinessShift:0, opReadinessShift:{} };

    const depsRebuild = {
      getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
      getFieldParams: (id)=> getFieldParams(state, id),
      LOSS_SCALE: CONST.LOSS_SCALE,
      EXTRA: { ...EXTRA, DRY_LOSS_MULT: dryLossMult },
      opKey,
      CAL: CAL0,
      seedMode: 'baseline'
    };

    const fields = Array.isArray(state.fields) ? state.fields : [];
    if (!fields.length){
      window.alert('No fields loaded.');
      return;
    }

    const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);

    if (api.kind === 'compat'){
      const db = window.firebase.firestore();
      const updatedAtISO = nowISO();

      for (const f of fields){
        try{
          if (!f || !f.id) continue;
          const run = state._mods.model.runField(f, depsRebuild);
          if (!run || safeNum(run.storageFinal) == null) continue;

          let asOf = '';
          try{
            const rows = Array.isArray(run.rows) ? run.rows : [];
            const last = rows.length ? rows[rows.length - 1] : null;
            asOf = isoDay(last && last.dateISO ? last.dateISO : '');
          }catch(_){}
          if (!asOf) asOf = isoDay(new Date().toISOString());

          const Smax = safeNum(run?.factors?.Smax) ?? 0;
          const storageFinal = Math.max(0, Number(run.storageFinal));

          await writeTruthStateDocCompat(db, String(f.id), {
            fieldId: String(f.id),
            fieldName: String(f.name || ''),
            asOfDateISO: String(asOf),
            storageFinal,
            SmaxAtSave: Number(Smax || 0),
            source: 'reset-rebuild-30days',
            updatedAt: updatedAtISO,
            updatedBy: createdBy || null
          });

          state.persistedStateByFieldId = state.persistedStateByFieldId || {};
          state.persistedStateByFieldId[String(f.id)] = {
            fieldId: String(f.id),
            storageFinal: Number(storageFinal),
            asOfDateISO: String(asOf),
            SmaxAtSave: Number(Smax || 0)
          };
        }catch(e){
          console.warn('[FieldReadiness] rebuild truth failed for field:', f?.name, e);
        }
      }

      state._persistLoadedAt = Date.now();
      try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
      window.alert('Reset complete: truth rebuilt from last ~30 days weather.');
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();

      for (const f of fields){
        try{
          if (!f || !f.id) continue;
          const run = state._mods.model.runField(f, depsRebuild);
          if (!run || safeNum(run.storageFinal) == null) continue;

          let asOf = '';
          try{
            const rows = Array.isArray(run.rows) ? run.rows : [];
            const last = rows.length ? rows[rows.length - 1] : null;
            asOf = isoDay(last && last.dateISO ? last.dateISO : '');
          }catch(_){}
          if (!asOf) asOf = isoDay(new Date().toISOString());

          const Smax = safeNum(run?.factors?.Smax) ?? 0;
          const storageFinal = Math.max(0, Number(run.storageFinal));

          await writeTruthStateDocModern(api, db, String(f.id), {
            fieldId: String(f.id),
            fieldName: String(f.name || ''),
            asOfDateISO: String(asOf),
            storageFinal,
            SmaxAtSave: Number(Smax || 0),
            source: 'reset-rebuild-30days',
            updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
            updatedBy: createdBy || null
          });

          state.persistedStateByFieldId = state.persistedStateByFieldId || {};
          state.persistedStateByFieldId[String(f.id)] = {
            fieldId: String(f.id),
            storageFinal: Number(storageFinal),
            asOfDateISO: String(asOf),
            SmaxAtSave: Number(Smax || 0)
          };
        }catch(e){
          console.warn('[FieldReadiness] rebuild truth failed for field:', f?.name, e);
        }
      }

      state._persistLoadedAt = Date.now();
      try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
      window.alert('Reset complete: truth rebuilt from last ~30 days weather.');
    }
  }catch(e){
    console.warn('[FieldReadiness] rebuildTruthFromLast30Days failed:', e);
    try{ window.alert('Reset failed. Check console for details.'); }catch(_){}
  }
}

/* =====================================================================
   Build/wire UI
===================================================================== */
function ensureResetButtonExists(){
  try{
    const applyBtn = $('btnAdjApply');
    if (!applyBtn) return;

    if ($('btnAdjReset30')) return;

    const btn = document.createElement('button');
    btn.id = 'btnAdjReset30';
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Reset (rebuild) • 30 days';

    const parent = applyBtn.parentElement;
    if (parent){
      parent.insertBefore(btn, applyBtn);
    }
  }catch(_){}
}

async function openAdjust(state){
  ensureGlobalCalThemeCSSOnce();
  if (!canEdit(state)) return;

  await loadPersistedState(state, { force:true });

  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  const f = getSelectedField(state);
  if (!f) return;

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

  showModal('adjustBackdrop', true);
}

function closeAdjust(state){
  showModal('adjustBackdrop', false);
  showModal('confirmAdjBackdrop', false);
}

function wireOnce(state){
  if (state._globalCalWired) return;
  state._globalCalWired = true;

  ensureResetButtonExists();

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

  const s = sliderEl();
  if (s){
    s.addEventListener('input', ()=>{
      // Live compute what would happen (force + mult) to show in guard text
      try{
        const refField = getSelectedField(state);
        const runRef = refField ? getRunForFieldShown(state, refField) : null;
        if (!runRef || !runRef.factors) return;

        const SmaxRef = Number(runRef.factors.Smax);
        const targetR = sliderVal();

        const curStorageRef = Math.max(1e-6, Number(runRef.storageFinal || 0));
        const forced = storageNeededForTargetReadiness(targetR, SmaxRef);
        const storageMult = clamp(forced.storageEff / curStorageRef, 0.05, 5.0);

        updateGuardText(state, storageMult, forced.storageEff);
      }catch(_){}
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
      await applyForcedCalibration(state);
      closeAdjust(state);
    });
  }

  const btnReset = $('btnAdjReset30');
  if (btnReset){
    btnReset.addEventListener('click', async ()=>{
      await rebuildTruthFromLast30Days(state);
      closeAdjust(state);
    });
  }

  const hot = $('fieldsTitle');
  if (hot){
    hot.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit(state)) return;

      ensureResetButtonExists();
      await openAdjust(state);
    }, { passive:false });
  }
}

/* =====================================================================
   Public init
===================================================================== */
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

  ensureResetButtonExists();
  wireOnce(state);

  (async ()=>{
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);
  })();
}
