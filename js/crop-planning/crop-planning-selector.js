/* =====================================================================
/Farm-vista/js/crop-planning/crop-planning-selector.js  (FULL FILE)
Rev: 2025-12-31a

Implements:
1) ✅ Preserve scroll position (board + each bucket) after moves
2) ✅ Ctrl multi-select fields within a farm; drag selected as a group
3) ✅ Comma formatting for acres/numbers
4) ✅ Writes plans to NEW collection via crop-planning-data.js (v2)

Also:
✅ Narrow screen view-only (no drag; hint displayed)
===================================================================== */
'use strict';

import { initDB, loadFarms, loadFields, loadPlansForYear, setPlan, clearPlan } from './crop-planning-data.js';
import { wireDnd } from './crop-planning-dnd.js';

const $ = (id) => document.getElementById(id);
const norm = (s) => String(s || '').trim().toLowerCase();

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US');

function isNarrow(){ return window.matchMedia('(max-width: 980px)').matches; }

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

// selection state (per farm)
const selection = new Map(); // farmId -> Set(fieldId)
function clearSelection(farmId){
  if(farmId) selection.delete(farmId);
  else selection.clear();
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
    .map(f => `<div class="combo-item" data-id="${f.id}"><div>${escapeHtml(f.name)}</div><div></div></div>`)
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
  clearSelection();
  renderAll();
});

/* ---------- Year options ---------- */
function buildYearOptions(){
  yearEl.innerHTML = `<option value="2026">2026</option><option value="2027">2027</option>`;
  yearEl.value = '2026';
  currentYear = '2026';
}
yearEl.addEventListener('change', async ()=>{
  currentYear = String(yearEl.value || '2026');
  plans = await loadPlansForYear(db, currentYear);
  clearSelection();
  renderAll(true);
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
  searchEl._t = setTimeout(()=> renderAll(true), 120);
});

/* ---------- Scroll preservation ---------- */
function snapshotScroll(){
  const snap = { boardTop: boardScroll?.scrollTop || 0, buckets: {} };
  document.querySelectorAll('.bucketBody[data-farm-id][data-crop]').forEach(el=>{
    const k = `${el.dataset.farmId}::${el.dataset.crop}`;
    snap.buckets[k] = el.scrollTop || 0;
  });
  return snap;
}
function restoreScroll(snap){
  if(!snap) return;
  if(boardScroll) boardScroll.scrollTop = snap.boardTop || 0;

  document.querySelectorAll('.bucketBody[data-farm-id][data-crop]').forEach(el=>{
    const k = `${el.dataset.farmId}::${el.dataset.crop}`;
    if(snap.buckets[k] != null) el.scrollTop = snap.buckets[k];
  });
}

