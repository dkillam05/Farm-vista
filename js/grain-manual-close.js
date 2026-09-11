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
