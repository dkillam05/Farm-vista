/* =======================================================================
   /Farm-vista/js/boundary-drive-open.js   (FULL FILE)
   Rev: 2026-01-21i-report-clone-drive-only-perfect

   ✅ COPY OF reports-boundary-requests.html UI/behavior for SCREEN (tiles + details + photo viewer)
   ✅ Drive-only differences (per Dane):
      - Shows OPEN only (global queue, no field selection required)
      - NO filters, NO print, NO delete
      - Replace "Mark completed" with "Mark as Driven"
      - Mark as Driven -> status: "In Progress", drivenAt: serverTimestamp()
      - After marking driven: remove from list (reload)

   ✅ RTK correctness:
      - EXACT same RTK logic as report:
        1) use request.rtk snapshot if present
        2) else fetch tower doc by rtkTowerId from rtkTowers/rtk_towers
        3) display: Name + "Net #### • ###.##### MHz"
======================================================================= */

import {
  ready,
  getFirestore,
  getAuth,
  collection, getDocs,
  doc, getDoc,
  updateDoc,
  query, where, orderBy,
  serverTimestamp
} from '/Farm-vista/js/firebase-init.js';

/* ===========================
   CONFIG (copied)
   =========================== */
const CONFIG = {
  COLLECTION_PATH: 'boundary_requests',
  TOWER_COLLECTIONS: ['rtkTowers','rtk_towers']
};

/* ===========================
   DOM helpers
   =========================== */
const $ = (sel, root=document) => root.querySelector(sel);

function escapeHtml(str){
  return String(str || '').replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}

/* ===========================
   CSS injection (report page styles needed for 1:1 look)
   - Safe: uses same classnames as report page
   =========================== */
