/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2025-12-26b

GLOBAL calibration with 72h lock + cooldown card.
Uses existing HTML IDs from your field-readiness page.

Reads cooldown from:
  field_readiness_model_weights/default
Writes log to:
  field_readiness_adjustments

Edit gating:
  requires crop-weather.edit (handled in code)

UI tweak (per Dane):
- “Fields” stays looking like plain text (no big button feel)
  (no cursor:pointer, no role/aria label)

===================================================================== */
'use strict';

import { CONST, EXTRA, buildWxCtx } from './state.js';
import { getAPI } from './firebase.js';
import { clamp, esc } from './utils.js';
import { getFieldParams } from './params.js';
import { getCurrentOp, getThresholdForOp } from './thresholds.js';
import { canEdit } from './perm.js';

function $(id){ return document.getElementById(id); }

/* ---------- time helpers ---------- */
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
function __tsToMs(ts){
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds && ts.nanoseconds != null){
    return (Number(ts.seconds)*1000) + Math.floor(Number(ts.nanoseconds)/1e6);
  }
  return 0;
}

function isGlobalCalLocked(state){
  const nextMs = Number(state._nextAllowedMs || 0);
  return !!(nextMs && Date.now() < nextMs);
}

/* ---------- modal helpers ---------- */
function showModal(id, on){
  const b = $(id);
  if (b) b.classList.toggle('pv-hide', !on);
}

