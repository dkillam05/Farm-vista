/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30e

Changes in this rev:
✅ Bulk actions moved into the 3 lower boxes (small buttons)
✅ Removed farm helper text “22 farms” (farmHelp kept blank)
✅ Removed year helper text “Only 2026 and 2027”
✅ Year dropdown is ONLY 2026 + 2027 (default 2026)
✅ Farm dropdown list no longer shows any status labels
✅ Page ALWAYS shows ACTIVE fields only
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
  showToast._t = setTimeout(()=> el.classList.remove('show'), 1100);
}

function closeAllCombos(except=null){
  document.querySelectorAll('.combo-panel.show').forEach(p=>{
    if(p!==except) p.classList.remove('show');
  });
}
document.addEventListener('click', ()=> closeAllCombos());
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeAllCombos(); });

async function runWithConcurrency(items, limit, worker){
  const arr = Array.from(items || []);
  let idx = 0;
  const total = arr.length;
  const runners = new Array(Math.max(1, limit)).fill(0).map(async ()=>{
    while(idx < total){
      const i = idx++;
      await worker(arr[i], i);
    }
  });
  await Promise.all(runners);
}

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

const btnAllCorn  = $('btnAllCorn');
const btnAllSoy   = $('btnAllSoy');
const btnAllClear = $('btnAllClear');

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
let currentYear = '2026';

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
        <div></div>
      </div>
    `);

  const topAll = `
    <div class="combo-item" data-id="">
      <div><strong>All farms</strong></div>
      <div></div>
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

/* ========= Year options (only 2026-2027) ========= */
function buildYearOptions(){
  const years = [2026, 2027];
  yearEl.innerHTML = years.map(v=> `<option value="${v}">${v}</option>`).join('');
  yearEl.value = '2026';
  currentYear = '2026';
}

/* ========= Filtering / grouping ========= */
function getShownFields(){
  const farmId = String(farmIdEl.value || '').trim();
  const q = norm(searchEl.value);

  // ✅ active-only lock
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
  const list = getShownFields();
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
}

function renderEmpty(msg){
  return `<div class="muted" style="font-weight:900;padding:10px 2px">${esc(msg)}</div>`;
}

function renderCard(f, crop){
  const farmName = farmNameById.get(String(f.farmId||'')) || '';
  const acres = to2(f.tillable || 0);

  return `
    <div class="cardRow" data-field-id="${esc(f.id)}" data-crop="${esc(crop)}">
      <div class="dragGrip" data-drag-grip="1" draggable="true" title="Drag">
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

      try{
        if(action === 'corn' || action === 'soybeans'){
          const payload = await setPlan(db, currentYear, f, action);
          plans.set(id, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
          showToast(`Planned: ${action}`);
        }else if(action === 'clear'){
          await clearPlan(db, currentYear, id);
          plans.delete(id);
          showToast('Cleared plan');
        }
        renderAll();
      }catch(e){
        console.error(e);
        showToast('Save failed (see console)');
      }
    }, { once:true });
  });
}

/* ========= DnD drop ========= */
async function handleDrop({ fieldId, fromCrop, toCrop }){
  if(norm(fromCrop) === norm(toCrop)) return;

  const f = fields.find(x=> x.id === fieldId);
  if(!f) return;

  try{
    if(toCrop === 'corn' || toCrop === 'soybeans'){
      const payload = await setPlan(db, currentYear, f, toCrop);
      plans.set(fieldId, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
      showToast(`Planned: ${toCrop}`);
    }else{
      await clearPlan(db, currentYear, fieldId);
      plans.delete(fieldId);
      showToast('Cleared plan');
    }
    renderAll();
  }catch(e){
    console.error(e);
    showToast('Save failed (see console)');
  }
}

/* ========= Bulk actions (ALL shown) ========= */
function disableBulk(disabled){
  btnAllCorn.disabled = !!disabled;
  btnAllSoy.disabled = !!disabled;
  btnAllClear.disabled = !!disabled;
  yearEl.disabled = !!disabled;
  if(disabled) closeAllCombos();
}

async function bulkSetAllShown(targetCrop){
  const list = getShownFields();
  if(!list.length) return;

  disableBulk(true);
  showToast(`Saving ${list.length}…`);

  try{
    const concurrency = 10;

    await runWithConcurrency(list, concurrency, async (f)=>{
      const payload = await setPlan(db, currentYear, f, targetCrop);
      plans.set(f.id, { crop: norm(payload.crop), acres: payload.acres, farmId: payload.farmId, fieldName: payload.fieldName, status: payload.status });
    });

    renderAll();
    showToast(`Moved ALL shown → ${targetCrop}`);
  }catch(e){
    console.error(e);
    showToast('Bulk save failed (see console)');
  }finally{
    disableBulk(false);
  }
}

async function bulkClearAllShown(){
  const list = getShownFields();
  if(!list.length) return;

  disableBulk(true);
  showToast(`Clearing ${list.length}…`);

  try{
    const concurrency = 10;

    await runWithConcurrency(list, concurrency, async (f)=>{
      await clearPlan(db, currentYear, f.id);
      plans.delete(f.id);
    });

    renderAll();
    showToast(`Cleared ALL shown`);
  }catch(e){
    console.error(e);
    showToast('Bulk clear failed (see console)');
  }finally{
    disableBulk(false);
  }
}

/* ========= Load ========= */
async function loadAll(){
  // ✅ No farm count helper text
  if(farmHelp) farmHelp.textContent = '';

  farms = await loadFarms(db);
  farmNameById = new Map(farms.map(f=>[String(f.id), String(f.name)]));

  renderFarmList('');

  fields = await loadFields(db);
  plans = await loadPlansForYear(db, currentYear);

  if(farmIdEl.value && !farmNameById.get(String(farmIdEl.value))){
    farmIdEl.value = '';
    farmNameEl.value = '';
    farmBtn.textContent = '— All farms —';
  }

  renderAll();
}

/* ========= Events ========= */
let searchT = null;
searchEl.addEventListener('input', ()=>{
  clearTimeout(searchT);
  searchT = setTimeout(()=> renderAll(), 120);
});

yearEl.addEventListener('change', async ()=>{
  currentYear = String(yearEl.value || '2026');
  plans = await loadPlansForYear(db, currentYear);
  renderAll();
  showToast(`Year: ${currentYear}`);
});

btnAllCorn.addEventListener('click', ()=> bulkSetAllShown('corn'));
btnAllSoy.addEventListener('click', ()=> bulkSetAllShown('soybeans'));
btnAllClear.addEventListener('click', bulkClearAllShown);

/* ========= Boot ========= */
(async function boot(){
  buildYearOptions();

  db = await initDB();

  wireDnd({
    root: boardRoot,
    onDrop: handleDrop,
    onDragStart: ()=>{}
  });

  await loadAll();
})();
