/* =======================================================================
   /Farm-vista/js/boundary-drive-open.js   (FULL FILE)
   Rev: 2026-01-21h-perfect-report-ui-and-rtk-join-drive-only

   GOAL (per Dane):
     ✅ COPY the REPORT PAGE behavior + UI 1:1 for tiles + details panel
     ✅ But with ONLY these differences:
        - Only shows OPEN requests (drive queue)
        - Clicking a tile opens the SAME style details panel (like report)
        - NO "Mark Completed" button
        - NO delete/trash button
        - Instead: "Mark as Driven" -> updates status to "In Progress"
        - Keep photos view-only, same modal viewer behavior

   IMPORTANT:
     - This file injects its own UI after #woHero if present, else into .wrap/body.
     - It performs the SAME RTK join logic as report page:
         rtk stored on doc OR fetch tower doc by rtkTowerId from rtkTowers / rtk_towers
     - Default mode: global queue (all OPEN across all fields)
     - Optional: window.BOUNDARY_DRIVE_MODE = 'field' to filter to window.currentFieldId
======================================================================= */

import {
  ready,
  getFirestore,
  collection, getDocs,
  doc, getDoc,
  updateDoc,
  query, where, orderBy,
  serverTimestamp
} from '/Farm-vista/js/firebase-init.js';

/* ===================== CONFIG (MATCH REPORT PAGE) ===================== */
const CONFIG = {
  COLLECTION_PATH: 'boundary_requests',
  TOWER_COLLECTIONS: ['rtkTowers','rtk_towers']
};

/* ===================== DOM HELPERS ===================== */
const byId = (id) => document.getElementById(id);
const qs   = (sel, root=document) => root.querySelector(sel);

function escapeHtml(str){
  return String(str || '').replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}

/* ===================== REPORT HELPERS (COPY) ===================== */
function normalizeStatus(s){
  return String(s || '').trim().replace(/\.+$/,'').toLowerCase();
}

