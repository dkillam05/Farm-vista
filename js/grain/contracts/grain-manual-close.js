/* FarmVista — manual close for near-complete grain contracts / hauling jobs
   Rev 2026-09-09
   Manual close is offered only when actual bushels are within ±1% of target.
   Actual bushel accounting is preserved; close metadata is stored separately.
*/
import {
  ready,
  getFirestore,
  getAuth,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from '/js/firebase-init.js';

await ready;

const db = getFirestore();
const auth = getAuth();
const $ = id => document.getElementById(id);
const num = value => {
  const n = Number(String(value ?? '').replace(/,/g,''));
  return Number.isFinite(n) ? n : 0;
};
const clean = value => String(value ?? '').trim();
const round2 = value => Number(num(value).toFixed(2));
const fmtBu = value => num(value).toLocaleString('en-US',{maximumFractionDigits:2});
const withinOnePercent = (actual,target) => target > 0 && Math.abs(actual-target) <= (target * 0.01 + 0.005);
const isVoided = item => item?.voided === true || clean(item?.status).toLowerCase().includes('void');

let snapshot = {contracts:[],jobs:[],tickets:[]};
let loading = null;

async function refreshData(force=false){
  if(loading && !force) return loading;
  loading = Promise.all([
    getDocs(collection(db,'grain_contracts')),
    getDocs(collection(db,'grain_hauling_jobs')),
    getDocs(collection(db,'grain_tickets'))
  ]).then(([contracts,jobs,tickets]) => {
    snapshot = {
      contracts: contracts.docs.map(d => ({id:d.id,...d.data()})),
      jobs: jobs.docs.map(d => ({id:d.id,...d.data()})),
      tickets: tickets.docs.map(d => ({id:d.id,...d.data()}))
    };
    return snapshot;
  }).finally(() => { loading = null; });
  return loading;
}

function ticketBushels(ticket){
  return num(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels);
}

function jobTarget(job){
  return Math.max(0,num(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
}

function jobActual(jobId){
  return round2(snapshot.tickets
    .filter(t => !isVoided(t) && clean(t?.haulingJobId) === clean(jobId))
    .reduce((sum,t) => sum + ticketBushels(t),0));
}

function contractTarget(contract){
  return Math.max(0,num(contract?.contractBushels ?? contract?.bushels ?? contract?.quantity ?? contract?.totalBushels));
}

function contractActual(contractId){
  return round2(snapshot.tickets
    .filter(t => !isVoided(t))
    .reduce((sum,ticket) => {
      if(Array.isArray(ticket?.contractAllocations)){
        return sum + ticket.contractAllocations
          .filter(a => clean(a?.contractId) === clean(contractId))
          .reduce((a,b) => a + num(b?.bushels),0);
      }
      if(clean(ticket?.contractId) === clean(contractId)) return sum + ticketBushels(ticket);
      return sum;
    },0));
}

function actorValue(){
  const user = auth.currentUser;
  return clean(user?.email || user?.phoneNumber || user?.uid) || 'FarmVista user';
}

function ensureStyle(){
  if(document.getElementById('fv-manual-close-style')) return;
  const style = document.createElement('style');
  style.id = 'fv-manual-close-style';
  style.textContent = `
    .fv-manual-close-panel{margin:12px 18px 18px;padding:12px;border:1px solid var(--border,#d4d4d4);border-radius:10px;background:var(--surface-2,#f5f5f5)}
    .fv-manual-close-copy{font-size:.84rem;line-height:1.4;margin-bottom:9px}
    .fv-manual-close-copy strong{font-weight:900}
    .fv-manual-close-btn{min-height:40px;padding:8px 13px;border:0;border-radius:9px;background:#3B7E46;color:#fff;font:inherit;font-weight:850;cursor:pointer}
    .fv-manual-close-btn:disabled{opacity:.55;cursor:not-allowed}
    .fv-manual-close-closed{font-weight:850;color:#2f6e39}
  `;
  document.head.appendChild(style);
}

function panelFor(form,key){
  let panel = form?.querySelector(`[data-fv-manual-close-panel="${key}"]`);
  if(panel) return panel;
  panel = document.createElement('div');
  panel.className = 'fv-manual-close-panel';
  panel.dataset.fvManualClosePanel = key;
  form?.appendChild(panel);
  return panel;
}

async function renderContract(){
  const form = $('edit-contract-form');
  const id = clean(form?.dataset?.fvContractId);
  if(!form || !id) return;
  await refreshData();
  const contract = snapshot.contracts.find(c => c.id === id);
  if(!contract) return;
  const panel = panelFor(form,'contract');
  if(contract.manualClosed === true){
    panel.innerHTML = '<div class="fv-manual-close-closed">This contract was manually closed.</div>';
    return;
  }
  const target = contractTarget(contract);
  const actual = contractActual(id);
  if(!withinOnePercent(actual,target)){
    panel.remove();
    return;
  }
  const variance = round2(actual-target);
  panel.innerHTML = `
    <div class="fv-manual-close-copy">
      <strong>Within 1% of contract target.</strong><br>
      Target: ${fmtBu(target)} bu · Delivered: ${fmtBu(actual)} bu · Difference: ${variance >= 0 ? '+' : ''}${fmtBu(variance)} bu
    </div>
    <button type="button" class="fv-manual-close-btn">Close Contract</button>`;
  panel.querySelector('button')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if(!confirm(`Close this contract at ${fmtBu(actual)} of ${fmtBu(target)} bushels?\n\nThe actual bushel totals will not be changed.`)) return;
    button.disabled = true;
    button.textContent = 'Closing…';
    await updateDoc(doc(db,'grain_contracts',id),{
      manualClosed:true,
      manualClosedAt:serverTimestamp(),
      manualClosedBy:actorValue(),
      manualCloseTargetBushels:round2(target),
      manualCloseActualBushels:round2(actual),
      manualCloseVarianceBushels:round2(variance),
      status:'Completed',
      contractStatus:'Completed',
      updatedAt:serverTimestamp()
    });
    location.reload();
  });
}

async function renderJob(){
  const form = $('hauling-job-form');
  const id = clean($('hauling-job-edit-id')?.value);
  if(!form || !id) return;
  await refreshData();
  const job = snapshot.jobs.find(j => j.id === id);
  if(!job) return;
  const panel = panelFor(form,'job');
  if(job.manualClosed === true){
    panel.innerHTML = '<div class="fv-manual-close-closed">This hauling job was manually closed.</div>';
    return;
  }
  const target = jobTarget(job);
  const actual = jobActual(id);
  if(!withinOnePercent(actual,target)){
    panel.remove();
    return;
  }
  const variance = round2(actual-target);
  panel.innerHTML = `
    <div class="fv-manual-close-copy">
      <strong>Within 1% of hauling-job target.</strong><br>
      Target: ${fmtBu(target)} bu · Hauled: ${fmtBu(actual)} bu · Difference: ${variance >= 0 ? '+' : ''}${fmtBu(variance)} bu
    </div>
    <button type="button" class="fv-manual-close-btn">Close Hauling Job</button>`;
  panel.querySelector('button')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    if(!confirm(`Close this hauling job at ${fmtBu(actual)} of ${fmtBu(target)} bushels?\n\nThe actual bushel totals will not be changed.`)) return;
    button.disabled = true;
    button.textContent = 'Closing…';
    await updateDoc(doc(db,'grain_hauling_jobs',id),{
      manualClosed:true,
      manualClosedAt:serverTimestamp(),
      manualClosedBy:actorValue(),
      manualCloseTargetBushels:round2(target),
      manualCloseActualBushels:round2(actual),
      manualCloseVarianceBushels:round2(variance),
      status:'Closed',
      updatedAt:serverTimestamp()
    });
    location.reload();
  });
}

