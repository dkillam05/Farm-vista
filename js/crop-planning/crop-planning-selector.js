/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30k

Adds:
✅ Farm tile header shows (Corn X • Beans Y) when any planned exists
✅ Narrow screens: view-only mode
   - disables drag
   - shows "View only on phone" hint
Keeps:
✅ Active fields only
✅ Years: 2026–2027 only (default 2026)
✅ Field drag vs farm drag works (explicit data-drag-type)
✅ Dropdown behavior stable
===================================================================== */
'use strict';

import { initDB, loadFarms, loadFields, loadPlansForYear, setPlan, clearPlan } from './crop-planning-data.js';
import { wireDnd } from './crop-planning-dnd.js';

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').trim().toLowerCase();
const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[m]));
const to2 = (n) => (Number(n || 0)).toFixed(2);

function isNarrow(){
  return window.matchMedia('(max-width: 980px)').matches;
}

function showToast(msg){
  const el = $('fv-toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> el.classList.remove('show'), 1000);
}

/* ---------- DOM ---------- */
const farmBtn   = $('farmBtn');
const farmPanel = $('farmPanel');
const farmList  = $('farmList');
const farmSearch= $('farmSearch');
const farmIdEl  = $('farmId');
const farmNameEl= $('farmName');
const farmHelp  = $('farmHelp');

const yearEl    = $('year');
const searchEl  = $('search');
const scopeHelp = $('scopeHelp');

const laneHeader = $('laneHeader');
const boardScroll = $('boardScroll');

const kpiUnplannedFields = $('kpiUnplannedFields');
const kpiUnplannedAcres  = $('kpiUnplannedAcres');
const kpiCornFields      = $('kpiCornFields');
const kpiCornAcres       = $('kpiCornAcres');
const kpiSoyFields       = $('kpiSoyFields');
const kpiSoyAcres        = $('kpiSoyAcres');

/* ---------- State ---------- */
let db = null;
let farms = [];
let fields = [];
let farmNameById = new Map();
let plans = new Map();
let currentYear = '2026';

// collapsible lanes
const OPEN_KEY = 'fv:cropplan:lanesOpen:v1';
let laneOpen = Object.create(null);
try{ laneOpen = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') || {}; }catch{ laneOpen = {}; }
function setLaneOpen(farmId, open){
  laneOpen[farmId] = !!open;
  try{ localStorage.setItem(OPEN_KEY, JSON.stringify(laneOpen)); }catch{}
}

/* ---------- Combo closing (outside .combo only) ---------- */
function closeAllCombos(){ farmPanel.classList.remove('show'); }
document.addEventListener('click', (e)=>{
  if (e.target.closest('.combo')) return;
  closeAllCombos();
});
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeAllCombos(); });

/* ---------- Farm combo ---------- */
farmBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  farmPanel.classList.toggle('show');
  farmSearch.value = '';
  renderFarmList('');
  setTimeout(()=> farmSearch.focus(), 0);
});
farmPanel.addEventListener('click', e=> e.stopPropagation());
farmPanel.addEventListener('mousedown', e=> e.stopPropagation());
farmSearch.addEventListener('input', ()=> renderFarmList(farmSearch.value));

function renderFarmList(q){
  const qq = norm(q);
  const items = farms
    .filter(f => !qq || norm(f.name).includes(qq))
    .map(f => `<div class="combo-item" data-id="${esc(f.id)}"><div>${esc(f.name)}</div><div></div></div>`)
    .join('');

  farmList.innerHTML =
    `<div class="combo-item" data-id=""><div><strong>All farms</strong></div><div></div></div>` +
    (items || `<div class="combo-empty">(no matches)</div>`);
}

farmList.addEventListener('mousedown', (e)=>{
  const row = e.target.closest('.combo-item'); if(!row) return;
  const id = row.dataset.id || '';

  if(!id){
    farmIdEl.value = '';
    farmNameEl.value = '';
    farmBtn.textContent = '— All farms —';
  }else{
    const f = farms.find(x=> x.id === id);
    if(!f) return;
    farmIdEl.value = f.id;
    farmNameEl.value = f.name;
    farmBtn.textContent = f.name;
  }

  closeAllCombos();
  renderAll();
});

/* ---------- Year ---------- */
function buildYearOptions(){
  yearEl.innerHTML = `<option value="2026">2026</option><option value="2027">2027</option>`;
  yearEl.value = '2026';
  currentYear = '2026';
}
yearEl.addEventListener('change', async ()=>{
  currentYear = String(yearEl.value || '2026');
  plans = await loadPlansForYear(db, currentYear);
  renderAll();
  showToast(`Year: ${currentYear}`);
});

/* ---------- Filters ---------- */
function getShownFields(){
  const farmId = String(farmIdEl.value || '').trim();
  const q = norm(searchEl.value);

  return fields.filter(f=>{
    if (norm(f.status) !== 'active') return false;
    if (farmId && f.farmId !== farmId) return false;
    if (q && !norm(f.name).includes(q)) return false;
    return true;
  });
}