function formatDate(d){
  if(!d) return '';
  try{ return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch{ return ''; }
}
function formatDateTime(d){
  if(!d) return '';
  try{ return d.toLocaleString(); }
  catch{ return ''; }
}

function coerceStr(v){
  if(v == null) return '';
  return String(v).trim();
}
function fmtFreqMHz(freq){
  const s = coerceStr(freq);
  if(!s) return '';
  return `${s} MHz`;
}

function getTowerIdFromRequest(d){
  return coerceStr(d?.rtkTowerId || d?.towerId || d?.rtkId || '');
}

/* createdAt parsing EXACTLY like report page */
function createdAtFromDoc(data){
  let createdIso = null;

  if (data.timestampISO){
    createdIso = data.timestampISO;
  } else if (data.createdAt){
    if (data.createdAt.toDate) createdIso = data.createdAt.toDate().toISOString();
    else createdIso = data.createdAt;
  } else if (data.t != null){
    if (typeof data.t === 'number') createdIso = new Date(data.t).toISOString();
    else if (data.t && data.t.seconds) createdIso = new Date(data.t.seconds*1000).toISOString();
  }

  return createdIso ? new Date(createdIso) : null;
}

/* ===================== STATE (MATCH REPORT PAGE) ===================== */
const STATE = {
  db: null,
  items: [],
  selectedId: null,
  farmMap: new Map(),
  towersById: new Map()
};

/* ===========================
   RTK join (COPY OF REPORT PAGE)
   =========================== */
async function fetchTowerFromAnyCollection(towerId){
  for (const colName of CONFIG.TOWER_COLLECTIONS){
    try{
      const snap = await getDoc(doc(STATE.db, colName, towerId));
      if(snap.exists()){
        const d = snap.data() || {};
        return {
          id: towerId,
          name: coerceStr(d.name),
          networkId: coerceStr(d.networkId),
          frequencyMHz: coerceStr(d.frequencyMHz)
        };
      }
    }catch(_){}
  }
  return { id:towerId, name:'', networkId:'', frequencyMHz:'' };
}

async function loadRtkTowersForItems(items){
  const want = new Set();
  (items || []).forEach(it => {
    const id = getTowerIdFromRequest(it.data);
    if(id) want.add(id);
  });

  const missing = Array.from(want).filter(id => !STATE.towersById.has(id));
  if(!missing.length) return;

  await Promise.allSettled(missing.map(async (towerId) => {
    const t = await fetchTowerFromAnyCollection(towerId);
    STATE.towersById.set(towerId, t);
  }));
}

function getRtkForRequest(d){
  // prefer embedded rtk snapshot if present
  if(d && typeof d === 'object' && d.rtk && typeof d.rtk === 'object'){
    const name = coerceStr(d.rtk.name);
    const networkId = coerceStr(d.rtk.networkId);
    const frequencyMHz = coerceStr(d.rtk.frequencyMHz);
    if(name || networkId || frequencyMHz){
      return { name, networkId, frequencyMHz, towerId: getTowerIdFromRequest(d) };
    }
  }

  // otherwise join from tower docs by id
  const towerId = getTowerIdFromRequest(d);
  if(towerId && STATE.towersById.has(towerId)){
    const t = STATE.towersById.get(towerId);
    return {
      name: coerceStr(t?.name),
      networkId: coerceStr(t?.networkId),
      frequencyMHz: coerceStr(t?.frequencyMHz),
      towerId
    };
  }

  return { name:'', networkId:'', frequencyMHz:'', towerId };
}

function rtkLines(rtk){
  const name = coerceStr(rtk?.name);
  const net  = coerceStr(rtk?.networkId);
  const freq = coerceStr(rtk?.frequencyMHz);

  const nameLine = name || (rtk?.towerId ? `Tower ${rtk.towerId}` : '');
  const subBits = [];
  if(net) subBits.push(`Net ${net}`);
  if(freq) subBits.push(fmtFreqMHz(freq));
  const subLine = subBits.join(' • ');

  return { nameLine, subLine };
}

function rtkHtmlBox(rtk){
  const { nameLine, subLine } = rtkLines(rtk);
  if(!nameLine && !subLine) return '';
  return `
    <span class="rtk-block">
      <span class="rtk-name">${escapeHtml(nameLine || '')}</span>
      ${subLine ? `<span class="rtk-sub">${escapeHtml(subLine)}</span>` : ``}
    </span>
  `;
}

function getPhotosFromRequest(d){
  const arr = Array.isArray(d?.photos) ? d.photos : [];
  const out = [];
  arr.forEach((p)=>{
    if(!p) return;
    const url = String(p.url || p.path || '').trim();
    if(!url) return;
    out.push({ url, name: String(p.name || '').trim() });
  });
  return out;
}

/* ===================== DOM INJECTION (REPORT-LIKE) ===================== */
function ensureContainers(){
  const anchor = byId('woHero') || qs('#woHero');
  const wrap = qs('.wrap') || document.body;

  if(!byId('bdDriveOpenHero')){
    const hero = document.createElement('section');
    hero.id = 'bdDriveOpenHero';
    hero.className = 'hero';

    // UI is intentionally the SAME structure/classes as report page:
    // - .hero-head
    // - .body
    // - .toolbar with count meta
    // - .wo-empty
    // - .wo-list
    // - .wo-detail-panel (same layout)
    hero.innerHTML = `
      <header class="hero-head">
        <div class="icon" aria-hidden="true">🚜</div>
        <div>
          <h1>Open Boundary Drive Requests</h1>
          <p class="muted">Tap a card to view details. Mark as Driven moves it to “In Progress”.</p>
        </div>
      </header>

      <div class="body">
        <div class="toolbar">
          <div class="toolbar-left">
            <!-- intentionally no filters / no print -->
            <span class="muted" style="font-weight:800;">Drive Queue</span>
          </div>
          <div class="page-header-meta" id="bdDriveOpenCount">0 open</div>
        </div>

        <section aria-label="Open boundary drive requests">
          <div class="wo-empty" id="bdDriveOpenEmpty">Loading open drive requests…</div>
          <div class="wo-list" id="bdDriveOpenList"></div>
        </section>

        <!-- Details panel (COPY OF REPORT PANEL, drive-only actions) -->
        <section class="wo-detail-panel" id="bdDriveDetailPanel" aria-label="Boundary request details">
          <div class="wo-detail-header">
            <div class="wo-detail-title" id="bdDriveDetailTitle">Boundary Request Details</div>
            <button type="button" id="bdDriveDetailClose" class="wo-detail-close">Close</button>
          </div>

          <div class="wo-detail-grid" id="bdDriveDetailGrid"></div>

          <div class="wo-detail-notes">
            <div class="wo-detail-notes-label">Notes</div>
            <div class="wo-detail-notes-body" id="bdDriveDetailNotes"></div>
          </div>

          <div id="bdDriveDetailPhotosWrap" class="wo-detail-photos" aria-label="Boundary request photos">
            <div class="wo-detail-photos-label">Photos</div>
            <div id="bdDriveDetailPhotoGrid" class="wo-photo-grid"></div>
          </div>

          <div class="wo-detail-footer" id="bdDriveDetailFooter"></div>

          <div class="wo-detail-actions">
            <div class="wo-detail-actions-left">
              <button type="button" id="bdDriveBtnMarkDriven" class="btn btn-primary btn-small">
                Mark as Driven
              </button>
            </div>
            <div class="wo-detail-actions-right">
              <!-- NO delete button here on purpose -->
            </div>
          </div>
        </section>
      </div>
    `;

    if(anchor && anchor.parentNode){
      anchor.insertAdjacentElement('afterend', hero);
    }else{
      wrap.appendChild(hero);
    }
  }

  // Photo viewer modal (COPY STYLE/BEHAVIOR of report page modal)
  if(!byId('bdDrivePhotoModal')){
    const modal = document.createElement('div');
    modal.id = 'bdDrivePhotoModal';
    modal.className = 'photo-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','Boundary request photo');
    modal.innerHTML = `
      <div id="bdDrivePhotoBackdrop" class="photo-backdrop"></div>
      <div class="photo-sheet">
        <div class="photo-close-row">
          <button id="bdDrivePhotoClose" type="button" class="photo-close-btn">Close</button>
        </div>
        <div class="photo-img-wrap">
          <img id="bdDrivePhotoImg" src="" alt="Boundary request photo"/>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

/* ===================== RENDER LIST (COPY REPORT TILE HTML) ===================== */
function renderList(){
  const listEl  = byId('bdDriveOpenList');
  const emptyEl = byId('bdDriveOpenEmpty');
  const countEl = byId('bdDriveOpenCount');
  if(!listEl || !emptyEl) return;

  listEl.innerHTML = '';

  const items = STATE.items;

  if(!items.length){
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'No open drive requests.';
    if(countEl) countEl.textContent = '0 open';
    return;
  }

  emptyEl.style.display = 'none';

  // Count line EXACTLY like report page open view:
  // "{openItems.length} open on {farmCountOpen} farms"
  const farmCountOpen = new Set(items.map(it => it.data.farmId || it.data.farm).filter(Boolean)).size;
  if(countEl){
    countEl.textContent = `${items.length} open on ${farmCountOpen || 0} farm${farmCountOpen === 1 ? '' : 's'}`;
  }

  for(const item of items){
    const d = item.data;

    const field = d.field || 'Field not set';
    const farm  = d.farm  || '';
    const scope = d.scope || '';
    const bType = d.boundaryType || '';
    const status = d.status || '';
    const createdBy = d.submittedBy || '';
    const createdAt = d._createdAtDate || null;
    const whenStr   = formatDate(createdAt);

    const rtk = getRtkForRequest(d);
    const rtkBox = rtkHtmlBox(rtk);

    const card = document.createElement('article');
    card.className = 'wo-card';
    card.dataset.id = item.id;

    // ✅ THIS IS THE REPORT PAGE TILE HTML (verbatim)
    card.innerHTML = `
      <div class="wo-row-top">
        <div class="wo-main">
          <div class="wo-title">
            ${escapeHtml(field)}${farm ? ` · <span>${escapeHtml(farm)}</span>` : ''}
          </div>
          <div class="wo-sub">
            ${escapeHtml(scope || 'Boundary correction requested')}
          </div>
          <div class="wo-meta">
            ${bType ? `<span><span class="wo-meta-label">Type</span> <span class="wo-meta-val">${escapeHtml(bType)}</span></span>` : ''}
            ${status ? `<span><span class="wo-meta-label">Status</span> <span class="wo-meta-val">${escapeHtml(status)}</span></span>` : ''}
            ${createdBy ? `<span><span class="wo-meta-label">By</span> <span class="wo-meta-val">${escapeHtml(createdBy)}</span></span>` : ''}
            ${whenStr ? `<span><span class="wo-meta-label">Submitted</span> <span class="wo-meta-val">${escapeHtml(whenStr)}</span></span>` : ''}
            ${rtkBox ? `<span><span class="wo-meta-label">RTK</span> ${rtkBox}</span>` : (d.rtkTowerId ? `<span><span class="wo-meta-label">RTK</span> <span class="wo-meta-val">${escapeHtml(d.rtkTowerId)}</span></span>` : '')}
          </div>
        </div>
      </div>
    `;

    // Only behavior difference: click opens our details panel (same feel), not report’s complete/delete
    card.addEventListener('click', () => {
      STATE.selectedId = item.id;
      renderDetails();

      const panel = byId('bdDriveDetailPanel');
      if(panel){
        panel.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    });

    listEl.appendChild(card);
  }
}

/* ===================== PHOTO VIEWER (COPY REPORT BEHAVIOR) ===================== */
let photoModal=null, photoImg=null, photoBackdrop=null, photoCloseBtn=null;

function openPhotoViewer(url){
  if(!photoModal || !photoImg || !url) return;
  photoImg.src = url;
  photoModal.classList.add('show');
}
function closePhotoViewer(){
  if(!photoModal) return;
  photoModal.classList.remove('show');
  if(photoImg) photoImg.src = '';
}

/* ===================== DETAILS (COPY REPORT STRUCTURE + DRIVE BUTTON) ===================== */
function clearDetails(){
  const panel = byId('bdDriveDetailPanel');
  if(!panel) return;

  panel.style.display = 'none';
  panel.dataset.id = '';
  byId('bdDriveDetailTitle').textContent = 'Boundary Request Details';
  byId('bdDriveDetailGrid').innerHTML = '';
  byId('bdDriveDetailNotes').textContent = '';
  byId('bdDriveDetailFooter').innerHTML = '';

  const photosWrap = byId('bdDriveDetailPhotosWrap');
  const photosGrid = byId('bdDriveDetailPhotoGrid');
  if(photosWrap) photosWrap.classList.remove('show');
  if(photosGrid) photosGrid.innerHTML = '';

  const btn = byId('bdDriveBtnMarkDriven');
  if(btn){
    btn.disabled = true;
    btn.textContent = 'Mark as Driven';
  }
}

function renderDetails(){
  const panel = byId('bdDriveDetailPanel');
  if(!panel) return;

  const item = STATE.items.find(x => x.id === STATE.selectedId);
  if(!item){
    clearDetails();
    return;
  }

  const d = item.data;
  const field = d.field || 'Field not set';
  const farm  = d.farm  || '';
  const scope = d.scope || '';
  const bType = d.boundaryType || '';
  const status = d.status || '';
  const submittedBy = d.submittedBy || '';
  const submittedByEmail = d.submittedByEmail || '';
  const createdAt = d._createdAtDate || null;
  const createdStr = formatDateTime(createdAt);
  const notes = d.notes || '';

  const rtk = getRtkForRequest(d);
  const { nameLine, subLine } = rtkLines(rtk);

  const photos = getPhotosFromRequest(d);

  panel.dataset.id = item.id;

  // Title (same as report)
  byId('bdDriveDetailTitle').textContent = farm ? `${field} · ${farm}` : field;

  // Grid (same as report)
  const grid = byId('bdDriveDetailGrid');
  grid.innerHTML = `
    <div>
      <div class="wo-detail-item-label">Scope</div>
      <div class="wo-detail-item-value">${escapeHtml(scope || 'Not specified')}</div>
    </div>
    <div>
      <div class="wo-detail-item-label">Boundary Type</div>
      <div class="wo-detail-item-value">${escapeHtml(bType || 'Not specified')}</div>
    </div>

    <div style="grid-column:1 / -1;">
      <div class="wo-detail-item-label">RTK</div>
      <div class="wo-detail-item-value">
        <span class="rtk-block">
          <span class="rtk-name">${escapeHtml(nameLine || (d.rtkTowerId ? ('Tower ' + d.rtkTowerId) : 'Not set'))}</span>
          ${subLine ? `<span class="rtk-sub">${escapeHtml(subLine)}</span>` : ``}
        </span>
      </div>
    </div>

    <div>
      <div class="wo-detail-item-label">Submitted By</div>
      <div class="wo-detail-item-value">
        ${escapeHtml(submittedBy || 'Unknown')}
        ${submittedByEmail ? `<br><span style="opacity:.8">${escapeHtml(submittedByEmail)}</span>` : ''}
      </div>
    </div>
    <div>
      <div class="wo-detail-item-label">Submitted</div>
      <div class="wo-detail-item-value">${escapeHtml(createdStr || 'Unknown')}</div>
    </div>

    <div>
      <div class="wo-detail-item-label">Photos</div>
      <div class="wo-detail-item-value">${escapeHtml(String(photos.length))}</div>
    </div>
  `;

  // Notes (same as report)
  byId('bdDriveDetailNotes').textContent = notes || 'No notes recorded for this request.';

  // Footer (same style, plus Drive-only note)
  const footer = byId('bdDriveDetailFooter');
  footer.innerHTML = `
    Current status:
    <span class="wo-detail-pill">${escapeHtml(status || 'unknown')}</span>
    <span class="wo-detail-pill">Drive-only</span>
  `;

  // Photos (same as report)
  const photosWrap = byId('bdDriveDetailPhotosWrap');
  const photosGrid = byId('bdDriveDetailPhotoGrid');
  if(photosWrap && photosGrid){
    photosGrid.innerHTML = '';
    if(photos.length){
      photosWrap.classList.add('show');
      photos.forEach((p) => {
        const box = document.createElement('div');
        box.className = 'wo-photo';
        box.innerHTML = `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.name || 'Boundary request photo')}" loading="lazy" decoding="async">`;
        box.addEventListener('click', () => openPhotoViewer(p.url));
        photosGrid.appendChild(box);
      });
    }else{
      photosWrap.classList.remove('show');
    }
  }

  // Drive button enabled only if OPEN (like report enables Mark completed only if open)
  const btn = byId('bdDriveBtnMarkDriven');
  if(btn){
    const isOpen = normalizeStatus(status) === 'open';
    btn.disabled = !isOpen;
    btn.textContent = isOpen ? 'Mark as Driven' : (status ? `Status: ${status}` : 'Mark as Driven');
  }

  panel.style.display = 'flex';
}