/* ---------- Render ---------- */
function escapeHtml(s){
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

function ensureViewOnlyHint(narrow){
  let hint = document.getElementById('fvViewOnlyHint');
  if(!hint){
    hint = document.createElement('div');
    hint.id = 'fvViewOnlyHint';
    hint.className = 'help';
    hint.style.display = 'none';
    hint.style.fontWeight = '900';
    hint.textContent = 'View only on phone — use desktop for planning.';
    const row3 = document.querySelector('.row3');
    if(row3 && row3.parentNode) row3.parentNode.insertBefore(hint, row3.nextSibling);
  }
  hint.style.display = narrow ? 'block' : 'none';
}

function renderAll(preserveScroll=false){
  const narrow = isNarrow();
  ensureViewOnlyHint(narrow);
  if (farmHelp) farmHelp.textContent = '';

  const scrollSnap = preserveScroll ? snapshotScroll() : null;

  const list = getShownFields();
  scopeHelp.textContent = `Showing ${fmt0.format(list.length)} active fields` + (farmNameEl.value ? ` in ${farmNameEl.value}` : '');

  // KPIs + group by farm
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

  kpiUnplannedFields.textContent = fmt0.format(unCnt);
  kpiUnplannedAcres.textContent  = fmt2.format(unAc);
  kpiCornFields.textContent      = fmt0.format(coCnt);
  kpiCornAcres.textContent       = fmt2.format(coAc);
  kpiSoyFields.textContent       = fmt0.format(soCnt);
  kpiSoyAcres.textContent        = fmt2.format(soAc);

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

    const plannedBadge = (coN + soN) > 0
      ? ` <span class="muted">(${coN ? `Corn ${fmt0.format(coN)}` : ''}${coN && soN ? ' • ' : ''}${soN ? `Beans ${fmt0.format(soN)}` : ''})</span>`
      : '';

    return `
      <div class="farmLane" data-farm-id="${escapeHtml(g.farmId)}" data-open="${open ? '1':'0'}">
        <div class="farmLaneHead" data-farm-toggle="1">
          <div class="farmGrip" data-drag-type="farm" draggable="${narrow ? 'false':'true'}"
               title="${narrow ? 'View only' : 'Drag farm'}"
               style="${narrow ? 'opacity:.45;cursor:not-allowed;' : ''}">
            ${gripSvg()}
          </div>
          <div class="farmLaneTitle" title="${escapeHtml(g.farmName)}">${escapeHtml(g.farmName)}${plannedBadge}</div>
          <div class="farmLaneMeta">${fmt0.format(g.fields.length)} • ${fmt2.format(unA+coA+soA)} ac</div>
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
  bindCtrlSelection();

  // restore scroll after DOM update
  if(scrollSnap) restoreScroll(scrollSnap);
}

function renderBucket(farmId, title, crop, arr, acres, narrow){
  const rows = arr.length ? arr.map(f=> renderFieldRow(farmId, crop, f, narrow)).join('')
                          : `<div class="muted" style="font-weight:900">—</div>`;

  // Bucket header grip for moving ALL of this bucket within this farm
  // (e.g. drag Unplanned header → Corn to move ALL unplanned for that farm)
  return `
    <div class="bucket">
      <div class="bucketHead" data-bucket-crop="${escapeHtml(crop)}" data-bucket-farm="${escapeHtml(farmId)}">
        <div style="display:flex;gap:8px;align-items:center;min-width:0;">
          <div class="dragGrip" data-drag-type="bucket" draggable="${narrow ? 'false':'true'}"
               title="${narrow ? 'View only' : 'Drag to move all'}"
               style="${narrow ? 'opacity:.45;cursor:not-allowed;' : 'width:22px;height:22px;'}">
            ${gripSvg()}
          </div>
          <div class="bucketTitle" style="min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</div>
        </div>
        <div class="bucketSub">${fmt0.format(arr.length)} • ${fmt2.format(acres)} ac</div>
      </div>

      <div class="bucketBody" data-crop="${escapeHtml(crop)}" data-farm-id="${escapeHtml(farmId)}">
        ${rows}
      </div>
    </div>
  `;
}

function renderFieldRow(farmId, crop, f, narrow){
  const sel = selection.get(farmId);
  const isSel = sel ? sel.has(f.id) : false;

  // If multiple selected within same farm, we embed selected ids on each selected row
  // so dragging any selected row drags the set.
  const selectedIdsJson = isSel && sel && sel.size > 1 ? escapeHtml(JSON.stringify(Array.from(sel))) : '';

  return `
    <div class="cardRow ${isSel ? 'fvSel' : ''}"
         data-field-id="${escapeHtml(f.id)}"
         data-farm-id="${escapeHtml(farmId)}"
         data-crop="${escapeHtml(crop)}"
         data-selected-ids="${selectedIdsJson}">
      <div class="dragGrip" data-drag-type="field" draggable="${narrow ? 'false':'true'}"
           title="${narrow ? 'View only' : (sel && sel.size > 1 && isSel ? `Drag ${sel.size} selected` : 'Drag field')}"
           style="${narrow ? 'opacity:.45;cursor:not-allowed;' : ''}">
        ${gripSvg()}
      </div>

      <div class="cardName" title="${escapeHtml(f.name)}" style="cursor:${narrow?'default':'pointer'};">
        ${escapeHtml(f.name)}
      </div>

      <div class="pill">${fmt2.format(Number(f.tillable||0))} ac</div>
    </div>
  `;
}

/* ---------- Ctrl selection (within same farm) ---------- */
function bindCtrlSelection(){
  // inject a tiny style for selected rows (no HTML edits needed)
  if(!document.getElementById('fvCropSelStyle')){
    const st = document.createElement('style');
    st.id = 'fvCropSelStyle';
    st.textContent = `
      .fvSel{ outline:2px solid rgba(47,108,60,.45); outline-offset:-2px; background:rgba(47,108,60,.06); }
    `;
    document.head.appendChild(st);
  }

  // click handler on field name area (or row) with Ctrl
  document.querySelectorAll('.cardRow[data-field-id]').forEach(row=>{
    if(row._fvSelBound) return;
    row._fvSelBound = true;

    row.addEventListener('click', (e)=>{
      if(isNarrow()) return;
      if(!e.ctrlKey) return;

      const farmId = row.dataset.farmId || '';
      const fieldId = row.dataset.fieldId || '';
      if(!farmId || !fieldId) return;

      let set = selection.get(farmId);
      if(!set){ set = new Set(); selection.set(farmId, set); }

      if(set.has(fieldId)) set.delete(fieldId);
      else set.add(fieldId);

      // if empty, remove map entry
      if(set.size === 0) selection.delete(farmId);

      // re-render but keep scroll (so you don’t jump)
      renderAll(true);
    });
  });
}

/* ---------- Lane collapse ---------- */
function bindLaneToggles(){
  document.querySelectorAll('[data-farm-toggle="1"]').forEach(head=>{
    if(head._fvBound) return;
    head._fvBound = true;

    head.addEventListener('click', (e)=>{
      // don’t toggle when interacting with grips
      if(e.target.closest('[data-drag-type]')) return;

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

  const scrollSnap = snapshotScroll();

  if(payload.type === 'field'){
    await moveField(payload.fieldId, payload.toCrop);
    renderAll(true);
    restoreScroll(scrollSnap);
    return;
  }

  if(payload.type === 'fields'){
    await moveManyFields(payload.fieldIdsJson, payload.toCrop);
    renderAll(true);
    restoreScroll(scrollSnap);
    return;
  }

  if(payload.type === 'bucket'){
    await moveBucket(payload.bucketFarm, payload.bucketCrop, payload.toCrop);
    renderAll(true);
    restoreScroll(scrollSnap);
    return;
  }

  if(payload.type === 'farm'){
    await moveFarmInScope(payload.farmId, payload.toCrop);
    renderAll(true);
    restoreScroll(scrollSnap);
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
    // clear selection for this field
    const set = selection.get(f.farmId);
    if(set) set.delete(fieldId);
  }catch(e){
    console.error(e);
    showToast('Save failed (see console)');
  }
}

async function moveManyFields(fieldIdsJson, toCrop){
  let ids = [];
  try{ ids = JSON.parse(fieldIdsJson || '[]'); }catch{ ids = []; }
  ids = Array.isArray(ids) ? ids.map(String) : [];
  if(!ids.length) return;

  const byFarm = new Map();
  for(const id of ids){
    const f = fields.find(x=> x.id === id);
    if(!f) continue;
    if(!byFarm.has(f.farmId)) byFarm.set(f.farmId, []);
    byFarm.get(f.farmId).push(f);
  }

  // small concurrency per farm list
  for(const [farmId, list] of byFarm.entries()){
    let idx = 0;
    const runners = new Array(6).fill(0).map(async ()=>{
      while(idx < list.length){
        const f = list[idx++];
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

    // clear selection for that farm
    selection.delete(farmId);
  }

  showToast(`Moved ${fmt0.format(ids.length)} field(s)`);
}

async function moveBucket(farmId, bucketCrop, toCrop){
  // Move all fields currently in bucketCrop for that farm to toCrop
  const shown = getShownFields().filter(f=> f.farmId === String(farmId||''));
  if(!shown.length) return;

  const ids = shown.filter(f=> cropForField(f.id) === (bucketCrop || '')).map(f=> f.id);
  if(!ids.length) return;

  await moveManyFields(JSON.stringify(ids), toCrop);
}

async function moveFarmInScope(farmId, toCrop){
  const fid = String(farmId||'').trim();
  if(!fid) return;

  const visible = getShownFields().filter(f=> f.farmId === fid);
  if(!visible.length) return;

  showToast(`Moving ${fmt0.format(visible.length)}…`);

  let idx = 0;
  const runners = new Array(8).fill(0).map(async ()=>{
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

  try{
    await Promise.all(runners);
    selection.delete(fid);
    showToast('Farm moved');
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

  renderAll(false);
}

/* ---------- Boot ---------- */
(async function boot(){
  buildYearOptions();
  db = await initDB();

  wireDnd({
    root: document,
    onDrop,
    isEnabled: ()=> !isNarrow()
  });

  await loadAll();

  window.addEventListener('resize', ()=>{
    clearTimeout(window.__fvResizeT);
    window.__fvResizeT = setTimeout(()=> renderAll(true), 150);
  });
})();
