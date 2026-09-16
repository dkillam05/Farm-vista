/* FarmVista — Matching hauling-job DND controller — Sept. 16, 2026
   Firestore is the source of truth for Matching Jobs. This controller owns the
   Matching Jobs right column, its filters, count, message, and ticket-to-job drop.
   Other status views remain owned by grain-hauling-status-dnd.js.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_MATCHING_CONTROLLER_20260916_V1) return;
  window.__FV_HAULING_MATCHING_CONTROLLER_20260916_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const num=v=>{const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
  const fmt=v=>num(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const esc=v=>clean(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const cropKey=v=>{const k=norm(v);if(k==='corn'||k==='yellowcorn')return'corn';if(['soy','soybean','soybeans','bean','beans','yellowsoybeans'].includes(k))return'soybeans';return k};
  const unique=a=>[...new Set(a.map(clean).filter(v=>v&&norm(v)!=='unknown'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));

  const state={firebase:null,db:null,jobs:[],tickets:[],customers:new Map(),busy:false,loading:null,queued:false};

  const jobBuyer=j=>clean(j?.buyerName||j?.buyer||j?.grainBuyerName);
  const jobBuyerId=j=>clean(j?.buyerId||j?.grainBuyerId);
  const jobLocation=j=>clean(j?.deliveryLocationName||j?.locationName||j?.destinationName||j?.destination);
  const jobLocationId=j=>clean(j?.deliveryLocationId||j?.locationId||j?.destinationId);
  const jobCrop=j=>clean(j?.crop||j?.commodity||j?.cropName||j?.cropType);
  const jobCustomerId=j=>clean(j?.customerId||j?.grainCustomerId||j?.soldUnderId);
  const jobSoldUnder=j=>clean(j?.customerName||j?.soldUnderName||j?.soldUnder||state.customers.get(jobCustomerId(j))?.name)||'—';
  const jobTarget=j=>Math.max(0,num(j?.startingBushels??j?.jobBushels??j?.bushels));
  const jobName=j=>clean(j?.displayName||j?.jobName||j?.haulingJobName)||`${jobLocation(j)||jobBuyer(j)||'Hauling Job'} — ${fmt(jobTarget(j))} bu`;

  const ticketBuyer=t=>clean(t?.buyerName||t?.destinationBuyerName||t?.elevatorName);
  const ticketBuyerId=t=>clean(t?.buyerId||t?.grainBuyerId||t?.destinationBuyerId);
  const ticketLocation=t=>clean(t?.deliveryLocationName||t?.locationName||t?.destinationName||t?.destination||t?.elevator);
  const ticketLocationId=t=>clean(t?.deliveryLocationId||t?.locationId||t?.destinationId);
  const ticketCrop=t=>clean(t?.crop||t?.commodity||t?.grain||t?.cropName||t?.cropType);
  const ticketBushels=t=>Math.max(0,num(t?.netBushels??t?.netBu??t?.bushels));
  const isVoided=r=>r?.voided===true||clean(r?.status||r?.contractStatus).toLowerCase().includes('void');

  function localISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function ticketsForJob(id){return state.tickets.filter(t=>!isVoided(t)&&clean(t?.haulingJobId)===clean(id))}
  function delivered(j){return ticketsForJob(j.id).reduce((s,t)=>s+ticketBushels(t),0)}
  function jobStatus(j){
    if(isVoided(j))return'voided';
    const raw=clean(j?.status).toLowerCase();
    if(j?.manualClosed===true||raw.includes('closed')||raw.includes('cancel'))return'closed';
    const target=jobTarget(j),used=delivered(j);
    if(raw.includes('complete')||(target>0&&used>=target-.005))return'completed';
    const start=clean(j?.deliveryStartDate||j?.startDate).slice(0,10);
    const end=clean(j?.deliveryEndDate||j?.endDate).slice(0,10);
    if(start&&start>localISO())return'upcoming';
    if(end&&end<localISO()&&used<target-.005)return'past_due';
    return'active';
  }
  const statusLabel=s=>({active:'Active',upcoming:'Upcoming',past_due:'Past Due',completed:'Completed'})[s]||s;
  const eligible=j=>['past_due','active','upcoming'].includes(jobStatus(j));

  function idsOrNamesMatch(aId,aName,bId,bName){
    if(aId&&bId)return clean(aId)===clean(bId);
    if(aName&&bName)return norm(aName)===norm(bName);
    return true;
  }
  function ticketMatchesJob(t,j){
    if(!idsOrNamesMatch(ticketBuyerId(t),ticketBuyer(t),jobBuyerId(j),jobBuyer(j)))return false;
    if(!idsOrNamesMatch(ticketLocationId(t),ticketLocation(t),jobLocationId(j),jobLocation(j)))return false;
    const tc=cropKey(ticketCrop(t)),jc=cropKey(jobCrop(j));
    return !(tc&&jc&&tc!==jc);
  }

  function unassignedTickets(){
    return state.tickets.filter(t=>!isVoided(t)&&!clean(t?.haulingJobId));
  }
  function filters(){return{
    buyer:clean(document.getElementById('fv-ticket-filter-buyer')?.value),
    sold:clean(document.getElementById('fv-ticket-filter-sold-under')?.value),
    crop:clean(document.getElementById('fv-ticket-filter-crop')?.value)
  }}
  function passesFilters(j){const f=filters();return(!f.buyer||norm(jobBuyer(j))===norm(f.buyer))&&(!f.sold||norm(jobSoldUnder(j))===norm(f.sold))&&(!f.crop||cropKey(jobCrop(j))===cropKey(f.crop))}
  function matchingJobs(){
    const left=unassignedTickets();
    if(!left.length)return[];
    return state.jobs.filter(j=>eligible(j)&&passesFilters(j)&&left.some(t=>ticketMatchesJob(t,j)))
      .sort((a,b)=>({past_due:0,active:1,upcoming:2}[jobStatus(a)]??9)-({past_due:0,active:1,upcoming:2}[jobStatus(b)]??9)||clean(a?.deliveryStartDate).localeCompare(clean(b?.deliveryStartDate))||jobName(a).localeCompare(jobName(b),undefined,{numeric:true,sensitivity:'base'}));
  }

  async function load(force=false){
    if(state.loading&&!force)return state.loading;
    state.loading=(async()=>{
      const f=state.firebase||await import('/js/firebase-init.js');await f.ready;state.firebase=f;state.db=f.getFirestore();
      const [js,ts,cs]=await Promise.all([f.getDocs(f.collection(state.db,'grain_hauling_jobs')),f.getDocs(f.collection(state.db,'grain_tickets')),f.getDocs(f.collection(state.db,'grain_customers'))]);
      state.jobs=js.docs.map(d=>({id:d.id,...d.data()}));
      state.tickets=ts.docs.map(d=>({id:d.id,...d.data()}));
      state.customers=new Map(cs.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    })().finally(()=>{state.loading=null});
    return state.loading;
  }

  function ensureList(){
    const core=document.getElementById('fv-ticket-job-list');
    const column=core?.closest('.fv-ticket-hauling-column');
    if(!core||!column)return null;
    let list=document.getElementById('fv-ticket-matching-job-list');
    if(!list){list=document.createElement('div');list.id='fv-ticket-matching-job-list';list.className='fv-ticket-hauling-list';core.insertAdjacentElement('afterend',list)}
    return{core,column,list,alt:document.getElementById('fv-ticket-status-job-list')};
  }

  function setCount(n){const el=document.getElementById('fv-ticket-job-count');if(el)el.textContent=`${n} job${n===1?'':'s'}`}
  function setMessage(leftCount,count){const el=document.getElementById('fv-ticket-hauling-message');if(!el)return;el.textContent=!leftCount?'No unassigned grain tickets. Matching Jobs is empty.':count?`Showing ${count} Past Due, Active, or Upcoming hauling job${count===1?'':'s'} matching the ${leftCount} unassigned grain ticket${leftCount===1?'':'s'}.`:'No Past Due, Active, or Upcoming hauling jobs match the unassigned grain tickets and current filters.';el.classList.add('ready')}

  function fill(id,label,values){
    const s=document.getElementById(id);if(!s)return;
    const old=clean(s.value),vals=unique(values);s.replaceChildren();
    const all=document.createElement('option');all.value='';all.textContent=`All ${label}`;s.appendChild(all);
    vals.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;s.appendChild(o)});s.value=old&&vals.includes(old)?old:'';
  }
  function rebuildFilters(){
    const left=unassignedTickets();
    const candidates=left.length?state.jobs.filter(j=>eligible(j)&&left.some(t=>ticketMatchesJob(t,j))):[];
    fill('fv-ticket-filter-buyer','Buyers',candidates.map(jobBuyer));
    fill('fv-ticket-filter-sold-under','Sold Under',candidates.map(jobSoldUnder));
    fill('fv-ticket-filter-crop','Crops',candidates.map(jobCrop));
    ['fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].forEach(id=>{const s=document.getElementById(id);s?.setAttribute('data-fv-combo','');s?.setAttribute('data-fv-search','false')});
    window.FVCombo?.upgrade?.(document);
  }

  function markup(j){
    const used=delivered(j),target=jobTarget(j),remaining=Math.max(0,target-used),status=jobStatus(j);
    return `<div class="fv-ticket-job-card fv-status-job-card ${status}" data-fv-matching-job="1" data-fv-ticket-job-id="${esc(j.id)}">
      <div class="fv-ticket-job-title">${esc(jobName(j))}<span class="fv-status-pill ${status}">${esc(statusLabel(status))}</span></div>
      <div class="fv-ticket-job-meta">${esc(jobBuyer(j)||'Unknown buyer')} • ${esc(jobLocation(j)||'Unknown location')} • ${esc(jobCrop(j)||'Unknown crop')}<br>${fmt(used)} bu ticketed • ${fmt(remaining)} bu remaining • ${ticketsForJob(j.id).length} ticket${ticketsForJob(j.id).length===1?'':'s'}</div>
      <div class="fv-job-sold-under"><strong>Sold Under:</strong> ${esc(jobSoldUnder(j))}</div>
    </div>`;
  }

  async function assign(ids,jobId){
    if(state.busy)return;await load();const job=state.jobs.find(j=>j.id===clean(jobId));const ticketIds=[...new Set(ids.map(clean).filter(Boolean))];if(!job||!ticketIds.length)return;
    const chosen=ticketIds.map(id=>state.tickets.find(t=>t.id===id)).filter(Boolean);
    if(chosen.some(t=>!ticketMatchesJob(t,job))){alert('One or more selected tickets do not match this hauling job\'s destination or crop.');return}
    state.busy=true;
    try{
      const f=state.firebase;const customerId=jobCustomerId(job),customerName=jobSoldUnder(job);
      const patch={haulingJobId:job.id,haulingJobName:jobName(job),haulingJobMatched:true,matchingHaulingJobIds:[job.id],haulingJobAssignmentSource:'manual_dnd',haulingJobAssignedAt:f.serverTimestamp(),haulingJobManualUnassignedFromJobId:null,haulingJobManualUnassignedAt:null,haulingJobManualUnassignedByUid:null,haulingJobManualUnassignedByName:null,updatedAt:f.serverTimestamp()};
      if(jobBuyerId(job))patch.buyerId=jobBuyerId(job);if(jobBuyer(job))patch.buyerName=jobBuyer(job);if(jobLocationId(job))patch.deliveryLocationId=jobLocationId(job);if(jobLocation(job))patch.deliveryLocationName=jobLocation(job);if(jobCrop(job))patch.crop=jobCrop(job);if(customerId)patch.customerId=customerId;if(customerName&&customerName!=='—')patch.customerName=customerName;
      await Promise.all(ticketIds.map(id=>f.updateDoc(f.doc(state.db,'grain_tickets',id),patch)));
      await refresh(true);document.getElementById('refresh-hauling-link-btn')?.click();
    }catch(e){console.error('[FarmVista] Matching hauling DND assignment failed:',e);alert(e?.message||'FarmVista could not assign that grain ticket.')}finally{state.busy=false}
  }

  function dragIds(event){const raw=clean(event.dataTransfer?.getData('text/plain'));return raw?raw.split(',').map(clean).filter(Boolean):[]}
  function bind(list){
    list.querySelectorAll('[data-fv-matching-job]').forEach(card=>{
      card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('drag-over')});
      card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
      card.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();card.classList.remove('drag-over');assign(dragIds(e),card.dataset.fvTicketJobId)});
    });
  }

  function render(){
    const status=document.getElementById('fv-ticket-job-status-filter');if(!status)return;
    const parts=ensureList();if(!parts)return;
    if(status.value!=='matching'){parts.list.hidden=true;return}
    const left=unassignedTickets(),jobs=matchingJobs();
    parts.core.hidden=true;if(parts.alt)parts.alt.hidden=true;parts.list.hidden=false;
    parts.list.innerHTML=jobs.length?jobs.map(markup).join(''):'<div class="fv-ticket-empty"><div class="fv-ticket-empty-title">No Matching Jobs</div><div class="fv-ticket-empty-sub">Unassigned grain tickets will appear on the left. Matching hauling jobs will appear here.</div></div>';
    setCount(jobs.length);setMessage(left.length,jobs.length);bind(parts.list);
  }

  async function refresh(force=false){try{await load(force);rebuildFilters();render()}catch(e){console.warn('[FarmVista] Matching hauling DND refresh failed:',e)}}
  function queue(){if(state.queued)return;state.queued=true;requestAnimationFrame(()=>{state.queued=false;render()})}
  function start(){setTimeout(()=>refresh(true),350)}

  document.addEventListener('change',e=>{
    if(e.target?.id==='fv-ticket-job-status-filter')setTimeout(()=>{if(e.target.value==='matching')refresh(true);else{const p=ensureList();if(p)p.list.hidden=true}},0);
    if(['fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].includes(e.target?.id)&&document.getElementById('fv-ticket-job-status-filter')?.value==='matching')queue();
  },true);
  document.addEventListener('click',e=>{if(e.target?.closest?.('#fv-refresh-ticket-hauling'))setTimeout(()=>refresh(true),100)},true);
  window.addEventListener('fv:hauling-effective-totals-updated',()=>{if(document.getElementById('fv-ticket-job-status-filter')?.value==='matching')refresh(true)});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
