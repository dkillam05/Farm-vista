/* =======================================================================
   /Farm-vista/js/boundary-drive-open.js   (FULL FILE)
   Rev: 2026-01-21-perfect-report-tiles-open-queue-drive-only

   PERFECT MATCH TARGET: reports page tile rendering
   ✅ Uses the SAME tile HTML structure as the report page (wo-card / wo-title / wo-sub / wo-meta / rtk-block)
   ✅ Uses the SAME status normalization + createdAt parsing strategy as the report page
   ✅ Shows ALL OPEN requests globally by default (no field selection required)
   ✅ Optional field mode: window.BOUNDARY_DRIVE_MODE='field' uses window.currentFieldId
   ✅ Click tile -> inline drive panel (NO complete/delete from this feature)
   ✅ Mark as Driven -> status: "In Progress" + refresh list
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
const qs = (sel, root=document) => root.querySelector(sel);

function escapeHtml(str){
  return String(str || '').replace(/[&<>"']/g, m => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]
  ));
}

/* ===================== REPORT-PAGE COMPAT HELPERS ===================== */
function normalizeStatus(s){
  return String(s || '').trim().replace(/\.+$/,'').toLowerCase();
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

function formatDate(d){
  if(!d) return '';
  try{ return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
  catch{ return ''; }
}

/* createdAt parsing EXACTLY like the report page */
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

  const createdDate = createdIso ? new Date(createdIso) : null;
  return createdDate;
}

function getTowerIdFromRequest(d){
  return coerceStr(d?.rtkTowerId || d?.towerId || d?.rtkId || '');
}

/* RTK display EXACTLY like the report page tile (uses d.rtk if present; otherwise towerId) */
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

/* ===================== STATE ===================== */
let db = null;
let lastMode = null;
let lastFieldId = null;

/* ===================== DOM INJECTION ===================== */
function ensureContainers(){
  const anchor = $('woHero') || qs('#woHero');
  const wrap = qs('.wrap') || document.body;

  if(!$('woOpenHero')){
    const openHero = document.createElement('section');
    openHero.id = 'woOpenHero';
    openHero.className = 'hero';
    openHero.hidden = true;

    // Match report-page section layout: body contains empty + list
    openHero.innerHTML = `
      <header class="hero-head">
        <div class="icon" aria-hidden="true">🚜</div>
        <div>
          <h1>Open Boundary Drive Requests</h1>
          <p class="muted">Needs to be driven</p>
        </div>
      </header>

      <div class="body">
        <div class="toolbar" style="margin-bottom:2px;">
          <div class="page-header-meta" id="woOpenCount">0 open</div>
        </div>

        <section aria-label="Open boundary drive requests">
          <div class="wo-empty" id="woOpenEmpty">Loading open drive requests…</div>
          <div class="wo-list" id="woOpenList"></div>
        </section>
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

/* ===================== DATA FETCH (OPEN ONLY) ===================== */
async function fetchAllOpen(){
  // Try indexed query first; if it fails, full scan.
  const openVariants = ['open','Open','OPEN'];

  try{
    const qy = query(
      collection(db, 'boundary_requests'),
      where('status', 'in', openVariants),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(qy);
    const items = snap.docs.map(ds => {
      const data = ds.data() || {};
      const createdDate = createdAtFromDoc(data);
      return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
    });

    // Normalize filter (guaranteed OPEN)
    return items.filter(it => normalizeStatus(it.data.status) === 'open');
  }catch(e){
    console.warn('[boundary-drive-open] open query failed; falling back to scan', e);

    const snap = await getDocs(collection(db, 'boundary_requests'));
    const items = snap.docs
      .map(ds => {
        const data = ds.data() || {};
        const createdDate = createdAtFromDoc(data);
        return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
      })
      .filter(it => normalizeStatus(it.data.status) === 'open');

    items.sort((a,b) => {
      const ta = a.data._createdAtDate ? a.data._createdAtDate.getTime() : 0;
      const tb = b.data._createdAtDate ? b.data._createdAtDate.getTime() : 0;
      return tb - ta;
    });

    return items;
  }
}

async function fetchOpenForField(fieldId){
  if(!fieldId) return [];

  try{
    const qy = query(
      collection(db, 'boundary_requests'),
      where('fieldId', '==', fieldId),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(qy);
    const items = snap.docs
      .map(ds => {
        const data = ds.data() || {};
        const createdDate = createdAtFromDoc(data);
        return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
      })
      .filter(it => normalizeStatus(it.data.status) === 'open');

    return items;
  }catch(e){
    console.warn('[boundary-drive-open] field open query failed; falling back to scan', e);

    const snap = await getDocs(collection(db, 'boundary_requests'));
    const items = snap.docs
      .map(ds => {
        const data = ds.data() || {};
        const createdDate = createdAtFromDoc(data);
        return { id: ds.id, data: { ...data, _createdAtDate: createdDate } };
      })
      .filter(it => normalizeStatus(it.data.status) === 'open' && String(it.data.fieldId||'') === String(fieldId||''));

    items.sort((a,b) => {
      const ta = a.data._createdAtDate ? a.data._createdAtDate.getTime() : 0;
      const tb = b.data._createdAtDate ? b.data._createdAtDate.getTime() : 0;
      return tb - ta;
    });

    return items;
  }
}

/* ===================== PERFECT TILE RENDER (COPY OF REPORT LOGIC) ===================== */
function renderOpenTiles(items){
  const listEl  = $('woOpenList');
  const emptyEl = $('woOpenEmpty');
  const countEl = $('woOpenCount');

  if(!listEl || !emptyEl) return;

  listEl.innerHTML = '';

  if(!items.length){
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'No open drive requests.';
    if(countEl) countEl.textContent = '0 open';
    return;
  }

  emptyEl.style.display = 'none';

  // Count line matches report style: "{open} open on {farms} farms"
  const farmIds = new Set(items.map(it => it.data.farmId || it.data.farm).filter(Boolean));
  if(countEl){
    countEl.textContent = `${items.length} open on ${farmIds.size || 0} farm${farmIds.size === 1 ? '' : 's'}`;
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

    // ✅ EXACT report tile HTML (no changes) EXCEPT: click behavior routes to drive panel instead of report details
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
      showDrivePanel(item.id, d);
    });

    listEl.appendChild(card);
  }
}

/* ===================== INLINE DRIVE PANEL (DRIVE-ONLY) ===================== */
function showDrivePanel(id, d){
  const panel = $('drivePanel');
  if(!panel) return;

  const field = d.field || 'Field not set';
  const farm  = d.farm  || '';
  const scope = d.scope || '';
  const bType = d.boundaryType || '';
  const submittedBy = d.submittedBy || 'Unknown';
  const submittedByEmail = d.submittedByEmail || '';
  const createdAt = createdAtFromDoc(d);
  const whenStr = formatDate(createdAt);

  const rtk = getRtkForRequest(d);
  const rtkBox = rtkHtmlBox(rtk);

  panel.innerHTML = `
    <header class="hero-head">
      <div class="icon" aria-hidden="true">🚜</div>
      <div>
        <h1>Drive Request</h1>
        <p class="muted">${escapeHtml(field)}${farm ? ` · ${escapeHtml(farm)}` : ''}</p>
      </div>
    </header>

    <div class="body">
      <div class="wo-detail-panel" style="display:flex; margin-top:0;">
        <div class="wo-detail-header">
          <div class="wo-detail-title">${escapeHtml(field)}${farm ? ` · ${escapeHtml(farm)}` : ''}</div>
          <button type="button" id="driveClose" class="wo-detail-close">Close</button>
        </div>

        <div class="wo-detail-grid">
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
              ${rtkBox ? `
              <span class="rtk-block">
                <span class="rtk-name">${escapeHtml(rtkLines(rtk).nameLine || (d.rtkTowerId ? ('Tower ' + d.rtkTowerId) : 'Not set'))}</span>
                ${rtkLines(rtk).subLine ? `<span class="rtk-sub">${escapeHtml(rtkLines(rtk).subLine)}</span>` : ``}
              </span>` : escapeHtml(d.rtkTowerId ? ('Tower ' + d.rtkTowerId) : 'Not set')}
            </div>
          </div>

          <div>
            <div class="wo-detail-item-label">Submitted By</div>
            <div class="wo-detail-item-value">
              ${escapeHtml(submittedBy)}
              ${submittedByEmail ? `<br><span style="opacity:.8">${escapeHtml(submittedByEmail)}</span>` : ''}
            </div>
          </div>

          <div>
            <div class="wo-detail-item-label">Submitted</div>
            <div class="wo-detail-item-value">${escapeHtml(whenStr || 'Unknown')}</div>
          </div>
        </div>

        <div class="wo-detail-notes">
          <div class="wo-detail-notes-label">Notes</div>
          <div class="wo-detail-notes-body">${escapeHtml(d.notes || 'No notes recorded for this request.')}</div>
        </div>

        <div class="wo-detail-footer">
          Current status:
          <span class="wo-detail-pill">${escapeHtml(d.status || 'open')}</span>
          <span class="wo-detail-pill">Drive-only</span>
        </div>

        <div class="wo-detail-actions">
          <div class="wo-detail-actions-left">
            <button type="button" id="btnMarkDriven" class="btn btn-primary btn-small">
              Mark as Driven
            </button>
          </div>
          <div class="wo-detail-actions-right">
            <!-- Intentionally NO delete button here -->
          </div>
        </div>
      </div>
    </div>
  `;

  panel.hidden = false;
  panel.scrollIntoView({ behavior:'smooth', block:'start' });

  const closeBtn = $('driveClose');
  if(closeBtn){
    closeBtn.addEventListener('click', () => {
      panel.hidden = true;
      panel.innerHTML = '';
    });
  }

  const drivenBtn = $('btnMarkDriven');
  if(drivenBtn){
    drivenBtn.addEventListener('click', async () => {
      await markDriven(id);
    });
  }
}

/* ===================== UPDATE ===================== */
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

    await refresh();

  }catch(e){
    alert('Failed to mark as driven');
    console.error(e);
  }
}

/* ===================== MODE / REFRESH ===================== */
function computeMode(){
  const raw = String(window.BOUNDARY_DRIVE_MODE || 'global').toLowerCase().trim();
  return (raw === 'field') ? 'field' : 'global';
}

async function refresh(){
  const hero = $('woOpenHero');
  if(!hero) return;

  hero.hidden = false;

  const mode = computeMode();
  const fid = window.currentFieldId || '';

  let items = [];
  if(mode === 'field'){
    items = await fetchOpenForField(fid);
    lastFieldId = fid || null;
  }else{
    items = await fetchAllOpen();
    lastFieldId = null;
  }

  renderOpenTiles(items);
}

function watchModeAndField(){
  setInterval(async () => {
    const mode = computeMode();
    const fid = window.currentFieldId || '';

    if(mode !== lastMode){
      lastMode = mode;
      await refresh();
      return;
    }

    if(mode === 'field'){
      if(fid && fid !== lastFieldId){
        lastFieldId = fid;
        await refresh();
      }
      if(!fid){
        // In field mode with no selected field, hide feature (matches old behavior)
        const hero = $('woOpenHero');
        const panel = $('drivePanel');
        if(hero) hero.hidden = true;
        if(panel){ panel.hidden = true; panel.innerHTML = ''; }
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

  lastMode = computeMode();
  await refresh();

  watchModeAndField();
})();