ensureStyle();
await refreshData();

let lastContractId = '';
let lastJobId = '';
const sync = () => {
  const contractId = clean($('edit-contract-form')?.dataset?.fvContractId);
  const jobId = clean($('hauling-job-edit-id')?.value);
  if(contractId && contractId !== lastContractId){
    lastContractId = contractId;
    renderContract();
  }
  if(jobId && jobId !== lastJobId){
    lastJobId = jobId;
    renderJob();
  }
  if(!contractId) lastContractId = '';
  if(!jobId) lastJobId = '';
};

new MutationObserver(sync).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['value','class','aria-hidden','data-fv-contract-id']});
document.addEventListener('click',() => setTimeout(sync,0),true);
setInterval(sync,700);
sync();

/*
  Sept. 11, 2026 — Ticket -> Hauling Job first-load context.
  The hybrid DND workspace intentionally lets the active ticket determine the
  compatible jobs shown on the right. On first render there can be several
  unassigned tickets, so select the first card automatically instead of making
  the user click/half-drag once before any hauling job appears.
*/
let fvInitialTicketContextSet = false;
const setInitialTicketContext = () => {
  if(fvInitialTicketContextSet) return;
  const list = document.getElementById('fv-unassigned-ticket-list');
  if(!list) return;
  if(list.querySelector('.fv-hauling-ticket-card.fv-active-ticket')){
    fvInitialTicketContextSet = true;
    return;
  }
  const first = list.querySelector('.fv-hauling-ticket-card[data-ticket-id]');
  if(!first) return;
  fvInitialTicketContextSet = true;
  first.click();
};

