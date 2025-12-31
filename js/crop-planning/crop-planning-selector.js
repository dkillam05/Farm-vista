/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30g

Farm-first planner:
- Each farm appears once (collapsible lane)
- Inside lane: 3 buckets (unplanned/corn/soybeans)
- Drag field between buckets
- Drag farm header onto top headers (laneHeader) to set entire farm
- Active fields only
- Years: 2026–2027 only
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

const laneHeader = $('laneHeader');
const boardScroll = $('boardScroll');

/* ========= State ========= */
let db = null;
let farms = [];
let fields = [];
let farmNameById = new Map();
let plans = new Map();
let currentYear = '2026';

const EXP_KEY = 'fv:cropplan:lanesOpen:v1';
let openFarm = Object.create(null);

function loadOpen(){
  try{
    const raw = localStorage.getItem(EXP_KEY);
    if(raw){
      const obj = JSON.parse(raw);
      if(obj && typeof obj === 'object') openFarm = obj;
    }
  }catch{}
}
function saveOpen(){
  try{ localStorage.setItem(EXP_KEY, JSON.stringify(openFarm)); }catch{}
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

/* ========= Years ========= */
function buildYearOptions(){
  const years = [2026, 2027];
  yearEl.innerHTML = years.map(v=> `<option value="${v}">${v}</option>`).join('');
  yearEl.value = '2026';
  currentYear = '2026';
}

/* ========= Filtering ========= */
function getShownFields(){
  const farmId = String(farmIdEl.value || '').trim();
  const q = norm(searchEl.value);

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

/* ========= Rendering ========= */
function renderAll(){
  if(farmHelp) farmHelp.textContent = '';

  const list = getShownFields();
  scopeHelp.textContent = `Showing ${list.length} active fields` + (farmNameEl.value ? ` in ${farmNameEl.value}` : '');

  // KPIs across shown fields
  let unCnt=0, coCnt=0, soCnt=0;
  let unAc=0, coAc=0, soAc=0;

  // Group by farm
  const byFarm = new Map(); // farmId -> {farmId,farmName,fields:[]}
  for(const f of list){
    const fid = String(f.farmId||'');
    const nm = farmNameById.get(fid) || '(Unknown Farm)';
    if(!byFarm.has(fid)) byFarm.set(fid, { farmId: fid, farmName: nm, fields: [] });
    byFarm.get(fid).fields.push(f);

    const b = bucketOfField(f);
    const a = Number(f.tillable||0);
    if(b === 'corn'){ coCnt++; coAc+=a; }
    else if(b === 'soybeans'){ soCnt++; soAc+=a; }
    else { unCnt++; unAc+=a; }
  }

  kpiUnplannedFields.textContent = String(unCnt);
  kpiUnplannedAcres.textContent  = to2(unAc);
  kpiCornFields.textContent      = String(coCnt);
  kpiCornAcres.textContent       = to2(coAc);
  kpiSoyFields.textContent       = String(soCnt);
  kpiSoyAcres.textContent        = to2(soAc);

  // Sort farms by name
  const farmsArr = Array.from(byFarm.values()).sort((a,b)=> a.farmName.localeCompare(b.farmName));

  // Default open: if a specific farm is selected, open it; else collapsed
  const defaultOpen = !!farmIdEl.value;

  boardScroll.innerHTML = farmsArr.map(g=>{
    const open = (openFarm[g.farmId] != null) ? !!openFarm[g.farmId] : defaultOpen;

    // split into buckets
    const un = [], co = [], so = [];
    let unA=0, coA=0, soA=0;
    g.fields.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));

    for(const f of g.fields){
      const b = bucketOfField(f);
      const a = Number(f.tillable||0);
      if(b === 'corn'){ co.push(f); coA+=a; }
      else if(b === 'soybeans'){ so.push(f); soA+=a; }
      else { un.push(f); unA+=a; }
    }

    return `
      <div class="farmLane" data-farm-id="${esc(g.farmId)}" data-open="${open?'1':'0'}">
        <div class="farmLaneHead" data-farm-toggle="1">
          <div class="farmGrip" data-drag-grip="1" draggable="true" title="Drag farm (drop on top headers)">
            ${gripSvg()}
          </div>
          <div class="farmLaneTitle" title="${esc(g.farmName)}">${esc(g.farmName)}</div>
          <div class="farmLaneMeta">${g.fields.length} • ${to2(unA+coA+soA)} ac</div>
          <div class="chev" aria-hidden="true">${chevSvg()}</div>
        </div>

        <div class="farmLaneBody">
          <div class="buckets">
            ${renderBucket(g.farmId, 'Unplanned', '', un, unA)}
            ${renderBucket(g.farmId, 'Corn', 'corn', co, coA)}
            ${renderBucket(g.farmId, 'Soybeans', 'soybeans', so, soA)}
          </div>
        </div>
      </div>
    `;
  }).join('') || `<div class="muted" style="font-weight:900;padding:12px">No fields match your filters.</div>`;

  bindLaneToggleClicks();
  bindMobileButtons();
  bindHeaderFarmDrops(); // farm header -> top header
}