/* ===================== LOAD OPEN ITEMS (GLOBAL or FIELD) ===================== */
function computeMode(){
  const raw = String(window.BOUNDARY_DRIVE_MODE || 'global').toLowerCase().trim();
  return (raw === 'field') ? 'field' : 'global';
}

async function loadOpenRequests(){
  const mode = computeMode();
  const fid = String(window.currentFieldId || '').trim();

  // Primary: try indexed open query; fallback scan
  // We keep it resilient because some docs have status "Open" etc.
  const openVariants = ['open','Open','OPEN'];

  let items = [];

  try{
    if(mode === 'field' && fid){
      const qy = query(
        collection(STATE.db, CONFIG.COLLECTION_PATH),
        where('fieldId','==', fid),
        orderBy('createdAt','desc')
      );
      const snap = await getDocs(qy);
      items = snap.docs
        .map(ds => {
          const data = ds.data() || {};
          const createdDate = createdAtFromDoc(data);
          return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
        })
        .filter(it => normalizeStatus(it.data.status) === 'open');
    }else{
      const qy = query(
        collection(STATE.db, CONFIG.COLLECTION_PATH),
        where('status', 'in', openVariants),
        orderBy('createdAt','desc')
      );
      const snap = await getDocs(qy);
      items = snap.docs
        .map(ds => {
          const data = ds.data() || {};
          const createdDate = createdAtFromDoc(data);
          return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
        })
        .filter(it => normalizeStatus(it.data.status) === 'open');
    }
  }catch(e){
    console.warn('[boundary-drive-open] query failed, fallback scan', e);

    const snap = await getDocs(collection(STATE.db, CONFIG.COLLECTION_PATH));
    items = snap.docs
      .map(ds => {
        const data = ds.data() || {};
        const createdDate = createdAtFromDoc(data);
        return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
      })
      .filter(it => normalizeStatus(it.data.status) === 'open')
      .filter(it => {
        if(mode === 'field' && fid) return String(it.data.fieldId || '') === fid;
        return true;
      });

    items.sort((a,b) => {
      const ta = a.data._createdAtDate ? a.data._createdAtDate.getTime() : 0;
      const tb = b.data._createdAtDate ? b.data._createdAtDate.getTime() : 0;
      return tb - ta;
    });
  }

  // Build farm map (same as report)
  STATE.farmMap = new Map();
  items.forEach(it=>{
    const d = it.data;
    if(!d.farm) return;
    const key = d.farmId || d.farm;
    if(!key) return;
    if(!STATE.farmMap.has(key)) STATE.farmMap.set(key, d.farm);
  });

  // RTK join (critical for “name • net • freq” format)
  await loadRtkTowersForItems(items);

  STATE.items = items;
}

