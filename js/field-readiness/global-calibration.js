/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-01-20a-global-slider-truth-state

CHANGE (per Dane):
✅ Reframe Global Calibration slider to mean:
   “This is the TRUE soil condition today (readiness truth), seed the model from it.”

What this file does now:
✅ Uses the slider value as TARGET READINESS (0..100).
✅ Converts it to a per-field STORAGE seed (0..Smax) using each field’s Smax:
     wet = 100 - readiness
     storageFinal = Smax * (wet/100)
✅ Writes that seed to Firestore:
   field_readiness_state/{fieldId} => { storageFinal, asOfDateISO, SmaxAtSave, updatedAt, updatedBy, source }

Keeps:
✅ 72h lockout (nextAllowedAt = now + cooldownHours)
✅ Opposite-only Wet/Dry guardrail + slider clamp direction
✅ UI theme patch
✅ fr:soft-reload after apply

No longer does:
❌ Does NOT write field_readiness_adjustments delta/anchor/slider entries
❌ Does NOT compute readinessShift / compensated shifts

NOTE:
- render.js must read field_readiness_state and pass getPersistedState into the model deps
  (you already asked to do that there).
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
   PERSISTED TRUTH STATE COLLECTION (NEW)
===================================================================== */
const FR_STATE_COLLECTION = 'field_readiness_state';

/* =====================================================================
   OP-THRESHOLD WET/DRY TRIGGER TUNING
===================================================================== */
const STATUS_HYSTERESIS = 2;

