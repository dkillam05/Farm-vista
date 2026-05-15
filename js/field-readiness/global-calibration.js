/* =====================================================================
/Farm-vista/js/field-readiness/global-calibration.js  (FULL FILE)
Rev: 2026-05-15-field-conditions-current-fix
===================================================================== */

'use strict';

import { getAPI } from './firebase.js';
import { canEdit } from './perm.js';
import { buildWxCtx, CONST, OPS, EXTRA } from './state.js';
import { getFieldParams } from './params.js';
import { getCurrentOp } from './thresholds.js';
import { ensureFRModules, buildFRDeps } from './formula.js';

function $(id){ return document.getElementById(id); }
function setText(id, value){

  const el =
    $(id);

  if (!el){
    return;
  }

  el.textContent =
    value == null
      ? ''
      : String(value);
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function safeStr(x){
  const s = String(x || '');
  return s ? s : '';
}

function safeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeInt(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.round(n)
    : fallback;
}

function toIsoFromAny(v){

  try{

    if (!v) return '';

    if (typeof v === 'string'){
      const d = new Date(v);
      return Number.isFinite(d.getTime())
        ? d.toISOString()
        : v;
    }

    if (v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return Number.isFinite(d.getTime())
        ? d.toISOString()
        : '';
    }

    if (
      v &&
      typeof v === 'object' &&
      typeof v.seconds === 'number'
    ){
      const ms =
        (Number(v.seconds) * 1000) +
        Math.round(Number(v.nanoseconds || 0) / 1e6);

      const d = new Date(ms);

      return Number.isFinite(d.getTime())
        ? d.toISOString()
        : '';
    }

  }catch(_){}

  return '';
}

/* =====================================================================
   COLLECTIONS
===================================================================== */

const FR_LATEST_COLLECTION =
  'field_conditions_current';

const LATEST_TTL_MS =
  30000;

const STATUS_HYSTERESIS =
  2;

/* =====================================================================
   READINESS RECORD BUILDER
===================================================================== */

function buildLatestReadinessRecord(
  raw,
  fallbackId
){

  const d =
    (raw && typeof raw === 'object')
      ? raw
      : {};

  const fieldId =
    safeStr(d.fieldId || fallbackId);

  if (!fieldId){
    return null;
  }

  return {

    fieldId,

    farmId:
      safeStr(d.farmId),

    farmName:
      d.farmName == null
        ? null
        : safeStr(d.farmName),

    fieldName:
      safeStr(d.fieldName),

    county:
      safeStr(d.county),

    state:
      safeStr(d.state),

    readiness:
      safeInt(
        d.readinessR ??
        d.readiness
      ),

    wetness:
      safeInt(
        d.wetnessR ??
        d.wetness
      ),

    soilWetness:
      safeNum(d.soilWetness) ??
      safeNum(d?.soil?.storage),

    drainageIndex:
      safeNum(d.drainageIndex) ??
      50,

    readinessCreditIn:
      safeNum(d.readinessCreditIn) ?? 0,

    storageFinal:
      safeNum(d.storageFinal) ??
      safeNum(d?.soil?.storage),

    storageForReadiness:
      safeNum(d.storageForReadiness),

    storagePhysFinal:
      safeNum(d.storagePhysFinal),

    surfaceStorageFinal:
      safeNum(d.surfaceStorageFinal) ??
      safeNum(d?.surface?.water),

    surfacePenaltyFinal:
      safeNum(d.surfacePenaltyFinal) ??
      safeNum(d?.surface?.penalty),

    wetBiasApplied:
      safeNum(d.wetBiasApplied) ?? 0,

    runKey:
      safeStr(d.runKey),

    seedSource:
      safeStr(
        d.seedMode ??
        d.seedSource
      ),

    weatherSource:
      safeStr(
        d.weatherSource ??
        d?.soil?.source
      ),

    timezone:
      safeStr(d.timezone),

    computedAtISO:
      toIsoFromAny(d.computedAt),

    weatherFetchedAtISO:
      toIsoFromAny(d.weatherFetchedAt),

    modelVersion:
      safeStr(d.modelVersion),

    status:
      safeStr(d.status),

    drydownPointsPerHour:
      safeNum(
        d.drydownPointsPerHour ??
        d?.eta?.drydownPointsPerHour
      ),

    Smax:
      safeNum(d?.soil?.Smax),

    location: {
      lat:
        safeNum(d?.location?.lat),

      lng:
        safeNum(d?.location?.lng)
    },

    _raw: d
  };
}

/* =====================================================================
   LOAD LATEST READINESS
===================================================================== */

async function loadLatestReadiness(
  state,
  { force=false } = {}
){

  try{

    if (!state){
      return;
    }

    const now =
      Date.now();

    const last =
      Number(
        state._latestReadinessLoadedAt || 0
      );

    if (
      !force &&
      state.latestReadinessByFieldId &&
      (now - last) < LATEST_TTL_MS
    ){
      return;
    }

    state.latestReadinessByFieldId =
      state.latestReadinessByFieldId || {};

    const out = {};

    const api =
      getAPI(state);

    if (!api){

      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;

      return;
    }

    if (
      api.kind === 'compat' &&
      window.firebase &&
      window.firebase.firestore
    ){

      const db =
        window.firebase.firestore();

      const snap =
        await db
          .collection(FR_LATEST_COLLECTION)
          .get();

      snap.forEach(doc=>{

        const rec =
          buildLatestReadinessRecord(
            doc.data() || {},
            doc.id
          );

        if (!rec || !rec.fieldId){
          return;
        }

        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;

      return;
    }

    if (api.kind !== 'compat'){

      const db =
        api.getFirestore();

      const col =
        api.collection(
          db,
          FR_LATEST_COLLECTION
        );

      const snap =
        await api.getDocs(col);

      snap.forEach(doc=>{

        const rec =
          buildLatestReadinessRecord(
            doc.data() || {},
            doc.id
          );

        if (!rec || !rec.fieldId){
          return;
        }

        out[rec.fieldId] = rec;
      });

      state.latestReadinessByFieldId = out;
      state._latestReadinessLoadedAt = now;

      return;
    }

  }catch(e){

    console.warn(
      '[FieldReadiness] latest readiness load failed:',
      e
    );

    state.latestReadinessByFieldId =
      state.latestReadinessByFieldId || {};

    state._latestReadinessLoadedAt =
      Date.now();
  }
}

/* =====================================================================
   GET LATEST
===================================================================== */

function getLatestReadinessForField(
  state,
  fieldId
){

  try{

    const map =
      (
        state &&
        state.latestReadinessByFieldId &&
        typeof state.latestReadinessByFieldId === 'object'
      )
        ? state.latestReadinessByFieldId
        : {};

    const fid =
      safeStr(fieldId);

    const rec =
      map[fid];

    return (
      rec &&
      typeof rec === 'object'
    )
      ? rec
      : null;

  }catch(_){

    return null;
  }
}

/* =====================================================================
   FIELD LOOKUP
===================================================================== */

function getSelectedField(state){

  const fid =
    state.selectedFieldId;

  if (!fid){
    return null;
  }

  return (
    state.fields || []
  ).find(
    x => x.id === fid
  ) || null;
}

/* =====================================================================
   CURRENT THRESHOLD
===================================================================== */

function currentThreshold(state){

  const opKey =
    getCurrentOp();

  const v =
    state.thresholdsByOp &&
    state.thresholdsByOp.get
      ? state.thresholdsByOp.get(opKey)
      : null;

  const thr =
    Number.isFinite(Number(v))
      ? Number(v)
      : 70;

  return clamp(
    Math.round(thr),
    0,
    100
  );
}

/* =====================================================================
   SLIDER HELPERS
===================================================================== */

function sliderEl(){
  return $('adjIntensity');
}

function sliderVal(){

  const el =
    sliderEl();

  const v =
    el
      ? Number(el.value)
      : 50;

  return clamp(
    Math.round(
      Number.isFinite(v)
        ? v
        : 50
    ),
    0,
    100
  );
}

function setSliderVal(v){

  const el =
    sliderEl();

  if (el){

    el.value =
      String(
        clamp(
          Math.round(Number(v)),
          0,
          100
        )
      );
  }

  const out =
    $('adjIntensityVal');

  if (out){
    out.textContent =
      String(sliderVal());
  }
}

function setAnchor(
  state,
  anchorReadiness
){

  state._adjAnchorReadiness =
    clamp(
      Math.round(
        Number(anchorReadiness)
      ),
      0,
      100
    );

  const el =
    sliderEl();

  if (el){

    el.min = '0';
    el.max = '100';

    el.value =
      String(
        state._adjAnchorReadiness
      );
  }

  const out =
    $('adjIntensityVal');

  if (out){

    out.textContent =
      String(
        state._adjAnchorReadiness
      );
  }
}

/* =====================================================================
   LOCK
===================================================================== */

function isLocked(state){

  const nextMs =
    Number(
      state._nextAllowedMs || 0
    );

  if (!nextMs){
    return false;
  }

  return Date.now() < nextMs;
}

/* =====================================================================
   UPDATE HEADER
===================================================================== */

function updateAdjustHeader(state){

  const f =
    getSelectedField(state);

  const sub =
    $('adjustSub');

  if (!sub){
    return;
  }

  if (f && f.name){

    sub.textContent =
      `Global storage shift • ${f.name}`;

  } else {

    sub.textContent =
      'Global storage shift';
  }
}

/* =====================================================================
   UPDATE PILLS
===================================================================== */

function updatePills(
  state,
  run
){

  const fid =
    state.selectedFieldId;

  const p =
    getFieldParams(state, fid);

  const latest =
    state?.latestReadinessByFieldId?.[fid] ||
    getLatestReadinessForField(state, fid) ||
    null;

  const thr =
    currentThreshold(state);

  const liveReadiness =
    Number(
      run?.readinessR ??
      run?.readiness ??
      latest?.readiness
    );

  if (!Number.isFinite(liveReadiness)){

    state._adjStatus = null;

  } else if (liveReadiness >= thr){

    state._adjStatus = 'dry';

  } else {

    state._adjStatus = 'wet';
  }

  const shownReadiness =
    Number.isFinite(
      Number(
        run?.readinessR ??
        run?.readiness
      )
    )
      ? Math.round(
          Number(
            run.readinessR ??
            run.readiness
          )
        )
      : (
          Number.isFinite(
            Number(latest?.readiness)
          )
            ? Math.round(
                Number(latest.readiness)
              )
            : '—'
        );

  const shownWetness =
    Number.isFinite(
      Number(
        run?.wetnessR ??
        run?.wetness
      )
    )
      ? Math.round(
          Number(
            run.wetnessR ??
            run.wetness
          )
        )
      : (
          Number.isFinite(
            Number(latest?.wetness)
          )
            ? Math.round(
                Number(latest.wetness)
              )
            : '—'
        );

  const shownSoil =
    Number.isFinite(
      Number(latest?.soilWetness)
    )
      ? Math.round(
          Number(latest.soilWetness)
        )
      : (
          Number.isFinite(
            Number(p?.soilWetness)
          )
            ? Math.round(
                Number(p.soilWetness)
              )
            : '—'
        );

  const shownDrain =
    Number.isFinite(
      Number(latest?.drainageIndex)
    )
      ? Math.round(
          Number(latest.drainageIndex)
        )
      : (
          Number.isFinite(
            Number(p?.drainageIndex)
          )
            ? Math.round(
                Number(p.drainageIndex)
              )
            : '—'
        );

  setText(
    'adjReadiness',
    shownReadiness
  );

  setText(
    'adjWetness',
    shownWetness
  );

  setText(
    'adjSoil',
    shownSoil === '—'
      ? '—'
      : `${shownSoil}/100`
  );

  setText(
    'adjDrain',
    shownDrain === '—'
      ? '—'
      : `${shownDrain}/100`
  );

  setText(
    'adjModelClass',
    (state._adjStatus || '—')
      .toUpperCase()
  );

  const thrEl =
    $('adjThreshold');

  if (thrEl){

    thrEl.textContent =
      String(thr);
  }

  const baseEl =
    $('adjBaseReadiness');

  if (baseEl){

    const baseReadiness =
      run?.readinessR ??
      run?.readiness ??
      latest?.readiness;

    baseEl.textContent =
      Number.isFinite(
        Number(baseReadiness)
      )
        ? String(
            Math.round(
              Number(baseReadiness)
            )
          )
        : '—';
  }
}

/* =====================================================================
   GUARD TEXT
===================================================================== */

function updateGuardText(state){

  const el =
    $('adjGuard');

  if (!el){
    return;
  }

  const feel =
    state._adjFeel;

  if (
    !(
      feel === 'wet' ||
      feel === 'dry'
    )
  ){

    el.textContent =
      'Choose Wet or Dry, then move the slider to adjust the system.';

    return;
  }

  const shownAnchor =
    clamp(
      Math.round(
        Number(
          state._adjAnchorReadiness ?? 50
        )
      ),
      0,
      100
    );

  const target =
    sliderVal();

  const pct =
    Math.round(
      (
        (
          target -
          shownAnchor
        ) /
        Math.max(1, shownAnchor)
      ) * 100
    );

  const dir =
    pct >= 0
      ? 'drier'
      : 'wetter';

  el.textContent =
    `Current shown: ${shownAnchor}. Global shift target ~${Math.abs(pct)}% ${dir}.`;
}

/* =====================================================================
   UPDATE UI
===================================================================== */

function updateUI(state){

  const locked =
    isLocked(state);

  const bWet =
    $('btnFeelWet');

  const bDry =
    $('btnFeelDry');

  const applyBtn =
    $('btnAdjApply');

  const s =
    sliderEl();

  if (bWet){

    bWet.disabled =
      locked ||
      (
        state._adjStatus === 'wet'
      );
  }

  if (bDry){

    bDry.disabled =
      locked ||
      (
        state._adjStatus === 'dry'
      );
  }

  if (s){

    s.disabled =
      locked;
  }

  if (locked){

    state._adjFeel =
      null;
  }

  const seg =
    $('feelSeg');

  if (seg){

    seg
      .querySelectorAll('.segbtn')
      .forEach(btn=>{

        const bf =
          btn.getAttribute(
            'data-feel'
          );

        btn.classList.toggle(
          'on',
          bf === state._adjFeel
        );
      });
  }

  const box =
    $('intensityBox');

  const opposite =
    (
      state._adjStatus === 'wet' &&
      state._adjFeel === 'dry'
    ) ||
    (
      state._adjStatus === 'dry' &&
      state._adjFeel === 'wet'
    );

  if (box){

    box.classList.toggle(
      'pv-hide',
      !opposite
    );
  }

  const title =
    $('intensityTitle');

  const left =
    $('intensityLeft');

  const right =
    $('intensityRight');

  if (opposite){

    if (
      state._adjStatus === 'wet'
    ){

      if (title){

        title.textContent =
          'How DRY is it?';
      }

      if (left){

        left.textContent =
          'Slightly drier';
      }

      if (right){

        right.textContent =
          'Extremely drier';
      }

    } else {

      if (title){

        title.textContent =
          'How WET is it?';
      }

      if (left){

        left.textContent =
          'Slightly wetter';
      }

      if (right){

        right.textContent =
          'Extremely wetter';
      }
    }
  }

  const hint =
    $('adjHint');

  if (hint){

    const thr =
      currentThreshold(state);

    const band =
      clamp(
        Math.round(
          Number(
            STATUS_HYSTERESIS
          )
        ),
        0,
        10
      );

    if (locked){

      hint.textContent =
        'Global shift is locked (72h rule).';

    } else if (
      state._adjStatus === 'wet'
    ){

      hint.textContent =
        `This reference field is WET for the current operation (Readiness below threshold ${thr}). ` +
        `Only “Dry” is allowed. (Stability band ±${band} around threshold)`;

    } else if (
      state._adjStatus === 'dry'
    ){

      hint.textContent =
        `This reference field is DRY for the current operation (Readiness at/above threshold ${thr}). ` +
        `Only “Wet” is allowed. (Stability band ±${band} around threshold)`;

    } else {

      hint.textContent =
        'Choose Wet or Dry.';
    }
  }

  if (applyBtn){

    const hasChoice =
      (
        state._adjFeel === 'wet' ||
        state._adjFeel === 'dry'
      );

    applyBtn.disabled =
      locked ||
      !hasChoice;
  }

  updateGuardText(state);
}

/* =====================================================================
   OPEN
===================================================================== */

async function openAdjust(state){

  await loadLatestReadiness(
    state,
    { force:true }
  );

  if (
    !state.selectedFieldId &&
    (state.fields || []).length
  ){

    state.selectedFieldId =
      state.fields[0].id;
  }

  const f =
    getSelectedField(state);

  if (!f){
    return;
  }

  updateAdjustHeader(state);

  const latest =
    getLatestReadinessForField(
      state,
      f.id
    );

  const readiness =
    Number(
      latest?.readiness ?? 50
    );

  const thr =
    currentThreshold(state);

  if (readiness >= thr){

    state._adjStatus =
      'dry';

  } else {

    state._adjStatus =
      'wet';
  }

  state._adjFeel =
    null;

  state._adjAnchorReadiness =
    clamp(
      Math.round(readiness),
      0,
      100
    );

  setAnchor(
    state,
    state._adjAnchorReadiness
  );

  setSliderVal(
    state._adjAnchorReadiness
  );

  updatePills(
    state,
    latest
  );

  updateUI(state);

  const back =
    document.getElementById(
      'adjustBackdrop'
    );

  if (back){

    back.classList.remove(
      'pv-hide'
    );
  }
}

/* =====================================================================
   CLOSE
===================================================================== */

function closeAdjust(){

  const back =
    document.getElementById(
      'adjustBackdrop'
    );

  if (back){

    back.classList.add(
      'pv-hide'
    );
  }
}

/* =====================================================================
   PUBLIC
===================================================================== */

export async function openGlobalCalibration(
  state
){

  await openAdjust(state);
}

export function initGlobalCalibration(
  state
){

  const hot =
    document.getElementById(
      'fieldsTitle'
    );

  if (hot){

    hot.onclick =
      async (e)=>{

        e.preventDefault();
        e.stopPropagation();

        await openAdjust(state);
      };
  }

  const btnX =
    $('btnAdjX');

  if (btnX){

    btnX.onclick =
      ()=> closeAdjust();
  }

  const btnCancel =
    $('btnAdjCancel');

  if (btnCancel){

    btnCancel.onclick =
      ()=> closeAdjust();
  }

  const seg =
    $('feelSeg');

  if (seg){

    seg.onclick =
      (e)=>{

        const btn =
          e.target.closest(
            'button[data-feel]'
          );

        if (!btn){
          return;
        }

        const feel =
          btn.getAttribute(
            'data-feel'
          );

        if (
          feel !== 'wet' &&
          feel !== 'dry'
        ){
          return;
        }

        if (
          state._adjStatus === 'wet'
        ){

          state._adjFeel =
            'dry';

        } else if (
          state._adjStatus === 'dry'
        ){

          state._adjFeel =
            'wet';
        }

        const box =
          $('intensityBox');

        if (box){

          box.classList.remove(
            'pv-hide'
          );
        }

        updateUI(state);
      };
  }

  const s =
    sliderEl();

  if (s){

    s.oninput =
      ()=>{

        updateGuardText(state);
      };
  }
}