new MutationObserver(() => setTimeout(setInitialTicketContext,0)).observe(document.documentElement,{subtree:true,childList:true});
setTimeout(setInitialTicketContext,0);

/* ======================================================================
   SEPT. 11, 2026 — HAULING JOB TICKET-FIRST DRILLDOWN

   Hauling Jobs are now the operational parent whether or not contracts exist.
   Replace the old Contracts count in the main Hauling Jobs table with Tickets.
   The ticket count opens a job-level review with bushel-weighted grade
   averages, per-ticket grades/details, and saved ticket image access.
====================================================================== */

const fvEscape = value => clean(value)
  .replaceAll('&','&amp;')
  .replaceAll('<','&lt;')
  .replaceAll('>','&gt;')
  .replaceAll('"','&quot;')
  .replaceAll("'",'&#039;');

function haulingJobTickets(jobId){
  return snapshot.tickets
    .filter(ticket => !isVoided(ticket) && clean(ticket?.haulingJobId) === clean(jobId))
    .sort((a,b) => {
      const ad = clean(a?.ticketDate || a?.date || a?.deliveryDate);
      const bd = clean(b?.ticketDate || b?.date || b?.deliveryDate);
      return bd.localeCompare(ad) || ticketNumber(a).localeCompare(ticketNumber(b),undefined,{numeric:true,sensitivity:'base'});
    });
}

function ticketNumber(ticket){
  return clean(ticket?.ticketNumber || ticket?.ticketNo || ticket?.ticket || ticket?.number) || clean(ticket?.id) || 'Ticket';
}

