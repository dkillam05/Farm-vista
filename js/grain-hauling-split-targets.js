/* FarmVista — Matching Jobs helper — Sept. 16, 2026
   Matching Jobs is driven ONLY by tickets currently visible in the left
   Unassigned Grain Tickets column. The Buyer / Sold Under / Crop filters affect
   only the right hauling-job list. Past Due, Active, and Upcoming jobs may match;
   Completed / Closed / Voided jobs are excluded. If the left side is empty,
   Matching Jobs is empty.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_SPLIT_TARGETS_20260916_V6) return;
  window.__FV_HAULING_SPLIT_TARGETS_20260916_V6 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const cropKey=v=>{const k=norm(v);if(k==='corn'||k==='yellowcorn')return'corn';if(['soy','soybean','soybeans','bean','beans','yellowsoybeans'].includes(k))return'soybeans';return k};
  const unique=values=>[...new Set(values.map(clean).filter(v=>v&&norm(v)!=='unknown'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));

  const jobBuyer=j=>clean(j?.buyerName||j?.buyer||j?.grainBuyerName||j?.destinationBuyerName||j?.elevatorName);
  const jobBuyerId=j=>clean(j?.buyerId||j?.grainBuyerId||j?.destinationBuyerId);
  const jobLocation=j=>clean(j?.deliveryLocationName||j?.locationName||j?.destinationName||j?.destination||j?.elevator);
  const jobLocationId=j=>clean(j?.deliveryLocationId||j?.locationId||j?.destinationId);
  const jobSoldUnder=j=>clean(j?.customerName||j?.soldUnderName||j?.soldUnder||j?.customer);
  const jobCrop=j=>clean(j?.crop||j?.commodity||j?.cropName||j?.cropType);

  const ticketBuyer=t=>clean(t?.buyerName||t?.buyer||t?.grainBuyerName||t?.destinationBuyerName||t?.elevatorName);
  const ticketBuyerId=t=>clean(t?.buyerId||t?.grainBuyerId||t?.destinationBuyerId);
  const ticketLocation=t=>clean(t?.deliveryLocationName||t?.locationName||t?.destinationName||t?.destination||t?.elevator);
  const ticketLocationId=t=>clean(t?.deliveryLocationId||t?.locationId||t?.destinationId);
  const ticketCrop=t=>clean(t?.crop||t?.commodity||t?.grain||t?.cropName||t?.cropType);

  let jobs=[];
  let tickets=[];
  let queued=false;

  function localISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function jobStatus(j){
    const raw=norm(j?.status||j?.jobStatus);
    if(j?.voided===true||raw.includes('void'))return'voided';
    if(j?.manualClosed===true||raw.includes('closed')||raw.includes('cancel'))return'closed';
    if(j?.completed===true||j?.isCompleted===true||raw.includes('complete'))return'completed';
    const start=clean(j?.deliveryStartDate||j?.startDate).slice(0,10);
    const end=clean(j?.deliveryEndDate||j?.endDate).slice(0,10);
    if(start&&start>localISO())return'upcoming';
    if(end&&end<localISO())return'past_due';
    return'active';
  }
  const eligibleStatus=j=>['past_due','active','upcoming'].includes(jobStatus(j));

  function idsOrNamesMatch(aId,aName,bId,bName){
    if(aId&&bId)return clean(aId)===clean(bId);
    if(aName&&bName)return norm(aName)===norm(bName);
    return true;
  }
  function matchesTicket(j,t){
    if(!idsOrNamesMatch(ticketBuyerId(t),ticketBuyer(t),jobBuyerId(j),jobBuyer(j)))return false;
    if(!idsOrNamesMatch(ticketLocationId(t),ticketLocation(t),jobLocationId(j),jobLocation(j)))return false;
    const tc=cropKey(ticketCrop(t)),jc=cropKey(jobCrop(j));
    return !(tc&&jc&&tc!==jc);
  }

  function leftTicketIds(){
    const list=document.getElementById('fv-unassigned-ticket-list');
    if(!list)return[];
    return [...new Set([...list.querySelectorAll('[data-ticket-id],[data-touch-ticket-id]')]
      .filter(el=>!el.closest('.fv-hauling-partial-tile.unassigned'))
      .map(el=>clean(el.dataset.ticketId||el.dataset.touchTicketId))
      .filter(Boolean))];
  }
  function leftTickets(){
    const ids=leftTicketIds();
    return ids.map(id=>tickets.find(t=>clean(t.id)===id)).filter(Boolean);
  }

  function rightFilters(){
    return{
      buyer:clean(document.getElementById('fv-ticket-filter-buyer')?.value),
      sold:clean(document.getElementById('fv-ticket-filter-sold-under')?.value),
      crop:clean(document.getElementById('fv-ticket-filter-crop')?.value)
    };
  }
  function passesRightFilters(j){
    const f=rightFilters();
    if(f.buyer&&norm(jobBuyer(j))!==norm(f.buyer))return false;
    if(f.sold&&norm(jobSoldUnder(j))!==norm(f.sold))return false;
    if(f.crop&&cropKey(jobCrop(j))!==cropKey(f.crop))return false;
    return true;
  }
  function matchingJobs(){
    const left=leftTickets();
    if(!left.length)return[];
    return jobs.filter(j=>eligibleStatus(j)&&passesRightFilters(j)&&left.some(t=>matchesTicket(j,t)));
  }

  function cardJobId(card){
    return clean(card?.dataset?.fvTicketJobId||card?.dataset?.jobId||card?.dataset?.haulingJobId||card?.getAttribute?.('data-id'));
  }
  function cardMatches(card,eligible){
    const id=cardJobId(card);
    if(id)return eligible.some(j=>clean(j.id)===id);
    const text=norm(card?.textContent);
    return eligible.some(j=>{
      const place=norm(jobLocation(j)||jobBuyer(j));
      const crop=cropKey(jobCrop(j));
      return (!place||text.includes(place))&&(!crop||text.includes(crop));
    });
  }

  function syncMatching(){
    const status=document.getElementById('fv-ticket-job-status-filter');
    if(!status||status.value!=='matching')return;
    const list=document.getElementById('fv-ticket-job-list');
    if(!list)return;
    const left=leftTickets();
    const eligible=matchingJobs();
    [...list.children].forEach(card=>{card.hidden=!cardMatches(card,eligible)});
    const count=[...list.children].filter(card=>!card.hidden).length;
    const countEl=document.getElementById('fv-ticket-job-count');
    if(countEl)countEl.textContent=`${count} job${count===1?'':'s'}`;
    const msg=document.getElementById('fv-ticket-hauling-message');
    if(msg){
      msg.textContent=left.length
        ? `Showing Past Due, Active, or Upcoming hauling jobs that match the ${left.length} unassigned grain ticket${left.length===1?'':'s'} on the left.`
        : 'No unassigned grain tickets. Matching Jobs is empty.';
      msg.classList.add('ready');
    }
  }

  function fill(id,label,values){
    const s=document.getElementById(id);if(!s)return;
    const old=clean(s.value),vals=unique(values);
    s.replaceChildren();
    const all=document.createElement('option');all.value='';all.textContent=`All ${label}`;s.appendChild(all);
    vals.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;s.appendChild(o)});
    s.value=old&&vals.includes(old)?old:'';
  }
  function combos(){
    ['fv-ticket-job-status-filter','fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].forEach(id=>{
      const s=document.getElementById(id);if(!s)return;s.setAttribute('data-fv-combo','');s.setAttribute('data-fv-search','false');
    });
    window.FVCombo?.upgrade?.(document);
  }
  function rebuildRightFilterOptions(){
    const left=leftTickets();
    const candidates=left.length?jobs.filter(j=>eligibleStatus(j)&&left.some(t=>matchesTicket(j,t))):[];
    fill('fv-ticket-filter-buyer','Buyers',candidates.map(jobBuyer));
    fill('fv-ticket-filter-sold-under','Sold Under',candidates.map(jobSoldUnder));
    fill('fv-ticket-filter-crop','Crops',candidates.map(jobCrop));
    combos();
  }

  async function load(){
    try{
      const F=await import('/js/firebase-init.js');await F.ready;const db=F.getFirestore();
      const[js,ts]=await Promise.all([F.getDocs(F.collection(db,'grain_hauling_jobs')),F.getDocs(F.collection(db,'grain_tickets'))]);
      jobs=js.docs.map(d=>({id:d.id,...d.data()}));
      tickets=ts.docs.map(d=>({id:d.id,...d.data()}));
      rebuildRightFilterOptions();
      requestAnimationFrame(syncMatching);
    }catch(e){console.warn('[FarmVista] Matching Jobs helper skipped:',e)}
  }
  function queueSync(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;syncMatching()})}
  function start(){requestAnimationFrame(()=>setTimeout(load,300))}

  document.addEventListener('click',e=>{if(e.target?.closest?.('#fv-refresh-ticket-hauling'))setTimeout(load,100)},true);
  document.addEventListener('change',e=>{
    if(e.target?.id==='fv-ticket-job-status-filter')queueSync();
    if(['fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].includes(e.target?.id))queueSync();
  },true);

  const observer=new MutationObserver(records=>{
    if(records.some(r=>r.target?.id==='fv-unassigned-ticket-list'||r.target?.closest?.('#fv-unassigned-ticket-list')))queueSync();
  });
  const hook=()=>{const left=document.getElementById('fv-unassigned-ticket-list');if(left){observer.observe(left,{childList:true,subtree:true});return true}return false};
  const timer=setInterval(()=>{if(hook())clearInterval(timer)},150);

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