function ensureReportStyles(){
  if(document.getElementById('bd-drive-report-clone-styles')) return;

  const style = document.createElement('style');
  style.id = 'bd-drive-report-clone-styles';
  style.textContent = `
    :root{
      --card-max: 1200px;
      --page-bottom-gap: 72px;
      --accent: #2F6C3C;
    }

    .hero{
      border:1px solid var(--border);
      border-radius:14px;
      background:var(--surface);
      box-shadow:var(--shadow,0 8px 20px rgba(0,0,0,.08));
      overflow:visible;
    }
    .hero-head{
      display:grid;
      grid-template-columns:36px 1fr;
      gap:12px;
      align-items:center;
      padding:14px 16px;
      background:linear-gradient(90deg, rgba(47,108,60,.12), transparent);
      border-bottom:1px solid var(--border);
    }
    .hero-head .icon{
      width:24px;
      height:24px;
      color:var(--accent);
      display:grid;
      place-items:center;
    }
    .hero-head h1{
      margin:0;
      font-size:clamp(20px,3.2vw,26px);
      line-height:1.2;
    }
    .muted{ color:var(--muted,#67706B); }

    .body{ padding:16px; display:grid; gap:14px; }

    .toolbar{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      align-items:flex-end;
      justify-content:space-between;
    }
    .toolbar-left{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      align-items:center;
    }

    .btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-width:120px;
      padding:10px 14px;
      border-radius:12px;
      border:1px solid var(--border);
      font-weight:800;
      text-decoration:none;
      cursor:pointer;
      user-select:none;
      color:var(--text) !important;
      background:var(--card-surface,var(--surface));
      font-size:0.9rem;
      gap:6px;
    }
    .btn-quiet{ min-width:auto; padding-inline:10px; }
    .btn-primary{
      border-color:transparent;
      background:#2F6C3C;
      color:#fff !important;
    }
    .btn-small{ min-width:auto; padding:8px 12px; font-size:0.85rem; }

    .page-header-meta{ font-size:0.9rem; opacity:0.8; }

    /* List cards */
    .wo-list{ display:flex; flex-direction:column; gap:10px; margin-top:8px; }

    .wo-empty{
      padding:14px 16px;
      border-radius:12px;
      border:1px dashed var(--border);
      background:var(--card-surface, var(--surface));
      font-size:0.95rem;
      opacity:0.9;
    }

    .wo-card{
      position:relative;
      border-radius:10px;
      border:1px solid var(--card-border, var(--border));
      background:var(--card-surface, var(--surface));
      box-shadow:var(--shadow-soft, var(--shadow));
      padding:12px 14px 10px;
      display:flex;
      flex-direction:column;
      gap:6px;
      cursor:pointer;
      transition:transform .06s, box-shadow .12s, border-color .12s, background .12s;
    }
    .wo-card:active{
      transform:scale(.995);
      box-shadow:var(--shadow);
    }

    .wo-row-top{ display:flex; align-items:flex-start; gap:10px; }
    .wo-main{ flex:1 1 auto; min-width:0; }

    .wo-title{
      font-weight:700;
      font-size:0.98rem;
      line-height:1.3;
    }

    .wo-sub{
      font-size:0.86rem;
      opacity:0.9;
      margin-top:2px;
    }

    .wo-meta{
      display:flex;
      flex-wrap:wrap;
      gap:6px 10px;
      margin-top:4px;
      font-size:0.8rem;
      opacity:0.9;
    }

    .wo-meta span{
      display:inline-flex;
      align-items:flex-start;
      gap:6px;
      padding:2px 7px;
      border-radius:999px;
      background:color-mix(in srgb, var(--surface) 70%, var(--border) 30%);
      max-width:100%;
    }
    .wo-meta span > span.wo-meta-label{
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:0.08em;
      font-size:0.72rem;
      opacity:0.85;
      margin-top:1px;
    }
    .wo-meta .wo-meta-val{
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width:48ch;
    }
    @media (max-width:520px){
      .wo-meta .wo-meta-val{ max-width:28ch; }
    }

    /* RTK block */
    .rtk-block{
      display:flex;
      flex-direction:column;
      gap:2px;
      line-height:1.15;
      max-width:min(62ch, 100%);
    }
    .rtk-block .rtk-name{
      font-weight:600;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width:100%;
    }
    .rtk-block .rtk-sub{
      font-weight:600;
      opacity:0.88;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width:100%;
    }

    /* Detail panel */
    .wo-detail-panel{
      margin-top:10px;
      border-radius:10px;
      border:1px solid var(--card-border, var(--border));
      background:var(--card-surface, var(--surface));
      box-shadow:var(--shadow-soft, var(--shadow));
      padding:14px 16px 12px;
      display:none;
      flex-direction:column;
      gap:8px;
      scroll-margin-top: 90px;
    }

    .wo-detail-header{
      display:flex;
      justify-content:space-between;
      align-items:flex-start;
      gap:10px;
    }

    .wo-detail-title{ font-weight:700; font-size:1rem; }

    .wo-detail-close{
      border:none;
      outline:none;
      border-radius:999px;
      padding:4px 9px;
      font-size:0.8rem;
      background:color-mix(in srgb, var(--surface) 70%, var(--border) 30%);
      cursor:pointer;
      color:var(--text);
    }

    .wo-detail-grid{
      display:grid;
      grid-template-columns:minmax(0,1fr);
      gap:8px 16px;
      font-size:0.9rem;
      margin-top:4px;
    }
    @media (min-width:700px){
      .wo-detail-grid{ grid-template-columns:repeat(2, minmax(0,1fr)); }
    }

    .wo-detail-item-label{
      font-size:0.78rem;
      text-transform:uppercase;
      letter-spacing:0.06em;
      opacity:0.7;
      margin-bottom:1px;
    }
    .wo-detail-item-value{ font-size:0.94rem; }

    .wo-detail-notes{
      margin-top:8px;
      padding-top:8px;
      border-top:1px solid var(--border);
      font-size:0.92rem;
      white-space:pre-wrap;
    }
    .wo-detail-notes-label{
      font-size:0.8rem;
      text-transform:uppercase;
      letter-spacing:0.06em;
      opacity:0.7;
      margin-bottom:2px;
    }
    .wo-detail-notes-body{ margin-top:2px; }

    .wo-detail-photos{
      margin-top:10px;
      padding-top:10px;
      border-top:1px solid var(--border);
      display:none;
      flex-direction:column;
      gap:8px;
    }
    .wo-detail-photos.show{ display:flex; }
    .wo-detail-photos-label{
      font-size:0.8rem;
      text-transform:uppercase;
      letter-spacing:0.06em;
      opacity:0.7;
    }
    .wo-photo-grid{
      display:grid;
      grid-template-columns:repeat(2, minmax(0,1fr));
      gap:10px;
    }
    @media (max-width:520px){
      .wo-photo-grid{ grid-template-columns:1fr; }
    }
    .wo-photo{
      border:1px solid var(--border);
      border-radius:14px;
      overflow:hidden;
      background:color-mix(in srgb, var(--surface) 70%, var(--border) 30%);
      box-shadow:var(--shadow-soft, var(--shadow));
      cursor:pointer;
    }
    .wo-photo img{
      width:100%;
      height:auto;
      display:block;
      max-height:520px;
      object-fit:cover;
    }

    .wo-detail-footer{
      margin-top:10px;
      font-size:0.82rem;
      opacity:0.85;
    }
    .wo-detail-pill{
      display:inline-flex;
      align-items:center;
      gap:4px;
      padding:2px 8px;
      border-radius:999px;
      background:color-mix(in srgb, var(--surface) 70%, var(--border) 30%);
      font-size:0.8rem;
      margin-left:6px;
    }

    .wo-detail-actions{
      margin-top:10px;
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:10px;
    }
    .wo-detail-actions-left{ display:flex; align-items:center; gap:8px; }
    .wo-detail-actions-right{ display:flex; align-items:center; gap:4px; }

    .photo-modal{
      position:fixed;
      inset:0;
      display:none;
      align-items:center;
      justify-content:center;
      z-index:100000;
      padding:16px;
    }
    .photo-modal.show{ display:flex; }
    .photo-backdrop{
      position:absolute;
      inset:0;
      background:rgba(0,0,0,.65);
    }
    .photo-sheet{
      position:relative;
      max-width:min(1000px, 95vw);
      max-height:90vh;
      background:var(--surface);
      border-radius:14px;
      border:1px solid var(--border);
      box-shadow:0 20px 40px rgba(0,0,0,.45);
      padding:10px;
      display:flex;
      flex-direction:column;
      gap:8px;
      z-index:1;
      overflow:hidden;
    }
    .photo-close-row{
      display:flex;
      justify-content:flex-end;
    }
    .photo-close-btn{
      border:none;
      border-radius:999px;
      padding:6px 12px;
      font-size:0.85rem;
      cursor:pointer;
      background:color-mix(in srgb, var(--surface) 70%, var(--border) 30%);
      color:var(--text);
    }
    .photo-img-wrap{
      border-radius:12px;
      overflow:hidden;
      background:#000;
      display:flex;
      align-items:center;
      justify-content:center;
      max-height:calc(90vh - 70px);
    }
    .photo-img-wrap img{
      max-width:100%;
      max-height:100%;
      display:block;
    }
  `;
  document.head.appendChild(style);
}

