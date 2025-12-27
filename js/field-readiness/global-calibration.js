/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2025-12-27c

Implements Dane's GLOBAL CALIBRATION rules:

Reference field:
- The selected field at the moment you open Adjust is the reference.
- adjustSub shows: "Global calibration • <Field Name>"

Wet/Dry gating is based on CURRENT OP THRESHOLD:
- status = (readinessR >= threshold) ? 'dry' : 'wet'

Allowed actions:
- If status === 'wet'  -> you CANNOT mark "wet"; you may only mark "dry" (drier).
  Slider shows 0–100, starts at current readiness anchor.
  Slider cannot be moved below anchor (can't make it wetter than current).
- If status === 'dry' -> you CANNOT mark "dry"; you may only mark "wet" (wetter).
  Slider shows 0–100, starts at current readiness anchor.
  Slider cannot be moved above anchor (can't make it drier than current).

72h cooldown:
- Reads lock from: field_readiness_model_weights/default
  fields used: lastAppliedAt, nextAllowedAt, cooldownHours (default 72)
- Fixes "expired but still locked": if nextAllowedAt is in the past -> unlocked.

Writes:
- Writes entry to field_readiness_adjustments (global:true)
- Optimistically updates weights doc (lastAppliedAt / nextAllowedAt) and local state
- Dispatches fr:soft-reload so UI refreshes without page reload

Depends on:
- state._mods.model + state._mods.weather loaded by index/render
- getAPI(state) from firebase.js
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

function getRunForField(state, f){
  if (!f) return null;
  if (!state._mods || !state._mods.model || !state._mods.weather) return null;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(f.id, run); }catch(_){}
  return run;
}

/* =========================
   Threshold-based wet/dry status (YOUR RULE)
   wet  => readiness below threshold
   dry  => readiness at/above threshold
========================= */
function currentThreshold(state){
  const opKey = getCurrentOp();
  const v = state.thresholdsByOp && state.thresholdsByOp.get ? state.thresholdsByOp.get(opKey) : null;
  const thr = isFinite(Number(v)) ? Number(v) : 70;
  return clamp(Math.round(thr), 0, 100);
}

function statusFromRunAndThreshold(run, thr){
  const r = clamp(Math.round(Number(run?.readinessR ?? 0)), 0, 100);
  return (r >= thr) ? 'dry' : 'wet';
}

/* =========================
   Cooldown (72h)
========================= */
function isLocked(state){
  const nextMs = Number(state._nextAllowedMs || 0);
  if (!nextMs) return false;
  // ✅ If expired, unlocked — no stale lock
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

  // compat
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

  // modular
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

/**
 * Enforce the "can't go past current reading" clamp:
 * - If status wet and user marking drier => slider cannot go BELOW anchor (can't make wetter)
 * - If status dry and user marking wetter => slider cannot go ABOVE anchor (can't make drier)
 */
function enforceSliderClamp(state){
  const el = sliderEl();
  if (!el) return;

  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  let v = sliderVal();

  const status = state._adjStatus; // 'wet'|'dry'
  const feel = state._adjFeel;     // user choice: 'wet'|'dry'|null

  // If no feel selected, keep it pinned at anchor
  if (!feel){
    v = anchor;
    el.value = String(v);
    setSliderVal(v);
    return;
  }

  // User choice must be opposite of status (rules), but clamp defensively:
  if (status === 'wet' && feel === 'dry'){
    // drier => readiness can ONLY increase
    if (v < anchor) v = anchor;
  } else if (status === 'dry' && feel === 'wet'){
    // wetter => readiness can ONLY decrease
    if (v > anchor) v = anchor;
  } else {
    // invalid combination, pin
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

  // Only meaningful when choosing opposite
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

/**
 * Delta is the guarded nudge sent to the calibration log.
 * - sign: + means "make model wetter", - means "make model drier" (same as old file)
 * - magnitude grows with slider distance (intensity) but is guardrailed
 */
function computeDelta(state){
  const feel = state._adjFeel;
  if (!feel) return 0;

  let sign = 0;
  if (feel === 'wet') sign = +1;
  if (feel === 'dry') sign = -1;

  // Base magnitude and intensity-driven magnitude like your old behavior
  const intensity = normalizedIntensity0100(state); // 0..100
  const mag = 8 + Math.round((intensity/100) * 10); // 8..18
  return clamp(sign * mag, -18, +18);
}

function updateGuardText(state){
  const el = $('adjGuard');
  if (!el) return;
  const d = computeDelta(state);
  if (d === 0){
    el.textContent = 'Choose Wet or Dry to submit a global calibration.';
    return;
  }
  el.textContent = `This will nudge the model by ${d > 0 ? '+' : ''}${d} (guardrailed).`;
}

/* =========================
   UI state
========================= */
function updateAdjustHeader(state){
  const f = getSelectedField(state);
  const sub = $('adjustSub');
  if (!sub) return;

  // ✅ This is the indicator you asked for
  if (f && f.name){
    sub.textContent = `Global calibration • ${f.name}`;
  } else {
    sub.textContent = 'Global calibration';
  }
}

function updatePills(state, run){
  const fid = state.selectedFieldId;
  const p = getFieldParams(state, fid);

  setText('adjReadiness', run ? run.readinessR : '—');
  setText('adjWetness', run ? run.wetnessR : '—');
  setText('adjSoil', `${p.soilWetness}/100`);
  setText('adjDrain', `${p.drainageIndex}/100`);
  setText('adjModelClass', (state._adjStatus || '—').toUpperCase());
}

function updateUI(state){
  const locked = isLocked(state);

  // enable/disable
  const bWet = $('btnFeelWet');
  const bDry = $('btnFeelDry');
  const applyBtn = $('btnAdjApply');
  const s = sliderEl();

  // Your rule: if status is wet -> wet disabled, only dry allowed
  //            if status is dry -> dry disabled, only wet allowed
  if (bWet) bWet.disabled = locked || (state._adjStatus === 'wet');
  if (bDry) bDry.disabled = locked || (state._adjStatus === 'dry');

  if (s) s.disabled = locked;

  if (locked){
    state._adjFeel = null;
  }

  // highlight selection
  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }

  // intensity box only when choosing opposite (which is always in this design)
  const box = $('intensityBox');
  const opposite =
    (state._adjStatus === 'wet' && state._adjFeel === 'dry') ||
    (state._adjStatus === 'dry' && state._adjFeel === 'wet');
  if (box) box.classList.toggle('pv-hide', !opposite);

  // set intensity labels
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

  // hint
  const hint = $('adjHint');
  if (hint){
    if (locked){
      hint.textContent = 'Global calibration is locked (72h rule). Use field-specific Soil Wetness and Drainage sliders instead.';
    } else if (state._adjStatus === 'wet'){
      hint.textContent = 'This reference field is below threshold (WET). Only “Dry” is allowed, and the slider cannot move wetter than the current reading.';
    } else if (state._adjStatus === 'dry'){
      hint.textContent = 'This reference field meets threshold (DRY). Only “Wet” is allowed, and the slider cannot move drier than the current reading.';
    } else {
      hint.textContent = 'Choose Wet or Dry.';
    }
  }

  // apply enabled only when choice exists and not locked
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

  // compat
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

  // modular
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

  // optimistic local update
  state._lastAppliedMs = nowMs;
  state._nextAllowedMs = nextMs;

  if (!api) return;

  // compat
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

  // modular
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
  if (!canEdit(state)) return;

  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  const f = getSelectedField(state);
  if (!f) return;

  updateAdjustHeader(state);

  // read cooldown
  await loadCooldown(state);
  renderCooldownCard(state);

  // compute run + status from threshold
  const run = getRunForField(state, f);
  const thr = currentThreshold(state);
  const status = statusFromRunAndThreshold(run, thr);

  state._adjStatus = status;       // 'wet' or 'dry'
  state._adjFeel = null;           // user choice
  state._adjAnchorReadiness = clamp(Math.round(Number(run?.readinessR ?? 50)), 0, 100);

  // init slider at anchor
  setAnchor(state, state._adjAnchorReadiness);
  setSliderVal(state._adjAnchorReadiness);

  updatePills(state, run);
  updateUI(state);

  showModal('adjustBackdrop', true);

  // ticker
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = setInterval(async ()=>{
    // quick UI unlock if expired
    renderCooldownCard(state);
    updateUI(state);

    // periodic firestore refresh (keeps you honest)
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);
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
async function applyAdjustment(state){
  if (isLocked(state)) return;

  const f = getSelectedField(state);
  if (!f) return;

  const run = getRunForField(state, f);
  if (!run) return;

  const feel = state._adjFeel;
  if (!(feel === 'wet' || feel === 'dry')) return;

  // Enforce rule: must be opposite of status
  if (state._adjStatus === 'wet' && feel !== 'dry') return;
  if (state._adjStatus === 'dry' && feel !== 'wet') return;

  const d = computeDelta(state);
  if (!d) return;

  const thr = currentThreshold(state);
  const entry = {
    fieldId: f.id,
    fieldName: f.name || '',
    op: getCurrentOp(),
    threshold: thr,

    // rule context
    status: state._adjStatus, // wet/dry relative to threshold
    feel,                     // user correction direction

    readinessAnchor: clamp(Math.round(Number(run.readinessR)), 0, 100),
    readinessSlider: sliderVal(),
    intensity: normalizedIntensity0100(state),
    delta: d,

    global: true,

    model: {
      readinessBefore: run.readinessR,
      wetnessBefore: run.wetnessR
    },

    ts: Date.now()
  };

  await writeAdjustment(state, entry);

  // lock
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

  // close buttons
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

  // feel buttons
  const seg = $('feelSeg');
  if (seg){
    seg.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
      if (!btn) return;
      const feel = btn.getAttribute('data-feel');
      if (feel !== 'wet' && feel !== 'dry') return;
      if (isLocked(state)) return;

      // enforce opposite-only per status
      if (state._adjStatus === 'wet'){
        state._adjFeel = 'dry';
      } else if (state._adjStatus === 'dry'){
        state._adjFeel = 'wet';
      } else {
        state._adjFeel = feel;
      }

      // reset slider to anchor on selection
      setSliderVal(state._adjAnchorReadiness);
      updateUI(state);
    });
  }

  // slider
  const s = sliderEl();
  if (s){
    s.addEventListener('input', ()=>{
      enforceSliderClamp(state);
      updateGuardText(state);
    });
  }

  // apply -> confirm
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

  // hotspot: ONLY the word "Fields"
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
  // permission gate + hotspot visibility
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

  // preload cooldown (no ticker until modal opens)
  (async ()=>{
    try{ await loadCooldown(state); }catch(_){}
    renderCooldownCard(state);
  })();
}
