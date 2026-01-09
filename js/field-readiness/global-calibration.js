/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-01-09a

Change (per Dane TODAY):
✅ Global calibration delta is now SLIDER-DIFFERENCE DRIVEN (absolute correction).
   - Slider represents where you believe readiness should be for the reference field.
   - Delta magnitude is based on the actual distance moved (anchor -> slider).
   - Delta is applied globally (as before) via field_readiness_adjustments (global:true).
   - Guardrails KEPT: opposite-only Wet/Dry + slider clamp direction + 72h lock.

Keeps (unchanged):
✅ OP-threshold driven wet/dry status + hysteresis
✅ Lock logic (field_readiness_model_weights) unchanged
✅ UI theme patch (Wet/Dry centered, slider full width, FV buttons)
✅ Still logs op + threshold + anchor/slider + intensity
✅ Still writes to field_readiness_adjustments (global:true) + dispatches fr:soft-reload
✅ Model run still passes CAL + opKey for consistency

NOTE:
- This is a “trigger” for calibration UI only. It does NOT change the physics model.
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
   OP-THRESHOLD WET/DRY TRIGGER TUNING
   - HYSTERESIS prevents flip-flop when readiness is near threshold.
   - Example: threshold 70, band 2:
       dry if readiness >= 72
       wet if readiness <= 68
       69-71 => keep previous status
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

function getCalForModel(state){
  try{
    if (state && state._cal && typeof state._cal === 'object') return state._cal;
  }catch(_){}
  return { wetBias:0, opWetBias:{} };
}

function getRunForField(state, f){
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
    CAL: getCalForModel(state)
  };

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
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
   - Uses readiness and current op threshold
========================= */
function statusFromReadinessAndThreshold(state, run, thr){
  const r = clamp(Math.round(Number(run?.readinessR ?? 0)), 0, 100);
  const t = clamp(Math.round(Number(thr ?? 70)), 0, 100);
  const band = clamp(Math.round(Number(STATUS_HYSTERESIS)), 0, 10);

  // If far enough above threshold -> dry
  if (r >= (t + band)) return 'dry';

  // If far enough below threshold -> wet
  if (r <= (t - band)) return 'wet';

  // In the middle band -> keep previous if we have it; otherwise decide by simple compare
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
    ? `Last global adjustment: <span class="mono">${esc(since)}</span> ago`
    : `Last global adjustment: <span class="mono">—</span>`;
  const sub = `Next global adjustment allowed: <span class="mono">${esc(nextAbs)}</span>`;
  const note =
    `If one specific field needs changes right now, do a <b>field-specific adjustment</b> using the field’s <b>Soil Wetness</b> and <b>Drainage Index</b> sliders (not global calibration).`;

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

  // WET -> only DRY allowed -> readiness can only increase (cannot move below anchor)
  if (status === 'wet' && feel === 'dry'){
    if (v < anchor) v = anchor;
  }
  // DRY -> only WET allowed -> readiness can only decrease (cannot move above anchor)
  else if (status === 'dry' && feel === 'wet'){
    if (v > anchor) v = anchor;
  } else {
    v = anchor;
  }

  el.value = String(v);
  setSliderVal(v);
}

/* =========================
   Intensity normalization + delta
========================= */
function normalizedIntensity0100(state){
  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  const target = sliderVal();
  const status = state._adjStatus;
  const feel = state._adjFeel;

  if (status === 'wet' && feel === 'dry'){
    const denom = Math.max(1, 100 - anchor);
    return Math.round(clamp((target - anchor) / denom, 0, 1) * 100);
  }
  if (status === 'dry' && feel === 'wet'){
    const denom = Math.max(1, anchor);
    return Math.round(clamp((anchor - target) / denom, 0, 1) * 100);
  }
  return 0;
}

/* =====================================================================
   NEW DELTA (per Dane):
   - Delta magnitude is the ACTUAL points moved on the slider from anchor.
   - Applies globally via the existing adjustment pipeline (global:true).
   - Still guardrailed by:
       • opposite-only feel buttons
       • slider clamp direction (cannot move “the wrong way”)
       • max delta clamp below
===================================================================== */
const MAX_GLOBAL_DELTA = 35; // guardrail: max points shifted per global calibration

function computeDelta(state){
  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return 0;

  const anchor = clamp(Math.round(Number(state._adjAnchorReadiness ?? 50)), 0, 100);
  const target = clamp(Math.round(Number(sliderVal())), 0, 100);

  // Directional distance (must be positive to count)
  // - Feel WET means you moved readiness DOWN (toward wetter)
  // - Feel DRY means you moved readiness UP (toward drier)
  const dirDiff = (feel === 'wet') ? (anchor - target) : (target - anchor);
  const dist = Math.round(Math.max(0, dirDiff));

  if (!dist) return 0;

  const mag = clamp(dist, 1, MAX_GLOBAL_DELTA);

  // Keep sign convention used by the rest of the system:
  // +delta = wetter, -delta = drier
  const sign = (feel === 'wet') ? +1 : -1;

  return clamp(sign * mag, -MAX_GLOBAL_DELTA, +MAX_GLOBAL_DELTA);
}