/* ===========================
   STATE (report shape)
   =========================== */
const STATE = {
  items: [],
  selectedId: null,
  db: null,
  farmMap: new Map(),
  towersById: new Map()
};

/* ===========================
   Report helpers (copied)
   =========================== */
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

/* createdAt parsing (copied) */
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

/* ===========================
   RTK join (copied)
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
  if(d && typeof d === 'object' && d.rtk && typeof d.rtk === 'object'){
    const name = coerceStr(d.rtk.name);
    const networkId = coerceStr(d.rtk.networkId);
    const frequencyMHz = coerceStr(d.rtk.frequencyMHz);
    if(name || networkId || frequencyMHz){
      return { name, networkId, frequencyMHz, towerId: getTowerIdFromRequest(d) };
    }
  }

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

/* ===========================
   UI injection (report-like)
   =========================== */
function ensureUI(){
  if(byId('bdDriveHero')) return;

  const anchor = byId('woHero') || $('#woHero');
  const host = anchor?.parentElement || $('.wrap') || document.body;

  const hero = document.createElement('section');
  hero.id = 'bdDriveHero';
  hero.className = 'hero';
  hero.innerHTML = `
    <header class="hero-head">
      <div class="icon" aria-hidden="true">🚜</div>
      <div>
        <h1>Open Boundary Drive Requests</h1>
        <p class="muted">Tap a card to see full notes. Mark as Driven moves it to “In Progress”.</p>
      </div>
    </header>

    <div class="body">
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="muted" style="font-weight:800;">Drive Queue</span>
        </div>
        <div class="page-header-meta" id="brCount">0 open</div>
      </div>

      <section aria-label="Boundary drive requests">
        <div class="wo-empty">Loading boundary requests…</div>
        <div class="wo-list"></div>
      </section>

      <section class="wo-detail-panel" aria-label="Boundary request details">
        <div class="wo-detail-header">
          <div class="wo-detail-title">Boundary Request Details</div>
          <button type="button" id="woDetailClose" class="wo-detail-close">Close</button>
        </div>

        <div class="wo-detail-grid"></div>

        <div class="wo-detail-notes">
          <div class="wo-detail-notes-label">Notes</div>
          <div class="wo-detail-notes-body"></div>
        </div>

        <div id="woDetailPhotos" class="wo-detail-photos" aria-label="Boundary request photos">
          <div class="wo-detail-photos-label">Photos</div>
          <div id="woDetailPhotoGrid" class="wo-photo-grid"></div>
        </div>

        <div class="wo-detail-footer"></div>

        <div class="wo-detail-actions">
          <div class="wo-detail-actions-left">
            <button type="button" id="btnMarkDriven" class="btn btn-primary btn-small">
              Mark as Driven
            </button>
          </div>
          <div class="wo-detail-actions-right">
            <!-- NO delete button -->
          </div>
        </div>
      </section>
    </div>
  `;

  if(anchor){
    anchor.insertAdjacentElement('afterend', hero);
  }else{
    host.appendChild(hero);
  }

  // Photo modal (same as report)
  if(!byId('photoModal')){
    const modal = document.createElement('div');
    modal.id = 'photoModal';
    modal.className = 'photo-modal';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','Boundary request photo');
    modal.innerHTML = `
      <div id="photoModalBackdrop" class="photo-backdrop"></div>
      <div class="photo-sheet">
        <div class="photo-close-row">
          <button id="photoModalClose" type="button" class="photo-close-btn">Close</button>
        </div>
        <div class="photo-img-wrap">
          <img id="photoModalImg" src="" alt="Boundary request photo"/>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

function byId(id){ return document.getElementById(id); }

/* ===========================
   Rendering (screen) — COPY of report renderList/renderDetails
   =========================== */
function renderList(){
  const root = byId('bdDriveHero') || document;
  const listEl  = $('.wo-list', root);
  const emptyEl = $('.wo-empty', root);
  const countEl = $('#brCount', root);

  listEl.innerHTML = '';
  const items = STATE.items;

  if(!items.length){
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'No open drive requests.';
    if(countEl) countEl.textContent = '0 open';
    return;
  }

  emptyEl.style.display = 'none';

  // count line matches report “open” view
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

    // verbatim tile HTML from report
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

    card.addEventListener('click', () => {
      STATE.selectedId = item.id;
      renderDetails();

      const panel = $('.wo-detail-panel', root);
      if(panel){
        panel.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    });

    listEl.appendChild(card);
  }
}

function clearDetails(){
  const root = byId('bdDriveHero') || document;
  const panel = $('.wo-detail-panel', root);
  panel.style.display = 'none';
  panel.dataset.id = '';
  $('.wo-detail-title', panel).textContent = 'Boundary Request Details';
  $('.wo-detail-grid', panel).innerHTML = '';
  $('.wo-detail-notes-body', panel).textContent = '';
  $('.wo-detail-footer', panel).innerHTML = '';

  const photosWrap = $('#woDetailPhotos', root);
  const photosGrid = $('#woDetailPhotoGrid', root);
  if(photosWrap) photosWrap.classList.remove('show');
  if(photosGrid) photosGrid.innerHTML = '';

  const markBtn = $('#btnMarkDriven', root);
  if (markBtn){
    markBtn.disabled = true;
    markBtn.textContent = 'Mark as Driven';
  }
}

// photo viewer state (same ids as report)
let photoModal=null, photoModalImg=null, photoModalBackdrop=null, photoModalCloseBtn=null;

function openPhotoViewer(url){
  if(!photoModal || !photoModalImg || !url) return;
  photoModalImg.src = url;
  photoModal.classList.add('show');
}
function closePhotoViewer(){
  if(!photoModal) return;
  photoModal.classList.remove('show');
  if(photoModalImg) photoModalImg.src = '';
}

function renderDetails(){
  const root = byId('bdDriveHero') || document;
  const panel = $('.wo-detail-panel', root);

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
  $('.wo-detail-title', panel).textContent = farm ? `${field} · ${farm}` : field;

  const grid = $('.wo-detail-grid', panel);
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

  $('.wo-detail-notes-body', panel).textContent = notes || 'No notes recorded for this request.';

  const footer = $('.wo-detail-footer', panel);
  footer.innerHTML = `
    Current status:
    <span class="wo-detail-pill">${escapeHtml(status || 'unknown')}</span>
  `;

  const markBtn = $('#btnMarkDriven', root);
  if (markBtn){
    const isOpen = normalizeStatus(status) === 'open';
    markBtn.disabled = !isOpen;
    markBtn.textContent = isOpen ? 'Mark as Driven' : (status ? `Status: ${status}` : 'Mark as Driven');
  }

  // big photos (same)
  const photosWrap = $('#woDetailPhotos', root);
  const photosGrid = $('#woDetailPhotoGrid', root);
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

  panel.style.display = 'flex';
}

/* ===========================
   Loading (OPEN ONLY; global queue)
   - uses indexed query if possible, falls back to scan
   =========================== */
async function loadOpenBoundaryRequests(){
  const openVariants = ['open','Open','OPEN'];

  let items = [];

  try{
    const qy = query(
      collection(STATE.db, CONFIG.COLLECTION_PATH),
      where('status', 'in', openVariants),
      orderBy('createdAt','desc')
    );
    const snap = await getDocs(qy);

    items = snap.docs.map(docSnap => {
      const data = docSnap.data() || {};
      const createdDate = createdAtFromDoc(data);
      return { id: docSnap.id, data: { ...data, _createdAtDate: createdDate } };
    });

    // normalize filter
    items = items.filter(it => normalizeStatus(it.data.status) === 'open');
  }catch(e){
    console.warn('[boundary-drive-open] open query failed, scanning all docs', e);

    const snap = await getDocs(collection(STATE.db, CONFIG.COLLECTION_PATH));
    items = snap.docs
      .map(docSnap => {
        const data = docSnap.data() || {};
        const createdDate = createdAtFromDoc(data);
        return { id: docSnap.id, data: { ...data, _createdAtDate: createdDate } };
      })
      .filter(it => normalizeStatus(it.data.status) === 'open');

    items.sort((a,b) => {
      const ta = a.data._createdAtDate ? a.data._createdAtDate.getTime() : 0;
      const tb = b.data._createdAtDate ? b.data._createdAtDate.getTime() : 0;
      return tb - ta;
    });
  }

  // RTK join (required for name/net/freq display)
  await loadRtkTowersForItems(items);

  STATE.items = items;
}
function currentDriveUser(){
  try{
    const u = getAuth().currentUser;
    if(!u) return { uid:'', email:'', name:'' };

    const email = u.email || '';
    const name =
      u.displayName ||
      (email ? email.replace(/@.*/,'').replace(/\./g,' ') : '');

    return { uid: u.uid || '', email, name };
  }catch(_){
    return { uid:'', email:'', name:'' };
  }
}

/* ===========================
   Action: Mark as Driven
   =========================== */
async function handleMarkDriven(){
  if(!STATE.selectedId){
    alert('Select a boundary request first.');
    return;
  }
  const item = STATE.items.find(it => it.id === STATE.selectedId);
  if(!item){
    alert('Could not find this request in memory.');
    return;
  }
  const currentStatus = item.data.status || '';
  if (normalizeStatus(currentStatus) !== 'open') return;

  try{
    const ref = doc(STATE.db, CONFIG.COLLECTION_PATH, STATE.selectedId);

    // ✅ Capture who is driving (best-effort; blanks if not signed in)
    const who = currentDriveUser();

    await updateDoc(ref, {
      status: 'In Progress',
      drivenAt: serverTimestamp(),
      drivenBy: who.name || '',
      drivenByEmail: who.email || '',
      drivenByUid: who.uid || ''
    });

    // remove selection + reload list (so it disappears immediately)
    STATE.selectedId = null;
    clearDetails();

    await loadOpenBoundaryRequests();
    renderList();
  }catch(err){
    console.error('Error marking driven:', err);
    alert('Could not mark as driven. Check console for details.');
  }
}

  await updateDoc(ref, {
    status: 'In Progress',
    drivenAt: serverTimestamp(),
    drivenBy,
    drivenByEmail,
    drivenByUid
  });


    // remove selection + reload list (so it disappears immediately)
    STATE.selectedId = null;
    clearDetails();

    await loadOpenBoundaryRequests();
    renderList();
  }catch(err){
    console.error('Error marking driven:', err);
    alert('Could not mark as driven. Check console for details.');
  }
}

/* ===========================
   Wire UI
   =========================== */
function wire(){
  const root = byId('bdDriveHero') || document;

  $('#woDetailClose', root)?.addEventListener('click', () => {
    STATE.selectedId = null;
    clearDetails();
  });

  $('#btnMarkDriven', root)?.addEventListener('click', handleMarkDriven);

  // Photo viewer wiring (exact behavior)
  photoModal = byId('photoModal');
  photoModalImg = byId('photoModalImg');
  photoModalBackdrop = byId('photoModalBackdrop');
  photoModalCloseBtn = byId('photoModalClose');

  if(photoModalBackdrop) photoModalBackdrop.addEventListener('click', closePhotoViewer);
  if(photoModalCloseBtn) photoModalCloseBtn.addEventListener('click', closePhotoViewer);
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') closePhotoViewer(); });
}

/* ===========================
   BOOT
   =========================== */
(async function boot(){
  await ready;
  STATE.db = getFirestore();

  ensureReportStyles();
  ensureUI();
  wire();

  await loadOpenBoundaryRequests();
  renderList();
  clearDetails();
})();
