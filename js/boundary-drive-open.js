/* =======================================================================
   boundary-drive-open.js
   Purpose:
     - Adds an OPEN-only actionable work order hero
     - Inline drive panel (no modal)
     - Mark as Driven → status: "In Progress"
     - Auto-scroll to inline panel

   Assumptions:
     - firebase-init.js is available
     - Page already selects a field and sets:
         window.currentFieldId
         window.currentFieldLabel (optional)
     - Existing page already renders woHero (mixed status)

   This file is FULLY INDEPENDENT.
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
const $ = id => document.getElementById(id);
const esc = s => String(s || "").replace(/[&<>"']/g, m => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));
const fmtDate = ts => {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleDateString() : "";
};

/* ===================== STATE ===================== */
let db = null;
let lastFieldId = null;

/* ===================== DOM INJECTION ===================== */
function ensureContainers(){
  const woHero = $('woHero');
  if(!woHero) return;

  if(!$('woOpenHero')){
    const openHero = document.createElement('section');
    openHero.id = 'woOpenHero';
    openHero.className = 'hero';
    openHero.hidden = true;
    openHero.innerHTML = `
      <header class="hero-head">
        <div class="icon">🚜</div>
        <div>
          <h1>Open Boundary Drive Requests</h1>
          <p class="muted">Needs to be driven</p>
        </div>
      </header>
      <div id="woOpenList" class="wo-list">
        <div class="muted">No open drive requests.</div>
      </div>
    `;
    woHero.after(openHero);
  }

  if(!$('drivePanel')){
    const panel = document.createElement('section');
    panel.id = 'drivePanel';
    panel.className = 'hero';
    panel.hidden = true;
    $('woOpenHero').after(panel);
  }
}

/* ===================== RENDER OPEN ONLY ===================== */
async function renderOpenWorkOrders(fieldId){
  if(!fieldId){
    hideAll();
    return;
  }

  try{
    const qy = query(
      collection(db, 'boundary_requests'),
      where('fieldId', '==', fieldId),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(qy);
    const items = [];

    snap.forEach(d => {
      const it = d.data() || {};
      const status = String(it.status || 'open').toLowerCase().trim();
      if(status === 'open'){
        items.push({ id: d.id, ...it });
      }
    });

    const hero = $('woOpenHero');
    const list = $('woOpenList');

    hero.hidden = false;

    if(!items.length){
      list.innerHTML = '<div class="muted">No open drive requests.</div>';
      return;
    }

    list.innerHTML = '';
    items.forEach(it => {
      const el = document.createElement('div');
      el.className = 'wo-item';
      el.tabIndex = 0;
      el.innerHTML = `
        <div class="wo-head">
          <strong>${esc(it.boundaryType || '—')}</strong>
          <span class="pill">${esc(fmtDate(it.createdAt) || it.when || '')}</span>
          <span class="pill">OPEN</span>
        </div>
        <div class="muted" style="margin-top:6px">
          Submitted by ${esc(it.submittedBy || 'Unknown')}
        </div>
        ${it.notes ? `<div style="margin-top:6px">${esc(it.notes)}</div>` : ''}
      `;

      el.addEventListener('click', () => showDrivePanel(it));
      el.addEventListener('keydown', e => {
        if(e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          showDrivePanel(it);
        }
      });

      list.appendChild(el);
    });

  }catch(e){
    console.error(e);
  }
}

/* ===================== INLINE DRIVE PANEL ===================== */
function showDrivePanel(it){
  const panel = $('drivePanel');
  const label = window.currentFieldLabel || it.field || 'Selected Field';

  panel.innerHTML = `
    <header class="hero-head">
      <div class="icon">🚜</div>
      <div>
        <h1>Drive Request — ${esc(label)}</h1>
        <p class="muted">Open → Mark as Driven</p>
      </div>
    </header>
    <div class="body">
      <div class="row">
        <div class="field">
          <label>Status</label>
          <div class="pill">OPEN</div>
        </div>
        <div class="field">
          <label>Date</label>
          <div class="pill">${esc(fmtDate(it.createdAt) || it.when || '')}</div>
        </div>
      </div>

      <div class="field">
        <label>Boundary Type</label>
        <strong>${esc(it.boundaryType || '—')}</strong>
      </div>

      <div class="field">
        <label>Submitted By</label>
        <div>${esc(it.submittedBy || 'Unknown')}</div>
      </div>

      ${it.notes ? `
      <div class="field">
        <label>Notes</label>
        <div>${esc(it.notes)}</div>
      </div>` : ''}

      <div class="actions">
        <button id="markDrivenBtn" class="btn btn-primary" type="button">
          Mark as Driven
        </button>
      </div>
    </div>
  `;

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  $('markDrivenBtn').addEventListener('click', async () => {
    await markDriven(it.id);
  });
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

    $('drivePanel').hidden = true;
    $('drivePanel').innerHTML = '';

    if(lastFieldId){
      renderOpenWorkOrders(lastFieldId);
    }
  }catch(e){
    alert('Failed to mark as driven');
    console.error(e);
  }
}

/* ===================== HELPERS ===================== */
function hideAll(){
  if($('woOpenHero')) $('woOpenHero').hidden = true;
  if($('drivePanel')){
    $('drivePanel').hidden = true;
    $('drivePanel').innerHTML = '';
  }
}

/* ===================== FIELD WATCHER ===================== */
/*
  This watches for the page updating:
    window.currentFieldId
*/
function watchField(){
  setInterval(() => {
    const fid = window.currentFieldId || '';
    if(fid && fid !== lastFieldId){
      lastFieldId = fid;
      renderOpenWorkOrders(fid);
    }
    if(!fid){
      hideAll();
      lastFieldId = null;
    }
  }, 300);
}

/* ===================== BOOT ===================== */
(async function boot(){
  await ready;
  db = getFirestore();
  ensureContainers();
  watchField();
})();
