/* =====================================================================
/Farm-vista/js/crop-planning/crop-planner.module.js  (FULL FILE)
Rev: 2026-01-01d

FIX:
✅ Removed duplicate renderYearList / setYearUI at bottom
   (was causing: Identifier 'renderYearList' has already been declared)

Keeps:
✅ Farm + Year dropdowns (custom styled)
✅ Close on outside click anywhere
✅ Phone viewer (farm -> crop tiles -> fields)
✅ Desktop DnD + bulk + global lock
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

  const YEARS = ['2026','2027'];

  const OPEN_KEY = 'fv:cropplan:lanesOpen:v1';
  let laneOpen = {};
  try{ laneOpen = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; }catch{ laneOpen = {}; }
  const setLaneOpen = (farmId, open) => {
    laneOpen[farmId] = !!open;
    try{ localStorage.setItem(OPEN_KEY, JSON.stringify(laneOpen)); }catch{}
  };

  // nested crop-open state (phone only)
  const CROP_OPEN_KEY = 'fv:cropplan:cropOpen:v1';
  let cropOpen = {};
  try{ cropOpen = JSON.parse(localStorage.getItem(CROP_OPEN_KEY) || '{}') || {}; }catch{ cropOpen = {}; }
  const cropKey = (farmId, crop) => `${String(farmId||'')}::${String(crop||'')}`;
  const isCropOpen = (farmId, crop) => !!cropOpen[cropKey(farmId,crop)];
  const setCropOpen = (farmId, crop, open) => {
    cropOpen[cropKey(farmId,crop)] = !!open;
    try{ localStorage.setItem(CROP_OPEN_KEY, JSON.stringify(cropOpen)); }catch{}
  };

  // ---- GLOBAL LOCK state ----
  let fs = null;
  let isLocked = false;
  let lockUnsub = null;
  let lockPollT = null;

  const lockPath = (year) => ['crop_plan_locks', String(year)];
  const canDragNow = () => (!viewOnly && !isLocked);

  // Shared combo styling (inline)
  const COMBO_Z = 30000;
  const comboBtnStyle = (radiusPx) => `
    width:100%;
    font:inherit;
    font-size:16px;
    color:var(--text);
    background:var(--card-surface,var(--surface));
    border:1px solid var(--border);
    border-radius:${radiusPx}px;
    padding:12px 42px 12px 12px;
    outline:none;
    cursor:pointer;
    text-align:left;
    position:relative;
    user-select:none;
  `;
  const comboCaret = `
    position:absolute;
    right:12px;
    top:50%;
    transform:translateY(-50%);
    width:0;height:0;
    border-left:6px solid transparent;
    border-right:6px solid transparent;
    border-top:7px solid color-mix(in srgb, var(--muted,#67706B) 75%, var(--text));
    opacity:.95;
    pointer-events:none;
  `;
  const comboPanelStyle = `
    position:absolute;
    left:0; right:0;
    top:calc(100% + 8px);
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:14px;
    box-shadow:0 18px 40px rgba(0,0,0,.20);
    z-index:${COMBO_Z};
    padding:10px;
    display:none;
  `;
  const comboSearchWrapStyle = `
    padding:2px 0 10px 0;
    border-bottom:1px solid color-mix(in srgb, var(--border) 85%, transparent);
    margin-bottom:8px;
  `;
  const comboSearchStyle = `
    width:100%;
    padding:12px 12px;
    border:1px solid var(--border);
    border-radius:12px;
    font:inherit;
    font-size:15px;
    color:var(--text);
    background:var(--card-surface,var(--surface));
    outline:none;
  `;
  const comboListStyle = `
    max-height:52vh;
    overflow:auto;
    -webkit-overflow-scrolling:touch;
  `;
  const comboItemStyle = `
    padding:12px 10px;
    border-radius:10px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    cursor:pointer;
  `;
  const comboItemDividerStyle = `
    border-top:1px solid color-mix(in srgb, var(--border) 85%, transparent);
  `;
  const comboHeaderStyle = `
    font-weight:400;
  `;

  // ---------- YEAR combo HTML (custom) ----------
  function yearComboHtml(radiusPx){
    const r = Number(radiusPx || 12);
    return `
      <div class="field combo combo-year" style="position:relative;">
        <label style="display:block;font-weight:400;margin:0 0 6px;">Crop Year</label>
        <div class="combo-anchor" style="position:relative;display:inline-block;width:100%;">
          <button data-el="yearBtn" class="buttonish has-caret" type="button" aria-haspopup="listbox" aria-expanded="false"
                  style="${comboBtnStyle(r)}">
            <span data-el="yearBtnText">${esc(currentYear)}</span>
            <span aria-hidden="true" style="${comboCaret}"></span>
          </button>

          <div data-el="yearPanel" class="combo-panel" style="${comboPanelStyle}">
            <div data-el="yearList" class="list" style="${comboListStyle}"></div>
          </div>
        </div>
        <input data-el="yearVal" type="hidden" value="${esc(currentYear)}" />
      </div>
    `;
  }

  // bulk header box helper (desktop only)
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

  // -------------------------------------------------------------------
  // SKELETON: Desktop vs Phone viewer
  // -------------------------------------------------------------------
  hostEl.innerHTML = viewOnly ? `
    <section class="cpRoot viewOnly" style="padding:0;margin:0;">
      <style>
        .cpRoot.viewOnly{ width:100%; }
        .cpRoot.viewOnly .cpPad{ padding:10px 10px 12px 10px; }
        .cpRoot.viewOnly .row3{ display:grid; gap:10px; grid-template-columns:1fr !important; }

        .cpRoot.viewOnly .kpiLine{
          display:grid; grid-template-columns:1fr; gap:10px;
          border:1px solid var(--border); border-radius:12px; padding:10px;
          background:var(--card-surface,var(--surface));
        }
        .cpRoot.viewOnly .kpiBox{
          border:1px solid var(--border); border-radius:12px; padding:10px;
          background:var(--surface);
        }
        .cpRoot.viewOnly .kpiBig{ font-weight:900; font-size:18px; }
        .cpRoot.viewOnly .kpiLbl{
          margin-top:4px; font-weight:800; font-size:12px;
          color:var(--muted,#67706B); letter-spacing:.2px; text-transform:uppercase;
        }

        .cpRoot.viewOnly .farmLane{ border:1px solid var(--border); border-radius:14px; background:var(--surface); overflow:hidden; }
        .cpRoot.viewOnly .farmLaneHead{
          display:flex; align-items:center; justify-content:space-between;
          gap:10px; padding:14px 12px; border-bottom:1px solid var(--border); user-select:none;
        }
        .cpRoot.viewOnly .farmName{ font-weight:900; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        .cpRoot.viewOnly .farmInner{
          padding:10px; display:grid; gap:10px;
          background: color-mix(in srgb, var(--surface) 96%, rgba(0,0,0,.02));
        }
        .cpRoot.viewOnly .cropTile{ border:1px solid var(--border); border-radius:14px; background:var(--card-surface,var(--surface)); overflow:hidden; }
        .cpRoot.viewOnly .cropHead{ padding:12px; display:flex; align-items:center; justify-content:space-between; gap:10px; user-select:none; }
        .cpRoot.viewOnly .cropTitle{ font-weight:900; }
        .cpRoot.viewOnly .cropMeta{
          font-size:12px; color:var(--muted,#67706B); font-weight:900;
          letter-spacing:.2px; text-transform:uppercase; white-space:nowrap; flex:0 0 auto;
        }
        .cpRoot.viewOnly .cropChev{
          width:18px;height:18px; display:grid;place-items:center; color:var(--muted,#67706B);
          flex:0 0 auto; transition:transform .12s ease; margin-left:6px;
        }
        .cpRoot.viewOnly .cropBody{
          padding:10px 12px 12px 12px;
          border-top:1px solid var(--border);
          display:grid; gap:10px;
        }
        .cpRoot.viewOnly .cardRow{
          border:1px solid var(--border); border-radius:12px; background:var(--surface);
          padding:10px; display:flex; align-items:center; justify-content:space-between; gap:10px;
        }
        .cpRoot.viewOnly .fname{ font-weight:900; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cpRoot.viewOnly .pill{ white-space:nowrap; }
        .cpRoot.viewOnly .dragGrip, .cpRoot.viewOnly .farmGrip{ display:none !important; }
      </style>

      <div class="cpPad" style="display:grid;gap:12px;">
        <div class="row3">
          <!-- Farm combo -->
          <div class="field combo" style="position:relative;">
            <label style="display:block;font-weight:800;margin:0 0 6px;">Farm</label>
            <div class="combo-anchor" style="position:relative;display:inline-block;width:100%;">
              <button data-el="farmBtn" type="button" aria-haspopup="listbox" aria-expanded="false"
                      style="${comboBtnStyle(12)}">
                <span data-el="farmBtnText">— All farms —</span>
                <span aria-hidden="true" style="${comboCaret}"></span>
              </button>

              <div data-el="farmPanel" style="${comboPanelStyle}">
                <div style="${comboSearchWrapStyle}">
                  <input data-el="farmSearch" type="search" placeholder="Search farms…" style="${comboSearchStyle}" />
                </div>
                <div data-el="farmList" style="${comboListStyle}"></div>
              </div>
            </div>
            <input data-el="farmId" type="hidden" />
            <input data-el="farmName" type="hidden" />
          </div>

          ${yearComboHtml(12)}

          <div class="field">
            <label style="display:block;font-weight:800;margin:0 0 6px;">Search fields</label>
            <input data-el="search" class="input" type="search" placeholder="Type to filter…"
                   style="width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--card-surface,var(--surface));
                          border:1px solid var(--border);border-radius:12px;padding:12px;outline:none;" />
            <div data-el="scopeHelp" style="font-size:13px;color:var(--muted,#67706B);margin-top:6px;font-weight:800;">
              Showing 0 active fields
            </div>
          </div>
        </div>

        <div class="kpiLine">
          <div class="kpiBox">
            <div class="kpiBig"><span data-el="kpiUnplannedFields">0</span> • <span data-el="kpiUnplannedAcres">0.00</span></div>
            <div class="kpiLbl">Unplanned (fields • acres)</div>
          </div>
          <div class="kpiBox">
            <div class="kpiBig"><span data-el="kpiCornFields">0</span> • <span data-el="kpiCornAcres">0.00</span></div>
            <div class="kpiLbl">Corn (fields • acres)</div>
          </div>
          <div class="kpiBox">
            <div class="kpiBig"><span data-el="kpiSoyFields">0</span> • <span data-el="kpiSoyAcres">0.00</span></div>
            <div class="kpiLbl">Beans (fields • acres)</div>
          </div>
        </div>

        <div data-el="boardScroll" style="display:grid;gap:12px;"></div>
      </div>
    </section>

    <div data-el="toast" style="position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);
         background:#2F6C3C;color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;
         box-shadow:0 10px 24px rgba(0,0,0,.25);opacity:0;pointer-events:none;
         transition:opacity .18s ease, transform .18s ease;z-index:10000;white-space:nowrap;"></div>
  ` : `
    <section style="padding:16px;">
      <div class="hero" style="margin:0;border:1px solid var(--border);border-radius:14px;background:var(--surface);
           box-shadow:var(--shadow,0 8px 20px rgba(0,0,0,.08));overflow:hidden;">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border);background:linear-gradient(90deg,rgba(47,108,60,.12),transparent);">
          <div style="font-weight:900;font-size:18px;">Crop Planner</div>
          <div class="muted" style="margin-top:4px;font-weight:800;">Assign corn/beans. Desktop for drag + bulk.</div>
        </div>

        <div style="padding:16px;display:grid;gap:14px;">
          <div class="row3" style="display:grid;gap:10px;grid-template-columns:1fr 1fr 1fr;">
            <!-- Farm combo -->
            <div class="field combo" style="position:relative;">
              <label style="display:block;font-weight:800;margin:0 0 6px;">Farm</label>
              <div class="combo-anchor" style="position:relative;display:inline-block;width:100%;">
                <button data-el="farmBtn" type="button" aria-haspopup="listbox" aria-expanded="false"
                        style="${comboBtnStyle(10)}">
                  <span data-el="farmBtnText">— All farms —</span>
                  <span aria-hidden="true" style="${comboCaret}"></span>
                </button>

                <div data-el="farmPanel" style="${comboPanelStyle}">
                  <div style="${comboSearchWrapStyle}">
                    <input data-el="farmSearch" type="search" placeholder="Search farms…" style="${comboSearchStyle}" />
                  </div>
                  <div data-el="farmList" style="${comboListStyle}"></div>
                </div>
              </div>
              <input data-el="farmId" type="hidden" />
              <input data-el="farmName" type="hidden" />
            </div>

            ${yearComboHtml(10)}

            <div class="field">
              <label style="display:block;font-weight:800;margin:0 0 6px;">Search fields</label>
              <input data-el="search" class="input" type="search" placeholder="Type to filter…"
                     style="width:100%;font:inherit;font-size:16px;color:var(--text);background:var(--card-surface,var(--surface));
                            border:1px solid var(--border);border-radius:10px;padding:12px;outline:none;" />
              <div data-el="scopeHelp" style="font-size:13px;color:var(--muted,#67706B);margin-top:6px;font-weight:800;">
                Showing 0 active fields
              </div>
            </div>
          </div>

          <div class="kpi-line" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 12px;border:1px solid var(--border);
               border-radius:12px;background:var(--card-surface,var(--surface));">
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

          <div data-el="bulkWrap" style="display:grid;gap:8px;">
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
                      style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border);
                             background:var(--card-surface,var(--surface));color:var(--text);border-radius:999px;
                             padding:7px 10px;font-weight:900;cursor:pointer;user-select:none;flex:0 0 auto;">
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

    <div data-el="toast" style="position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);
         background:#2F6C3C;color:#fff;padding:10px 16px;border-radius:999px;font-size:14px;
         box-shadow:0 10px 24px rgba(0,0,0,.25);opacity:0;pointer-events:none;
         transition:opacity .18s ease, transform .18s ease;z-index:10000;white-space:nowrap;"></div>
  `;

  // element getters scoped to host
  const q = (sel) => hostEl.querySelector(sel);
  const el = {
    farmBtn: q('[data-el="farmBtn"]'),
    farmBtnText: q('[data-el="farmBtnText"]'),
    farmPanel: q('[data-el="farmPanel"]'),
    farmList: q('[data-el="farmList"]'),
    farmSearch: q('[data-el="farmSearch"]'),
    farmId: q('[data-el="farmId"]'),
    farmName: q('[data-el="farmName"]'),

    yearBtn: q('[data-el="yearBtn"]'),
    yearBtnText: q('[data-el="yearBtnText"]'),
    yearPanel: q('[data-el="yearPanel"]'),
    yearList: q('[data-el="yearList"]'),
    yearVal: q('[data-el="yearVal"]'),

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

  const controller = new AbortController();
  const { signal } = controller;

  const toast = (msg) => {
    if(!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.opacity = '1';
    el.toast.style.transform = 'translate(-50%,0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>{
      el.toast.style.opacity = '0';
      el.toast.style.transform = 'translate(-50%,12px)';
    }, 900);
  };

  const isAnyComboOpen = () => {
    const fp = el.farmPanel && el.farmPanel.style.display === 'block';
    const yp = el.yearPanel && el.yearPanel.style.display === 'block';
    return !!(fp || yp);
  };

  const closeAllCombos = () => {
    if (el.farmPanel) el.farmPanel.style.display = 'none';
    if (el.yearPanel) el.yearPanel.style.display = 'none';
    if (el.farmBtn) el.farmBtn.setAttribute('aria-expanded','false');
    if (el.yearBtn) el.yearBtn.setAttribute('aria-expanded','false');
  };

  // Close on outside click ANYWHERE
  hostEl.ownerDocument.addEventListener('mousedown', (e)=>{
    if(!isAnyComboOpen()) return;
    const t = e.target;
    const insideFarm = (el.farmBtn && el.farmBtn.contains(t)) || (el.farmPanel && el.farmPanel.contains(t));
    const insideYear = (el.yearBtn && el.yearBtn.contains(t)) || (el.yearPanel && el.yearPanel.contains(t));
    if(insideFarm || insideYear) return;
    closeAllCombos();
  }, { capture:true, signal });

  hostEl.ownerDocument.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;
    if(isAnyComboOpen()){
      e.preventDefault();
      closeAllCombos();
    }
  }, { capture:true, signal });

  // ----- Farm combo -----
  const renderFarmList = (qtext) => {
    const qq = norm(qtext);

    const rows = farms
      .filter(f => !qq || norm(f.name).includes(qq))
      .map((f, idx) => `
        <div class="combo-item" data-id="${esc(f.id)}"
             style="${comboItemStyle}${idx===0 ? '' : comboItemDividerStyle}">
          <div style="font-weight:400;">${esc(f.name)}</div>
          <div></div>
        </div>
      `).join('');

    const allRow = `
      <div class="combo-item" data-id=""
           style="${comboItemStyle}">
        <div style="${comboHeaderStyle}">All farms</div>
        <div></div>
      </div>
    `;

    if (el.farmList){
      el.farmList.innerHTML = allRow + (rows || `
        <div style="padding:12px 10px;color:var(--muted,#67706B);font-weight:900;">(no matches)</div>
      `);
    }
  };

  if (el.farmBtn){
    el.farmBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const isOpen = el.farmPanel.style.display === 'block';
      closeAllCombos();
      el.farmPanel.style.display = isOpen ? 'none' : 'block';
      el.farmBtn.setAttribute('aria-expanded', (!isOpen).toString());
      if(el.farmSearch){
        el.farmSearch.value = '';
        renderFarmList('');
        setTimeout(()=> el.farmSearch.focus(), 0);
      }else{
        renderFarmList('');
      }
    }, { signal });

    if(el.farmPanel){
      el.farmPanel.addEventListener('mousedown', (e)=> e.stopPropagation(), { signal });
      el.farmPanel.addEventListener('click', (e)=> e.stopPropagation(), { signal });
    }

    if(el.farmSearch){
      el.farmSearch.addEventListener('input', ()=> renderFarmList(el.farmSearch.value), { signal });
    }

    if(el.farmList){
      el.farmList.addEventListener('mousedown', (e)=>{
        const row = e.target.closest('.combo-item'); if(!row) return;
        const id = row.dataset.id || '';

        if(!id){
          if(el.farmId) el.farmId.value = '';
          if(el.farmName) el.farmName.value = '';
          if(el.farmBtnText) el.farmBtnText.textContent = '— All farms —';
        }else{
          const f = farms.find(x=> x.id === id);
          if(f){
            if(el.farmId) el.farmId.value = f.id;
            if(el.farmName) el.farmName.value = f.name;
            if(el.farmBtnText) el.farmBtnText.textContent = f.name;
          }
        }

        closeAllCombos();
        renderAll(true);
      }, { signal });
    }
  }

  // ----- Year combo -----
  const renderYearList = () => {
    if(!el.yearList) return;
    el.yearList.innerHTML = YEARS.map((y, idx) => `
      <div class="combo-item" data-year="${esc(y)}"
           style="${comboItemStyle}${idx===0 ? '' : comboItemDividerStyle}">
        <div style="font-weight:400;">${esc(y)}</div>
        <div></div>
      </div>
    `).join('');
  };

  const setYearUI = (y) => {
    currentYear = String(y || YEARS[0] || '2026');
    if(el.yearBtnText) el.yearBtnText.textContent = currentYear;
    if(el.yearVal) el.yearVal.value = currentYear;
  };

  if (el.yearBtn){
    renderYearList();
    setYearUI(currentYear);

    el.yearBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const isOpen = el.yearPanel.style.display === 'block';
      closeAllCombos();
      el.yearPanel.style.display = isOpen ? 'none' : 'block';
      el.yearBtn.setAttribute('aria-expanded', (!isOpen).toString());
    }, { signal });

    if(el.yearPanel){
      el.yearPanel.addEventListener('mousedown', (e)=> e.stopPropagation(), { signal });
      el.yearPanel.addEventListener('click', (e)=> e.stopPropagation(), { signal });
    }

    if(el.yearList){
      el.yearList.addEventListener('mousedown', async (e)=>{
        const row = e.target.closest('.combo-item'); if(!row) return;
        const y = row.dataset.year || YEARS[0] || '2026';
        if(String(y) === String(currentYear)){
          closeAllCombos();
          return;
        }

        setYearUI(y);
        closeAllCombos();

        await startLockWatch(currentYear);
        plans = await loadPlansForYear(db, currentYear);
        renderAll(true);
        toast(`Year: ${currentYear}${isLocked ? ' (Locked)' : ''}`);
      }, { signal });
    }
  }

  const cropForField = (fieldId) => {
    const c = norm(plans.get(fieldId)?.crop);
    if (c === 'corn' || c === 'soybeans') return c;
    return '';
  };

  const getShownFields = () => {
    const farmId = String(el.farmId?.value || '').trim();
    const qtext = norm(el.search?.value);

    return fields.filter(f=>{
      if (norm(f.status) !== 'active') return false;
      if (farmId && f.farmId !== farmId) return false;
      if (qtext && !norm(f.name).includes(qtext)) return false;
      return true;
    });
  };

  const renderFieldRowsPhone = (arr) => {
    if (!arr.length) return `<div class="muted" style="font-weight:900">—</div>`;
    return arr.map(f=>`
      <div class="cardRow" data-field-id="${esc(f.id)}">
        <div class="fname">${esc(f.name)}</div>
        <div class="pill">${fmt2.format(Number(f.tillable||0))} ac</div>
      </div>
    `).join('');
  };

  const renderBucketDesktop = (farmId, title, crop, arr, acres) => {
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

  function renderCropTilePhone(farmId, label, cropKeyName, arr, acres, isOpen){
    const meta = `${fmt0.format(arr.length)} • ${fmt2.format(acres)} ac`;
    const body = isOpen ? `<div class="cropBody">${renderFieldRowsPhone(arr)}</div>` : '';
    const r = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    return `
      <div class="cropTile" data-crop-tile="1" data-farm-id="${esc(farmId)}" data-crop-key="${esc(cropKeyName)}" data-open="${isOpen?'1':'0'}">
        <div class="cropHead">
          <div class="cropTitle">${esc(label)}</div>
          <div style="display:flex;align-items:center;gap:0;">
            <div class="cropMeta">${meta}</div>
            <div class="cropChev" aria-hidden="true" style="transform:${r};">${chevSvg()}</div>
          </div>
        </div>
        ${body}
      </div>
    `;
  }

  function bindToggles(){
    hostEl.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
      if(head._fvBound) return;
      head._fvBound = true;
      head.addEventListener('click', (e)=>{
        if(!viewOnly && e.target.closest('[data-drag-type]')) return;

        const lane = head.closest('.farmLane');
        if(!lane) return;
        const farmId = lane.dataset.farmId || '';
        const open = lane.dataset.open === '1';
        const next = !open;

        lane.dataset.open = next ? '1' : '0';
        const body = lane.querySelector('.farmLaneBody');
        if(body) body.style.display = next ? (viewOnly ? 'block' : 'grid') : 'none';
        setLaneOpen(farmId, next);
      }, { signal });
    });

    if(viewOnly){
      hostEl.querySelectorAll('[data-crop-tile="1"]').forEach(tile=>{
        if(tile._fvBound) return;
        tile._fvBound = true;
        tile.addEventListener('click', (e)=>{
          const head = e.target.closest('.cropHead');
          if(!head) return;

          const farmId = tile.dataset.farmId || '';
          const ck = tile.dataset.cropKey || '';
          const open = tile.dataset.open === '1';
          const next = !open;

          tile.dataset.open = next ? '1' : '0';
          setCropOpen(farmId, ck, next);
          renderAll(true);
        }, { signal });
      });
    }
  }

  const renderAll = (preserveScroll=false) => {
    const list = getShownFields();
    if (el.scopeHelp) el.scopeHelp.textContent = `Showing ${fmt0.format(list.length)} active fields${isLocked ? ' • Locked' : ''}`;

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

    if (el.kpiUnplannedFields) el.kpiUnplannedFields.textContent = fmt0.format(unCnt);
    if (el.kpiUnplannedAcres)  el.kpiUnplannedAcres.textContent  = fmt2.format(unAc);
    if (el.kpiCornFields)      el.kpiCornFields.textContent      = fmt0.format(coCnt);
    if (el.kpiCornAcres)       el.kpiCornAcres.textContent       = fmt2.format(coAc);
    if (el.kpiSoyFields)       el.kpiSoyFields.textContent       = fmt0.format(soCnt);
    if (el.kpiSoyAcres)        el.kpiSoyAcres.textContent        = fmt2.format(soAc);

    const farmsArr = Array.from(byFarm.values()).sort((a,b)=> a.farmName.localeCompare(b.farmName));
    const defaultOpen = !!el.farmId?.value;

    const snap = (!viewOnly && preserveScroll) ? {
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
      const openFarm = (laneOpen[g.farmId] != null) ? !!laneOpen[g.farmId] : defaultOpen;

      const un = [], co = [], so = [];
      let unA=0, coA=0, soA=0;

      for(const f of g.fields){
        const b = cropForField(f.id);
        const a = Number(f.tillable||0);
        if(b === 'corn'){ co.push(f); coA+=a; }
        else if(b === 'soybeans'){ so.push(f); soA+=a; }
        else { un.push(f); unA+=a; }
      }

      if(viewOnly){
        const unOpen = isCropOpen(g.farmId, 'unplanned');
        const coOpen = isCropOpen(g.farmId, 'corn');
        const soOpen = isCropOpen(g.farmId, 'soybeans');

        return `
          <div class="farmLane" data-farm-id="${esc(g.farmId)}" data-open="${openFarm?'1':'0'}">
            <div class="farmLaneHead" data-farm-toggle="1">
              <div class="farmName">${esc(g.farmName)}</div>
              <div aria-hidden="true">${chevSvg()}</div>
            </div>

            <div class="farmLaneBody" style="display:${openFarm?'block':'none'};">
              <div class="farmInner">
                ${renderCropTilePhone(g.farmId, 'Unplanned', 'unplanned', un, unA, unOpen)}
                ${renderCropTilePhone(g.farmId, 'Corn', 'corn', co, coA, coOpen)}
                ${renderCropTilePhone(g.farmId, 'Beans', 'soybeans', so, soA, soOpen)}
              </div>
            </div>
          </div>
        `;
      }

      return `<div></div>`;
    }).join('');

    bindToggles();

    if(snap){
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

  if (el.search){
    el.search.addEventListener('input', ()=>{
      clearTimeout(el.search._t);
      el.search._t = setTimeout(()=> renderAll(true), 120);
    }, { signal });
  }

  if(viewOnly){
    hostEl.addEventListener('dragstart', (e)=> e.preventDefault(), { capture:true, signal });
    hostEl.addEventListener('drop', (e)=> e.preventDefault(), { capture:true, signal });
  }

  // boot data
  db = await initDB();
  fs = await getFirestoreFns();

  farms = await loadFarms(db);
  fields = await loadFields(db);
  farmNameById = new Map(farms.map(f=>[String(f.id), String(f.name)]));

  // initialize combo labels
  if(el.farmBtnText) el.farmBtnText.textContent = '— All farms —';
  if(el.yearBtnText) el.yearBtnText.textContent = currentYear;

  // render lists now that farms loaded
  renderFarmList('');
  renderYearList();

  // initial plans + lock
  plans = await loadPlansForYear(db, currentYear);
  isLocked = await readLockOnce(currentYear);
  renderLockUI();
  await startLockWatch(currentYear);

  // lock btn wiring
  if (el.lockBtn){
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

  // ============================================================
  // SINGLE SET OF LOCK HELPERS (no duplicates)
  // ============================================================
  function renderLockUI(){
    if (!el.lockBtn) return;
    el.lockIcon.innerHTML = lockSvg(isLocked);
    el.lockLabel.textContent = isLocked ? 'Locked' : 'Unlocked';
    el.lockBtn.style.borderColor = isLocked
      ? 'color-mix(in srgb, var(--border) 60%, rgba(47,108,60,.25))'
      : 'var(--border)';
  }

  function stopLockWatch(){
    try{ if (typeof lockUnsub === 'function') lockUnsub(); }catch{}
    lockUnsub = null;
    if (lockPollT) clearInterval(lockPollT);
    lockPollT = null;
  }

  async function readLockOnce(year){
    if (!fs || !db) return false;
    try{
      const ref = fs.doc(db, ...lockPath(year));
      const snap = await fs.getDoc(ref);
      const data = snap?.data?.() || {};
      return !!data.locked;
    }catch{
      return false;
    }
  }

  async function writeLock(year, nextLocked){
    if (!fs || !db) throw new Error('Missing Firestore fns/db');
    const ref = fs.doc(db, ...lockPath(year));
    const payload = {
      locked: !!nextLocked,
      updatedAt: fs.serverTimestamp ? fs.serverTimestamp() : new Date(),
      updatedBy: getUserTag() || ''
    };
    await fs.setDoc(ref, payload, { merge: true });
  }

  async function startLockWatch(year){
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
  }
}