function updateGuardText(state){
  const el = $('adjGuard');
  if (!el) return;

  const d = computeDelta(state);
  if (d === 0){
    el.textContent = 'Choose Wet or Dry, then move the slider to set how far off the model is.';
    return;
  }

  const anchor = clamp(Math.round(Number(state._adjAnchorReadiness ?? 50)), 0, 100);
  const target = sliderVal();
  const dist = Math.abs(anchor - target);

  el.textContent =
    `This will shift the model by ${d > 0 ? '+' : ''}${d} globally ` +
    `(based on moving this field ${dist} point${dist === 1 ? '' : 's'}).`;
}

/* =========================
   UI state
========================= */
function updateAdjustHeader(state){
  const f = getSelectedField(state);
  const sub = $('adjustSub');
  if (!sub) return;

  if (f && f.name){
    sub.textContent = `Global calibration • ${f.name}`;
  } else {
    sub.textContent = 'Global calibration';
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

  // Status now tied to OP threshold trigger
  setText('adjModelClass', (state._adjStatus || '—').toUpperCase());

  // If you have a spot in the modal for threshold, you can wire it. Otherwise harmless.
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
      hint.textContent = 'Global calibration is locked (72h rule). Use field-specific Soil Wetness and Drainage sliders instead.';
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
   Firestore write
========================= */
async function writeAdjustment(state, entry){
  const api = getAPI(state);
  if (!api) return;

  if (api.kind === 'compat'){
    try{
      const db = window.firebase.firestore();
      const auth = window.firebaseAuth || null;
      const user = auth && auth.currentUser ? auth.currentUser : null;

      const payload = {
        ...entry,
        createdAt: new Date().toISOString(),
        createdBy: user ? (user.email || user.uid || null) : null
      };
      await db.collection(CONST.ADJ_COLLECTION).add(payload);
    }catch(e){
      console.warn('[FieldReadiness] adjust write failed:', e);
    }
    return;
  }

  try{
    const db = api.getFirestore();
    const auth = api.getAuth ? api.getAuth() : null;
    const user = auth && auth.currentUser ? auth.currentUser : null;

    const payload = {
      ...entry,
      createdAt: api.serverTimestamp ? api.serverTimestamp() : new Date().toISOString(),
      createdBy: user ? (user.email || user.uid || null) : null
    };

    const col = api.collection(db, CONST.ADJ_COLLECTION);
    if (api.addDoc) await api.addDoc(col, payload);
    else {
      const id = String(Date.now());
      const ref = api.doc(db, CONST.ADJ_COLLECTION, id);
      await api.setDoc(ref, payload, { merge:true });
    }
  }catch(e){
    console.warn('[FieldReadiness] adjust write failed:', e);
  }
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
      nextAllowedAt: new Date(nextMs).toISOString(),
      cooldownHours: cdH
    }, { merge:true });
  }catch(e){
    console.warn('[FieldReadiness] weights update failed:', e);
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

  const run = getRunForField(state, f);
  if (!run) return;

  // ✅ NEW: op-threshold dynamic wet/dry status (with hysteresis)
  const thr = currentThreshold(state);
  const status = statusFromReadinessAndThreshold(state, run, thr);

  state._adjStatus = status;
  state._adjFeel = null;

  // Anchor remains readiness (your rule)
  state._adjAnchorReadiness = clamp(Math.round(Number(run?.readinessR ?? 50)), 0, 100);

  setAnchor(state, state._adjAnchorReadiness);
  setSliderVal(state._adjAnchorReadiness);

  updatePills(state, run);
  updateUI(state);

  showModal('adjustBackdrop', true);

  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = setInterval(async ()=>{
    // refresh lock + status (in case op or readiness changed while open)
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);

    const f2 = getSelectedField(state);
    const run2 = getRunForField(state, f2);
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
   Apply
========================= */
function currentThresholdForLogging(state){
  return currentThreshold(state);
}

async function applyAdjustment(state){
  if (isLocked(state)) return;

  const f = getSelectedField(state);
  if (!f) return;

  const run = getRunForField(state, f);
  if (!run) return;

  // Re-evaluate status at apply time (operation might have changed)
  const thr = currentThreshold(state);
  state._adjStatus = statusFromReadinessAndThreshold(state, run, thr);

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return;

  // Enforce opposite-only
  if (state._adjStatus === 'wet' && feel !== 'dry') return;
  if (state._adjStatus === 'dry' && feel !== 'wet') return;

  const d = computeDelta(state);
  if (!d) return;

  const entry = {
    fieldId: f.id,
    fieldName: f.name || '',

    op: getCurrentOp(),
    threshold: thr,

    status: state._adjStatus, // wet/dry driven by op-threshold trigger
    feel,

    readinessAnchor: clamp(Math.round(Number(run.readinessR)), 0, 100),
    readinessSlider: sliderVal(),
    intensity: normalizedIntensity0100(state),

    // ✅ Now driven by slider difference (absolute correction), applied globally
    delta: d,
    deltaMax: MAX_GLOBAL_DELTA,
    deltaMode: 'slider-diff',

    global: true,

    model: {
      readinessBefore: run.readinessR,
      wetnessBefore: run.wetnessR
    },

    ts: Date.now()
  };

  await writeAdjustment(state, entry);

  const nowMs = Date.now();
  await writeWeightsLock(state, nowMs);

  renderCooldownCard(state);
  updateUI(state);

  closeAdjust(state);

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

      // Opposite-only enforcement based on current status
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