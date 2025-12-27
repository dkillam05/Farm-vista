/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2025-12-27a

Ports the proven global calibration rules from the old field-readiness.ui.js:

✅ Only opens from the tiny "Fields" hotspot (id="fieldsTitle") — NOT the whole row
✅ Permission gated (edit only):
   - if !canEdit(state): hides hotspot + no wiring
✅ Reads cooldown lock from:
   field_readiness_model_weights / default
   fields: lastAppliedAt, nextAllowedAt, cooldownHours (fallback 72h)
✅ Fixes “timer expired but still locked”:
   - if nextAllowedAt is in the past => UNLOCK locally and enable controls immediately
✅ Shows cooldown status card in #calibCooldownMsg
✅ Enforces guardrails:
   - If model says WET: "Wet" disabled, only "Dry" can be chosen
   - If model says DRY: "Dry" disabled, only "Wet" can be chosen
   - If model says OK: either can be chosen
   - If opposite chosen: intensity slider appears, anchored at current readiness
✅ Apply flow:
   - opens confirm modal
   - writes to field_readiness_adjustments (global: true)
   - updates weights doc with lastAppliedAt + nextAllowedAt (optimistic lockout)
✅ On save:
   - dispatches fr:soft-reload so tiles/details refresh without full page reload

Depends on:
- state._mods.model + state._mods.weather already loaded by index/render
- Firestore helpers via getAPI(state) from firebase.js
===================================================================== */
'use strict';

import { getAPI } from './firebase.js';
import { canEdit } from './perm.js';
import { getCurrentOp } from './thresholds.js';
import { buildWxCtx, CONST, EXTRA } from './state.js';
import { getFieldParams } from './params.js';

function $(id){ return document.getElementById(id); }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'","&#039;");
}