/* ===================== UPDATE (DRIVEN) ===================== */
async function markDriven(){
  if(!STATE.selectedId) return;

  const item = STATE.items.find(it => it.id === STATE.selectedId);
  if(!item) return;

  // Only OPEN can be driven
  if(normalizeStatus(item.data.status) !== 'open') return;

  try{
    await updateDoc(
      doc(STATE.db, CONFIG.COLLECTION_PATH, STATE.selectedId),
      { status: 'In Progress', drivenAt: serverTimestamp() }
    );

    // Clear selection (like report would after state change)
    STATE.selectedId = null;
    clearDetails();

    // Reload + rerender
    await loadOpenRequests();
    renderList();

  }catch(e){
    console.error(e);
    alert('Failed to mark as driven');
  }
}

/* ===================== WIRING ===================== */
function wire(){
  const closeBtn = byId('bdDriveDetailClose');
  if(closeBtn){
    closeBtn.addEventListener('click', () => {
      STATE.selectedId = null;
      clearDetails();
    });
  }

  const drivenBtn = byId('bdDriveBtnMarkDriven');
  if(drivenBtn){
    drivenBtn.addEventListener('click', markDriven);
  }

  // Photo modal wiring (copy report behavior)
  photoModal = byId('bdDrivePhotoModal');
  photoImg = byId('bdDrivePhotoImg');
  photoBackdrop = byId('bdDrivePhotoBackdrop');
  photoCloseBtn = byId('bdDrivePhotoClose');

  if(photoBackdrop) photoBackdrop.addEventListener('click', closePhotoViewer);
  if(photoCloseBtn) photoCloseBtn.addEventListener('click', closePhotoViewer);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closePhotoViewer(); });
}

