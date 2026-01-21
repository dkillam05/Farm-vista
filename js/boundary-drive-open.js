/* =======================================================================
   /Farm-vista/js/boundary-drive-open.js   (FULL FILE)
   Rev: 2026-01-21-global-open-queue-report-tiles

   Purpose (updated per Dane):
     ✅ Show ALL OPEN boundary drive requests across ALL fields (no field selection needed)
     ✅ Render tiles to MATCH the report page look/structure (wo-card / wo-meta / RTK block)
     ✅ Inline drive panel (no modal)
     ✅ Mark as Driven → status: "In Progress"
     ✅ NO “Mark Completed” or “Delete” actions from this feature

   Notes:
     - This file stays FULLY INDEPENDENT.
     - It will inject its own "Open Boundary Drive Requests" hero after #woHero if present,
       otherwise it will append to .wrap or <body>.
     - Uses Firestore query for OPEN statuses; falls back to full scan if indexes/status casing
       prevents query.

   Optional toggles:
     - window.BOUNDARY_DRIVE_MODE = 'global' | 'field'   (default: 'global')
       If 'field', it will filter to window.currentFieldId like the old behavior.
======================================================================= */

import {
  ready,
  getFirestore,
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  serverTimestamp
} from '/Farm-vista/js/firebase-init.js';

