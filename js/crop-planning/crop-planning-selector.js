/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30f

Major change:
✅ No more “move all / clear all” buttons.
✅ Columns show collapsible farm groups.
✅ Drag farm header to move whole farm.
✅ Drag field row to move single field.
✅ Active fields only.
✅ Years: 2026–2027 only (default 2026).
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

// expanded state per column+farmId
let expanded = Object.create(null);
// persist in localStorage so it stays as you work
const EXP_KEY = 'fv:cropplan:expanded:v1';

function loadExpanded(){
  try{
    const raw = localStorage.getItem(EXP_KEY);
    if(raw){
      const obj = JSON.parse(raw);
      if(obj && typeof obj === 'object') expanded = obj;
    }
  }catch{}
}
function saveExpanded(){
  try{ localStorage.setItem(EXP_KEY, JSON.stringify(expanded)); }catch{}
}
function expKey(bucket, farmId){ return `${bucket}::${farmId}`; }
function isOpen(bucket, farmId, defaultOpen){
  const k = expKey(bucket, farmId);
  if(Object.prototype.hasOwnProperty.call(expanded, k)) return !!expanded[k];
  return !!defaultOpen;
}
function setOpen(bucket, farmId, open){
  expanded[expKey(bucket, farmId)] = !!open;
  saveExpanded();
}

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

function bucketOfField(f){
  const c = cropForField(f.id);
  if(c === 'corn') return 'corn';
  if(c === 'soybeans') return 'soybeans';
  return '';
}

function groupByFarm(list){
  // returns Map<farmId, {farmId, farmName, fields[], acres}>
  const out = new Map();
  for(const f of list){
    const fid = String(f.farmId || '');
    const nm = farmNameById.get(fid) || '(Unknown Farm)';
    if(!out.has(fid)){
      out.set(fid, { farmId: fid, farmName: nm, fields: [], acres: 0 });
    }
    const g = out.get(fid);
    g.fields.push(f);
    g.acres += Number(f.tillable || 0);
  }
  // sort fields by name
  for(const g of out.values()){
    g.fields.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
  }
  // sort groups by farmName
  return Array.from(out.values()).sort((a,b)=> String(a.farmName||'').localeCompare(String(b.farmName||'')));
}

function splitIntoBuckets(list){
  const un = [];
  const co = [];
  const so = [];
  for(const f of list){
    const b = bucketOfField(f);
    if(b === 'corn') co.push(f);
    else if(b === 'soybeans') so.push(f);
    else un.push(f);
  }
  return { un, co, so };
}

/* ========= Rendering ========= */
function renderAll(){
  const list = getShownFields();
  scopeHelp.textContent = `Showing ${list.length} active fields` + (farmNameEl.value ? ` in ${farmNameEl.value}` : '');

  const { un, co, so } = splitIntoBuckets(list);

  renderColumn(zoneUnplanned, '', un);
  renderColumn(zoneCorn, 'corn', co);
  renderColumn(zoneSoy, 'soybeans', so);

  // KPI totals (across shown fields)
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

  bindFarmToggleClicks();
  bindMobileButtons();
}

function renderColumn(zoneEl, bucket, list){
  const groups = groupByFarm(list);

  // default open behavior:
  // - if a specific farm is selected: open groups
  // - if all farms: default collapsed (keeps it short)
  const defaultOpen = !!farmIdEl.value;

  if(!groups.length){
    zoneEl.innerHTML = `<div class="muted" style="font-weight:900;padding:10px 2px">No fields in this view.</div>`;
    return;
  }

  zoneEl.innerHTML = groups.map(g=>{
    const open = isOpen(bucket, g.farmId, defaultOpen);
    const body = g.fields.map(f=> renderFieldCard(f, bucket)).join('');

    // if there are 0 fields in group (shouldn't happen), collapse header border
    const headClass = g.fields.length ? '' : 'compact';

    return `
      <div class="farmGroup" data-farm-id="${esc(g.farmId)}" data-bucket="${esc(bucket)}" data-open="${open ? '1':'0'}">
        <div class="farmHead ${headClass}" data-farm-toggle="1" title="Click to expand/collapse">
          <div class="farmGrip" data-drag-grip="1" draggable="true" aria-label="Drag farm" title="Drag farm to move entire farm">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <circle cx="9" cy="7" r="1.6" fill="currentColor"></circle>
              <circle cx="15" cy="7" r="1.6" fill="currentColor"></circle>
              <circle cx="9" cy="12" r="1.6" fill="currentColor"></circle>
              <circle cx="15" cy="12" r="1.6" fill="currentColor"></circle>
              <circle cx="9" cy="17" r="1.6" fill="currentColor"></circle>
              <circle cx="15" cy="17" r="1.6" fill="currentColor"></circle>
            </svg>
          </div>

          <div class="farmTitle">${esc(g.farmName)}</div>
          <div class="farmMeta">${g.fields.length} • ${to2(g.acres)} ac</div>
          <div class="chev" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </div>
        </div>

        <div class="farmBody">
          ${body}
        </div>
      </div>
    `;
  }).join('');
}

