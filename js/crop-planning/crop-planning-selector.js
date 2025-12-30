/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30c
Controller + renderer for Crop Planning Selector (FV themed)

Changes in this rev:
✅ ONLY shows ACTIVE fields (no status dropdown)
✅ Better error banner when farms fail to load (prevents silent "0 farms")
===================================================================== */
'use strict';

import { initDB, loadFarms, loadFields, loadPlansForYear, setPlan, clearPlan } from './crop-planning-data.js';
import { wireDnd } from './crop-planning-dnd.js';

/* ========= Helpers ========= */
const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').trim().toLowerCase();
const esc = (s) => String(s||"").replace(/[&<>"']/g, m=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));
const to2 = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : '0.00';
};

function showToast(msg){
  const el = $('fv-toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> el.classList.remove('show'), 1200);
}

function showErr(msg){
  const b = $('errBanner');
  if(!b) return;
  b.textContent = msg;
  b.classList.add('show');
}

function clearErr(){
  const b = $('errBanner');
  if(!b) return;
  b.textContent = '';
  b.classList.remove('show');
}

function closeAllCombos(except=null){
  document.querySelectorAll('.combo-panel.show').forEach(p=>{
    if(p!==except) p.classList.remove('show');
  });
}
document.addEventListener('click', ()=> closeAllCombos());
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAllCombos(); });

/* ========= DOM ========= */
const farmBtn   = $('farmBtn');
const farmPanel = $('farmPanel');
const farmList  = $('farmList');
const farmSearch= $('farmSearch');
const farmHelp  = $('farmHelp');
const farmIdEl  = $('farmId');
const farmNameEl= $('farmName');

const yearEl    = $('year');
const searchEl  = $('search');

const scopeHelp = $('scopeHelp');

const btnRefresh= $('btnRefresh');
const btnUndo   = $('btnUndo');
const mobileHint= $('mobileHint');

const kpiUnplannedFields = $('kpiUnplannedFields');
const kpiUnplannedAcres  = $('kpiUnplannedAcres');
const kpiCornFields      = $('kpiCornFields');
const kpiCornAcres       = $('kpiCornAcres');
const kpiSoyFields       = $('kpiSoyFields');
const kpiSoyAcres        = $('kpiSoyAcres');

const subUnplanned = $('subUnplanned');
const subCorn      = $('subCorn');
const subSoy       = $('subSoy');

const zoneUnplanned = $('zoneUnplanned');
const zoneCorn      = $('zoneCorn');
const zoneSoy       = $('zoneSoy');

const boardRoot = $('board');

/* ========= State ========= */
let db = null;
let farms = [];
let fields = [];
let farmNameById = new Map();

let plans = new Map();
let currentYear = '';
let undoStack = [];

/* ========= Farm combo ========= */
function openFarmPanel(){
  closeAllCombos(farmPanel);
  farmPanel.classList.add('show');
  farmSearch.value = "";
  farmSearch.focus();
  renderFarmList("");
}
function closeFarmPanel(){ farmPanel.classList.remove('show'); }

farmBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  farmPanel.classList.contains('show') ? closeFarmPanel() : openFarmPanel();
});
farmPanel.addEventListener('click', e=> e.stopPropagation());
farmPanel.addEventListener('mousedown', e=> e.stopPropagation());
farmSearch.addEventListener('input', ()=> renderFarmList(farmSearch.value));

function renderFarmList(q){
  const qq = norm(q);
  const items = farms
    .filter(f => !qq || norm(f.name).includes(qq))
    .map(f => `
      <div class="combo-item" data-id="${esc(f.id)}">
        <div>${esc(f.name)}</div>
        <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end">
          <span class="pill">${esc(String(f.status||'active'))}</span>
        </div>
      </div>
    `);

  const topAll = `
    <div class="combo-item" data-id="">
      <div><strong>All farms</strong></div>
      <div><span class="pill">Show all</span></div>
    </div>
  `;

  farmList.innerHTML = topAll + (items.join("") || `<div class="combo-empty">(no matches)</div>`);
}

farmList.addEventListener('mousedown', (e)=>{
  const row = e.target.closest('.combo-item'); if(!row) return;
  const id = row.dataset.id || "";
  if(!id){
    farmIdEl.value = "";
    farmNameEl.value = "";
    farmBtn.textContent = "— All farms —";
  }else{
    const f = farms.find(x=> String(x.id)===String(id));
    if(!f) return;
    farmIdEl.value = f.id;
    farmNameEl.value = f.name;
    farmBtn.textContent = f.name;
  }
  closeFarmPanel();
  renderAll();
});

/* ========= Year options ========= */
function buildYearOptions(){
  const now = new Date();
  const y = now.getFullYear();
  const years = [];
  for(let i=-1; i<=5; i++) years.push(y+i);

  yearEl.innerHTML = years.map(v=> `<option value="${v}">${v}</option>`).join('');

  const def = y + 1;
  yearEl.value = String(def);
  currentYear = String(def);

  const isMobile = window.matchMedia('(max-width: 980px)').matches;
  if(isMobile && mobileHint) mobileHint.style.display = 'block';
}

