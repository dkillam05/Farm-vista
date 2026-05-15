/* =====================================================================
/Farm-vista/js/field-readiness/eta-helper.js  (FULL FILE)
Rev: 2026-05-15-backend-eta-days-source

Field ETA Helper

✅ Listens for "fr:eta-help"
✅ Opens FarmVista-style modal explaining ETA
✅ Uses NEW backend ETA source:
   field_conditions_current/{fieldId}/daily/{latestDate}
   → eta.etaDays
✅ No frontend ETA physics
✅ No formula.js
✅ No model.etaToThreshold()
✅ Tile helper and render can now use same backend ETA buckets
✅ Shows:
   - Snapshot
   - Backend ETA summary
   - ETA day buckets
   - Forecast/rain/readiness gain details
===================================================================== */
'use strict';

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

function safeObj(x){
  return x && typeof x === 'object'
    ? x
    : null;
}

function safeStr(x, fallback = ''){
  if (x === undefined || x === null) return fallback;
  const s = String(x);
  return s ? s : fallback;
}

function safeNum(v, fallback = null){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 2){
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function compactEtaText(txt, horizonHours){
  const s = String(txt || '').trim();
  if (!s) return '';

  let m = s.match(/~\s*(\d+)\s*hours/i);
  if (!m) m = s.match(/~\s*(\d+)\s*h\b/i);

  if (m){
    const n = Number(m[1]);
    if (Number.isFinite(n)){
      return n <= horizonHours
        ? `~${Math.round(n)}h`
        : `>${Math.round(horizonHours)}h`;
    }
  }

  if (
    /greater\s+than/i.test(s) ||
    />\s*\d+/.test(s) ||
    /beyond/i.test(s) ||
    /over\s+\d+/i.test(s)
  ){
    return `>${Math.round(horizonHours) || 168}h`;
  }

  return s;
}

/* =====================================================================
   Firebase modular loader
===================================================================== */
let __fbModPromise = null;

async function getFirebaseMod(){
  if (__fbModPromise) return __fbModPromise;

  __fbModPromise = (async()=>{
    try{
      const mod = await import('/Farm-vista/js/firebase-init.js');
      if (mod && mod.ready) await mod.ready;
      return mod;
    }catch(e){
      console.warn('[ETA Helper] Firebase load failed:', e);
      return null;
    }
  })();

  return __fbModPromise;
}

/* =====================================================================
   Backend ETA debug reads
===================================================================== */
async function readDailyEtaDoc(fieldId){
  const mod = await getFirebaseMod();

  if (
    !mod ||
    !(mod.getFirestore && mod.getDoc && mod.doc)
  ){
    return null;
  }

  const fid = safeStr(fieldId);
  if (!fid) return null;

  const dateISO = todayISO();

  try{
    const db = mod.getFirestore();

    const ref = mod.doc(
      db,
      'field_conditions_current',
      fid,
      'daily',
      dateISO
    );

    const snap = await mod.getDoc(ref);

    if (snap && snap.exists && snap.exists()){
      return {
        id: dateISO,
        dateISO,
        source: 'field_conditions_current/daily/today',
        data: snap.data() || {}
      };
    }
  }catch(e){
    console.warn('[ETA Helper] Today ETA doc read failed:', e);
  }

  return null;
}

async function readCurrentConditionsDoc(fieldId){
  const mod = await getFirebaseMod();

  if (
    !mod ||
    !(mod.getFirestore && mod.getDoc && mod.doc)
  ){
    return null;
  }

  const fid = safeStr(fieldId);
  if (!fid) return null;

  try{
    const db = mod.getFirestore();

    const ref = mod.doc(
      db,
      'field_conditions_current',
      fid
    );

    const snap = await mod.getDoc(ref);

    if (!snap || !snap.exists || !snap.exists()){
      return null;
    }

    return snap.data() || null;
  }catch(e){
    console.warn('[ETA Helper] Current conditions read failed:', e);
    return null;
  }
}

async function loadBackendEta(fieldId){
  const [dailyDoc, currentDoc] = await Promise.all([
    readDailyEtaDoc(fieldId),
    readCurrentConditionsDoc(fieldId)
  ]);

  const dailyData = safeObj(dailyDoc && dailyDoc.data) || {};
  const eta = safeObj(dailyData.eta) || safeObj(currentDoc && currentDoc.eta) || {};

  const etaDays =
    Array.isArray(eta.etaDays)
      ? eta.etaDays
      : [];

  return {
    fieldId: safeStr(fieldId),
    dailyDateISO: safeStr(dailyDoc && dailyDoc.dateISO),
    source: safeStr(dailyDoc && dailyDoc.source) || 'field_conditions_current',
    dailyData,
    currentDoc: safeObj(currentDoc) || {},
    eta,
    etaDays
  };
}

/* =====================================================================
   ETA crossing helper
===================================================================== */
function calculateEtaFromDays({
  readinessNow,
  threshold,
  etaDays,
  horizonHours = 168
}){
  const rNow = safeNum(readinessNow);
  const thr = safeNum(threshold);

  if (rNow === null || thr === null){
    return {
      status: 'missing_inputs',
      text: 'ETA can not be calculated at this time',
      hours: null
    };
  }

  if (rNow >= thr){
    return {
      status: 'ready_now',
      text: 'Ready now',
      hours: 0
    };
  }

  const need = thr - rNow;
  let gained = 0;
  let elapsed = 0;

  const days = Array.isArray(etaDays) ? etaDays : [];

  for (const day of days){
    const gain = safeNum(day && day.readinessGain, 0);
    const hours = safeNum(day && day.hours, 24);
    const rate = safeNum(day && day.drydownPointsPerHour, null);

    if (gain <= 0 || rate === null || rate <= 0){
      elapsed += hours;
      continue;
    }

    if (gained + gain >= need){
      const remaining = need - gained;
      const partialHours = remaining / rate;
      const total = elapsed + partialHours;

      if (total > horizonHours){
        return {
          status: 'beyond_horizon',
          text: `>${Math.round(horizonHours)}h`,
          hours: horizonHours
        };
      }

      return {
        status: 'reaches_threshold',
        text: `~${Math.max(0, Math.round(total))}h`,
        hours: total
      };
    }

    gained += gain;
    elapsed += hours;
  }

  return {
    status: 'not_reached',
    text: `>${Math.round(horizonHours)}h`,
    hours: null
  };
}

/* =====================================================================
   Modal DOM
===================================================================== */
function ensureModal(){
  let bd = document.getElementById('fvEtaHelpBackdrop');
  if (bd) return bd;

  bd = document.createElement('div');
  bd.id = 'fvEtaHelpBackdrop';
  bd.className = 'modal-backdrop pv-hide';
  bd.setAttribute('role', 'dialog');
  bd.setAttribute('aria-modal', 'true');
  bd.setAttribute('aria-labelledby', 'fvEtaHelpTitle');

  bd.innerHTML = `
    <div class="modal">
      <div class="modal-h">
        <h3 id="fvEtaHelpTitle">ETA Helper</h3>

        <button class="xbtn" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
          </svg>
        </button>

        <div class="muted" style="font-size:12px; margin-top:4px;" id="fvEtaHelpSub">—</div>
      </div>

      <div class="modal-b" id="fvEtaHelpBody">
        <div class="help">Loading ETA details…</div>
      </div>
    </div>
  `;

  bd._lockScroll = ()=>{
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  };

  bd._unlockScroll = ()=>{
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  };

  const close = ()=>{
    bd.classList.add('pv-hide');
    bd._unlockScroll();
  };

  bd.querySelector('.xbtn')?.addEventListener('click', close);

  bd.addEventListener('click', e=>{
    if (e.target === bd) close();
  });

  document.addEventListener('keydown', e=>{
    if (
      e.key === 'Escape' &&
      !bd.classList.contains('pv-hide')
    ){
      close();
    }
  });

  document.body.appendChild(bd);

  return bd;
}

function showModal(){
  const bd = ensureModal();

  bd.classList.remove('pv-hide');
  bd._lockScroll();

  const body = bd.querySelector('#fvEtaHelpBody');

  if (body){
    body.style.maxHeight = '70vh';
    body.style.overflowY = 'auto';
    body.style.overscrollBehavior = 'contain';
    body.style.webkitOverflowScrolling = 'touch';
  }

  return bd;
}

/* =====================================================================
   HTML builders
===================================================================== */
function buildHelperText(){
  return `
    <div style="font-size:14px; line-height:1.35;">
      <b>What does this ETA mean?</b><br/>
      This ETA is now driven by the <b>backend forecast projection</b>.
      FarmVista starts with the current field readiness, then walks forward through
      the saved forecast ETA buckets from Firestore.
      Rain days can reduce readiness, and dry days can increase readiness.
    </div>
  `;
}

function buildSnapshotHtml({
  opKey,
  threshold,
  readinessNow,
  etaText,
  horizon,
  source,
  backendEta
}){
  const eta = safeObj(backendEta && backendEta.eta) || {};

  return `
    <div style="margin-top:14px;">
      <div style="font-weight:900; font-size:13px; margin-bottom:8px;">Snapshot</div>

      <div class="help" style="display:grid; gap:6px;">
        <div><b>Operation:</b> ${esc(opKey || '—')}</div>
        <div><b>Threshold:</b> ${Number.isFinite(Number(threshold)) ? esc(String(threshold)) : '—'}</div>
        <div><b>Readiness now:</b> ${Number.isFinite(Number(readinessNow)) ? esc(String(round(readinessNow, 2))) : '—'}</div>
        <div><b>ETA:</b> ${esc(etaText || '—')}</div>
        <div><b>Horizon:</b> ${esc(String(horizon))}h</div>
        <div><b>Backend source:</b> ${esc(source || '—')}</div>
        <div><b>Backend projected readiness:</b> ${eta.projectedReadiness != null ? esc(String(round(eta.projectedReadiness, 2))) : '—'}</div>
        <div><b>Backend total gain:</b> ${eta.readinessGain != null ? esc(String(round(eta.readinessGain, 2))) : '—'}</div>

        <div class="muted" style="font-size:12px;">
          Source priority: field_conditions_current daily ETA buckets → passed tile ETA fallback
        </div>
      </div>
    </div>
  `;
}

function buildEtaDaysTable(etaDays){
  const days = Array.isArray(etaDays) ? etaDays : [];

  if (!days.length){
    return `
      <div class="help muted" style="margin-top:14px;">
        No backend ETA day buckets were found yet. Wait for the next scheduled backend run.
      </div>
    `;
  }

  const trs = days.map(day=>{
    const gain = safeNum(day.readinessGain, 0);
    const rate = safeNum(day.drydownPointsPerHour, 0);
    const rain = safeNum(day.rainIn, 0);

    const gainTxt =
      gain > 0
        ? `+${round(gain, 2)}`
        : String(round(gain, 2));

    const rateTxt =
      rate > 0
        ? `+${round(rate, 4)}`
        : String(round(rate, 4));

    return `
      <tr>
        <td class="right mono">${esc(day.day ?? '—')}</td>
        <td class="mono">${esc(day.dateISO || '—')}</td>
        <td class="right mono">${esc(day.hours ?? '—')}</td>
        <td class="right mono">${esc(round(day.readinessStart, 2) ?? '—')}</td>
        <td class="right mono">${esc(round(day.readinessEnd, 2) ?? '—')}</td>
        <td class="right mono">${esc(gainTxt)}</td>
        <td class="right mono">${esc(rateTxt)}</td>
        <td class="right mono">${esc(round(rain, 2))}</td>
        <td class="mono">${esc(day.rainSource || '—')}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="margin-top:14px;">
      <div style="font-weight:900; font-size:13px; margin-bottom:8px;">Backend ETA buckets</div>

      <div class="table-scroll" style="overflow-x:auto;">
        <table aria-label="Backend ETA Buckets">
          <thead>
            <tr>
              <th class="right">Day</th>
              <th>Date</th>
              <th class="right">Hours</th>
              <th class="right">Start</th>
              <th class="right">End</th>
              <th class="right">Gain</th>
              <th class="right">Pts/hr</th>
              <th class="right">Rain</th>
              <th>Source</th>
            </tr>
          </thead>

          <tbody>
            ${trs}
          </tbody>
        </table>
      </div>

      <div class="help muted" style="margin-top:8px;">
        Positive gain means the field is drying. Negative gain means forecast rain/wet conditions are reducing readiness.
      </div>
    </div>
  `;
}

function buildDebugSummary(backendEta){
  const eta = safeObj(backendEta && backendEta.eta) || {};

  return `
    <div style="margin-top:14px;">
      <div style="font-weight:900; font-size:13px; margin-bottom:8px;">Backend ETA Summary</div>

      <div class="help" style="display:grid; gap:6px;">
        <div><b>Current readiness:</b> ${eta.currentReadiness != null ? esc(String(round(eta.currentReadiness, 3))) : '—'}</div>
        <div><b>Projected readiness:</b> ${eta.projectedReadiness != null ? esc(String(round(eta.projectedReadiness, 3))) : '—'}</div>
        <div><b>Total readiness gain:</b> ${eta.readinessGain != null ? esc(String(round(eta.readinessGain, 3))) : '—'}</div>
        <div><b>Projection hours:</b> ${eta.projectionHours != null ? esc(String(eta.projectionHours)) : '—'}</div>
        <div><b>Average points/hour:</b> ${eta.drydownPointsPerHour != null ? esc(String(round(eta.drydownPointsPerHour, 6))) : '—'}</div>
      </div>
    </div>
  `;
}

/* =====================================================================
   Event listener
===================================================================== */
(function wireOnce(){
  try{
    if (window.__FV_FR_ETA_HELP_WIRED__) return;

    window.__FV_FR_ETA_HELP_WIRED__ = true;

    document.addEventListener('fr:eta-help', async e=>{
      try{
        const d = e && e.detail ? e.detail : {};

        const fieldId =
          safeStr(d.fieldId);

        if (!fieldId) return;

        const bd = showModal();

        const title =
          `ETA Helper • ${d.fieldName ? String(d.fieldName) : fieldId}`;

        const titleEl =
          bd.querySelector('#fvEtaHelpTitle');

        const subEl =
          bd.querySelector('#fvEtaHelpSub');

        const body =
          bd.querySelector('#fvEtaHelpBody');

        if (titleEl) titleEl.textContent = title;

        const opKey =
          safeStr(d.opKey);

        const threshold =
          safeNum(d.threshold);

        const readinessNow =
          safeNum(d.readinessNow);

        const horizon =
          safeNum(d.horizonHours, 168);

        const passedEtaText =
          compactEtaText(
            safeStr(d.etaText),
            horizon
          );

        if (subEl){
          subEl.textContent =
            `Operation threshold: ${threshold ?? '—'} • ` +
            `Readiness now: ${readinessNow ?? '—'} • ` +
            `ETA: ${passedEtaText || 'Loading...'}`;
        }

        if (body){
          body.innerHTML = `
            ${buildHelperText()}
            <div class="help muted" style="margin-top:12px;">
              Loading backend ETA buckets from Firestore…
            </div>
          `;
        }

        const backendEta =
          await loadBackendEta(fieldId);

        const etaDays =
          Array.isArray(backendEta.etaDays)
            ? backendEta.etaDays
            : [];

        const calculated =
          calculateEtaFromDays({
            readinessNow,
            threshold,
            etaDays,
            horizonHours: horizon
          });

        const finalEtaText =
          safeStr(calculated && calculated.text) ||
          passedEtaText ||
          'ETA can not be calculated at this time';

        if (subEl){
          subEl.textContent =
            `Operation threshold: ${threshold ?? '—'} • ` +
            `Readiness now: ${readinessNow ?? '—'} • ` +
            `ETA: ${finalEtaText}`;
        }

        if (body){
          body.innerHTML = `
            ${buildHelperText()}

            ${buildSnapshotHtml({
              opKey,
              threshold,
              readinessNow,
              etaText: finalEtaText,
              horizon,
              source: backendEta.source,
              backendEta
            })}

            ${buildDebugSummary(backendEta)}

            ${buildEtaDaysTable(etaDays)}
          `;
        }
      }catch(err){
        console.warn('[ETA Helper] failed:', err);
      }
    });
  }catch(err){
    console.warn('[ETA Helper] wire failed:', err);
  }
})();