function __setCooldownHtml(html){
  const el = $('calibCooldownMsg');
  if (!el) return;

  if (!html){
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  el.style.display = 'block';
  el.innerHTML = html;
}

function __renderCooldownCard(state){
  const now = Date.now();
  const lastMs = Number(state._lastAppliedMs || 0);
  const nextMs = Number(state._nextAllowedMs || 0);
  const cdH = Number(state._cooldownHours || 72);

  const locked = (nextMs && now < nextMs);
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

  __setCooldownHtml(`
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

/* ---------- cooldown read ---------- */
async function loadCooldownFromFirestore(state){
  const api = getAPI(state);
  if (!api || api.kind === 'compat'){
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
    return;
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
    state._nextAllowedMs = __tsToMs(d.nextAllowedAt);
    state._lastAppliedMs = __tsToMs(d.lastAppliedAt);
    state._cooldownHours = isFinite(Number(d.cooldownHours)) ? Number(d.cooldownHours) : 72;
  }catch(e){
    console.warn('[FieldReadiness] cooldown read failed:', e);
    state._nextAllowedMs = 0;
    state._lastAppliedMs = 0;
    state._cooldownHours = 72;
  }
}

function startCooldownTicker(state){
  function tick(){
    __renderCooldownCard(state);
    updateAdjustUI(state);
  }
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  tick();
  state._cooldownTimer = setInterval(tick, 30000);
}
function stopCooldownTicker(state){
  try{ if (state._cooldownTimer) clearInterval(state._cooldownTimer); }catch(_){}
  state._cooldownTimer = null;
  __setCooldownHtml('');
}

/* ---------- adjust UI ---------- */
function readSlider0100(){
  const el = $('adjIntensity');
  const v = el ? Number(el.value) : 50;
  return clamp(Math.round(isFinite(v) ? v : 50), 0, 100);
}
function updateIntensityLabel(){
  const out = $('adjIntensityVal');
  if (!out) return;
  out.textContent = String(readSlider0100());
}
function getAnchorReadinessFromRun(run){
  return clamp(Math.round(Number(run?.readinessR ?? 50)), 0, 100);
}
function configureSliderAnchor(anchorReadiness){
  const slider = $('adjIntensity');
  if (!slider) return;
  const r = clamp(Math.round(Number(anchorReadiness)), 0, 100);
  slider.min = '0';
  slider.max = '100';
  slider.value = String(r);
  updateIntensityLabel();
}
function enforceAdjustSliderBounds(state){
  const slider = $('adjIntensity');
  if (!slider) return;

  const anchor = clamp(Number(state._adjAnchorReadiness ?? 50), 0, 100);
  let v = readSlider0100();

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

function computeNormalizedIntensity0100(anchor, feel){
  const target = readSlider0100();
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
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return 0;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  const run = state.lastRuns.get(f.id) || state._mods.model.runField(f, deps);
  const mc = state._mods.model.modelClassFromRun(run);
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
    const anchor = (state._adjAnchorReadiness == null)
      ? getAnchorReadinessFromRun(run)
      : clamp(Number(state._adjAnchorReadiness), 0, 100);
    const intensity0100 = computeNormalizedIntensity0100(anchor, feel);
    mag = 8 + Math.round((intensity0100/100) * 10);
  }

  return clamp(sign * mag, -18, +18);
}

function updateAdjustGuard(state){
  updateIntensityLabel();
  const el = $('adjGuard');
  if (!el) return;

  const d = computeDelta(state);
  if (d === 0){
    el.textContent = 'Choose Wet or Dry to submit a global calibration.';
    return;
  }
  el.textContent = `This will nudge the model by ${d > 0 ? '+' : ''}${d} (guardrailed).`;
}

export function updateAdjustPills(state){
  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f || !state._mods.model || !state._mods.weather) return;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };

  const run = state.lastRuns.get(f.id) || state._mods.model.runField(f, deps);
  if (!run) return;

  const p = getFieldParams(state, f.id);

  const set = (id,val)=>{ const el=$(id); if(el) el.textContent=String(val); };
  set('adjReadiness', run.readinessR);
  set('adjWetness', run.wetnessR);
  set('adjSoil', `${p.soilWetness}/100`);
  set('adjDrain', `${p.drainageIndex}/100`);

  const mc = state._mods.model.modelClassFromRun(run);
  set('adjModelClass', mc.toUpperCase());

  updateAdjustUI(state);
}

function setFeel(state, feel){
  if (!canEdit(state)) return;
  if (isGlobalCalLocked(state)) return;

  state._adjFeel = (feel === 'wet' || feel === 'dry') ? feel : null;

  const seg = $('feelSeg');
  if (seg){
    seg.querySelectorAll('.segbtn').forEach(btn=>{
      const bf = btn.getAttribute('data-feel');
      btn.classList.toggle('on', bf === state._adjFeel);
    });
  }
  updateAdjustUI(state);
}

function updateAdjustUI(state){
  if (!state._mods.model) return;

  const fid = state.selectedFieldId;
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
  const mc = state._mods.model.modelClassFromRun(run);

  const locked = isGlobalCalLocked(state) || !canEdit(state);

  const bWet = $('btnFeelWet');
  const bDry = $('btnFeelDry');
  if (bWet) bWet.disabled = locked || (mc === 'wet');
  if (bDry) bDry.disabled = locked || (mc === 'dry');

  const s = $('adjIntensity');
  if (s) s.disabled = !!locked;

  if (mc === 'wet' && state._adjFeel === 'wet') state._adjFeel = null;
  if (mc === 'dry' && state._adjFeel === 'dry') state._adjFeel = null;
  if (locked) state._adjFeel = null;

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

    const anchor = getAnchorReadinessFromRun(run);
    state._adjAnchorReadiness = anchor;

    configureSliderAnchor(anchor);
    enforceAdjustSliderBounds(state);
  } else {
    updateIntensityLabel();
  }

  const hint = $('adjHint');
  if (hint){
    if (!canEdit(state)){
      hint.textContent = 'View only. You do not have edit permission for calibration.';
    } else if (locked && isGlobalCalLocked(state)){
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

  updateAdjustGuard(state);
}

/* ---------- Firestore write log ---------- */
async function writeAdjustToFirestore(state, entry){
  const api = getAPI(state);
  if (!api || api.kind === 'compat') return;

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
    console.warn('[FieldReadiness] adjust log write failed:', e);
  }
}

async function applyAdjustment(state){
  if (!canEdit(state)) return;

  const fid = state.selectedFieldId;
  const f = state.fields.find(x=>x.id===fid);
  if (!f) return;

  if (isGlobalCalLocked(state)) return;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };
  const run = state.lastRuns.get(f.id) || state._mods.model.runField(f, deps);

  const d = computeDelta(state);
  const feel = state._adjFeel;
  if (!feel || d === 0) return;

  const anchor = (state._adjAnchorReadiness == null) ? getAnchorReadinessFromRun(run) : Number(state._adjAnchorReadiness);

  const entry = {
    fieldId: f.id,
    fieldName: f.name || '',
    op: getCurrentOp(),

    feel,
    readinessAnchor: anchor,
    readinessSlider: readSlider0100(),
    intensity: computeNormalizedIntensity0100(anchor, feel),
    delta: d,

    global: true,

    model: {
      readinessBefore: run ? run.readinessR : null,
      wetnessBefore: run ? run.wetnessR : null,
      modelClass: state._mods.model.modelClassFromRun(run)
    },
    ts: Date.now()
  };

  await writeAdjustToFirestore(state, entry);

  try{ document.dispatchEvent(new CustomEvent('fr:soft-reload')); }catch(_){}
  updateAdjustPills(state);

  showModal('adjustBackdrop', false);
  stopCooldownTicker(state);
}

async function openAdjustGlobal(state){
  if (!canEdit(state)) return;

  if (!state.selectedFieldId && state.fields.length){
    state.selectedFieldId = state.fields[0].id;
  }

  const f = state.fields.find(x=>x.id===state.selectedFieldId);
  const sub = $('adjustSub');
  if (sub){
    sub.textContent = 'Global calibration';
    if (f && f.name) sub.textContent = `Global calibration • ${f.name}`;
  }

  state._adjFeel = null;

  const wxCtx = buildWxCtx(state);
  const deps = {
    getWeatherSeriesForFieldId: (fieldId)=> state._mods.weather.getWeatherSeriesForFieldId(fieldId, wxCtx),
    getFieldParams: (id)=> getFieldParams(state, id),
    LOSS_SCALE: CONST.LOSS_SCALE,
    EXTRA
  };
  const run = f ? (state.lastRuns.get(f.id) || state._mods.model.runField(f, deps)) : null;
  const anchor = getAnchorReadinessFromRun(run);
  state._adjAnchorReadiness = anchor;
  configureSliderAnchor(anchor);

  await loadCooldownFromFirestore(state);
  stopCooldownTicker(state);
  startCooldownTicker(state);

  __renderCooldownCard(state);
  updateAdjustPills(state);
  updateAdjustGuard(state);

  showModal('adjustBackdrop', true);
}

/* ---------- public init ---------- */
export function initGlobalCalibration(state){
  // Fields label click opens calibration (edit only)
  const fieldsTitle = $('fieldsTitle');
  if (fieldsTitle){
    // Keep it visually like normal text (no big button feel)
    fieldsTitle.style.cursor = '';
    fieldsTitle.removeAttribute('role');
    fieldsTitle.removeAttribute('aria-label');

    fieldsTitle.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      openAdjustGlobal(state);
    });
  }

  // Adjust modal close buttons
  const btnAdjX = $('btnAdjX');
  if (btnAdjX) btnAdjX.addEventListener('click', ()=>{
    showModal('adjustBackdrop', false);
    stopCooldownTicker(state);
  });

  const btnAdjCancel = $('btnAdjCancel');
  if (btnAdjCancel) btnAdjCancel.addEventListener('click', ()=>{
    showModal('adjustBackdrop', false);
    stopCooldownTicker(state);
  });

  // Apply button opens confirm
  const btnAdjApply = $('btnAdjApply');
  if (btnAdjApply){
    btnAdjApply.addEventListener('click', ()=>{
      if (btnAdjApply.disabled) return;
      showModal('confirmAdjBackdrop', true);
    });
  }

  // Confirm modal buttons
  const btnAdjNo = $('btnAdjNo');
  if (btnAdjNo) btnAdjNo.addEventListener('click', ()=> showModal('confirmAdjBackdrop', false));

  const btnAdjYes = $('btnAdjYes');
  if (btnAdjYes){
    btnAdjYes.addEventListener('click', async ()=>{
      showModal('confirmAdjBackdrop', false);
      await applyAdjustment(state);
    });
  }

  // Feel segment click
  const feelSeg = $('feelSeg');
  if (feelSeg){
    feelSeg.addEventListener('click', (e)=>{
      const btn = e.target && e.target.closest ? e.target.closest('button[data-feel]') : null;
      if (!btn) return;
      const f = btn.getAttribute('data-feel');
      if (f !== 'wet' && f !== 'dry') return;
      setFeel(state, f);
    });
  }

  // Intensity slider
  const adjIntensity = $('adjIntensity');
  if (adjIntensity){
    adjIntensity.addEventListener('input', ()=>{
      enforceAdjustSliderBounds(state);
      updateAdjustGuard(state);
    });
  }

  // Keep pills up to date on soft reloads
  document.addEventListener('fr:soft-reload', ()=>{
    try{ updateAdjustPills(state); }catch(_){}
  });
}
