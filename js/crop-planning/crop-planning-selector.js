/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-30i

FIXES:
✅ Explicit drag intent (field vs farm)
✅ Dropdowns no longer auto-close incorrectly
✅ Fields can be split within same farm
✅ Bulk farm move ONLY when farm grip is used
===================================================================== */
'use strict';

import {
  initDB,
  loadFarms,
  loadFields,
  loadPlansForYear,
  setPlan,
  clearPlan
} from './crop-planning-data.js';

import { wireDnd } from './crop-planning-dnd.js';

const $ = id => document.getElementById(id);
const norm = s => String(s || '').trim().toLowerCase();
const to2 = n => Number(n || 0).toFixed(2);

/* ---------- DOM ---------- */
const farmBtn = $('farmBtn');
const farmPanel = $('farmPanel');
const farmList = $('farmList');
const farmSearch = $('farmSearch');
const farmIdEl = $('farmId');
const farmNameEl = $('farmName');

const yearEl = $('year');
const searchEl = $('search');
const scopeHelp = $('scopeHelp');
const boardScroll = $('boardScroll');

const kpiUnplannedFields = $('kpiUnplannedFields');
const kpiUnplannedAcres  = $('kpiUnplannedAcres');
const kpiCornFields      = $('kpiCornFields');
const kpiCornAcres       = $('kpiCornAcres');
const kpiSoyFields       = $('kpiSoyFields');
const kpiSoyAcres        = $('kpiSoyAcres');

/* ---------- State ---------- */
let db;
let farms = [];
let fields = [];
let plans = new Map();
let farmNameById = new Map();
let currentYear = '2026';

/* ---------- Combo Safety ---------- */
document.addEventListener('click', (e)=>{
  if (e.target.closest('.combo')) return;
  farmPanel.classList.remove('show');
});

/* ---------- Farm Combo ---------- */
farmBtn.onclick = (e)=>{
  e.stopPropagation();
  farmPanel.classList.toggle('show');
  farmSearch.value = '';
  renderFarmList('');
};

farmPanel.onclick = e => e.stopPropagation();

farmSearch.oninput = () => renderFarmList(farmSearch.value);

function renderFarmList(q){
  const qq = norm(q);
  farmList.innerHTML = `
    <div class="combo-item" data-id=""><strong>All farms</strong></div>
    ${farms.filter(f=>!qq||norm(f.name).includes(qq)).map(f=>`
      <div class="combo-item" data-id="${f.id}">${f.name}</div>
    `).join('')}
  `;
}

farmList.onclick = (e)=>{
  const row = e.target.closest('.combo-item');
  if (!row) return;

  const id = row.dataset.id || '';
  if (!id) {
    farmIdEl.value = '';
    farmNameEl.value = '';
    farmBtn.textContent = '— All farms —';
  } else {
    const f = farms.find(x=>x.id===id);
    farmIdEl.value = f.id;
    farmNameEl.value = f.name;
    farmBtn.textContent = f.name;
  }
  farmPanel.classList.remove('show');
  render();
};

/* ---------- Year ---------- */
yearEl.innerHTML = `<option>2026</option><option>2027</option>`;
yearEl.value = '2026';
yearEl.onchange = async ()=>{
  currentYear = yearEl.value;
  plans = await loadPlansForYear(db, currentYear);
  render();
};

/* ---------- Helpers ---------- */
function cropOf(fieldId){
  const c = plans.get(fieldId)?.crop;
  return c === 'corn' || c === 'soybeans' ? c : '';
}

function shownFields(){
  const q = norm(searchEl.value);
  return fields.filter(f=>{
    if (f.status !== 'active') return false;
    if (farmIdEl.value && f.farmId !== farmIdEl.value) return false;
    if (q && !norm(f.name).includes(q)) return false;
    return true;
  });
}

/* ---------- Render ---------- */
function render(){
  const list = shownFields();

  let u=0, ua=0, c=0, ca=0, s=0, sa=0;
  const byFarm = {};

  list.forEach(f=>{
    const crop = cropOf(f.id);
    const a = Number(f.tillable||0);
    if (!byFarm[f.farmId]) byFarm[f.farmId]={farmId:f.farmId, name:farmNameById.get(f.farmId), fields:[]};
    byFarm[f.farmId].fields.push(f);

    if (crop==='corn'){ c++; ca+=a; }
    else if (crop==='soybeans'){ s++; sa+=a; }
    else { u++; ua+=a; }
  });

  kpiUnplannedFields.textContent = u;
  kpiUnplannedAcres.textContent  = to2(ua);
  kpiCornFields.textContent      = c;
  kpiCornAcres.textContent       = to2(ca);
  kpiSoyFields.textContent       = s;
  kpiSoyAcres.textContent        = to2(sa);

  scopeHelp.textContent = `Showing ${list.length} active fields`;

  boardScroll.innerHTML = Object.values(byFarm).map(farm=>{
    return `
      <div class="farmLane" data-farm-id="${farm.farmId}">
        <div class="farmLaneHead">
          <div class="farmGrip" data-drag-type="farm" draggable="true">⋮⋮</div>
          <strong>${farm.name}</strong>
        </div>
        <div class="farmLaneBody">
          <div class="buckets">
            ${renderBucket(farm, '')}
            ${renderBucket(farm, 'corn')}
            ${renderBucket(farm, 'soybeans')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderBucket(farm, crop){
  const rows = farm.fields.filter(f=>cropOf(f.id)===crop).map(f=>`
    <div class="cardRow" data-field-id="${f.id}" data-crop="${crop}">
      <div class="dragGrip" data-drag-type="field" draggable="true">⋮⋮</div>
      <div>${f.name}</div>
      <div>${to2(f.tillable)} ac</div>
    </div>
  `).join('');

  return `
    <div class="bucket">
      <div class="bucketHead">${crop||'Unplanned'}</div>
      <div class="bucketBody" data-crop="${crop}">
        ${rows||'<div class="muted">—</div>'}
      </div>
    </div>
  `;
}

/* ---------- Drop ---------- */
async function onDrop({ type, fieldId, farmId, toCrop }){
  if (type === 'field') {
    const f = fields.find(x=>x.id===fieldId);
    if (!f) return;
    if (toCrop) await setPlan(db, currentYear, f, toCrop);
    else await clearPlan(db, currentYear, fieldId);
    plans = await loadPlansForYear(db, currentYear);
    render();
    return;
  }

  if (type === 'farm') {
    const farmFields = shownFields().filter(f=>f.farmId===farmId);
    for (const f of farmFields){
      if (toCrop) await setPlan(db, currentYear, f, toCrop);
      else await clearPlan(db, currentYear, f.id);
    }
    plans = await loadPlansForYear(db, currentYear);
    render();
  }
}

/* ---------- Boot ---------- */
(async function(){
  db = await initDB();
  farms = await loadFarms(db);
  fields = await loadFields(db);
  farmNameById = new Map(farms.map(f=>[f.id,f.name]));
  plans = await loadPlansForYear(db, currentYear);

  wireDnd({ root: document, onDrop });
  render();
})();