function cropForField(fieldId){
  const c = norm(plans.get(fieldId)?.crop);
  if (c === 'corn' || c === 'soybeans') return c;
  return '';
}

searchEl.addEventListener('input', ()=>{
  clearTimeout(searchEl._t);
  searchEl._t = setTimeout(renderAll, 120);
});

/* ---------- Render helpers ---------- */
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

function renderAll(){
  if (farmHelp) farmHelp.textContent = ''; // keep blank per your preference

  const narrow = isNarrow();

  // Add a "view only" hint above the board on narrow screens (without changing HTML)
  ensureViewOnlyHint(narrow);

  const list = getShownFields();
  scopeHelp.textContent = `Showing ${list.length} active fields` + (farmNameEl.value ? ` in ${farmNameEl.value}` : '');

  // KPI totals across shown
  let unCnt=0, coCnt=0, soCnt=0;
  let unAc=0, coAc=0, soAc=0;

  // group by farm
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

  kpiUnplannedFields.textContent = String(unCnt);
  kpiUnplannedAcres.textContent  = to2(unAc);
  kpiCornFields.textContent      = String(coCnt);
  kpiCornAcres.textContent       = to2(coAc);
  kpiSoyFields.textContent       = String(soCnt);
  kpiSoyAcres.textContent        = to2(soAc);

  const farmsArr = Array.from(byFarm.values()).sort((a,b)=> a.farmName.localeCompare(b.farmName));
  const defaultOpen = !!farmIdEl.value;

  boardScroll.innerHTML = farmsArr.map(g=>{
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

    // ✅ Only show (Corn X • Beans Y) if there is any planned crop in this farm
    const plannedBadge = (coN + soN) > 0 ? ` <span class="muted">(${coN ? `Corn ${coN}` : ''}${coN && soN ? ' • ' : ''}${soN ? `Beans ${soN}` : ''})</span>` : '';

    return `
      <div class="farmLane" data-farm-id="${esc(g.farmId)}" data-open="${open ? '1':'0'}">
        <div class="farmLaneHead" data-farm-toggle="1">
          <!-- Farm drag grip: disabled on narrow screens -->
          <div class="farmGrip" data-drag-type="farm" draggable="${narrow ? 'false' : 'true'}" title="${narrow ? 'View only' : 'Drag farm'}"
               style="${narrow ? 'opacity:.45;cursor:not-allowed;' : ''}">
            ${gripSvg()}
          </div>

          <div class="farmLaneTitle" title="${esc(g.farmName)}">${esc(g.farmName)}${plannedBadge}</div>

          <div class="farmLaneMeta">${g.fields.length} • ${to2(unA+coA+soA)} ac</div>
          <div class="chev" aria-hidden="true">${chevSvg()}</div>
        </div>

        <div class="farmLaneBody">
          <div class="buckets">
            ${renderBucket(g.farmId, 'Unplanned', '', un, unA, narrow)}
            ${renderBucket(g.farmId, 'Corn', 'corn', co, coA, narrow)}
            ${renderBucket(g.farmId, 'Soybeans', 'soybeans', so, soA, narrow)}
          </div>
        </div>
      </div>
    `;
  }).join('') || `<div class="muted" style="font-weight:900;padding:12px">No fields match your filters.</div>`;

  bindLaneToggles();
  bindHeaderFarmDrops(narrow);
}

function renderBucket(farmId, title, crop, arr, acres, narrow){
  const rows = arr.length ? arr.map(f=> renderFieldRow(farmId, crop, f, narrow)).join('')
                          : `<div class="muted" style="font-weight:900">—</div>`;

  return `
    <div class="bucket">
      <div class="bucketHead">
        <div class="bucketTitle">${esc(title)}</div>
        <div class="bucketSub">${arr.length} • ${to2(acres)} ac</div>
      </div>
      <div class="bucketBody" data-crop="${esc(crop)}" data-farm-id="${esc(farmId)}" ${narrow ? 'style="opacity:.92;"' : ''}>
        ${rows}
      </div>
    </div>
  `;
}

function renderFieldRow(farmId, crop, f, narrow){
  return `
    <div class="cardRow" data-field-id="${esc(f.id)}" data-farm-id="${esc(farmId)}" data-crop="${esc(crop)}">
      <!-- Field drag grip: disabled on narrow screens -->
      <div class="dragGrip" data-drag-type="field" draggable="${narrow ? 'false' : 'true'}" title="${narrow ? 'View only' : 'Drag field'}"
           style="${narrow ? 'opacity:.45;cursor:not-allowed;' : ''}">
        ${gripSvg()}
      </div>
      <div class="cardName" title="${esc(f.name)}">${esc(f.name)}</div>
      <div class="pill">${to2(f.tillable)} ac</div>
    </div>
  `;
}