/* ========= Filtering / grouping ========= */
function getFilteredFields(){
  const farmId = String(farmIdEl.value || '').trim();
  const q = norm(searchEl.value);

  // ✅ HARD LOCK: only ACTIVE fields
  return fields.filter(f=>{
    if(norm(f.status) !== 'active') return false;
    if(farmId && String(f.farmId||'') !== farmId) return false;
    if(q && !f.nameLower.includes(q)) return false;
    return true;
  });
}

function cropForField(fieldId){
  const p = plans.get(fieldId);
  const c = norm(p?.crop);
  if(c === 'corn') return 'corn';
  if(c === 'soybeans') return 'soybeans';
  return '';
}

function groupFields(list){
  const un = [];
  const co = [];
  const so = [];
  for(const f of list){
    const c = cropForField(f.id);
    if(c === 'corn') co.push(f);
    else if(c === 'soybeans') so.push(f);
    else un.push(f);
  }
  return { un, co, so };
}

/* ========= Rendering ========= */
function renderAll(){
  clearErr();

  const list = getFilteredFields();
  scopeHelp.textContent = `Showing ${list.length} active fields` + (farmNameEl.value ? ` in ${farmNameEl.value}` : '');

  const { un, co, so } = groupFields(list);

  zoneUnplanned.innerHTML = un.map(f=> renderCard(f, '')).join('') || renderEmpty('No unplanned fields in this view.');
  zoneCorn.innerHTML      = co.map(f=> renderCard(f, 'corn')).join('') || renderEmpty('Drag fields here for Corn.');
  zoneSoy.innerHTML       = so.map(f=> renderCard(f, 'soybeans')).join('') || renderEmpty('Drag fields here for Soybeans.');

  const unAc = un.reduce((s,f)=> s + (Number(f.tillable)||0), 0);
  const coAc = co.reduce((s,f)=> s + (Number(f.tillable)||0), 0);
  const soAc = so.reduce((s,f)=> s + (Number(f.tillable)||0), 0);

  kpiUnplannedFields.textContent = String(un.length);
  kpiUnplannedAcres.textContent  = to2(unAc);
  kpiCornFields.textContent      = String(co.length);
  kpiCornAcres.textContent       = to2(coAc);
  kpiSoyFields.textContent       = String(so.length);
  kpiSoyAcres.textContent        = to2(soAc);

  subUnplanned.textContent = `${un.length} fields • ${to2(unAc)} ac`;
  subCorn.textContent      = `${co.length} fields • ${to2(coAc)} ac`;
  subSoy.textContent       = `${so.length} fields • ${to2(soAc)} ac`;

  bindMobileButtons();
  btnUndo.disabled = undoStack.length === 0;
}

function renderEmpty(msg){
  return `<div class="muted" style="font-weight:900;padding:10px 2px">${esc(msg)}</div>`;
}

function renderCard(f, crop){
  const farmName = farmNameById.get(String(f.farmId||'')) || '';
  const acres = to2(f.tillable || 0);

  return `
    <div class="cardRow" data-field-id="${esc(f.id)}" data-crop="${esc(crop)}">
      <div class="dragGrip desktop-only" data-drag-grip="1" draggable="true" title="Drag">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="9" cy="7" r="1.6" fill="currentColor"></circle>
          <circle cx="15" cy="7" r="1.6" fill="currentColor"></circle>
          <circle cx="9" cy="12" r="1.6" fill="currentColor"></circle>
          <circle cx="15" cy="12" r="1.6" fill="currentColor"></circle>
          <circle cx="9" cy="17" r="1.6" fill="currentColor"></circle>
          <circle cx="15" cy="17" r="1.6" fill="currentColor"></circle>
        </svg>
      </div>

      <div class="cardMain">
        <div class="cardName" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="cardFarm" title="${esc(farmName)}">${esc(farmName)}</div>

        <div class="mobileSet">
          <button class="miniBtn miniBtnPrimary" data-mobile-set="corn" data-id="${esc(f.id)}" type="button">Corn</button>
          <button class="miniBtn miniBtnPrimary" data-mobile-set="soybeans" data-id="${esc(f.id)}" type="button">Beans</button>
          <button class="miniBtn" data-mobile-set="clear" data-id="${esc(f.id)}" type="button">Clear</button>
        </div>
      </div>

      <div class="cardMeta">
        <span class="pill">${acres} ac</span>
      </div>
    </div>
  `;
}