function renderFieldCard(f, bucket){
  const acres = to2(f.tillable || 0);

  return `
    <div class="cardRow" data-field-id="${esc(f.id)}" data-crop="${esc(bucket)}">
      <div class="dragGrip" data-drag-grip="1" draggable="true" title="Drag field">
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

function bindFarmToggleClicks(){
  document.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
    head.addEventListener('click', (e)=>{
      // Don't toggle if clicking the drag grip
      if(e.target?.closest?.('.farmGrip')) return;

      const wrap = head.closest('.farmGroup');
      if(!wrap) return;
      const farmId = wrap.getAttribute('data-farm-id') || '';
      const bucket = wrap.getAttribute('data-bucket') || '';
      const isOpenNow = wrap.getAttribute('data-open') === '1';
      const next = !isOpenNow;

      wrap.setAttribute('data-open', next ? '1':'0');
      setOpen(bucket, farmId, next);
    }, { once:true });
  });
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
          plans.set(id, { crop: norm(payload.crop) });
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

/* ========= Drop handling ========= */
async function handleDrop(payload){
  if(payload?.type === 'farm'){
    await handleFarmDrop(payload.farmId, payload.toCrop);
    return;
  }
  await handleFieldDrop(payload.fieldId, payload.fromCrop, payload.toCrop);
}

async function handleFieldDrop(fieldId, fromCrop, toCrop){
  if(norm(fromCrop) === norm(toCrop)) return;
  const f = fields.find(x=> x.id === fieldId);
  if(!f) return;

  try{
    if(toCrop === 'corn' || toCrop === 'soybeans'){
      const p = await setPlan(db, currentYear, f, toCrop);
      plans.set(fieldId, { crop: norm(p.crop) });
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

async function handleFarmDrop(farmId, toCrop){
  const fid = String(farmId || '').trim();
  if(!fid) return;

  // Scope to CURRENT VIEW FILTERS (active-only + farm filter + search)
  // Then narrow to this farm.
  const visible = getShownFields().filter(f=> String(f.farmId||'') === fid);
  if(!visible.length) return;

  showToast(`Moving ${visible.length}…`);

  const concurrency = 10;

  try{
    if(toCrop === 'corn' || toCrop === 'soybeans'){
      await runWithConcurrency(visible, concurrency, async (f)=>{
        const p = await setPlan(db, currentYear, f, toCrop);
        plans.set(f.id, { crop: norm(p.crop) });
      });
      showToast(`Moved farm → ${toCrop}`);
    }else{
      await runWithConcurrency(visible, concurrency, async (f)=>{
        await clearPlan(db, currentYear, f.id);
        plans.delete(f.id);
      });
      showToast(`Moved farm → unplanned`);
    }
    renderAll();
  }catch(e){
    console.error(e);
    showToast('Farm move failed (see console)');
  }
}

/* ========= Load ========= */
async function loadAll(){
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

/* ========= Boot ========= */
(async function boot(){
  loadExpanded();
  buildYearOptions();

  db = await initDB();

  wireDnd({
    root: boardRoot,
    onDrop: handleDrop
  });

  await loadAll();
})();