/* ---------- View-only hint injection ---------- */
function ensureViewOnlyHint(narrow){
  let hint = document.getElementById('fvViewOnlyHint');
  if(!hint){
    hint = document.createElement('div');
    hint.id = 'fvViewOnlyHint';
    hint.className = 'help';
    hint.style.display = 'none';
    hint.style.fontWeight = '900';
    hint.style.marginTop = '-4px';
    hint.style.marginBottom = '4px';
    hint.textContent = 'View only on phone — use desktop for planning.';
    // insert under filters (after row3)
    const row3 = document.querySelector('.row3');
    if(row3 && row3.parentNode){
      row3.parentNode.insertBefore(hint, row3.nextSibling);
    }
  }
  hint.style.display = narrow ? 'block' : 'none';
}

/* ---------- Lane collapse ---------- */
function bindLaneToggles(){
  document.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
    if(head._fvBound) return;
    head._fvBound = true;

    head.addEventListener('click', (e)=>{
      if(e.target.closest('[data-drag-type]')) return; // don't toggle when grabbing grip

      const lane = head.closest('.farmLane');
      if(!lane) return;
      const farmId = lane.dataset.farmId || '';
      const open = lane.dataset.open === '1';
      const next = !open;
      lane.dataset.open = next ? '1' : '0';
      setLaneOpen(farmId, next);
    });
  });
}

/* ---------- Header drop targets for farm drag ---------- */
function bindHeaderFarmDrops(narrow){
  // On narrow screens: disable the "drop farm" headers
  laneHeader.querySelectorAll('[data-header-drop="1"]').forEach(box=>{
    if(box._fvBound) return;
    box._fvBound = true;

    box.addEventListener('dragover', (e)=>{
      if(narrow) return;
      e.preventDefault();
      box.classList.add('is-over');
    });
    box.addEventListener('dragleave', ()=> box.classList.remove('is-over'));
    box.addEventListener('drop', async (e)=>{
      if(narrow) return;
      box.classList.remove('is-over');
      e.preventDefault();

      const type = e.dataTransfer.getData('text/fv-type');
      if(type !== 'farm') return;

      const farmId = e.dataTransfer.getData('text/fv-farm-id');
      const toCrop = box.dataset.crop || '';
      if(!farmId) return;

      await moveFarmInScope(farmId, toCrop);
    });
  });
}

/* ---------- Drop handling from DnD module ---------- */
async function onDrop(payload){
  if(isNarrow()) return; // view-only protection

  if(payload.type === 'field'){
    await moveField(payload.fieldId, payload.toCrop);
    return;
  }
  if(payload.type === 'farm'){
    await moveFarmInScope(payload.farmId, payload.toCrop);
  }
}

async function moveField(fieldId, toCrop){
  const f = fields.find(x=> x.id === fieldId);
  if(!f) return;

  try{
    if(toCrop === 'corn' || toCrop === 'soybeans'){
      const p = await setPlan(db, currentYear, f, toCrop);
      plans.set(fieldId, { crop: norm(p.crop) });
    }else{
      await clearPlan(db, currentYear, fieldId);
      plans.delete(fieldId);
    }
    renderAll();
  }catch(e){
    console.error(e);
    showToast('Save failed (see console)');
  }
}

async function moveFarmInScope(farmId, toCrop){
  const fid = String(farmId||'').trim();
  if(!fid) return;

  const visible = getShownFields().filter(f=> String(f.farmId||'') === fid);
  if(!visible.length) return;

  showToast(`Moving ${visible.length}…`);

  const concurrency = 10;
  let idx = 0;

  try{
    const runners = new Array(concurrency).fill(0).map(async ()=>{
      while(idx < visible.length){
        const f = visible[idx++];
        if(toCrop === 'corn' || toCrop === 'soybeans'){
          const p = await setPlan(db, currentYear, f, toCrop);
          plans.set(f.id, { crop: norm(p.crop) });
        }else{
          await clearPlan(db, currentYear, f.id);
          plans.delete(f.id);
        }
      }
    });
    await Promise.all(runners);

    renderAll();
    showToast(`Farm moved`);
  }catch(e){
    console.error(e);
    showToast('Farm move failed (see console)');
  }
}

/* ---------- Load ---------- */
async function loadAll(){
  farms = await loadFarms(db);
  farmNameById = new Map(farms.map(f=>[String(f.id), String(f.name)]));
  renderFarmList('');

  fields = await loadFields(db);
  fields = fields.map(x=>({
    ...x,
    farmId: String(x.farmId||''),
    status: String(x.status||'active'),
    tillable: Number(x.tillable||0)
  }));

  plans = await loadPlansForYear(db, currentYear);

  if(farmIdEl.value && !farmNameById.get(String(farmIdEl.value))){
    farmIdEl.value = '';
    farmNameEl.value = '';
    farmBtn.textContent = '— All farms —';
  }

  renderAll();
}

/* ---------- Boot ---------- */
(async function boot(){
  buildYearOptions();
  db = await initDB();

  // Delegated DnD
  wireDnd({ root: document, onDrop });

  await loadAll();

  // If screen size changes, re-render to toggle view-only
  window.addEventListener('resize', ()=>{
    clearTimeout(window.__fvResizeT);
    window.__fvResizeT = setTimeout(renderAll, 120);
  });
})();