function bindMobileButtons(){
  document.querySelectorAll('[data-mobile-set]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id') || '';
      const action = btn.getAttribute('data-mobile-set') || '';
      if(!id) return;

      const f = fields.find(x=> x.id === id);
      if(!f) return;

      const fromCrop = cropForField(id);
      try{
        if(action === 'corn' || action === 'soybeans'){
          const payload = await setPlan(db, currentYear, f, action);
          plans.set(id, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
          undoStack.push({ fieldId: id, fromCrop, toCrop: action });
          showToast(`Planned: ${action === 'soybeans' ? 'soybeans' : 'corn'}`);
        }else if(action === 'clear'){
          await clearPlan(db, currentYear, id);
          plans.delete(id);
          undoStack.push({ fieldId: id, fromCrop, toCrop: '' });
          showToast('Cleared plan');
        }
        renderAll();
      }catch(e){
        console.error(e);
        showErr('Save failed. Check console for Firestore/rules/import errors.');
        showToast('Save failed');
      }
    }, { once:true });
  });
}

/* ========= DnD handlers ========= */
async function handleDrop({ fieldId, fromCrop, toCrop }){
  if(norm(fromCrop) === norm(toCrop)) return;

  const f = fields.find(x=> x.id === fieldId);
  if(!f) return;

  try{
    if(toCrop === 'corn' || toCrop === 'soybeans'){
      const payload = await setPlan(db, currentYear, f, toCrop);
      plans.set(fieldId, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
      undoStack.push({ fieldId, fromCrop: norm(fromCrop), toCrop: norm(toCrop) });
      showToast(`Planned: ${toCrop === 'soybeans' ? 'soybeans' : 'corn'}`);
    }else{
      await clearPlan(db, currentYear, fieldId);
      plans.delete(fieldId);
      undoStack.push({ fieldId, fromCrop: norm(fromCrop), toCrop: '' });
      showToast('Cleared plan');
    }
    renderAll();
  }catch(e){
    console.error(e);
    showErr('Drop save failed. Check console for Firestore/rules/import errors.');
    showToast('Save failed');
  }
}

/* ========= Undo ========= */
async function undoLast(){
  const last = undoStack.pop();
  if(!last){
    btnUndo.disabled = true;
    return;
  }

  const f = fields.find(x=> x.id === last.fieldId);
  if(!f){
    renderAll();
    return;
  }

  try{
    const target = norm(last.fromCrop);
    if(target === 'corn' || target === 'soybeans'){
      const payload = await setPlan(db, currentYear, f, target);
      plans.set(last.fieldId, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
      showToast('Undo: restored');
    }else{
      await clearPlan(db, currentYear, last.fieldId);
      plans.delete(last.fieldId);
      showToast('Undo: cleared');
    }
  }catch(e){
    console.error(e);
    showErr('Undo failed. Check console.');
    showToast('Undo failed');
  }

  renderAll();
}

/* ========= Load / refresh ========= */
async function refreshAll(){
  btnRefresh.disabled = true;
  clearErr();

  try{
    farmHelp.textContent = 'Loading farms…';
    farms = await loadFarms(db);

    if(!farms.length){
      farmHelp.textContent = '0 farms (check Firestore rules / console errors)';
      showErr('Farms returned 0. Open console: likely Firestore read blocked or JS import failed.');
    }else{
      farmHelp.textContent = `${farms.length} farms`;
    }

    farmNameById = new Map(farms.map(f=>[String(f.id), String(f.name)]));
    renderFarmList('');

    fields = await loadFields(db);
    plans = await loadPlansForYear(db, currentYear);

    // If selected farm no longer exists, reset
    if(farmIdEl.value && !farmNameById.get(String(farmIdEl.value))){
      farmIdEl.value = '';
      farmNameEl.value = '';
      farmBtn.textContent = '— All farms —';
    }

    renderAll();
    showToast('Ready');
  }catch(e){
    console.error(e);
    showErr('Load failed. Open console. Most common: missing JS file path or Firestore rules blocking reads.');
    showToast('Load failed');
  }finally{
    btnRefresh.disabled = false;
  }
}

/* ========= Events ========= */
let searchT = null;
searchEl.addEventListener('input', ()=>{
  clearTimeout(searchT);
  searchT = setTimeout(()=> renderAll(), 120);
});

yearEl.addEventListener('change', async ()=>{
  currentYear = String(yearEl.value || '').trim();
  undoStack = [];
  btnUndo.disabled = true;
  await refreshPlansOnly();
});

btnRefresh.addEventListener('click', refreshAll);
btnUndo.addEventListener('click', undoLast);

async function refreshPlansOnly(){
  btnRefresh.disabled = true;
  clearErr();
  try{
    showToast('Loading plans…');
    plans = await loadPlansForYear(db, currentYear);
    renderAll();
    showToast('Year loaded');
  }catch(e){
    console.error(e);
    showErr('Year load failed. Check console.');
    showToast('Year load failed');
  }finally{
    btnRefresh.disabled = false;
  }
}

/* ========= Boot ========= */
(async function boot(){
  buildYearOptions();

  try{
    db = await initDB();
  }catch(e){
    console.error(e);
    showErr('Firebase init failed. Check theme-boot/firebase-init chain and console.');
    return;
  }

  wireDnd({
    root: boardRoot,
    onDrop: handleDrop,
    onDragStart: ()=>{}
  });

  await refreshAll();
})();