/* =========================
   FV THEME PATCH (Adjust + Confirm)
========================= */
function ensureGlobalCalThemeCSSOnce(){
  try{
    if (window.__FV_FR_GCAL_THEME__) return;
    window.__FV_FR_GCAL_THEME__ = true;

    const st = document.createElement('style');
    st.setAttribute('data-fv-fr-gcal-theme','1');
    st.textContent = `
      /* Modal X buttons: FV xbtn look */
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

      /* CENTER Wet/Dry */
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

      /* Seg buttons (Wet/Dry) */
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

      /* Intensity slider: FULL WIDTH */
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

      /* Buttons (Cancel / Apply) */
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

      /* Primary buttons must be FV green with WHITE text */
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

// For this modal we use the SAME cal object the tiles use, but we must ensure
// readinessShift is OFF (truth slider writes state, not readiness offsets).
function getCalForModel(state){
  try{
    if (state && state._cal && typeof state._cal === 'object') return state._cal;
  }catch(_){}
  return { wetBias:0, opWetBias:{} };
}

function getCalForShown(state){
  const c = getCalForModel(state) || {};
  // Shown values should reflect tiles; readinessShift should already be treated as 0 in render.js now.
  // But keep safe: force it off here too.
  return { ...c, readinessShift: 0, opReadinessShift: {} };
}

function getCalForAnchor(state){
  const c = getCalForModel(state) || {};
  const out = { ...c };
  out.readinessShift = 0;
  out.opReadinessShift = {};
  return out;
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
    CAL: calObj
  };

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
}

function getRunForFieldShown(state, f){
  return runFieldWithCal(state, f, getCalForShown(state));
}

function getRunForFieldAnchor(state, f){
  return runFieldWithCal(state, f, getCalForAnchor(state));
}

/* =========================
   CURRENT OP THRESHOLD (dynamic)
========================= */
function currentThreshold(state){
  const opKey = getCurrentOp();
  const v = state.thresholdsByOp && state.thresholdsByOp.get ? state.thresholdsByOp.get(opKey) : null;
  const thr = isFinite(Number(v)) ? Number(v) : 70;
  return clamp(Math.round(thr), 0, 100);
}

/* =========================
   OP-THRESHOLD wet/dry truth (dynamic + hysteresis)
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

  const title = locked ? 'Global truth set is locked' : 'Global truth set is available';
  const lastLine = lastMs
    ? `Last global truth set: <span class="mono">${esc(since)}</span> ago`
    : `Last global truth set: <span class="mono">—</span>`;
  const sub = `Next global truth set allowed: <span class="mono">${esc(nextAbs)}</span>`;
  const note =
    `This sets today’s ground-truth readiness and seeds the soil model (storage) going forward.`;

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
   Slider anchoring + clamp (YOUR RULE)
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

  const status = state._adjStatus; // wet|dry
  const feel = state._adjFeel;     // wet|dry|null

  if (!feel){
    v = anchor;
    el.value = String(v);
    setSliderVal(v);
    return;
  }

  // Same guardrail direction:
  // - If model says WET and user says DRY, only allow moving UP (drier readiness)
  // - If model says DRY and user says WET, only allow moving DOWN (wetter readiness)
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
    el.textContent = 'Choose Wet or Dry, then move the slider to set the TRUE readiness for today.';
    return;
  }

  const anchor = clamp(Math.round(Number(state._adjAnchorReadiness ?? 50)), 0, 100);
  const target = sliderVal();
  const dist = Math.abs(anchor - target);

  el.textContent =
    `This will set today’s ground-truth readiness to ${target} ` +
    `(${dist} point${dist === 1 ? '' : 's'} from current), and seed the soil model for ALL fields.`;
}

/* =========================
   UI state
========================= */
function updateAdjustHeader(state){
  const f = getSelectedField(state);
  const sub = $('adjustSub');
  if (!sub) return;

  if (f && f.name){
    sub.textContent = `Global truth set • ${f.name}`;
  } else {
    sub.textContent = 'Global truth set';
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
      if (title) title.textContent = 'Set TRUE readiness (drier)';
      if (left) left.textContent = 'Slightly drier';
      if (right) right.textContent = 'Extremely drier';
    } else {
      if (title) title.textContent = 'Set TRUE readiness (wetter)';
      if (left) left.textContent = 'Slightly wetter';
      if (right) right.textContent = 'Extremely wetter';
    }
  }

  const hint = $('adjHint');
  if (hint){
    const thr = currentThreshold(state);
    const band = clamp(Math.round(Number(STATUS_HYSTERESIS)), 0, 10);

    if (locked){
      hint.textContent = 'Global truth set is locked (72h rule).';
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
   Firestore writes (TRUTH STATE)
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

function storageFromReadiness(readiness0_100, Smax){
  const r = clamp(Number(readiness0_100), 0, 100);
  const smax = Number(Smax);
  if (!isFinite(smax) || smax <= 0) return 0;

  const wet = clamp(100 - r, 0, 100);
  const storage = smax * (wet / 100);
  return clamp(storage, 0, smax);
}

async function writeTruthStateDocCompat(db, fieldId, payload){
  await db.collection(FR_STATE_COLLECTION).doc(String(fieldId)).set(payload, { merge:true });
}

async function writeTruthStateDocModern(api, db, fieldId, payload){
  const ref = api.doc(db, FR_STATE_COLLECTION, String(fieldId));
  await api.setDoc(ref, payload, { merge:true });
}

async function writeGlobalTruthState(state, targetReadiness, asOfDateISO){
  const api = getAPI(state);
  if (!api) return;

  // Need user identity for debug/audit only (non-blocking)
  let createdBy = null;

  if (api.kind === 'compat'){
    try{
      const auth = window.firebaseAuth || null;
      const user = auth && auth.currentUser ? auth.currentUser : null;
      createdBy = user ? (user.email || user.uid || null) : null;
    }catch(_){}
  } else {
    try{
      const auth = api.getAuth ? api.getAuth() : null;
      const user = auth && auth.currentUser ? auth.currentUser : null;
      createdBy = user ? (user.email || user.uid || null) : null;
    }catch(_){}
  }

  // Use anchor-cal (shift off) to compute each field’s Smax reliably.
  // Smax depends on soil/drain + last sm010, not on readiness.
  const calObj = getCalForAnchor(state);

  const fields = Array.isArray(state.fields) ? state.fields : [];
  if (!fields.length) return;

  if (api.kind === 'compat'){
    const db = window.firebase.firestore();
    const nowISO = new Date().toISOString();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const run = runFieldWithCal(state, f, calObj);
        if (!run || !run.factors || !isFinite(Number(run.factors.Smax))) continue;

        const Smax = Number(run.factors.Smax);
        const storageFinal = storageFromReadiness(targetReadiness, Smax);

        const payload = {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          asOfDateISO: String(asOfDateISO || ''),
          storageFinal,
          SmaxAtSave: Smax,
          source: 'global-truth-slider',
          updatedAt: nowISO,
          updatedBy: createdBy
        };

        await writeTruthStateDocCompat(db, f.id, payload);
      }catch(e){
        console.warn('[FieldReadiness] truth state write failed (compat):', e);
      }
    }
    return;
  }

  // modern wrapper
  try{
    const db = api.getFirestore();

    for (const f of fields){
      try{
        if (!f || !f.id) continue;

        const run = runFieldWithCal(state, f, calObj);
        if (!run || !run.factors || !isFinite(Number(run.factors.Smax))) continue;

        const Smax = Number(run.factors.Smax);
        const storageFinal = storageFromReadiness(targetReadiness, Smax);

        const payload = {
          fieldId: String(f.id),
          fieldName: String(f.name || ''),
          asOfDateISO: String(asOfDateISO || ''),
          storageFinal,
          SmaxAtSave: Smax,
          source: 'global-truth-slider',
          updatedAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
          updatedBy: createdBy
        };

        await writeTruthStateDocModern(api, db, f.id, payload);
      }catch(e){
        console.warn('[FieldReadiness] truth state write failed:', e);
      }
    }
  }catch(e){
    console.warn('[FieldReadiness] truth state write failed (setup):', e);
  }
}

/* =========================
   Open / Close
========================= */
async function openAdjust(state){
  ensureGlobalCalThemeCSSOnce();

  if (!canEdit(state)) return;

  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  const f = getSelectedField(state);
  if (!f) return;

  updateAdjustHeader(state);

  await loadCooldown(state);
  renderCooldownCard(state);

  // shown run (matches tiles; readinessShift off)
  const runShown = getRunForFieldShown(state, f);
  if (!runShown) return;

  const thr = currentThreshold(state);
  const status = statusFromReadinessAndThreshold(state, runShown, thr);

  state._adjStatus = status;
  state._adjFeel = null;

  // Anchor to shown readiness
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
   Apply (writes truth state)
========================= */
async function applyAdjustment(state){
  if (isLocked(state)) return;

  const f = getSelectedField(state);
  if (!f) return;

  const runShown = getRunForFieldShown(state, f);
  if (!runShown) return;

  const thr = currentThreshold(state);
  state._adjStatus = statusFromReadinessAndThreshold(state, runShown, thr);

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return;

  // enforce opposite-only rule
  if (state._adjStatus === 'wet' && feel !== 'dry') return;
  if (state._adjStatus === 'dry' && feel !== 'wet') return;

  // target readiness for today (truth)
  const targetR = sliderVal();

  // Choose as-of date aligned to the weather series end (prevents seed mismatch).
  // Use the selected field’s runShown rows as the global anchor date.
  let asOf = '';
  try{
    const rows = Array.isArray(runShown.rows) ? runShown.rows : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    asOf = isoDay(last && last.dateISO ? last.dateISO : '');
  }catch(_){}
  if (!asOf){
    asOf = isoDay(new Date().toISOString());
  }

  // WRITE truth state for ALL fields
  await writeGlobalTruthState(state, targetR, asOf);

  const nowMs = Date.now();
  await writeWeightsLock(state, nowMs);

  renderCooldownCard(state);
  updateUI(state);

  closeAdjust(state);

  // Force the page to reload model deps/state + rerender.
  try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
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