/* ============================
   Cooldown helpers
============================ */
function __tsToMs(ts){
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
function __fmtDur(ms){
  ms = Math.max(0, ms|0);
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2,'0')}m`;
}
function __fmtAbs(tsMs){
  if (!tsMs) return '—';
  try{
    const d = new Date(tsMs);
    return d.toLocaleString(undefined, {
      year:'numeric', month:'short', day:'2-digit',
      hour:'numeric', minute:'2-digit'
    });
  }catch(_){
    return '—';
  }
}

/* ============================
   UI helpers
============================ */
function showModal(id, on){
  const el = $(id);
  if (el) el.classList.toggle('pv-hide', !on);
}
function setText(id,val){
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

/* ============================
   Model helpers
============================ */
function modelClassFromRun(run){
  if (!run) return 'ok';
  const w = Number(run.wetnessR);
  if (!isFinite(w)) return 'ok';
  if (w >= 70) return 'wet';
  if (w <= 30) return 'dry';
  return 'ok';
}
function getRunForSelected(state){
  const fid = state.selectedFieldId;
  if (!fid) return null;
  const f = (state.fields || []).find(x=>x.id === fid);
  if (!f) return null;
  if (!state._mods || !state._mods.model || !state._mods.weather) return null;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  // Keep lastRuns in sync if present
  try{
    if (state.lastRuns && state.lastRuns.get(fid)) return state.lastRuns.get(fid);
  }catch(_){}

  const run = state._mods.model.runField(f, deps);
  try{ state.lastRuns && state.lastRuns.set(fid, run); }catch(_){}
  return run;
}

/* ============================
   Lock state (shared in state)
============================ */
function isLocked(state){
  const nextMs = Number(state._nextAllowedMs || 0);
  if (!nextMs) return false;
  // ✅ KEY FIX: if nextAllowed is in the past, UNLOCK even if doc wasn't updated yet
  return Date.now() < nextMs;
}

async function loadCooldownFromFirestore(state){
  const api = getAPI(state);
  if (!api){
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
    return;
  }

  // Compat path (if needed)
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
      state._nextAllowedMs = __tsToMs(d.nextAllowedAt);
      state._lastAppliedMs = __tsToMs(d.lastAppliedAt);
      state._cooldownHours = isFinite(Number(d.cooldownHours)) ? Number(d.cooldownHours) : 72;
      return;
    }catch(_){
      state._nextAllowedMs = 0;
      state._lastAppliedMs = 0;
      state._cooldownHours = 72;
      return;
    }
  }

  // Modular path
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
    state._nextAllowedMs = __tsToMs(d.nextAllowedAt);
    state._lastAppliedMs = __tsToMs(d.lastAppliedAt);
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
  const since = lastMs ? __fmtDur(now - lastMs) : '—';
  const nextAbs = nextMs ? __fmtAbs(nextMs) : '—';

  const title = locked ? 'Global calibration is locked' : 'Global calibration is available';
  const sub = `Next global adjustment allowed: <span class="mono">${esc(nextAbs)}</span>`;

  const lastLine = lastMs
    ? `Last global adjustment: <span class="mono">${esc(since)}</span> ago`
    : `Last global adjustment: <span class="mono">—</span>`;

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

/* ============================
   Adjust UI logic
============================ */
function updatePills(state){
  const run = getRunForSelected(state);
  if (!run) return;

  const fid = state.selectedFieldId;
  const p = getFieldParams(state, fid);

  setText('adjReadiness', run.readinessR);
  setText('adjWetness', run.wetnessR);
  setText('adjSoil', `${p.soilWetness}/100`);
  setText('adjDrain', `${p.drainageIndex}/100`);
  setText('adjModelClass', modelClassFromRun(run).toUpperCase());
}

function getAnchorReadiness(run){
  return clamp(Math.round(Number(run?.readinessR ?? 50)), 0, 100);
}

function configureSliderAnchor(state, anchor){
  const slider = $('adjIntensity');
  if (!slider) return;
  const r = clamp(Math.round(Number(anchor)), 0, 100);
  slider.min = '0';
  slider.max = '100';
  slider.value = String(r);
  const out = $('adjIntensityVal');
  if (out) out.textContent = String(r);
  state._adjAnchorReadiness = r;
}

function readSlider(){
  const el = $('adjIntensity');
  const v = el ? Number(el.value) : 50;
  return clamp(Math.round(isFinite(v) ? v : 50), 0, 100);
}
function updateIntensityLabel(){
  const out = $('adjIntensityVal');
  if (out) out.textContent = String(readSlider());
}

function enforceSliderBounds(state){
  const slider = $('adjIntensity');
  if (!slider) return;

  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  let v = readSlider();

  if (state._adjFeel === 'dry'){
    if (v < anchor) v = anchor;
  } else if (state._adjFeel === 'wet'){
    if (v > anchor) v = anchor;
  } else {
    v = anchor;
  }

  slider.value = String(v);
  updateIntensityLabel();
}

function computeNormalizedIntensity(anchor, feel){
  const target = readSlider();
  const r = clamp(Math.round(Number(anchor)), 0, 100);

  if (feel === 'dry'){
    const denom = Math.max(1, 100 - r);
    return Math.round(clamp((target - r) / denom, 0, 1) * 100);
  }
  if (feel === 'wet'){
    const denom = Math.max(1, r);
    return Math.round(clamp((r - target) / denom, 0, 1) * 100);
  }
  return 0;
}

function computeDelta(state){
  const run = getRunForSelected(state);
  if (!run) return 0;

  const mc = modelClassFromRun(run);
  const feel = state._adjFeel;
  if (!feel) return 0;

  let sign = 0;
  if (feel === 'wet') sign = +1;
  if (feel === 'dry') sign = -1;

  const opposite =
    (mc === 'wet' && feel === 'dry') ||
    (mc === 'dry' && feel === 'wet');

  let mag = 8;
  if (opposite){
    const anchor = (state._adjAnchorReadiness == null) ? getAnchorReadiness(run) : clamp(Number(state._adjAnchorReadiness), 0, 100);
    const intensity0100 = computeNormalizedIntensity(anchor, feel);
    mag = 8 + Math.round((intensity0100/100) * 10);
  }

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

function updateAdjustUI(state){
  const run = getRunForSelected(state);
  if (!run) return;

  const mc = modelClassFromRun(run);
  const locked = isLocked(state);

  const bWet = $('btnFeelWet');
  const bDry = $('btnFeelDry');

  if (bWet) bWet.disabled = locked || (mc === 'wet');
  if (bDry) bDry.disabled = locked || (mc === 'dry');

  const slider = $('adjIntensity');
  if (slider) slider.disabled = locked;

  // If locked, clear selection
  if (locked) state._adjFeel = null;

  // If model says wet and user chose wet, clear it (same for dry)
  if (mc === 'wet' && state._adjFeel === 'wet') state._adjFeel = null;
  if (mc === 'dry' && state._adjFeel === 'dry') state._adjFeel = null;

  // Toggle selected UI
  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }

  const opposite =
    (mc === 'wet' && state._adjFeel === 'dry') ||
    (mc === 'dry' && state._adjFeel === 'wet');

  const box = $('intensityBox');
  if (box) box.classList.toggle('pv-hide', !opposite);

  if (opposite){
    const title = $('intensityTitle');
    const left = $('intensityLeft');
    const right = $('intensityRight');

    if (mc === 'wet' && title){
      title.textContent = 'If it’s NOT wet… how DRY is it?';
      if (left) left.textContent = 'Slightly dry';
      if (right) right.textContent = 'Extremely dry';
    }
    if (mc === 'dry' && title){
      title.textContent = 'If it’s NOT dry… how WET is it?';
      if (left) left.textContent = 'Slightly wet';
      if (right) right.textContent = 'Extremely wet';
    }

    const anchor = getAnchorReadiness(run);
    configureSliderAnchor(state, anchor);
    enforceSliderBounds(state);
  } else {
    updateIntensityLabel();
  }

  const hint = $('adjHint');
  if (hint){
    if (locked){
      hint.textContent = 'Global calibration is locked (72h rule). Use field-specific Soil Wetness and Drainage sliders instead.';
    } else if (mc === 'wet'){
      hint.textContent = 'Model says WET → “Wet” disabled. Choose “Dry” to correct it (slider won’t allow going wetter).';
    } else if (mc === 'dry'){
      hint.textContent = 'Model says DRY → “Dry” disabled. Choose “Wet” to correct it (slider won’t allow going drier).';
    } else {
      hint.textContent = 'Model says OK → choose Wet or Dry if it’s wrong.';
    }
  }

  const applyBtn = $('btnAdjApply');
  if (applyBtn){
    const hasChoice = (state._adjFeel === 'wet' || state._adjFeel === 'dry');
    applyBtn.disabled = locked || !hasChoice;
  }

  updateGuardText(state);
}

function setFeel(state, feel){
  if (isLocked(state)) return;
  state._adjFeel = (feel === 'wet' || feel === 'dry') ? feel : null;
  updateAdjustUI(state);
}

/* ============================
   Firestore write
============================ */
async function writeAdjustToFirestore(state, entry){
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
    if (api.addDoc){
      await api.addDoc(col, payload);
    } else {
      const id = String(Date.now());
      const ref = api.doc(db, CONST.ADJ_COLLECTION, id);
      await api.setDoc(ref, payload, { merge:true });
    }
  }catch(e){
    console.warn('[FieldReadiness] adjust write failed:', e);
  }
}

async function updateWeightsLockDoc(state, nowMs){
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

/* ============================
   Open / Close
============================ */
async function openAdjustGlobal(state){
  // ensure selection exists
  if (!state.selectedFieldId && (state.fields||[]).length){
    state.selectedFieldId = state.fields[0].id;
  }
  if (!state.selectedFieldId) return;

  // reset selection
  state._adjFeel = null;

  // refresh cooldown from Firestore
  await loadCooldownFromFirestore(state);

  // render UI
  updatePills(state);
  renderCooldownCard(state);
  updateAdjustUI(state);

  // open modal
  showModal('adjustBackdrop', true);

  // start/refresh ticker
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = setInterval(async ()=>{
    // light: if expired locally, unlock UI immediately
    renderCooldownCard(state);
    updateAdjustUI(state);

    // periodic firestore refresh to stay accurate
    try{ await loadCooldownFromFirestore(state); }catch(_){}
    renderCooldownCard(state);
    updateAdjustUI(state);
  }, 30000);
}

function closeAdjust(state){
  showModal('adjustBackdrop', false);
  showModal('confirmAdjBackdrop', false);
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = null;
}

/* ============================
   Apply flow
============================ */
async function applyAdjustment(state){
  if (isLocked(state)) return;

  const fid = state.selectedFieldId;
  const f = (state.fields||[]).find(x=>x.id === fid);
  if (!f) return;

  const run = getRunForSelected(state);
  if (!run) return;

  const feel = state._adjFeel;
  const d = computeDelta(state);
  if (!feel || d === 0) return;

  const anchor = (state._adjAnchorReadiness == null) ? getAnchorReadiness(run) : Number(state._adjAnchorReadiness);

  const entry = {
    fieldId: f.id,
    fieldName: f.name || '',
    op: getCurrentOp(),
    feel,
    readinessAnchor: anchor,
    readinessSlider: readSlider(),
    intensity: computeNormalizedIntensity(anchor, feel),
    delta: d,
    global: true,
    model: {
      readinessBefore: run ? run.readinessR : null,
      wetnessBefore: run ? run.wetnessR : null,
      modelClass: modelClassFromRun(run)
    },
    ts: Date.now()
  };

  // write adjustment
  await writeAdjustToFirestore(state, entry);

  // immediately lock locally + update weights doc (so UI matches)
  const nowMs = Date.now();
  await updateWeightsLockDoc(state, nowMs);

  // refresh UI
  renderCooldownCard(state);
  updateAdjustUI(state);

  // close modal
  closeAdjust(state);

  // nudge the page to rerender tiles/details without full reload
  try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
}

/* ============================
   Wiring
============================ */
function wireOnce(state){
  if (state._globalCalWired) return;
  state._globalCalWired = true;

  // Close buttons
  const btnX = $('btnAdjX');
  if (btnX) btnX.addEventListener('click', ()=> closeAdjust(state));

  const btnCancel = $('btnAdjCancel');
  if (btnCancel) btnCancel.addEventListener('click', ()=> closeAdjust(state));

  // Backdrop click closes
  const back = $('adjustBackdrop');
  if (back){
    back.addEventListener('click', (e)=>{
      if (e.target && e.target.id === 'adjustBackdrop') closeAdjust(state);
    });
  }

  // Confirm modal wiring
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

  // Feel seg
  const seg = $('feelSeg');
  if (seg){
    seg.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
      if (!btn) return;
      const feel = btn.getAttribute('data-feel');
      if (feel !== 'wet' && feel !== 'dry') return;
      setFeel(state, feel);
    });
  }

  // Intensity slider
  const intensity = $('adjIntensity');
  if (intensity){
    intensity.addEventListener('input', ()=>{
      enforceSliderBounds(state);
      updateGuardText(state);
    });
  }

  // Tiny hotspot: ONLY the word "Fields"
  const hot = $('fieldsTitle');
  if (hot){
    hot.addEventListener('click', async (e)=>{
      e.preventDefault();
      e.stopPropagation();
      if (!canEdit(state)) return;
      await openAdjustGlobal(state);
    }, { passive:false });
  }
}

/* ============================
   Public init
============================ */
export function initGlobalCalibration(state){
  // Permission gate + hotspot visibility
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

  // Keep cooldown card reasonably fresh even if modal isn't open (optional)
  // We do NOT start ticker until modal opens.
  (async ()=>{
    try{
      await loadCooldownFromFirestore(state);
    }catch(_){}
  })();
}