function ticketDate(ticket){
  const raw = clean(ticket?.ticketDate || ticket?.date || ticket?.deliveryDate);
  if(!raw) return '—';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[2])}/${Number(match[3])}/${match[1]}` : raw;
}

function gradeValue(ticket,aliases){
  const sources = [
    ticket,
    ticket?.grades,
    ticket?.gradeFactors,
    ticket?.grade,
    ticket?.ocrValues
  ].filter(Boolean);

  for(const source of sources){
    for(const key of aliases){
      const raw = source?.[key];
      if(raw === undefined || raw === null || clean(raw) === '') continue;
      const parsed = Number(String(raw).replace(/[^0-9.-]/g,''));
      if(Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

const gradeKeys = {
  tw:['tw','TW','testWeight','testWt','testweight'],
  mo:['mo','MO','moisture','Moisture'],
  dm:['dm','DM','damage','damaged','damagePercent','damagedKernels'],
  fm:['fm','FM','foreignMaterial','foreignMatter','foreignMaterialPercent','bcfm']
};

function weightedGradeAverage(tickets,aliases){
  let weighted = 0;
  let weight = 0;
  tickets.forEach(ticket => {
    const value = gradeValue(ticket,aliases);
    const bushels = ticketBushels(ticket);
    if(value === null || !(bushels > 0)) return;
    weighted += value * bushels;
    weight += bushels;
  });
  return weight > 0 ? weighted / weight : null;
}

function fmtGrade(value,pad=false){
  if(value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const fixed = Number(value).toFixed(1);
  if(!pad) return fixed;
  const [whole,decimal] = fixed.split('.');
  return `${whole.padStart(2,'0')}.${decimal}`;
}

function ticketImageUrl(ticket){
  return clean(
    ticket?.ticketImageUrl ||
    ticket?.imageUrl ||
    ticket?.ticketPhotoUrl ||
    ticket?.photoUrl ||
    ticket?.image?.imageUrl ||
    ticket?.image?.url
  );
}

function jobDisplayName(job){
  if(!job) return 'Hauling Job';
  const saved = clean(job?.displayName || job?.jobName || job?.haulingJobName);
  if(saved) return saved;
  const buyer = clean(job?.buyerName || job?.buyer);
  const location = clean(job?.deliveryLocationName || job?.locationName || job?.destinationName || job?.destination);
  return `${buyer || location || 'Hauling Job'} — ${fmtBu(jobTarget(job))} bu`;
}

function ensureHaulingTicketStyle(){
  if(document.getElementById('fv-hauling-ticket-drill-style')) return;
  const style = document.createElement('style');
  style.id = 'fv-hauling-ticket-drill-style';
  style.textContent = `
    .fv-job-ticket-count-btn{min-width:34px;padding:5px 9px;border:1px solid rgba(59,126,70,.28);border-radius:999px;background:rgba(59,126,70,.10);color:inherit;font:inherit;font-weight:900;cursor:pointer}
    .fv-job-ticket-count-btn:hover,.fv-job-ticket-count-btn:focus{background:rgba(59,126,70,.18);outline:none}
    .fv-job-ticket-modal{position:fixed;inset:0;z-index:1000000;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.58)}
    .fv-job-ticket-modal.open{display:flex}
    .fv-job-ticket-card{width:min(1180px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--border,#d4d4d4);border-radius:14px;background:var(--surface,#fff);color:inherit;box-shadow:0 18px 48px rgba(0,0,0,.3)}
    .fv-job-ticket-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:16px 18px;border-bottom:1px solid var(--border,#ddd)}
    .fv-job-ticket-title{font-size:1.08rem;font-weight:900}
    .fv-job-ticket-sub{margin-top:3px;font-size:.82rem;opacity:.7}
    .fv-job-ticket-close{width:38px;height:38px;border:0;border-radius:9px;background:var(--surface-2,#eee);color:inherit;font-size:1.35rem;cursor:pointer}
    .fv-job-ticket-body{overflow:auto;padding:16px 18px 22px}
    .fv-job-ticket-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:10px}
    .fv-job-ticket-kpi{padding:11px 12px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--surface-2,#f5f5f5)}
    .fv-job-ticket-kpi-label{font-size:.72rem;font-weight:800;opacity:.64}
    .fv-job-ticket-kpi-value{margin-top:3px;font-size:1.02rem;font-weight:900;font-variant-numeric:tabular-nums}
    .fv-job-grade-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:14px}
    .fv-job-grade{padding:10px 12px;border:1px solid rgba(59,126,70,.2);border-radius:10px;background:rgba(59,126,70,.07)}
    .fv-job-grade-label{font-size:.72rem;font-weight:800;opacity:.68}
    .fv-job-grade-value{margin-top:2px;font-size:1rem;font-weight:900}
    .fv-job-ticket-table-wrap{overflow-x:auto;border:1px solid var(--border,#ddd);border-radius:10px}
    .fv-job-ticket-table{width:100%;border-collapse:collapse;min-width:850px}
    .fv-job-ticket-table th{padding:9px 10px;background:var(--surface-2,#f3f3f3);font-size:.75rem;text-align:left;white-space:nowrap}
    .fv-job-ticket-table td{padding:9px 10px;border-top:1px solid var(--border,#e2e2e2);font-size:.8rem;vertical-align:middle}
    .fv-job-ticket-table .num{text-align:right;font-variant-numeric:tabular-nums}
    .fv-job-ticket-link{border:0;border-radius:8px;padding:6px 9px;background:var(--surface-2,#eee);color:inherit;font:inherit;font-size:.76rem;font-weight:800;cursor:pointer}
    .fv-job-ticket-image-btn{background:rgba(59,126,70,.12)}
    .fv-job-ticket-empty{padding:28px;text-align:center;opacity:.66}
    .fv-job-image-stage{display:none;margin-top:14px;padding:12px;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--surface-2,#f5f5f5)}
    .fv-job-image-stage.open{display:block}
    .fv-job-image-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;font-weight:850}
    .fv-job-image-stage img{display:block;max-width:100%;max-height:66vh;margin:0 auto;border-radius:8px;background:#fff;object-fit:contain}
    @media(max-width:760px){.fv-job-ticket-kpis,.fv-job-grade-row{grid-template-columns:repeat(2,minmax(0,1fr))}.fv-job-ticket-modal{padding:6px}.fv-job-ticket-card{width:100%;max-height:96vh}}
    html.dark .fv-job-ticket-card,html[data-theme="dark"] .fv-job-ticket-card{background:#111a14;color:#eef4ef;border-color:#314137}
    html.dark .fv-job-ticket-table th,html[data-theme="dark"] .fv-job-ticket-table th{background:#1b271e;color:#eef4ef}
    html.dark .fv-job-ticket-table td,html[data-theme="dark"] .fv-job-ticket-table td{border-color:#314137;color:#eef4ef}
  `;
  document.head.appendChild(style);
}

function ensureHaulingTicketModal(){
  let modal = document.getElementById('fv-hauling-ticket-drill-modal');
  if(modal) return modal;

  modal = document.createElement('div');
  modal.id = 'fv-hauling-ticket-drill-modal';
  modal.className = 'fv-job-ticket-modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.innerHTML = `
    <div class="fv-job-ticket-card">
      <div class="fv-job-ticket-head">
        <div>
          <div class="fv-job-ticket-title" id="fv-job-ticket-modal-title">Hauling Job Tickets</div>
          <div class="fv-job-ticket-sub" id="fv-job-ticket-modal-sub"></div>
        </div>
        <button type="button" class="fv-job-ticket-close" id="fv-job-ticket-modal-close" aria-label="Close">×</button>
      </div>
      <div class="fv-job-ticket-body" id="fv-job-ticket-modal-body"></div>
    </div>`;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  };
  $('fv-job-ticket-modal-close')?.addEventListener('click',closeModal);
  modal.addEventListener('click',event => { if(event.target === modal) closeModal(); });
  document.addEventListener('keydown',event => { if(event.key === 'Escape' && modal.classList.contains('open')) closeModal(); });
  return modal;
}

function ticketDetailUrl(ticket){
  return `/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(clean(ticket?.id))}`;
}

function openSavedTicketImage(ticket){
  const imageUrl = ticketImageUrl(ticket);
  if(!imageUrl) return;
  const stage = $('fv-job-image-stage');
  const image = $('fv-job-image');
  const title = $('fv-job-image-title');
  if(!stage || !image) return;
  image.src = imageUrl;
  image.alt = `Saved image for grain ticket ${ticketNumber(ticket)}`;
  if(title) title.textContent = `Ticket ${ticketNumber(ticket)} Image`;
  stage.classList.add('open');
  stage.scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function openHaulingJobTickets(jobId){
  await refreshData(true);
  const job = snapshot.jobs.find(item => clean(item.id) === clean(jobId));
  if(!job) return;

  ensureHaulingTicketStyle();
  const modal = ensureHaulingTicketModal();
  const tickets = haulingJobTickets(job.id);
  const ticketed = round2(tickets.reduce((sum,ticket) => sum + ticketBushels(ticket),0));
  const target = jobTarget(job);
  const remaining = Math.max(0,round2(target-ticketed));
  const averages = {
    tw:weightedGradeAverage(tickets,gradeKeys.tw),
    mo:weightedGradeAverage(tickets,gradeKeys.mo),
    dm:weightedGradeAverage(tickets,gradeKeys.dm),
    fm:weightedGradeAverage(tickets,gradeKeys.fm)
  };

  $('fv-job-ticket-modal-title').textContent = jobDisplayName(job);
  $('fv-job-ticket-modal-sub').textContent = `${tickets.length} assigned ticket${tickets.length === 1 ? '' : 's'} • averages weighted by net bushels`;

  const rows = tickets.map(ticket => {
    const tw = gradeValue(ticket,gradeKeys.tw);
    const mo = gradeValue(ticket,gradeKeys.mo);
    const dm = gradeValue(ticket,gradeKeys.dm);
    const fm = gradeValue(ticket,gradeKeys.fm);
    const image = ticketImageUrl(ticket);
    return `
      <tr>
        <td><strong>${fvEscape(ticketNumber(ticket))}</strong></td>
        <td>${fvEscape(ticketDate(ticket))}</td>
        <td class="num">${fmtBu(ticketBushels(ticket))}</td>
        <td class="num">${fmtGrade(tw)}</td>
        <td class="num">${fmtGrade(mo)}</td>
        <td class="num">${fmtGrade(dm,true)}</td>
        <td class="num">${fmtGrade(fm,true)}</td>
        <td style="white-space:nowrap">
          <button type="button" class="fv-job-ticket-link" data-fv-ticket-detail="${fvEscape(ticket.id)}">Details</button>
          ${image ? `<button type="button" class="fv-job-ticket-link fv-job-ticket-image-btn" data-fv-ticket-image="${fvEscape(ticket.id)}">Image</button>` : ''}
        </td>
      </tr>`;
  }).join('');

  $('fv-job-ticket-modal-body').innerHTML = `
    <div class="fv-job-ticket-kpis">
      <div class="fv-job-ticket-kpi"><div class="fv-job-ticket-kpi-label">Starting Bushels</div><div class="fv-job-ticket-kpi-value">${fmtBu(target)}</div></div>
      <div class="fv-job-ticket-kpi"><div class="fv-job-ticket-kpi-label">Ticketed Bushels</div><div class="fv-job-ticket-kpi-value">${fmtBu(ticketed)}</div></div>
      <div class="fv-job-ticket-kpi"><div class="fv-job-ticket-kpi-label">Remaining</div><div class="fv-job-ticket-kpi-value">${fmtBu(remaining)}</div></div>
      <div class="fv-job-ticket-kpi"><div class="fv-job-ticket-kpi-label">Tickets</div><div class="fv-job-ticket-kpi-value">${tickets.length}</div></div>
    </div>
    <div class="fv-job-grade-row">
      <div class="fv-job-grade"><div class="fv-job-grade-label">Avg TW</div><div class="fv-job-grade-value">${fmtGrade(averages.tw)}</div></div>
      <div class="fv-job-grade"><div class="fv-job-grade-label">Avg MO</div><div class="fv-job-grade-value">${fmtGrade(averages.mo)}</div></div>
      <div class="fv-job-grade"><div class="fv-job-grade-label">Avg DM</div><div class="fv-job-grade-value">${fmtGrade(averages.dm,true)}</div></div>
      <div class="fv-job-grade"><div class="fv-job-grade-label">Avg FM</div><div class="fv-job-grade-value">${fmtGrade(averages.fm,true)}</div></div>
    </div>
    ${tickets.length ? `
      <div class="fv-job-ticket-table-wrap">
        <table class="fv-job-ticket-table">
          <thead><tr><th>Ticket #</th><th>Date</th><th class="num">Net Bu.</th><th class="num">TW</th><th class="num">MO</th><th class="num">DM</th><th class="num">FM</th><th>View</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="fv-job-ticket-empty">No grain tickets are assigned to this hauling job yet.</div>'}
    <div class="fv-job-image-stage" id="fv-job-image-stage">
      <div class="fv-job-image-head"><span id="fv-job-image-title">Ticket Image</span><button type="button" class="fv-job-ticket-link" id="fv-job-image-close">Hide Image</button></div>
      <img id="fv-job-image" alt="Saved grain ticket image">
    </div>`;

  $('fv-job-ticket-modal-body').querySelectorAll('[data-fv-ticket-detail]').forEach(button => {
    button.addEventListener('click',event => {
      event.stopPropagation();
      const ticket = snapshot.tickets.find(item => clean(item.id) === clean(button.dataset.fvTicketDetail));
      if(ticket) location.href = ticketDetailUrl(ticket);
    });
  });

  $('fv-job-ticket-modal-body').querySelectorAll('[data-fv-ticket-image]').forEach(button => {
    button.addEventListener('click',event => {
      event.stopPropagation();
      const ticket = snapshot.tickets.find(item => clean(item.id) === clean(button.dataset.fvTicketImage));
      if(ticket) openSavedTicketImage(ticket);
    });
  });

  $('fv-job-image-close')?.addEventListener('click',() => $('fv-job-image-stage')?.classList.remove('open'));
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

let haulingTicketDecorateQueued = false;
function decorateHaulingTicketColumn(){
  const tbody = $('hauling-jobs-table-body');
  const table = tbody?.closest('table');
  if(!tbody || !table) return;

  const headers = Array.from(table.querySelectorAll('thead th'));
  let ticketIndex = headers.findIndex(header => clean(header.textContent).toLowerCase() === 'tickets');
  if(ticketIndex < 0){
    ticketIndex = headers.findIndex(header => clean(header.textContent).toLowerCase() === 'contracts');
    if(ticketIndex >= 0) headers[ticketIndex].textContent = 'Tickets';
  }
  if(ticketIndex < 0) return;

  tbody.querySelectorAll('tr[data-hauling-job-id]').forEach(row => {
    const jobId = clean(row.dataset.haulingJobId);
    const cell = row.children[ticketIndex];
    if(!jobId || !cell) return;
    const count = haulingJobTickets(jobId).length;
    const existing = cell.querySelector('.fv-job-ticket-count-btn');
    if(existing && existing.dataset.count === String(count)) return;

    cell.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fv-job-ticket-count-btn';
    button.dataset.count = String(count);
    button.textContent = String(count);
    button.title = count ? `View ${count} assigned grain ticket${count === 1 ? '' : 's'}` : 'View hauling job ticket summary';
    button.setAttribute('aria-label',button.title);
    button.addEventListener('click',event => {
      event.preventDefault();
      event.stopPropagation();
      openHaulingJobTickets(jobId);
    });
    cell.appendChild(button);
  });
}

function queueHaulingTicketDecoration(){
  if(haulingTicketDecorateQueued) return;
  haulingTicketDecorateQueued = true;
  requestAnimationFrame(() => {
    haulingTicketDecorateQueued = false;
    ensureHaulingTicketStyle();
    decorateHaulingTicketColumn();
  });
}

const haulingTableObserver = new MutationObserver(queueHaulingTicketDecoration);
haulingTableObserver.observe(document.documentElement,{subtree:true,childList:true});

$('refresh-hauling-link-btn')?.addEventListener('click',() => {
  setTimeout(async () => {
    await refreshData(true);
    queueHaulingTicketDecoration();
  },500);
});

ensureHaulingTicketStyle();
queueHaulingTicketDecoration();
