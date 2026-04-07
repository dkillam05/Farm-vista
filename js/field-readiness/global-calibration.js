/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-04-06c-global-storage-mult-sync

KEEP UI (per Dane):
✅ Preserve the exact Rev 2026-01-22c modal look/feel (theme patch + layout + wording)
✅ Do NOT "redesign" the popup UI

THIS REV:
✅ Keeps Method 1 base-anchored behavior
✅ Continues writing immediate live results into field_readiness_latest
✅ Writes GLOBAL_STORAGE_MULT and lastStorageMult together
✅ RESET clears BOTH GLOBAL_STORAGE_MULT and lastStorageMult back to 1.0
✅ Keeps learning/tuning doc write
✅ Keeps fr:soft-reload after apply/reset
✅ Keeps current UI behavior and wording
===================================================================== */
'use strict';

import { getAPI } from './firebase.js';
import { canEdit } from './perm.js';
import { buildWxCtx, CONST, OPS, EXTRA } from './state.js';
import { getFieldParams } from './params.js';
import { getCurrentOp } from './thresholds.js';
import { ensureFRModules, buildFRDeps } from './formula.js';

function $(id){ return document.getElementById(id); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

/* =====================================================================
   LEGACY STATE COLLECTION
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';
const STATE_TTL_MS = 30000;

/* =====================================================================
   CENTRALIZED READINESS COLLECTION
===================================================================== */
const FR_LATEST_COLLECTION = 'field_readiness_latest';
const LATEST_TTL_MS = 30000;

/* =====================================================================
   LEARNING / TUNING DOC
===================================================================== */
const FR_TUNE_COLLECTION = 'field_readiness_tuning';
const FR_TUNE_DOC = 'global';

const DRY_LOSS_MULT_MIN = 0.30;
const DRY_LOSS_MULT_MAX = 3.00;
const RAIN_EFF_MULT_MIN = 0.30;
const RAIN_EFF_MULT_MAX = 3.00;
const GLOBAL_STORAGE_MULT_MIN = 0.05;
const GLOBAL_STORAGE_MULT_MAX = 5.00;

const TUNE_EXP = 0.50;

/* =====================================================================
   FORCE CALIBRATION helpers (must match model.js reversal)
===================================================================== */
const GCAL_SMAX_MIN = 3.0;
const GCAL_SMAX_MAX = 5.0;
const GCAL_SMAX_MID = 4.0;
const GCAL_REV_POINTS_MAX = 20;

const GCAL_SURFACE_CAP_IN = 0.70;
const GCAL_SURFACE_PENALTY_MAX = 36;
const GCAL_SURFACE_PENALTY_EXP = 1.20;

function gcalDryCreditInchesFromSmax(Smax){
  const s = clamp(Number(Smax), GCAL_SMAX_MIN, GCAL_SMAX_MAX);
  const signed = clamp((GCAL_SMAX_MID - s) / 1.0, -1, 1);
  return signed * (GCAL_REV_POINTS_MAX / 100) * s;
}

function gcalStorageNeededForTargetReadiness(targetR, Smax){
  const r = clamp(Math.round(Number(targetR)), 0, 100);
  const smax = clamp(Number(Smax), GCAL_SMAX_MIN, GCAL_SMAX_MAX);

  const creditIn = gcalDryCreditInchesFromSmax(smax);
  const wetPct = clamp(100 - r, 0, 100);
  const storageForReadiness = smax * (wetPct / 100);
  const storageEff = clamp(storageForReadiness + creditIn, 0, smax);

  return { storageEff, creditIn, wetPct, storageForReadiness };
}

function gcalSurfacePenaltyFromStorage(surfaceStorage){
  const cap = Math.max(1e-6, GCAL_SURFACE_CAP_IN);
  const frac = clamp(Number(surfaceStorage || 0) / cap, 0, 1);
  return clamp(
    Math.pow(frac, GCAL_SURFACE_PENALTY_EXP) * GCAL_SURFACE_PENALTY_MAX,
    0,
    GCAL_SURFACE_PENALTY_MAX
  );
}

function gcalComputeLiveReadinessFromState(storagePhys, surfaceStorage, Smax){
  const smax = clamp(Number(Smax || 0), 0, GCAL_SMAX_MAX);
  const storagePhysClamped = clamp(Number(storagePhys || 0), 0, smax);
  const surfaceStorageClamped = clamp(Number(surfaceStorage || 0), 0, GCAL_SURFACE_CAP_IN);

  if (storagePhysClamped <= 0 && surfaceStorageClamped <= 0){
    return {
      readiness: 100,
      wetness: 0,
      baseReadiness: 100,
      surfacePenalty: 0,
      creditIn: 0,
      storageEff: 0,
      storageForReadiness: 0,
      storagePhysFinal: 0,
      surfaceStorageFinal: 0,
      wetBiasApplied: 0
    };
  }

  const storageEff = storagePhysClamped; // CAL is zero in current model path
  const creditIn = gcalDryCreditInchesFromSmax(smax);
  const storageForReadiness = clamp(storageEff - creditIn, 0, smax);

  const baseWetness = smax > 0
    ? clamp((storageForReadiness / smax) * 100, 0, 100)
    : 0;

  const baseReadiness = clamp(100 - baseWetness, 0, 100);
  const surfacePenalty = gcalSurfacePenaltyFromStorage(surfaceStorageClamped);
  const readiness = clamp(baseReadiness - surfacePenalty, 0, 100);
  const wetness = clamp(100 - readiness, 0, 100);

  return {
    readiness,
    wetness,
    baseReadiness,
    surfacePenalty,
    creditIn,
    storageEff,
    storageForReadiness,
    storagePhysFinal: storagePhysClamped,
    surfaceStorageFinal: surfaceStorageClamped,
    wetBiasApplied: 0
  };
}

/* =====================================================================
   Basic helpers
===================================================================== */
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
function safeInt(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
function nowISO(){
  try{ return new Date().toISOString(); }catch(_){ return ''; }
}
function isoDay(iso){
  if (!iso) return '';
  const s = String(iso);
  return (s.length >= 10) ? s.slice(0,10) : s;
}
function toIsoFromAny(v){
  try{
    if (!v) return '';
    if (typeof v === 'string'){
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : v;
    }
    if (v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.seconds === 'number'){
      const ms = (Number(v.seconds) * 1000) + Math.round(Number(v.nanoseconds || 0) / 1e6);
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? d.toISOString() : '';
    }
    if (v && typeof v === 'object' && typeof v.__time__ === 'string'){
      const d = new Date(v.__time__);
      return Number.isFinite(d.getTime()) ? d.toISOString() : String(v.__time__ || '');
    }
  }catch(_){}
  return '';
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
   Legacy persisted truth-state load (compat only)
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
   CENTRALIZED latest readiness load
===================================================================== */
function buildLatestReadinessRecord(raw, fallbackId){
  const d = (raw && typeof raw === 'object') ? raw : {};
  const fieldId = safeStr(d.fieldId || fallbackId);
  if (!fieldId) return null;

  return {
    fieldId,
    farmId: safeStr(d.farmId),
    farmName: d.farmName == null ? null : safeStr(d.farmName),
    fieldName: safeStr(d.fieldName),
    county: safeStr(d.county),
    state: safeStr(d.state),
    readiness: safeInt(d.readiness),
    wetness: safeInt(d.wetness),
    soilWetness: safeNum(d.soilWetness),
    drainageIndex: safeNum(d.drainageIndex),
    readinessCreditIn: safeNum(d.readinessCreditIn) ?? 0,
    storageFinal: safeNum(d.storageFinal),
    storageForReadiness: safeNum(d.storageForReadiness),
    storagePhysFinal: safeNum(d.storagePhysFinal),
    surfaceStorageFinal: safeNum(d.surfaceStorageFinal),
    surfacePenaltyFinal: safeNum(d.surfacePenaltyFinal),
    wetBiasApplied: safeNum(d.wetBiasApplied),
    runKey: safeStr(d.runKey),
    seedSource: safeStr(d.seedSource),
    weatherSource: safeStr(d.weatherSource),
    timezone: safeStr(d.timezone),
    computedAtISO: toIsoFromAny(d.computedAt),
    weatherFetchedAtISO: toIsoFromAny(d.weatherFetchedAt),
    location: {
      lat: safeNum(d && d.location && d.location.lat),
      lng: safeNum(d && d.location && d.location.lng)
    },
    _raw: d
  };
}

async function loadLatestReadiness(state, { force=false } = {}){
  try{
    if (!state) return;

    const now = Date.now();
    const last = Number(state._latestReadinessLoadedAt || 0);
    if (!force && state.latestReadinessByFieldId && (now - last) < LATEST_TTL_MS) return;

    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    const out = {};

    const api = getAPI(state);
    if (!api){
      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;
      return;
    }

    if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
      const db = window.firebase.firestore();
      const snap = await db.collection(FR_LATEST_COLLECTION).get();

      snap.forEach(doc=>{
        const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
        if (!rec || !rec.fieldId) return;
        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();
      const col = api.collection(db, FR_LATEST_COLLECTION);
      const snap = await api.getDocs(col);

      snap.forEach(doc=>{
        const rec = buildLatestReadinessRecord(doc.data() || {}, doc.id);
        if (!rec || !rec.fieldId) return;
        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;
      return;
    }
  }catch(e){
    console.warn('[FieldReadiness] latest readiness load failed:', e);
    state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
    state._latestReadinessLoadedAt = Date.now();
  }
}

function getLatestReadinessForField(state, fieldId){
  try{
    const map = (state && state.latestReadinessByFieldId && typeof state.latestReadinessByFieldId === 'object')
      ? state.latestReadinessByFieldId
      : {};
    const fid = safeStr(fieldId);
    const rec = map[fid];
    return (rec && typeof rec === 'object') ? rec : null;
  }catch(_){
    return null;
  }
}

function buildSyntheticRunFromLatest(state, fieldObj, latestRec){
  const f = fieldObj || {};
  const rec = latestRec || getLatestReadinessForField(state, f.id);
  if (!rec) return null;

  const readinessR = safeInt(rec.readiness);
  if (!Number.isFinite(readinessR)) return null;

  return {
    ok: true,
    source: 'field_readiness_latest',
    sourceLabel: 'field_readiness_latest',
    fieldId: safeStr(rec.fieldId || f.id),
    readinessR,
    readiness: readinessR,
    wetness: safeInt(rec.wetness),
    wetnessR: safeInt(rec.wetness),
    soilWetness: safeNum(rec.soilWetness),
    drainageIndex: safeNum(rec.drainageIndex),
    readinessCreditIn: safeNum(rec.readinessCreditIn) ?? 0,
    storageFinal: safeNum(rec.storageFinal),
    storageForReadiness: safeNum(rec.storageForReadiness),
    storagePhysFinal: safeNum(rec.storagePhysFinal),
    surfaceStorageFinal: safeNum(rec.surfaceStorageFinal),
    surfacePenaltyFinal: safeNum(rec.surfacePenaltyFinal),
    wetBiasApplied: safeNum(rec.wetBiasApplied),
    runKey: safeStr(rec.runKey),
    seedSource: safeStr(rec.seedSource),
    weatherSource: safeStr(rec.weatherSource),
    timezone: safeStr(rec.timezone),
    computedAtISO: safeStr(rec.computedAtISO),
    weatherFetchedAtISO: safeStr(rec.weatherFetchedAtISO),
    county: safeStr(rec.county || f.county),
    state: safeStr(rec.state || f.state),
    factors: null,
    trace: [],
    rows: [],
    _latest: rec
  };
}

/* =====================================================================
   Tuning doc read/write
===================================================================== */
function normalizeTuneDoc(d){
  const doc = (d && typeof d === 'object') ? d : {};
  const dryLoss = safeNum(doc.DRY_LOSS_MULT);
  const rainEff = safeNum(doc.RAIN_EFF_MULT);
  const globalStorageMult = safeNum(doc.GLOBAL_STORAGE_MULT);
  const lastStorageMult = safeNum(doc.lastStorageMult);

  const chosenGlobal =
    globalStorageMult != null
      ? globalStorageMult
      : (lastStorageMult != null ? lastStorageMult : 1.0);

  return {
    DRY_LOSS_MULT: clamp((dryLoss == null ? 1.0 : dryLoss), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX),
    RAIN_EFF_MULT: clamp((rainEff == null ? 1.0 : rainEff), RAIN_EFF_MULT_MIN, RAIN_EFF_MULT_MAX),
    GLOBAL_STORAGE_MULT: clamp(chosenGlobal, GLOBAL_STORAGE_MULT_MIN, GLOBAL_STORAGE_MULT_MAX),

    lastStorageMult: clamp((lastStorageMult == null ? chosenGlobal : lastStorageMult), GLOBAL_STORAGE_MULT_MIN, GLOBAL_STORAGE_MULT_MAX),
    lastPercentMove: safeNum(doc.lastPercentMove),
    lastAnchorReadiness: safeNum(doc.lastAnchorReadiness),
    lastTargetReadiness: safeNum(doc.lastTargetReadiness),
    lastBaseReadiness: safeNum(doc.lastBaseReadiness),
    lastShownReadiness: safeNum(doc.lastShownReadiness),
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
      const ok =
        !!snap &&
        ((typeof snap.exists === 'function' && snap.exists()) || (snap.exists === true));
      if (!ok) return fallback;
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
   FV THEME PATCH (KEEP)
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

function getCalForShown(_state){
  return { wetBias:0, opWetBias:{}, readinessShift:0, opReadinessShift:{} };
}

function buildShownDeps(state, opKey){
  const wxCtx = buildWxCtx(state);
  return buildFRDeps(state, {
    opKey: String(opKey),
    wxCtx,
    persistedGetter: (id)=> getPersistedStateForDeps(state, id)
  });
}

function runFieldWithCal(state, f, _calObj){
  if (!f) return null;
  if (!state) return null;
  if (!state._mods || !state._mods.model) return null;

  const opKey = getCurrentOp();
  const deps = buildShownDeps(state, opKey);

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
}

function getRunForFieldShown(state, f){
  if (!f) return null;

  const latest = getLatestReadinessForField(state, f.id);
  const synthetic = buildSyntheticRunFromLatest(state, f, latest);
  if (synthetic) return synthetic;

  return runFieldWithCal(state, f, getCalForShown(state));
}

function getRunForFieldModel(state, f){
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

    const ok =
      !!snap &&
      ((typeof snap.exists === 'function' && snap.exists()) || (snap.exists === true));

    if (!ok){
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
  const note = `Apply recalculates ONE new absolute global multiplier from the current BASE model to your selected target. Reset clears the saved global multiplier and rebuilds from base.`;

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
   Slider anchoring + clamp (KEEP LOOK)
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
    el.textContent = 'Choose Wet or Dry, then move the slider to adjust the system.';
    return;
  }

  const shownAnchor = clamp(Math.round(Number(state._adjAnchorReadiness ?? 50)), 0, 100);
  const baseAnchor = clamp(Math.round(Number(state._adjBaseReadiness ?? shownAnchor)), 0, 100);
  const target = sliderVal();

  let factor = 1;
  if (baseAnchor > 0) factor = target / baseAnchor;

  const pct = Math.round((factor - 1) * 100);
  const dir = (pct >= 0) ? 'drier' : 'wetter';

  el.textContent = `Current shown: ${shownAnchor}. Base behind it: ${baseAnchor}. New absolute global multiplier will shift ALL fields ~${Math.abs(pct)}% ${dir}.`;
}

/* =========================
   UI state (KEEP)
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
  const latest = getLatestReadinessForField(state, fid);
  const baseRun = getRunForFieldModel(state, getSelectedField(state));

  const thr = currentThreshold(state);

  const shownReadiness =
    run && Number.isFinite(Number(run.readinessR))
      ? Math.round(Number(run.readinessR))
      : '—';

  const shownWetness =
    run && Number.isFinite(Number(run.wetnessR))
      ? Math.round(Number(run.wetnessR))
      : (latest && Number.isFinite(Number(latest.wetness)) ? Math.round(Number(latest.wetness)) : '—');

  const shownSoil =
    latest && safeNum(latest.soilWetness) != null
      ? `${Math.round(Number(latest.soilWetness))}/100`
      : `${p.soilWetness}/100`;

  const shownDrain =
    latest && safeNum(latest.drainageIndex) != null
      ? `${Math.round(Number(latest.drainageIndex))}/100`
      : `${p.drainageIndex}/100`;

  setText('adjReadiness', shownReadiness);
  setText('adjWetness', shownWetness);
  setText('adjSoil', shownSoil);
  setText('adjDrain', shownDrain);

  setText('adjModelClass', (state._adjStatus || '—').toUpperCase());

  try{
    const thrEl = $('adjThreshold');
    if (thrEl) thrEl.textContent = String(thr);
  }catch(_){}

  try{
    const baseEl = $('adjBaseReadiness');
    if (baseEl){
      baseEl.textContent = Number.isFinite(Number(baseRun?.readinessR))
        ? String(Math.round(Number(baseRun.readinessR)))
        : '—';
    }
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

/* =====================================================================
   Firestore writes (LATEST truth)
===================================================================== */
async function writeLatestReadinessDocCompat(db, fieldId, payload){
  await db.collection(FR_LATEST_COLLECTION).doc(String(fieldId)).set(payload, { merge:true });
}
async function writeLatestReadinessDocModern(api, db, fieldId, payload){
  const ref = api.doc(db, FR_LATEST_COLLECTION, String(fieldId));
  await api.setDoc(ref, payload, { merge:true });
}

function buildLatestMergePayload(existingRec, fieldObj, patch){
  const rec = (existingRec && typeof existingRec === 'object') ? existingRec : null;
  const raw = (rec && rec._raw && typeof rec._raw === 'object') ? rec._raw : {};
  const f = fieldObj || {};
  const p = (patch && typeof patch === 'object') ? patch : {};

  const location =
    (p.location && typeof p.location === 'object')
      ? p.location
      : (
          raw.location && typeof raw.location === 'object'
            ? raw.location
            : (
                rec && rec.location && typeof rec.location === 'object'
                  ? rec.location
                  : {
                      lat: safeNum(f.lat),
                      lng: safeNum(f.lng)
                    }
              )
        );

  const out = {
    fieldId: safeStr(p.fieldId || raw.fieldId || rec?.fieldId || f.id),
    fieldName: safeStr(p.fieldName || raw.fieldName || rec?.fieldName || f.name || ''),
    farmId: safeStr(p.farmId || raw.farmId || rec?.farmId || f.farmId || ''),
    county: safeStr(p.county || raw.county || rec?.county || f.county || ''),
    state: safeStr(p.state || raw.state || rec?.state || f.state || ''),
    timezone: safeStr(p.timezone || raw.timezone || rec?.timezone || ''),
    weatherSource: safeStr(p.weatherSource || raw.weatherSource || rec?.weatherSource || ''),
    seedSource: safeStr(p.seedSource || raw.seedSource || rec?.seedSource || ''),
    runKey: safeStr(p.runKey || raw.runKey || rec?.runKey || ''),
    weatherFetchedAt: p.weatherFetchedAt ?? raw.weatherFetchedAt ?? rec?.weatherFetchedAtISO ?? null,
    computedAt: p.computedAt ?? nowISO(),
    location
  };

  const farmNameVal = (p.farmName !== undefined)
    ? p.farmName
    : (raw.farmName !== undefined ? raw.farmName : rec?.farmName);
  if (farmNameVal !== undefined) out.farmName = farmNameVal;

  if (Number.isFinite(Number(p.readiness))) out.readiness = Math.round(Number(p.readiness));
  if (Number.isFinite(Number(p.wetness))) out.wetness = Math.round(Number(p.wetness));
  if (Number.isFinite(Number(p.soilWetness))) out.soilWetness = Number(p.soilWetness);
  if (Number.isFinite(Number(p.drainageIndex))) out.drainageIndex = Number(p.drainageIndex);
  if (Number.isFinite(Number(p.readinessCreditIn))) out.readinessCreditIn = Number(p.readinessCreditIn);
  if (Number.isFinite(Number(p.storageFinal))) out.storageFinal = Number(p.storageFinal);
  if (Number.isFinite(Number(p.storageForReadiness))) out.storageForReadiness = Number(p.storageForReadiness);
  if (Number.isFinite(Number(p.storagePhysFinal))) out.storagePhysFinal = Number(p.storagePhysFinal);
  if (Number.isFinite(Number(p.surfaceStorageFinal))) out.surfaceStorageFinal = Number(p.surfaceStorageFinal);
  if (Number.isFinite(Number(p.surfacePenaltyFinal))) out.surfacePenaltyFinal = Number(p.surfacePenaltyFinal);
  if (Number.isFinite(Number(p.wetBiasApplied))) out.wetBiasApplied = Number(p.wetBiasApplied);

  if (p.anchorReadiness !== undefined) out.anchorReadiness = Math.round(Number(p.anchorReadiness));
  if (p.targetReadiness !== undefined) out.targetReadiness = Math.round(Number(p.targetReadiness));
  if (p.baseReadiness !== undefined) out.baseReadiness = Math.round(Number(p.baseReadiness));
  if (p.storageMult !== undefined) out.storageMult = Number(p.storageMult);
  if (p.asOfDateISO !== undefined) out.asOfDateISO = String(p.asOfDateISO || '');
  if (p.updatedBy !== undefined) out.updatedBy = p.updatedBy || null;
  if (p.updatedAt !== undefined) out.updatedAt = p.updatedAt;

  return out;
}

/* =====================================================================
   Learning + absolute multiplier write
===================================================================== */
async function writeLearningFromStorageShift(state, {
  storageMult,
  percentMove,
  baseAnchorR,
  shownAnchorR,
  targetR,
  asOfDateISO,
  refFieldId,
  refFieldName,
  opKey
}){
  const api = getAPI(state);
  if (!api) return;

  const prev = await loadGlobalTuning(state);

  const sm = clamp(Number(storageMult || 1), GLOBAL_STORAGE_MULT_MIN, GLOBAL_STORAGE_MULT_MAX);
  const intentFactor = clamp(1 / Math.max(1e-6, sm), 0.10, 2.50);

  const next = computeNextTuning(prev, intentFactor);
  const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);

  const payload = {
    DRY_LOSS_MULT: next.DRY_LOSS_MULT,
    RAIN_EFF_MULT: next.RAIN_EFF_MULT,
    GLOBAL_STORAGE_MULT: sm,
    lastStorageMult: sm,

    lastPercentMove: clamp(Number(percentMove || 0), -90, 90),
    lastAnchorReadiness: clamp(Number(shownAnchorR || 0), 0, 100),
    lastBaseReadiness: clamp(Number(baseAnchorR || 0), 0, 100),
    lastShownReadiness: clamp(Number(shownAnchorR || 0), 0, 100),
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

async function clearAbsoluteGlobalMultiplier(state){
  const api = getAPI(state);
  if (!api) return;
  const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);

  await writeGlobalTuning(state, {
    GLOBAL_STORAGE_MULT: 1.0,
    lastStorageMult: 1.0,
    updatedBy: createdBy || null,
    updatedAt: (api.kind === 'compat')
      ? nowISO()
      : (api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString())
  });
}

/* =====================================================================
   writeWeightsLock + futureTimestamp
===================================================================== */
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

/* =====================================================================
   APPLY: METHOD 1
===================================================================== */
async function applyAdjustment(state){
  if (isLocked(state)) return;

  const api = getAPI(state);
  if (!api) return;

  const fRef = getSelectedField(state);
  if (!fRef) return;

  await ensureFRModules(state);
  await loadPersistedState(state, { force:true });
  await loadLatestReadiness(state, { force:true });

  const runRefShown = getRunForFieldShown(state, fRef);
  const runRefModel = getRunForFieldModel(state, fRef);

  if (!runRefShown) return;
  if (!runRefModel || !runRefModel.factors || !isFinite(Number(runRefModel.factors.Smax))) return;

  const thr = currentThreshold(state);
  state._adjStatus = statusFromReadinessAndThreshold(state, runRefShown, thr);

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return;

  if (state._adjStatus === 'wet' && feel !== 'dry') return;
  if (state._adjStatus === 'dry' && feel !== 'wet') return;

  const shownAnchorR = clamp(Math.round(Number(state._adjAnchorReadiness ?? runRefShown.readinessR ?? 0)), 0, 100);
  const baseAnchorR = clamp(Math.round(Number(state._adjBaseReadiness ?? runRefModel.readinessR ?? 0)), 0, 100);
  const targetR = clamp(Math.round(Number(sliderVal())), 0, 100);

  let factor = 1;
  if (baseAnchorR > 0) factor = targetR / baseAnchorR;
  const percentMove = clamp((factor - 1) * 100, -90, 90);

  const SmaxRef = Number(runRefModel.factors.Smax);
  const forced = gcalStorageNeededForTargetReadiness(targetR, SmaxRef);
  const forcedStorageRef = forced.storageEff;

  const baseStorageRefRaw =
    safeNum(runRefModel && runRefModel.storageFinal) ??
    safeNum(runRefModel && runRefModel.storagePhysFinal) ??
    0;

  const baseStorageRef = Math.max(0.05, (isFinite(baseStorageRefRaw) ? baseStorageRefRaw : 0));

  let storageMult = forcedStorageRef / baseStorageRef;
  storageMult = clamp(storageMult, GLOBAL_STORAGE_MULT_MIN, GLOBAL_STORAGE_MULT_MAX);

  let asOf = '';
  try{
    const rows = Array.isArray(runRefModel.rows) ? runRefModel.rows : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    asOf = isoDay(last && last.dateISO ? last.dateISO : '');
  }catch(_){}
  if (!asOf) asOf = isoDay(new Date().toISOString());

  const createdBy = (api.kind === 'compat') ? getAuthUserIdCompat() : getAuthUserIdModern(api);
  const fields = Array.isArray(state.fields) ? state.fields : [];
  if (!fields.length) return;

  if (api.kind === 'compat' && window.firebase && window.firebase.firestore){
    const db = window.firebase.firestore();
    const updatedAtISO = nowISO();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const latest = getLatestReadinessForField(state, f.id);
        const run = getRunForFieldModel(state, f);
        if (!run || !run.factors || !isFinite(Number(run.factors.Smax))) continue;

        const smax = Number(run.factors.Smax);

        const baseStorageRaw =
          safeNum(run && run.storageFinal) ??
          safeNum(run && run.storagePhysFinal) ??
          0;

        const baseStorage = Math.max(0.05, (isFinite(baseStorageRaw) ? baseStorageRaw : 0));

        let nextStoragePhys = clamp(baseStorage * storageMult, 0, smax);
        if (String(f.id) === String(fRef.id)){
          nextStoragePhys = clamp(forcedStorageRef, 0, smax);
        }

        const baseSurfaceStorage =
          safeNum(run && run.surfaceStorageFinal) ??
          0;

        const live = gcalComputeLiveReadinessFromState(nextStoragePhys, baseSurfaceStorage, smax);

        const params = getFieldParams(state, f.id) || {};
        const payload = buildLatestMergePayload(latest, f, {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          readiness: live.readiness,
          wetness: live.wetness,
          soilWetness: safeNum(latest && latest.soilWetness) ?? safeNum(params.soilWetness),
          drainageIndex: safeNum(latest && latest.drainageIndex) ?? safeNum(params.drainageIndex),
          readinessCreditIn: live.creditIn,
          storageFinal: live.storageEff,
          storageForReadiness: live.storageForReadiness,
          storagePhysFinal: live.storagePhysFinal,
          surfaceStorageFinal: live.surfaceStorageFinal,
          surfacePenaltyFinal: live.surfacePenalty,
          wetBiasApplied: live.wetBiasApplied,
          runKey: `global-calibration:${Date.now()}`,
          seedSource: 'global-calibration',
          weatherSource: safeStr(
            (Array.isArray(run.rows) && run.rows.length && run.rows[run.rows.length - 1] && run.rows[run.rows.length - 1].rainSource) ||
            (latest && latest.weatherSource) ||
            ''
          ),
          computedAt: updatedAtISO,
          asOfDateISO: String(asOf),
          storageMult,
          anchorReadiness: shownAnchorR,
          baseReadiness: baseAnchorR,
          targetReadiness: targetR,
          updatedAt: updatedAtISO,
          updatedBy: createdBy || null
        });

        await writeLatestReadinessDocCompat(db, String(f.id), payload);

        state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
        state.latestReadinessByFieldId[String(f.id)] = buildLatestReadinessRecord({
          ...(latest && latest._raw ? latest._raw : {}),
          ...payload
        }, String(f.id));
      }catch(e){
        console.warn('[FieldReadiness] global latest write failed (compat):', e);
      }
    }

    state._latestReadinessLoadedAt = Date.now();
  } else if (api.kind !== 'compat'){
    const db = api.getFirestore();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const latest = getLatestReadinessForField(state, f.id);
        const run = getRunForFieldModel(state, f);
        if (!run || !run.factors || !isFinite(Number(run.factors.Smax))) continue;

        const smax = Number(run.factors.Smax);

        const baseStorageRaw =
          safeNum(run && run.storageFinal) ??
          safeNum(run && run.storagePhysFinal) ??
          0;

        const baseStorage = Math.max(0.05, (isFinite(baseStorageRaw) ? baseStorageRaw : 0));

        let nextStoragePhys = clamp(baseStorage * storageMult, 0, smax);
        if (String(f.id) === String(fRef.id)){
          nextStoragePhys = clamp(forcedStorageRef, 0, smax);
        }

        const baseSurfaceStorage =
          safeNum(run && run.surfaceStorageFinal) ??
          0;

        const live = gcalComputeLiveReadinessFromState(nextStoragePhys, baseSurfaceStorage, smax);

        const params = getFieldParams(state, f.id) || {};
        const payload = buildLatestMergePayload(latest, f, {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          readiness: live.readiness,
          wetness: live.wetness,
          soilWetness: safeNum(latest && latest.soilWetness) ?? safeNum(params.soilWetness),
          drainageIndex: safeNum(latest && latest.drainageIndex) ?? safeNum(params.drainageIndex),
          readinessCreditIn: live.creditIn,
          storageFinal: live.storageEff,
          storageForReadiness: live.storageForReadiness,
          storagePhysFinal: live.storagePhysFinal,
          surfaceStorageFinal: live.surfaceStorageFinal,
          surfacePenaltyFinal: live.surfacePenalty,
          wetBiasApplied: live.wetBiasApplied,
          runKey: `global-calibration:${Date.now()}`,
          seedSource: 'global-calibration',
          weatherSource: safeStr(
            (Array.isArray(run.rows) && run.rows.length && run.rows[run.rows.length - 1] && run.rows[run.rows.length - 1].rainSource) ||
            (latest && latest.weatherSource) ||
            ''
          ),
          computedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
          asOfDateISO: String(asOf),
          storageMult,
          anchorReadiness: shownAnchorR,
          baseReadiness: baseAnchorR,
          targetReadiness: targetR,
          updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
          updatedBy: createdBy || null
        });

        await writeLatestReadinessDocModern(api, db, String(f.id), payload);

        state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
        state.latestReadinessByFieldId[String(f.id)] = buildLatestReadinessRecord({
          ...(latest && latest._raw ? latest._raw : {}),
          ...payload,
          computedAt: nowISO()
        }, String(f.id));
      }catch(e){
        console.warn('[FieldReadiness] global latest write failed:', e);
      }
    }

    state._latestReadinessLoadedAt = Date.now();
  }

  try{
    await writeLearningFromStorageShift(state, {
      storageMult,
      percentMove,
      baseAnchorR,
      shownAnchorR,
      targetR,
      asOfDateISO: asOf,
      refFieldId: String(fRef.id || ''),
      refFieldName: String(fRef.name || ''),
      opKey: String(getCurrentOp() || '')
    });
  }catch(_){}

  await writeWeightsLock(state, Date.now());

  renderCooldownCard(state);
  updateUI(state);

  closeAdjust(state);

  try{
    state._latestReadinessLoadedAt = 0;
    document.dispatchEvent(new CustomEvent('fr:soft-reload'));
  }catch(_){}
}

/* =====================================================================
   RESET / REBUILD truth from last ~30 days
===================================================================== */
async function rebuildTruthFromLast30Days(state){
  try{
    if (!state) return;
    if (!canEdit(state)) return;

    const ok = window.confirm(
      'Reset/Rebuild Truth?\n\nThis will recompute TODAY storage truth for ALL fields using the last ~30 days of weather and your current field sliders, write BASE model results into field_readiness_latest, and clear the saved global multiplier back to 1.0.\n\nProceed?'
    );
    if (!ok) return;

    await ensureFRModules(state);

    if (!state._mods || !state._mods.model || !state._mods.weather){
      window.alert('Model/weather modules are not loaded yet. Try again after the app finishes loading.');
      return;
    }

    const api = getAPI(state);
    if (!api){
      window.alert('Firebase is not ready. Try again after the app finishes loading.');
      return;
    }

    await loadLatestReadiness(state, { force:true });

    let dryLossMult = 1.0;
    try{
      const tuned = await loadGlobalTuning(state);
      if (tuned && safeNum(tuned.DRY_LOSS_MULT) != null){
        dryLossMult = clamp(Number(tuned.DRY_LOSS_MULT), DRY_LOSS_MULT_MIN, DRY_LOSS_MULT_MAX);
      }
    }catch(_){}

    const wxCtx = buildWxCtx(state);
    const opKey = getCurrentOp();

    const depsBase = buildFRDeps(state, {
      opKey,
      wxCtx,
      persistedGetter: (id)=> getPersistedStateForDeps(state, id)
    });

    const depsRebuild = {
      ...depsBase,
      EXTRA: { ...(depsBase.EXTRA || EXTRA), DRY_LOSS_MULT: dryLossMult },
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

          const latest = getLatestReadinessForField(state, f.id);
          const run = state._mods.model.runField(f, depsRebuild);
          if (!run || safeNum(run.storageFinal) == null) continue;

          let asOf = '';
          try{
            const rows = Array.isArray(run.rows) ? run.rows : [];
            const last = rows.length ? rows[rows.length - 1] : null;
            asOf = isoDay(last && last.dateISO ? last.dateISO : '');
          }catch(_){}
          if (!asOf) asOf = isoDay(new Date().toISOString());

          const params = getFieldParams(state, f.id) || {};
          const payload = buildLatestMergePayload(latest, f, {
            fieldId: String(f.id),
            fieldName: String(f.name || ''),
            readiness: Math.round(Number(run.readinessR || 0)),
            wetness: Math.round(Number(run.wetnessR || 0)),
            soilWetness: safeNum(latest && latest.soilWetness) ?? safeNum(params.soilWetness),
            drainageIndex: safeNum(latest && latest.drainageIndex) ?? safeNum(params.drainageIndex),
            readinessCreditIn: safeNum(run.readinessCreditIn) ?? 0,
            storageFinal: Math.max(0, Number(run.storageFinal || 0)),
            storageForReadiness: safeNum(run.storageForReadiness) ?? 0,
            storagePhysFinal: Math.max(0, Number(run.storagePhysFinal || 0)),
            surfaceStorageFinal: Math.max(0, Number(run.surfaceStorageFinal || 0)),
            surfacePenaltyFinal: safeNum(run.surfacePenaltyFinal) ?? 0,
            wetBiasApplied: 0,
            runKey: `reset-rebuild-30days:${Date.now()}`,
            seedSource: String(run.seedSource || 'baseline'),
            weatherSource: safeStr(
              (Array.isArray(run.rows) && run.rows.length && run.rows[run.rows.length - 1] && run.rows[run.rows.length - 1].rainSource) ||
              (latest && latest.weatherSource) ||
              ''
            ),
            computedAt: updatedAtISO,
            asOfDateISO: String(asOf),
            storageMult: 1.0,
            updatedAt: updatedAtISO,
            updatedBy: createdBy || null
          });

          await writeLatestReadinessDocCompat(db, String(f.id), payload);

          state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
          state.latestReadinessByFieldId[String(f.id)] = buildLatestReadinessRecord({
            ...(latest && latest._raw ? latest._raw : {}),
            ...payload
          }, String(f.id));
        }catch(e){
          console.warn('[FieldReadiness] rebuild latest failed for field:', f?.name, e);
        }
      }

      await clearAbsoluteGlobalMultiplier(state);

      state._latestReadinessLoadedAt = Date.now();
      try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
      window.alert('Reset complete: latest truth rebuilt from last ~30 days weather and saved global multiplier cleared to 1.0.');
      return;
    }

    if (api.kind !== 'compat'){
      const db = api.getFirestore();

      for (const f of fields){
        try{
          if (!f || !f.id) continue;

          const latest = getLatestReadinessForField(state, f.id);
          const run = state._mods.model.runField(f, depsRebuild);
          if (!run || safeNum(run.storageFinal) == null) continue;

          let asOf = '';
          try{
            const rows = Array.isArray(run.rows) ? run.rows : [];
            const last = rows.length ? rows[rows.length - 1] : null;
            asOf = isoDay(last && last.dateISO ? last.dateISO : '');
          }catch(_){}
          if (!asOf) asOf = isoDay(new Date().toISOString());

          const params = getFieldParams(state, f.id) || {};
          const payload = buildLatestMergePayload(latest, f, {
            fieldId: String(f.id),
            fieldName: String(f.name || ''),
            readiness: Math.round(Number(run.readinessR || 0)),
            wetness: Math.round(Number(run.wetnessR || 0)),
            soilWetness: safeNum(latest && latest.soilWetness) ?? safeNum(params.soilWetness),
            drainageIndex: safeNum(latest && latest.drainageIndex) ?? safeNum(params.drainageIndex),
            readinessCreditIn: safeNum(run.readinessCreditIn) ?? 0,
            storageFinal: Math.max(0, Number(run.storageFinal || 0)),
            storageForReadiness: safeNum(run.storageForReadiness) ?? 0,
            storagePhysFinal: Math.max(0, Number(run.storagePhysFinal || 0)),
            surfaceStorageFinal: Math.max(0, Number(run.surfaceStorageFinal || 0)),
            surfacePenaltyFinal: safeNum(run.surfacePenaltyFinal) ?? 0,
            wetBiasApplied: 0,
            runKey: `reset-rebuild-30days:${Date.now()}`,
            seedSource: String(run.seedSource || 'baseline'),
            weatherSource: safeStr(
              (Array.isArray(run.rows) && run.rows.length && run.rows[run.rows.length - 1] && run.rows[run.rows.length - 1].rainSource) ||
              (latest && latest.weatherSource) ||
              ''
            ),
            computedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
            asOfDateISO: String(asOf),
            storageMult: 1.0,
            updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
            updatedBy: createdBy || null
          });

          await writeLatestReadinessDocModern(api, db, String(f.id), payload);

          state.latestReadinessByFieldId = state.latestReadinessByFieldId || {};
          state.latestReadinessByFieldId[String(f.id)] = buildLatestReadinessRecord({
            ...(latest && latest._raw ? latest._raw : {}),
            ...payload,
            computedAt: nowISO()
          }, String(f.id));
        }catch(e){
          console.warn('[FieldReadiness] rebuild latest failed for field:', f?.name, e);
        }
      }

      await clearAbsoluteGlobalMultiplier(state);

      state._latestReadinessLoadedAt = Date.now();
      try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
      window.alert('Reset complete: latest truth rebuilt from last ~30 days weather and saved global multiplier cleared to 1.0.');
    }
  }catch(e){
    console.warn('[FieldReadiness] rebuildTruthFromLast30Days failed:', e);
    try{ window.alert('Reset failed. Check console for details.'); }catch(_){}
  }
}

/* =====================================================================
   Cooldown card + reset button
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

/* =====================================================================
   Open / Close
===================================================================== */
async function openAdjust(state){
  ensureGlobalCalThemeCSSOnce();
  if (!canEdit(state)) return;

  await ensureFRModules(state);
  await loadPersistedState(state, { force:true });
  await loadLatestReadiness(state, { force:true });

  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  const f = getSelectedField(state);
  if (!f) return;

  updateAdjustHeader(state);

  await loadCooldown(state);
  renderCooldownCard(state);

  const runShown = getRunForFieldShown(state, f);
  const runModel = getRunForFieldModel(state, f);
  if (!runShown || !runModel) return;

  const thr = currentThreshold(state);
  const status = statusFromReadinessAndThreshold(state, runShown, thr);

  state._adjStatus = status;
  state._adjFeel = null;

  state._adjAnchorReadiness = clamp(Math.round(Number(runShown?.readinessR ?? 50)), 0, 100);
  state._adjBaseReadiness = clamp(Math.round(Number(runModel?.readinessR ?? state._adjAnchorReadiness)), 0, 100);

  setAnchor(state, state._adjAnchorReadiness);
  setSliderVal(state._adjAnchorReadiness);

  updatePills(state, runShown);
  updateUI(state);

  ensureResetButtonExists();

  showModal('adjustBackdrop', true);

  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = setInterval(async ()=>{
    try{
      await loadCooldown(state);
      await loadLatestReadiness(state, { force:true });
    }catch(_){}
    renderCooldownCard(state);

    const f2 = getSelectedField(state);
    const runShown2 = getRunForFieldShown(state, f2);
    const runModel2 = getRunForFieldModel(state, f2);
    if (runShown2){
      const thr2 = currentThreshold(state);
      state._adjStatus = statusFromReadinessAndThreshold(state, runShown2, thr2);
      state._adjBaseReadiness = clamp(Math.round(Number(runModel2?.readinessR ?? state._adjBaseReadiness ?? 0)), 0, 100);
      updatePills(state, runShown2);
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

/* =====================================================================
   Wiring
===================================================================== */
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

  document.addEventListener('click', async (e)=>{
    const b = e && e.target && e.target.closest ? e.target.closest('#btnAdjReset30') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    await rebuildTruthFromLast30Days(state);
    closeAdjust(state);
  }, { passive:false });

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
    try{
      await ensureFRModules(state);
    }catch(_){}
    try{
      await loadLatestReadiness(state, { force:true });
    }catch(_){}
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);
  })();
}