function renderBucket(farmId, title, crop, arr, acres){
  const rows = arr.length ? arr.map(f=> renderFieldCard(farmId, crop, f)).join('')
                          : `<div class="muted" style="font-weight:900">—</div>`;
  return `
    <div class="bucket">
      <div class="bucketHead">
        <div class="bucketTitle">${esc(title)}</div>
        <div class="bucketSub">${arr.length} • ${to2(acres)} ac</div>
      </div>
      <div class="bucketBody" data-crop="${esc(crop)}" data-farm-id="${esc(farmId)}">
        ${rows}
      </div>
    </div>
  `;
}

function renderFieldCard(farmId, crop, f){
  const acres = to2(f.tillable || 0);
  return `
    <div class="cardRow" data-field-id="${esc(f.id)}" data-farm-id="${esc(farmId)}" data-crop="${esc(crop)}">
      <div class="dragGrip" data-drag-grip="1" draggable="true" title="Drag field">${gripSvg()}</div>
      <div>
        <div class="cardName" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="mobileSet">
          <button class="miniBtn miniBtnPrimary" data-mobile-set="corn" data-id="${esc(f.id)}" type="button">Corn</button>
          <button class="miniBtn miniBtnPrimary" data-mobile-set="soybeans" data-id="${esc(f.id)}" type="button">Beans</button>
          <button class="miniBtn" data-mobile-set="clear" data-id="${esc(f.id)}" type="button">Clear</button>
        </div>
      </div>
      <div class="pill">${acres} ac</div>
    </div>
  `;
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

function bindLaneToggleClicks(){
  document.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
    head.addEventListener('click', (e)=>{
      if(e.target?.closest?.('.farmGrip')) return;
      const lane = head.closest('.farmLane');
      if(!lane) return;
      const farmId = lane.getAttribute('data-farm-id') || '';
      const open = lane.getAttribute('data-open') === '1';
      const next = !open;
      lane.setAttribute('data-open', next ? '1':'0');
      openFarm[farmId] = next;
      saveOpen();
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
          const p = await setPlan(db, currentYear, f, action);
          plans.set(id, { crop: norm(p.crop) });
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

/* ========= Farm header drop targets ========= */
function bindHeaderFarmDrops(){
  laneHeader.querySelectorAll('[data-header-drop="1"]').forEach(box=>{
    box.addEventListener('dragover', (e)=>{
      e.preventDefault();
      box.classList.add('is-over');
    });
    box.addEventListener('dragleave', ()=> box.classList.remove('is-over'));
    box.addEventListener('drop', async (e)=>{
      box.classList.remove('is-over');
      e.preventDefault();

      const type = e.dataTransfer?.getData('text/fv-type') || '';
      if(type !== 'farm') return;

      const farmId = e.dataTransfer?.getData('text/fv-farm-id') || '';
      const toCrop = box.getAttribute('data-crop') || '';
      if(!farmId) return;

      await moveFarmInScope(farmId, toCrop);
    });
  });
}

/* ========= DnD drop handling ========= */
async function onDrop(payload){
  if(payload?.type === 'farm'){
    // Dropping a farm onto a bucket: treat same as header drop but restrict to the target farmId anyway
    await moveFarmInScope(payload.farmId, payload.toCrop);
    return;
  }

  if(payload?.type === 'field'){
    // prevent cross-farm drops
    if(payload.toFarmId && payload.fromFarmId && payload.toFarmId !== payload.fromFarmId) return;
    await moveField(payload.fieldId, payload.fromCrop, payload.toCrop);
  }
}

async function moveField(fieldId, fromCrop, toCrop){
  if(norm(fromCrop) === norm(toCrop)) return;
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

  // Scope to current filters/search AND this farm
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
      showToast(`Farm → ${toCrop}`);
    }else{
      await runWithConcurrency(visible, concurrency, async (f)=>{
        await clearPlan(db, currentYear, f.id);
        plans.delete(f.id);
      });
      showToast(`Farm → unplanned`);
    }
    renderAll();
  }catch(e){
    console.error(e);
    showToast('Farm move failed (see console)');
  }
}

/* ========= Load ========= */
async function loadAll(){
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
  loadOpen();
  buildYearOptions();

  db = await initDB();

  // wire bucket dnd; rebind zones after each render
  wireDnd({
    root: document,
    onDrop,
    onNeedBind: (bindZones)=> {
      // called immediately; we also need to rebind after renderAll()
      // easiest: call bindZones inside renderAll by re-invoking wireDnd? no.
      // So we simply call bindZones once now; zones are delegated by current DOM.
      bindZones();
    }
  });

  await loadAll();
})();
