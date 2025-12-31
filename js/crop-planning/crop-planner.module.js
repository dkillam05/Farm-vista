/* =====================================================================
/Farm-vista/js/crop-planning/crop-planner.module.js  (FULL FILE)
Rev: 2025-12-31i

PHONE FIX (VIEW-ONLY):
✅ Completely different “viewer” layout rules when opts.viewOnly=true
   - Filters stack 1-column
   - KPI line wraps cleanly
   - NO nested scroll traps (one natural page scroll)
   - Farm lanes become clean accordions
   - Buckets become 1-column (Unplanned / Corn / Beans stacked)
   - Field rows become 2-column (name + acres)
   - ALL grips/drag affordances hidden on phone

DESKTOP:
✅ unchanged behavior/layout (DnD + bulk + lock)

REQUIRES (DnD drop fix):
✅ /Farm-vista/js/crop-planning/crop-planning-dnd.js  Rev: 2025-12-31b
===================================================================== */
'use strict';

import { initDB, loadFarms, loadFields, loadPlansForYear, setPlan, clearPlan } from './crop-planning-data.js';
import { wireDnd } from './crop-planning-dnd.js';

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US');
const norm = (s) => String(s || '').trim().toLowerCase();

function esc(s){
  return String(s||'').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function gripSvg(){
  return `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="9" cy="7" r="1.6" fill="currentColor"></circle>
      <circle cx="15" cy="7" r="1.6" fill="currentColor"></circle>
      <circle cx="9" cy="12" r="1.6" fill="currentColor"></circle>
      <circle cx="15" cy="12" r="1.6" fill="currentColor"></circle>
      <circle cx="9" cy="17" r="1.6" fill="currentColor"></circle>
      <circle cx="15" cy="17" r="1.6" fill="currentColor"></circle>
    </svg>
  `;
}

function chevSvg(){
  return `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6"></path>
    </svg>
  `;
}

function lockSvg(locked){
  return locked ? `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2"></rect>
      <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
    </svg>
  ` : `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2"></rect>
      <path d="M8 11V8a4 4 0 0 1 7.5-1.9"></path>
      <path d="M16 3l5 5"></path>
    </svg>
  `;
}

/* ---------- Firestore modular helpers (best-effort) ---------- */
async function getFirestoreFns(){
  const g = globalThis || window;

  if (g.FV?.firestore?.doc && g.FV?.firestore?.getDoc && g.FV?.firestore?.setDoc){
    return g.FV.firestore;
  }

  if (g.doc && g.getDoc && g.setDoc){
    return {
      doc: g.doc,
      getDoc: g.getDoc,
      setDoc: g.setDoc,
      onSnapshot: g.onSnapshot,
      serverTimestamp: g.serverTimestamp
    };
  }

  try{
    const m = await import('/Farm-vista/js/firebase-init.js');
    if (m.doc && m.getDoc && m.setDoc){
      return {
        doc: m.doc,
        getDoc: m.getDoc,
        setDoc: m.setDoc,
        onSnapshot: m.onSnapshot,
        serverTimestamp: m.serverTimestamp
      };
    }
  }catch{}

  return null;
}

function getUserTag(){
  const g = globalThis || window;
  const email =
    g.FV?.user?.email ||
    g.FV?.auth?.currentUser?.email ||
    g.firebase?.auth?.().currentUser?.email ||
    '';
  return String(email || '').trim();
}

export async function mount(hostEl, opts = {}){
  const viewOnly = !!opts.viewOnly;

  // local state per mount
  let db = null;
  let farms = [];
  let fields = [];
  let plans = new Map();
  let farmNameById = new Map();
  let currentYear = '2026';

  const OPEN_KEY = 'fv:cropplan:lanesOpen:v1';
  let laneOpen = {};
  try{ laneOpen = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; }catch{ laneOpen = {}; }
  const setLaneOpen = (farmId, open) => {
    laneOpen[farmId] = !!open;
    try{ localStorage.setItem(OPEN_KEY, JSON.stringify(laneOpen)); }catch{}
  };

  // ---- GLOBAL LOCK state ----
  let fs = null;               // firestore fns
  let isLocked = false;        // current year's lock value
  let lockUnsub = null;        // onSnapshot unsubscribe
  let lockPollT = null;        // polling interval handle

  const lockPath = (year) => ['crop_plan_locks', String(year)];
  const canDragNow = () => (!viewOnly && !isLocked);

  // ✅ FIX: add data-dropzone="1" so farm drags can drop here
  function bulkBox(label, crop){
    return `
      <div class="hbox" data-header-drop="1" data-dropzone="1" data-crop="${crop}"
           style="border:1px dashed color-mix(in srgb, var(--border) 60%, transparent);
                  border-radius:12px;
                  padding:10px 10px;
                  font-weight:900;
                  display:flex;
                  align-items:center;
                  justify-content:space-between;
                  user-select:none;
                  background: color-mix(in srgb, var(--surface) 92%, rgba(47,108,60,.05));">
        <span>${label}</span>
        <span class="pill" style="font-size:11px;">drop farm</span>
      </div>
    `;
  }

  // render skeleton inside host
  hostEl.innerHTML = `
    <section class="cpRoot ${viewOnly ? 'viewOnly' : ''}" style="padding:16px;">
      <style>
        /* ==========================================================
           VIEW-ONLY PHONE MODE: make this a clean READ-ONLY VIEWER
           (Overrides inline styles with !important)
        ========================================================== */
        .cpRoot.viewOnly .row3{ grid-template-columns:1fr !important; }
        .cpRoot.viewOnly .kpi-line{ gap:8px !important; padding:10px 10px !important; }
        .cpRoot.viewOnly .kpi-line .kpi{ margin-left:0 !important; }
        .cpRoot.viewOnly .boardScroll{
          max-height:none !important;
          overflow:visible !important;
          padding:10px !important;
        }
        .cpRoot.viewOnly .farmLaneHead{
          grid-template-columns: 1fr auto !important;
          gap:10px !important;
        }
        .cpRoot.viewOnly .farmGrip{ display:none !important; }
        .cpRoot.viewOnly .dragGrip{ display:none !important; }
        .cpRoot.viewOnly .chev{ justify-self:end !important; }
        .cpRoot.viewOnly .farmLaneBody{ padding:10px !important; }
        .cpRoot.viewOnly .buckets{ grid-template-columns:1fr !important; gap:10px !important; }
        .cpRoot.viewOnly .bucketBody{
          max-height:none !important;
          overflow:visible !important;
          padding:10px !important;
        }
        .cpRoot.viewOnly .cardRow{
          grid-template-columns: 1fr auto !important;
          gap:10px !important;
          padding:10px !important;
        }
        .cpRoot.viewOnly .cardRow > div:nth-child(2){
          white-space:normal !important;
          overflow:visible !important;
          text-overflow:clip !important;
          line-height:1.15 !important;
        }
        .cpRoot.viewOnly .combo-panel{ max-height:70vh !important; }
        .cpRoot.viewOnly .pill{ white-space:nowrap !important; }
      </style>

      <div class="hero" style="margin:0;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:var(--shadow,0 8px 20px rgba(0,0,0,.08));overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,rgba(47,108,60,.12),transparent);">
          <div style="font-weight:900;font-size:18px;">Crop Planner</div>
          <div class="muted" style="margin-top:4px;font-weight:800;">
            ${viewOnly ? 'Phone mode: view-only (scroll to read).' : 'Desktop for drag + bulk.'}
          </div>
        </div>

        <div style="padding:16px;display:grid;gap:14px;">
          <div class="row3" style="display:grid;gap:10px;grid-template-columns:1fr 1fr 1fr;">
            <div class="field combo" style="position:relative;">
              <label style="display:block;font-weight:800;margin:0 0 6px;">Farm</label>
              <div class="combo-anchor" style="position:relative;display:inline-block;width:100%;">
                <button data-el="farmBtn" class="buttonish has-caret" type="button"
                        style="width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--card-surface,var(--surface));border:1px solid var(--border);border-radius:10px;padding:12px;outline:none;cursor:pointer;text-align:left;position:relative;padding-right:44px;user-select:none;">
                  — All farms —
                </button>
                <div data-el="farmPanel" class="combo-panel"
                     style="position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 12px 26px rgba(0,0,0,.18);z-index:9999;padding:8px;display:none;">
                  <div class="search" style="padding:4px 2px 8px;">
                    <input data-el="farmSearch" type="search" placeholder="Search farms…"
                           style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font:inherit;font-size:14px;color:var(--text);background:var(--card-surface,var(--surface));" />
                  </div>
                  <div data-el="farmList" class="list" style="max-height:52vh;overflow:auto;border-top:1px solid var(--border);"></div>
                </div>
              </div>
              <input data-el="farmId" type="hidden" />
              <input data-el="farmName" type="hidden" />
            </div>

            <div class="field">
              <label style="display:block;font-weight:800;margin:0 0 6px;">Crop Year</label>
              <select data-el="year" class="select"
                      style="width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--card-surface,var(--surface));border:1px solid var(--border);border-radius:10px;padding:12px;outline:none;">
                <option value="2026">2026</option>
                <option value="2027">2027</option>
              </select>
            </div>

            <div class="field">
              <label style="display:block;font-weight:800;margin:0 0 6px;">Search fields</label>
              <input data-el="search" class="input" type="search" placeholder="Type to filter…"
                     style="width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--card-surface,var(--surface));border:1px solid var(--border);border-radius:10px;padding:12px;outline:none;" />
              <div class="help" data-el="scopeHelp" style="font-size:13px;color:var(--muted,#67706B);margin-top:6px;font-weight:800;">Showing 0 active fields</div>
            </div>
          </div>

          <div class="kpi-line" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--card-surface,var(--surface));">
            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
              <div class="v" data-el="kpiUnplannedFields" style="font-weight:900;font-size:18px;">0</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Unplanned</div>
            </div>
            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
              <div class="v" data-el="kpiUnplannedAcres" style="font-weight:900;font-size:18px;">0.00</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Acres</div>
            </div>

            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-left:auto;">
              <div class="v" data-el="kpiCornFields" style="font-weight:900;font-size:18px;">0</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Corn</div>
            </div>
            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
              <div class="v" data-el="kpiCornAcres" style="font-weight:900;font-size:18px;">0.00</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Acres</div>
            </div>

            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-left:auto;">
              <div class="v" data-el="kpiSoyFields" style="font-weight:900;font-size:18px;">0</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Beans</div>
            </div>
            <div class="kpi" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
              <div class="v" data-el="kpiSoyAcres" style="font-weight:900;font-size:18px;">0.00</div>
              <div class="l" style="font-weight:800;color:var(--muted,#67706B);font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Acres</div>
            </div>
          </div>

          <!-- Bulk farm drop header (hidden on viewOnly) -->
          <div data-el="bulkWrap" style="display:${viewOnly ? 'none' : 'grid'};gap:8px;">
            <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
              <div style="display:flex;gap:8px;align-items:center;min-width:0;">
                <div style="width:28px;height:28px;border-radius:10px;border:1px solid var(--border);display:grid;place-items:center;color:var(--accent);flex:0 0 auto;">⇄</div>
                <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;min-width:0;">
                  <div style="font-weight:900;white-space:nowrap;">Bulk: drop a FARM here</div>
                  <div class="muted" style="font-weight:800;font-size:12px;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap;">
                    Moves every active field in that farm
                  </div>
                </div>
              </div>

              <button data-el="lockBtn" type="button"
                      title="Global lock (prevents drag moves for everyone)"
                      style="display:inline-flex;align-items:center;gap:8px;
                             border:1px solid var(--border);
                             background:var(--card-surface,var(--surface));
                             color:var(--text);
                             border-radius:999px;
                             padding:7px 10px;
                             font-weight:900;
                             cursor:pointer;
                             user-select:none;
                             flex:0 0 auto;">
                <span data-el="lockIcon" style="display:grid;place-items:center;"></span>
                <span data-el="lockLabel" style="font-size:12px;letter-spacing:.2px;text-transform:uppercase;">Unlocked</span>
              </button>
            </div>

            <div data-el="laneHeader" class="laneHeader"
                 style="border:1px solid var(--border);border-radius:14px;background:var(--card-surface,var(--surface));
                        padding:10px 12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:center;">
              ${bulkBox('Unplanned', '')}
              ${bulkBox('Corn', 'corn')}
              ${bulkBox('Soybeans', 'soybeans')}
            </div>
          </div>

          <div class="board" style="border:1px solid var(--border);border-radius:14px;background:var(--card-surface,var(--surface));overflow:hidden;">
            <div data-el="boardScroll" class="boardScroll" style="max-height:64vh;overflow:auto;padding:12px;display:grid;gap:12px;-webkit-overflow-scrolling:touch;"></div>
          </div>
        </div>
      </div>
    </section>

    <div data-el="toast" style="position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);background:#2F6C3C;color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;box-shadow:0 10px 24px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .18s ease, transform .18s ease;z-index:10000;white-space:nowrap;"></div>
  `;

  // element getters scoped to host
  const q = (sel) => hostEl.querySelector(sel);
  const el = {
    farmBtn: q('[data-el="farmBtn"]'),
    farmPanel: q('[data-el="farmPanel"]'),
    farmList: q('[data-el="farmList"]'),
    farmSearch: q('[data-el="farmSearch"]'),
    farmId: q('[data-el="farmId"]'),
    farmName: q('[data-el="farmName"]'),
    year: q('[data-el="year"]'),
    lockBtn: q('[data-el="lockBtn"]'),
    lockIcon: q('[data-el="lockIcon"]'),
    lockLabel: q('[data-el="lockLabel"]'),
    search: q('[data-el="search"]'),
    scopeHelp: q('[data-el="scopeHelp"]'),
    laneHeader: q('[data-el="laneHeader"]'),
    boardScroll: q('[data-el="boardScroll"]'),
    toast: q('[data-el="toast"]'),
    kpiUnplannedFields: q('[data-el="kpiUnplannedFields"]'),
    kpiUnplannedAcres: q('[data-el="kpiUnplannedAcres"]'),
    kpiCornFields: q('[data-el="kpiCornFields"]'),
    kpiCornAcres: q('[data-el="kpiCornAcres"]'),
    kpiSoyFields: q('[data-el="kpiSoyFields"]'),
    kpiSoyAcres: q('[data-el="kpiSoyAcres"]'),
  };

  const hasLockUI = !!el.lockBtn;

  const controller = new AbortController();
  const { signal } = controller;

  const toast = (msg) => {
    el.toast.textContent = msg;
    el.toast.style.opacity = '1';
    el.toast.style.transform = 'translate(-50%,0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>{
      el.toast.style.opacity = '0';
      el.toast.style.transform = 'translate(-50%,12px)';
    }, 900);
  };

  const closeCombo = () => { el.farmPanel.style.display = 'none'; };

  hostEl.ownerDocument.addEventListener('click', (e)=>{
    if (!hostEl.contains(e.target)) return;
    if (e.target.closest('.combo')) return;
    closeCombo();
  }, { signal });

  const renderFarmList = (qtext) => {
    const qq = norm(qtext);
    const items = farms
      .filter(f => !qq || norm(f.name).includes(qq))
      .map(f => `<div class="combo-item" data-id="${esc(f.id)}"><div>${esc(f.name)}</div><div></div></div>`)
      .join('');
    el.farmList.innerHTML =
      `<div class="combo-item" data-id=""><div><strong>All farms</strong></div><div></div></div>` +
      (items || `<div class="combo-empty">(no matches)</div>`);
  };

  el.farmBtn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const isOpen = el.farmPanel.style.display === 'block';
    el.farmPanel.style.display = isOpen ? 'none' : 'block';
    el.farmSearch.value = '';
    renderFarmList('');
    setTimeout(()=> el.farmSearch.focus(), 0);
  }, { signal });

  el.farmPanel.addEventListener('click', (e)=> e.stopPropagation(), { signal });
  el.farmPanel.addEventListener('mousedown', (e)=> e.stopPropagation(), { signal });

  el.farmSearch.addEventListener('input', ()=> renderFarmList(el.farmSearch.value), { signal });

  el.farmList.addEventListener('mousedown', (e)=>{
    const row = e.target.closest('.combo-item'); if(!row) return;
    const id = row.dataset.id || '';
    if(!id){
      el.farmId.value = '';
      el.farmName.value = '';
      el.farmBtn.textContent = '— All farms —';
    }else{
      const f = farms.find(x=> x.id === id);
      el.farmId.value = f.id;
      el.farmName.value = f.name;
      el.farmBtn.textContent = f.name;
    }
    closeCombo();
    renderAll(true);
  }, { signal });

  const renderLockUI = () => {
    if (!hasLockUI) return;
    el.lockIcon.innerHTML = lockSvg(isLocked);
    el.lockLabel.textContent = isLocked ? 'Locked' : 'Unlocked';
    el.lockBtn.style.borderColor = isLocked
      ? 'color-mix(in srgb, var(--border) 60%, rgba(47,108,60,.25))'
      : 'var(--border)';
  };

  const stopLockWatch = () => {
    try{ if (typeof lockUnsub === 'function') lockUnsub(); }catch{}
    lockUnsub = null;
    if (lockPollT) clearInterval(lockPollT);
    lockPollT = null;
  };

  const readLockOnce = async (year) => {
    if (!fs || !db) return false;
    try{
      const ref = fs.doc(db, ...lockPath(year));
      const snap = await fs.getDoc(ref);
      const data = snap?.data?.() || {};
      return !!data.locked;
    }catch{
      return false;
    }
  };

  const writeLock = async (year, nextLocked) => {
    if (!fs || !db) throw new Error('Missing Firestore fns/db');
    const ref = fs.doc(db, ...lockPath(year));
    const payload = {
      locked: !!nextLocked,
      updatedAt: fs.serverTimestamp ? fs.serverTimestamp() : new Date(),
      updatedBy: getUserTag() || ''
    };
    await fs.setDoc(ref, payload, { merge: true });
  };

  const startLockWatch = async (year) => {
    stopLockWatch();

    if (!fs || !db){
      isLocked = false;
      renderLockUI();
      return;
    }

    if (typeof fs.onSnapshot === 'function'){
      try{
        const ref = fs.doc(db, ...lockPath(year));
        lockUnsub = fs.onSnapshot(ref, (snap)=>{
          const data = snap?.data?.() || {};
          const next = !!data.locked;
          const changed = next !== isLocked;
          isLocked = next;
          renderLockUI();
          if (changed) renderAll(true);
        }, async ()=>{
          stopLockWatch();
          isLocked = await readLockOnce(year);
          renderLockUI();
          renderAll(true);
          lockPollT = setInterval(async ()=>{
            const v = await readLockOnce(year);
            if (v !== isLocked){
              isLocked = v;
              renderLockUI();
              renderAll(true);
            }
          }, 6000);
        });

        isLocked = await readLockOnce(year);
        renderLockUI();
        return;
      }catch{}
    }

    isLocked = await readLockOnce(year);
    renderLockUI();
    lockPollT = setInterval(async ()=>{
      const v = await readLockOnce(year);
      if (v !== isLocked){
        isLocked = v;
        renderLockUI();
        renderAll(true);
      }
    }, 6000);
  };

  el.year.value = '2026';
  currentYear = '2026';

  el.year.addEventListener('change', async ()=>{
    currentYear = String(el.year.value || '2026');
    await startLockWatch(currentYear);

    plans = await loadPlansForYear(db, currentYear);
    renderAll(true);
    toast(`Year: ${currentYear}${isLocked ? ' (Locked)' : ''}`);
  }, { signal });

  const cropForField = (fieldId) => {
    const c = norm(plans.get(fieldId)?.crop);
    if (c === 'corn' || c === 'soybeans') return c;
    return '';
  };

  const getShownFields = () => {
    const farmId = String(el.farmId.value || '').trim();
    const qtext = norm(el.search.value);

    return fields.filter(f=>{
      if (norm(f.status) !== 'active') return false;
      if (farmId && f.farmId !== farmId) return false;
      if (qtext && !norm(f.name).includes(qtext)) return false;
      return true;
    });
  };

  const renderBucket = (farmId, title, crop, arr, acres) => {
    const canDrag = canDragNow();
    const draggable = canDrag ? 'true' : 'false';

    const rows = arr.length ? arr.map(f=>{
      return `
        <div class="cardRow" data-field-id="${esc(f.id)}" data-farm-id="${esc(farmId)}" data-crop="${esc(crop)}"
             style="border:1px solid var(--border);border-radius:12px;background:var(--surface);padding:10px;display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;">
          <div class="dragGrip" data-drag-type="field" draggable="${draggable}"
               style="width:22px;height:22px;border:1px solid var(--border);border-radius:8px;display:grid;place-items:center;color:var(--muted,#67706B);cursor:${canDrag?'grab':'not-allowed'};opacity:${canDrag?'1':'.35'};">
            ${gripSvg()}
          </div>
          <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.name)}</div>
          <div class="pill">${fmt2.format(Number(f.tillable||0))} ac</div>
        </div>
      `;
    }).join('') : `<div class="muted" style="font-weight:900">—</div>`;

    return `
      <div class="bucket" data-dropzone="1" data-crop="${esc(crop)}" data-farm-id="${esc(farmId)}"
           style="border:1px solid var(--border);border-radius:12px;background:var(--card-surface,var(--surface));overflow:hidden;">
        <div class="bucketHead" style="padding:10px 10px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-weight:900;">${esc(title)}</div>
          <div style="font-size:12px;color:var(--muted,#67706B);font-weight:900;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap;">
            ${fmt0.format(arr.length)} • ${fmt2.format(acres)} ac
          </div>
        </div>
        <div class="bucketBody"
             style="padding:10px;display:grid;gap:10px;max-height:260px;overflow:auto;-webkit-overflow-scrolling:touch;">
          ${rows}
        </div>
      </div>
    `;
  };

  const renderAll = (preserveScroll=false) => {
    const list = getShownFields();
    el.scopeHelp.textContent = `Showing ${fmt0.format(list.length)} active fields${isLocked ? ' • Locked' : ''}`;

    let unCnt=0, coCnt=0, soCnt=0;
    let unAc=0, coAc=0, soAc=0;

    const byFarm = new Map();
    for(const f of list){
      const fid = String(f.farmId||'');
      const nm = farmNameById.get(fid) || '(Unknown Farm)';
      if(!byFarm.has(fid)) byFarm.set(fid, { farmId: fid, farmName: nm, fields: [] });
      byFarm.get(fid).fields.push(f);

      const b = cropForField(f.id);
      const a = Number(f.tillable||0);
      if(b === 'corn'){ coCnt++; coAc += a; }
      else if(b === 'soybeans'){ soCnt++; soAc += a; }
      else { unCnt++; unAc += a; }
    }

    el.kpiUnplannedFields.textContent = fmt0.format(unCnt);
    el.kpiUnplannedAcres.textContent  = fmt2.format(unAc);
    el.kpiCornFields.textContent      = fmt0.format(coCnt);
    el.kpiCornAcres.textContent       = fmt2.format(coAc);
    el.kpiSoyFields.textContent       = fmt0.format(soCnt);
    el.kpiSoyAcres.textContent        = fmt2.format(soAc);

    const farmsArr = Array.from(byFarm.values()).sort((a,b)=> a.farmName.localeCompare(b.farmName));
    const defaultOpen = !!el.farmId.value;

    const snap = preserveScroll ? {
      boardTop: el.boardScroll.scrollTop,
      buckets: Object.fromEntries([...hostEl.querySelectorAll('.bucketBody')].map(body=>{
        const bucket = body.closest('[data-dropzone="1"]');
        const k = `${bucket?.dataset.farmId || ''}::${bucket?.dataset.crop || ''}`;
        return [k, body.scrollTop||0];
      }))
    } : null;

    const canDrag = canDragNow();

    el.boardScroll.innerHTML = farmsArr.map(g=>{
      g.fields.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
      const open = (laneOpen[g.farmId] != null) ? !!laneOpen[g.farmId] : defaultOpen;

      const un = [], co = [], so = [];
      let unA=0, coA=0, soA=0;
      let coN=0, soN=0;

      for(const f of g.fields){
        const b = cropForField(f.id);
        const a = Number(f.tillable||0);
        if(b === 'corn'){ co.push(f); coA+=a; coN++; }
        else if(b === 'soybeans'){ so.push(f); soA+=a; soN++; }
        else { un.push(f); unA+=a; }
      }

      const farmDrag = canDrag ? 'true' : 'false';

      const plannedBadge = (coN + soN) > 0
        ? ` <span style="color:var(--muted,#67706B);font-weight:900;">(${coN ? `Corn ${fmt0.format(coN)}` : ''}${coN && soN ? ' • ' : ''}${soN ? `Beans ${fmt0.format(soN)}` : ''})</span>`
        : '';

      return `
        <div class="farmLane" data-farm-id="${esc(g.farmId)}" data-open="${open?'1':'0'}"
             style="border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden;">
          <div class="farmLaneHead" data-farm-toggle="1"
               style="display:grid;grid-template-columns:22px 1fr auto 18px;gap:10px;align-items:center;padding:12px;border-bottom:1px solid var(--border);background:linear-gradient(90deg, rgba(0,0,0,.02), transparent);user-select:none;">
            <div class="farmGrip" data-drag-type="farm" draggable="${farmDrag}"
                 style="width:22px;height:22px;border:1px solid var(--border);border-radius:8px;display:grid;place-items:center;color:var(--muted,#67706B);cursor:${canDrag?'grab':'not-allowed'};opacity:${canDrag?'1':'.35'};">
              ${gripSvg()}
            </div>
            <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(g.farmName)}${plannedBadge}
            </div>
            <div style="color:var(--muted,#67706B);font-size:12px;font-weight:900;letter-spacing:.2px;text-transform:uppercase;white-space:nowrap;">
              ${fmt0.format(g.fields.length)} • ${fmt2.format(unA+coA+soA)} ac
            </div>
            <div class="chev" aria-hidden="true" style="width:18px;height:18px;display:grid;place-items:center;color:var(--muted,#67706B);transition:transform .12s ease;">
              ${chevSvg()}
            </div>
          </div>

          <div class="farmLaneBody" style="padding:12px;display:${open?'grid':'none'};gap:10px;">
            <div class="buckets" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:start;">
              ${renderBucket(g.farmId, 'Unplanned', '', un, unA)}
              ${renderBucket(g.farmId, 'Corn', 'corn', co, coA)}
              ${renderBucket(g.farmId, 'Soybeans', 'soybeans', so, soA)}
            </div>
          </div>
        </div>
      `;
    }).join('') || `<div class="muted" style="font-weight:900;padding:12px">No fields match your filters.</div>`;

    hostEl.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
      if(head._fvBound) return;
      head._fvBound = true;
      head.addEventListener('click', (e)=>{
        if(e.target.closest('[data-drag-type]')) return;
        const lane = head.closest('.farmLane');
        if(!lane) return;
        const farmId = lane.dataset.farmId || '';
        const open = lane.dataset.open === '1';
        const next = !open;
        lane.dataset.open = next ? '1' : '0';
        lane.querySelector('.farmLaneBody').style.display = next ? 'grid' : 'none';
        setLaneOpen(farmId, next);
      }, { signal });
    });

    if(snap && !viewOnly){
      // preserve nested scroll only on desktop (phone has no nested scroll now)
      el.boardScroll.scrollTop = snap.boardTop || 0;
      hostEl.querySelectorAll('.bucketBody').forEach(body=>{
        const bucket = body.closest('[data-dropzone="1"]');
        const k = `${bucket?.dataset.farmId || ''}::${bucket?.dataset.crop || ''}`;
        if(snap.buckets[k] != null) body.scrollTop = snap.buckets[k];
      });
    }
  };

  const onDrop = async ({ type, fieldId, farmId, toCrop }) => {
    if(viewOnly) return;

    if(isLocked){
      toast(`Locked ${currentYear}`);
      return;
    }

    if(type === 'field'){
      const f = fields.find(x=> x.id === fieldId);
      if(!f) return;

      if(toCrop === 'corn' || toCrop === 'soybeans'){
        await setPlan(db, currentYear, f, toCrop);
      } else {
        await clearPlan(db, currentYear, fieldId);
      }

      plans = await loadPlansForYear(db, currentYear);
      renderAll(true);
      return;
    }

    if(type === 'farm'){
      const farmFields = getShownFields().filter(f=> f.farmId === String(farmId||''));
      if(!farmFields.length) return;

      for(const f of farmFields){
        if(toCrop === 'corn' || toCrop === 'soybeans'){
          await setPlan(db, currentYear, f, toCrop);
        } else {
          await clearPlan(db, currentYear, f.id);
        }
      }

      plans = await loadPlansForYear(db, currentYear);
      renderAll(true);
    }
  };

  el.search.addEventListener('input', ()=>{
    clearTimeout(el.search._t);
    el.search._t = setTimeout(()=> renderAll(true), 120);
  }, { signal });

  // Extra: on viewOnly, prevent any dragstart in this module subtree (stops iOS weirdness)
  if(viewOnly){
    hostEl.addEventListener('dragstart', (e)=> e.preventDefault(), { capture:true, signal });
    hostEl.addEventListener('drop', (e)=> e.preventDefault(), { capture:true, signal });
  }

  db = await initDB();
  fs = await getFirestoreFns();

  farms = await loadFarms(db);
  fields = await loadFields(db);
  farmNameById = new Map(farms.map(f=>[String(f.id), String(f.name)]));

  renderFarmList('');
  plans = await loadPlansForYear(db, currentYear);

  if (hasLockUI){
    el.lockBtn.addEventListener('click', async ()=>{
      try{
        const current = await readLockOnce(currentYear);
        await writeLock(currentYear, !current);
        toast(!current ? `Locked ${currentYear}` : `Unlocked ${currentYear}`);
      }catch(e){
        console.warn('[crop-planner] lock toggle failed', e);
        toast('Lock failed');
      }
    }, { signal });
  }

  isLocked = await readLockOnce(currentYear);
  renderLockUI();
  await startLockWatch(currentYear);

  renderAll(false);

  wireDnd({
    root: hostEl,
    onDrop,
    isEnabled: () => canDragNow()
  });

  toast(viewOnly ? 'View only' : (isLocked ? `Ready (Locked ${currentYear})` : 'Ready'));

  return {
    unmount(){
      stopLockWatch();
      controller.abort();
      hostEl.innerHTML = '';
    }
  };
}