/* ===================== WATCHER (optional field mode) ===================== */
let lastMode = null;
let lastFieldId = null;

function watchModeAndField(){
  setInterval(async () => {
    const mode = computeMode();
    const fid = String(window.currentFieldId || '').trim();

    // mode changed
    if(mode !== lastMode){
      lastMode = mode;
      lastFieldId = fid || null;

      await loadOpenRequests();
      renderList();
      clearDetails();
      return;
    }

    // field changed (field mode only)
    if(mode === 'field'){
      if(fid && fid !== lastFieldId){
        lastFieldId = fid;
        await loadOpenRequests();
        renderList();
        clearDetails();
      }
      if(!fid){
        // In field mode with no selected field, hide the module (matches your old “needs field” behavior)
        const hero = byId('bdDriveOpenHero');
        if(hero) hero.style.display = 'none';
        clearDetails();
      }else{
        const hero = byId('bdDriveOpenHero');
        if(hero) hero.style.display = '';
      }
    }
  }, 600);
}

/* ===================== BOOT ===================== */
(async function boot(){
  await ready;
  STATE.db = getFirestore();

  ensureContainers();
  wire();

  // default visible
  const hero = byId('bdDriveOpenHero');
  if(hero) hero.style.display = '';

  await loadOpenRequests();
  renderList();
  clearDetails();

  lastMode = computeMode();
  lastFieldId = String(window.currentFieldId || '').trim() || null;
  watchModeAndField();
})();