/* ===================== DOM HELPERS ===================== */
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s || '').replace(/[&<>"']/g, (m) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

/* Report-like date parsing (handles createdAt, timestampISO, t, etc) */
function toDateAny(v){
  if(!v) return null;
  try{
    if(v?.toDate) return v.toDate();
    if(typeof v === 'string'){
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    if(typeof v === 'number'){
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    if(v?.seconds){
      const d = new Date(v.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
  }catch(_){}
  return null;
}

function createdAtDate(it){
  // Prefer Firestore timestamp
  let d = toDateAny(it.createdAt);
  if(d) return d;

  // Common fallbacks used elsewhere in the app
  d = toDateAny(it.timestampISO);
  if(d) return d;

  d = toDateAny(it.t);
  if(d) return d;

  return null;
}

function fmtDateShort(d){
  if(!d) return '';
  try{ return d.toLocaleDateString(); }
  catch{ return ''; }
}

function normStatus(s){
  return String(s || '').trim().replace(/\.+$/,'').toLowerCase();
}

/* ===================== STATE ===================== */
let db = null;
let lastFieldId = null;
let lastMode = null;

/* ===================== DOM INJECTION ===================== */
function ensureContainers(){
  // Prefer to anchor after existing woHero (matches your pages)
  const anchor = $('woHero') || document.querySelector('#woHero');

  // If not found, try to attach to main content wrapper
  const wrap = document.querySelector('.wrap') || document.body;

  if(!$('woOpenHero')){
    const openHero = document.createElement('section');
    openHero.id = 'woOpenHero';
    openHero.className = 'hero';
    openHero.hidden = true;

    // Uses your report page tile containers/classes (wo-list, etc.)
    openHero.innerHTML = `
      <header class="hero-head">
        <div class="icon" aria-hidden="true">🚜</div>
        <div>
          <h1>Open Boundary Drive Requests</h1>
          <p class="muted">Needs to be driven</p>
        </div>
      </header>
      <div class="body" style="padding:16px; display:grid; gap:12px;">
        <div class="muted" id="woOpenMeta" style="font-size:0.95rem; opacity:.9;"></div>
        <div id="woOpenList" class="wo-list">
          <div class="muted">Loading…</div>
        </div>
      </div>
    `;

    if(anchor && anchor.parentNode){
      anchor.insertAdjacentElement('afterend', openHero);
    }else{
      wrap.appendChild(openHero);
    }
  }

  if(!$('drivePanel')){
    const panel = document.createElement('section');
    panel.id = 'drivePanel';
    panel.className = 'hero';
    panel.hidden = true;

    const openHero = $('woOpenHero');
    if(openHero && openHero.parentNode){
      openHero.insertAdjacentElement('afterend', panel);
    }else{
      wrap.appendChild(panel);
    }
  }
}

/* ===================== TILE HTML (MATCH REPORT STRUCTURE) ===================== */
function rtkLinesFromDoc(d){
  const towerId = String(d?.rtkTowerId || d?.towerId || d?.rtkId || '').trim();
  const rtk = (d && typeof d === 'object' && d.rtk && typeof d.rtk === 'object') ? d.rtk : null;

  const name = String(rtk?.name || '').trim();
  const net  = String(rtk?.networkId ?? '').trim();
  const freq = String(rtk?.frequencyMHz || '').trim();

  const nameLine = name || (towerId ? `Tower ${towerId}` : '');
  const subBits = [];
  if(net) subBits.push(`Net ${net}`);
  if(freq) subBits.push(`${freq} MHz`);
  const subLine = subBits.join(' • ');

  return { nameLine, subLine, towerId };
}

function rtkHtmlBox(d){
  const { nameLine, subLine } = rtkLinesFromDoc(d);
  if(!nameLine && !subLine) return '';
  return `
    <span class="rtk-block">
      <span class="rtk-name">${esc(nameLine || '')}</span>
      ${subLine ? `<span class="rtk-sub">${esc(subLine)}</span>` : ``}
    </span>
  `;
}

function buildCard(it){
  const d = it || {};
  const field = d.field || d.fieldName || d.fieldLabel || 'Field not set';
  const farm  = d.farm || d.farmName || '';
  const scope = d.scope || 'Boundary correction requested';
  const bType = d.boundaryType || '';
  const statusRaw = d.status || 'Open';
  const createdBy = d.submittedBy || '';
  const created = createdAtDate(d);
  const whenStr = fmtDateShort(created);

  const rtkBox = rtkHtmlBox(d);

  // Match report tile layout/classes: wo-card / wo-row-top / wo-main / wo-title / wo-sub / wo-meta
  const card = document.createElement('article');
  card.className = 'wo-card';
  card.tabIndex = 0;

  card.innerHTML = `
    <div class="wo-row-top">
      <div class="wo-main">
        <div class="wo-title">
          ${esc(field)}${farm ? ` · <span>${esc(farm)}</span>` : ''}
        </div>
        <div class="wo-sub">
          ${esc(scope)}
        </div>
        <div class="wo-meta">
          ${bType ? `<span><span class="wo-meta-label">Type</span> <span class="wo-meta-val">${esc(bType)}</span></span>` : ''}
          <span><span class="wo-meta-label">Status</span> <span class="wo-meta-val">OPEN</span></span>
          ${createdBy ? `<span><span class="wo-meta-label">By</span> <span class="wo-meta-val">${esc(createdBy)}</span></span>` : ''}
          ${whenStr ? `<span><span class="wo-meta-label">Submitted</span> <span class="wo-meta-val">${esc(whenStr)}</span></span>` : ''}
          ${rtkBox ? `<span><span class="wo-meta-label">RTK</span> ${rtkBox}</span>` : (d.rtkTowerId ? `<span><span class="wo-meta-label">RTK</span> <span class="wo-meta-val">${esc(d.rtkTowerId)}</span></span>` : '')}
        </div>
      </div>
    </div>
  `;

  // Click opens the inline drive panel (action allowed: mark driven)
  card.addEventListener('click', () => showDrivePanel(d));
  card.addEventListener('keydown', (e) => {
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      showDrivePanel(d);
    }
  });

  return card;
}

/* ===================== DATA FETCH ===================== */
async function fetchOpenItemsGlobal(){
  // Try efficient query first (requires index with status + createdAt order)
  const openVariants = ['open', 'Open', 'OPEN'];

  try{
    const qy = query(
      collection(db, 'boundary_requests'),
      where('status', 'in', openVariants),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(qy);
    const items = [];
    snap.forEach((d) => {
      const it = d.data() || {};
      items.push({ id: d.id, ...it });
    });

    // Keep only true OPEN by normalization (in case other values slip in)
    return items.filter(x => normStatus(x.status || 'open') === 'open');

  }catch(e){
    // Fallback: full scan + client filter/sort (works even without index / missing createdAt)
    console.warn('[boundary-drive-open] open query failed; falling back to scan', e);

    const snap = await getDocs(collection(db, 'boundary_requests'));
    const items = [];
    snap.forEach((d) => {
      const it = d.data() || {};
      const st = normStatus(it.status || 'open');
      if(st === 'open'){
        items.push({ id: d.id, ...it });
      }
    });

    items.sort((a,b) => {
      const ta = createdAtDate(a)?.getTime?.() || 0;
      const tb = createdAtDate(b)?.getTime?.() || 0;
      return tb - ta;
    });

    return items;
  }
}

async function fetchOpenItemsForField(fieldId){
  if(!fieldId) return [];

  // Field-filtered query (like old behavior) but still only OPEN
  try{
    const qy = query(
      collection(db, 'boundary_requests'),
      where('fieldId', '==', fieldId),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(qy);
    const items = [];
    snap.forEach((d) => {
      const it = d.data() || {};
      const st = normStatus(it.status || 'open');
      if(st === 'open'){
        items.push({ id: d.id, ...it });
      }
    });

    return items;

  }catch(e){
    console.warn('[boundary-drive-open] field query failed; falling back to scan', e);

    const snap = await getDocs(collection(db, 'boundary_requests'));
    const items = [];
    snap.forEach((d) => {
      const it = d.data() || {};
      const st = normStatus(it.status || 'open');
      if(st === 'open' && String(it.fieldId || '') === String(fieldId || '')){
        items.push({ id: d.id, ...it });
      }
    });

    items.sort((a,b) => {
      const ta = createdAtDate(a)?.getTime?.() || 0;
      const tb = createdAtDate(b)?.getTime?.() || 0;
      return tb - ta;
    });

    return items;
  }
}

/* ===================== RENDER ===================== */
async function renderOpenQueue(mode){
  const hero = $('woOpenHero');
  const list = $('woOpenList');
  const meta = $('woOpenMeta');
  if(!hero || !list) return;

  hero.hidden = false;
  list.innerHTML = '<div class="muted">Loading…</div>';
  if(meta) meta.textContent = '';

  try{
    let items = [];

    if(mode === 'field'){
      const fid = window.currentFieldId || '';
      items = await fetchOpenItemsForField(fid);
      lastFieldId = fid || null;
    }else{
      items = await fetchOpenItemsGlobal();
      lastFieldId = null;
    }

    // Meta line (small summary like report page does)
    if(meta){
      if(mode === 'field'){
        const label = window.currentFieldLabel || 'Selected Field';
        meta.textContent = items.length
          ? `${items.length} open request${items.length===1?'':'s'} for ${label}`
          : `No open requests for ${label}`;
      }else{
        const uniqueFields = new Set(items.map(x => (x.fieldId || x.field || x.fieldName || x.fieldLabel || '').toString()).filter(Boolean)).size;
        meta.textContent = items.length
          ? `${items.length} open on ${uniqueFields || 0} field${uniqueFields===1?'':'s'}`
          : `No open drive requests.`;
      }
    }

    if(!items.length){
      list.innerHTML = '<div class="muted">No open drive requests.</div>';
      return;
    }

    list.innerHTML = '';
    items.forEach((it) => {
      const card = buildCard(it);
      list.appendChild(card);
    });

  }catch(e){
    console.error(e);
    list.innerHTML = '<div class="muted">Unable to load open drive requests.</div>';
  }
}

/* ===================== INLINE DRIVE PANEL ===================== */
function showDrivePanel(it){
  const panel = $('drivePanel');
  if(!panel) return;

  // In global mode, currentFieldLabel likely not set; prefer per-item field label
  const label = window.currentFieldLabel || it.field || it.fieldName || it.fieldLabel || 'Selected Field';
  const farm  = it.farm || it.farmName || '';
  const scope = it.scope || '';
  const created = createdAtDate(it);
  const whenStr = fmtDateShort(created) || it.when || '';
  const rtkBox = rtkHtmlBox(it);

  panel.innerHTML = `
    <header class="hero-head">
      <div class="icon" aria-hidden="true">🚜</div>
      <div>
        <h1>Drive Request — ${esc(label)}${farm ? ` · <span>${esc(farm)}</span>` : ''}</h1>
        <p class="muted">Open → Mark as Driven</p>
      </div>
    </header>

    <div class="body" style="padding:16px; display:grid; gap:14px;">
      <div class="row" style="display:grid; gap:10px; grid-template-columns:1fr 1fr;">
        <div class="field">
          <label>Status</label>
          <div class="pill">OPEN</div>
        </div>
        <div class="field">
          <label>Date</label>
          <div class="pill">${esc(whenStr)}</div>
        </div>
      </div>

      ${scope ? `
      <div class="field">
        <label>Scope</label>
        <div>${esc(scope)}</div>
      </div>` : ''}

      <div class="field">
        <label>Boundary Type</label>
        <strong>${esc(it.boundaryType || '—')}</strong>
      </div>

      <div class="field">
        <label>Submitted By</label>
        <div>${esc(it.submittedBy || 'Unknown')}</div>
      </div>

      ${rtkBox ? `
      <div class="field">
        <label>RTK</label>
        <div>${rtkBox}</div>
      </div>` : (it.rtkTowerId ? `
      <div class="field">
        <label>RTK</label>
        <div>${esc(it.rtkTowerId)}</div>
      </div>` : '')}

      ${it.notes ? `
      <div class="field">
        <label>Notes</label>
        <div>${esc(it.notes)}</div>
      </div>` : ''}

      <div class="actions" style="display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
        <button id="markDrivenBtn" class="btn btn-primary" type="button">
          Mark as Driven
        </button>
        <button id="closeDrivePanelBtn" class="btn" type="button">
          Close
        </button>
      </div>

      <div class="muted" style="font-size:0.9rem;">
        Note: This page is drive-only. No complete/delete actions are available here.
      </div>
    </div>
  `;

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const drivenBtn = $('markDrivenBtn');
  const closeBtn  = $('closeDrivePanelBtn');

  if(drivenBtn){
    drivenBtn.addEventListener('click', async () => {
      await markDriven(it.id);
    });
  }
  if(closeBtn){
    closeBtn.addEventListener('click', () => {
      panel.hidden = true;
      panel.innerHTML = '';
    });
  }
}

/* ===================== FIRESTORE UPDATE ===================== */
async function markDriven(id){
  try{
    await updateDoc(
      doc(db, 'boundary_requests', id),
      {
        status: 'In Progress',
        drivenAt: serverTimestamp()
      }
    );

    const panel = $('drivePanel');
    if(panel){
      panel.hidden = true;
      panel.innerHTML = '';
    }

    // Refresh list (global or field depending on mode)
    const mode = String(window.BOUNDARY_DRIVE_MODE || 'global').toLowerCase().trim();
    await renderOpenQueue(mode === 'field' ? 'field' : 'global');

  }catch(e){
    alert('Failed to mark as driven');
    console.error(e);
  }
}

/* ===================== HELPERS ===================== */
function hideAll(){
  const hero = $('woOpenHero');
  const panel = $('drivePanel');
  if(hero) hero.hidden = true;
  if(panel){
    panel.hidden = true;
    panel.innerHTML = '';
  }
}

/* ===================== MODE / WATCHER ===================== */
function computeMode(){
  const raw = String(window.BOUNDARY_DRIVE_MODE || 'global').toLowerCase().trim();
  return (raw === 'field') ? 'field' : 'global';
}

function watchModeAndField(){
  setInterval(async () => {
    const mode = computeMode();

    if(mode !== lastMode){
      lastMode = mode;
      if(mode === 'global'){
        await renderOpenQueue('global');
      }else{
        // field mode
        const fid = window.currentFieldId || '';
        lastFieldId = fid || null;
        await renderOpenQueue('field');
      }
      return;
    }

    if(mode === 'field'){
      const fid = window.currentFieldId || '';
      if(fid && fid !== lastFieldId){
        lastFieldId = fid;
        await renderOpenQueue('field');
      }
      if(!fid){
        hideAll();
        lastFieldId = null;
      }
    }
  }, 500);
}

/* ===================== BOOT ===================== */
(async function boot(){
  await ready;
  db = getFirestore();
  ensureContainers();

  // Default: GLOBAL open queue immediately
  lastMode = computeMode();
  if(lastMode === 'field'){
    await renderOpenQueue('field');
  }else{
    await renderOpenQueue('global');
  }

  // Keep lightweight watcher so pages that set mode/field later still work
  watchModeAndField();
})();
