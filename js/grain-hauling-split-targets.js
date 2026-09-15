/* FarmVista — split/spot portion matching helper — Sept. 15, 2026
   Event-driven only. No MutationObserver, polling, or continuous repaint loop.
   Matching Jobs uses ACTIVE hauling jobs for the available split/unassigned ticket.
   Completed jobs are deliberately excluded from normal split assignment.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_SPLIT_TARGETS_20260915_V5) return;
  window.__FV_HAULING_SPLIT_TARGETS_20260915_V5 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const cropKey=v=>{const k=norm(v);if(k==='corn'||k==='yellowcorn')return'corn';if(['soy','soybean','soybeans','beans','yellowsoybeans'].includes(k))return'soybeans';return k};
  const jobBuyer=j=>clean(j?.buyerName||j?.buyer||j?.grainBuyerName||j?.destinationBuyerName||j?.elevatorName);
  const jobLocation=j=>clean(j?.deliveryLocationName||j?.locationName||j?.destinationName||j?.destination||j?.elevator);
  const jobSoldUnder=j=>clean(j?.customerName||j?.soldUnderName||j?.soldUnder||j?.customer);
  const jobCrop=j=>clean(j?.crop||j?.commodity||j?.cropName||j?.cropType);
  const ticketBuyer=t=>clean(t?.buyerName||t?.buyer||t?.grainBuyerName||t?.destinationBuyerName||t?.elevatorName);
  const ticketLocation=t=>clean(t?.deliveryLocationName||t?.locationName||t?.destinationName||t?.destination||t?.elevator);
  const ticketCrop=t=>clean(t?.crop||t?.commodity||t?.cropName||t?.cropType);
  const ticketDate=t=>clean(t?.ticketDate||t?.date||t?.deliveryDate).slice(0,10);
  let jobs=[],ticket=null;

  const unique=values=>[...new Set(values.map(clean).filter(v=>v&&norm(v)!=='unknown'))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
  const active=j=>{
    const s=norm(j?.status||j?.jobStatus);
    if(j?.voided===true||j?.completed===true||j?.isCompleted===true)return false;
    if(s.includes('void')||s.includes('cancel')||s.includes('closed')||s.includes('complete')||s.includes('pastdue')||s.includes('upcoming'))return false;
    return s==='active'||s==='open'||s==='inprogress'||s==='';
  };
  const dateOK=(t,j)=>{const d=ticketDate(t),s=clean(j?.startDate||j?.deliveryStartDate||j?.beginDate).slice(0,10),e=clean(j?.endDate||j?.expirationDate||j?.deliveryEndDate).slice(0,10);return !d||((!s||d>=s)&&(!e||d<=e))};
  const samePlace=(t,j)=>{const tl=norm(ticketLocation(t)),jl=norm(jobLocation(j)),tb=norm(ticketBuyer(t)),jb=norm(jobBuyer(j));if(tl&&jl)return tl===jl;return!!(tb&&jb&&tb===jb)};
  const matchesTicket=j=>!ticket||(samePlace(ticket,j)&&cropKey(ticketCrop(ticket))===cropKey(jobCrop(j))&&dateOK(ticket,j));

  function fill(id,label,values){const s=document.getElementById(id);if(!s)return;const old=clean(s.value),vals=unique(values);s.replaceChildren();const all=document.createElement('option');all.value='';all.textContent=`All ${label}`;s.appendChild(all);for(const v of vals){const o=document.createElement('option');o.value=v;o.textContent=v;s.appendChild(o)}s.value=old&&vals.includes(old)?old:''}
  function combos(){['fv-ticket-job-status-filter','fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'].forEach(id=>{const s=document.getElementById(id);if(!s)return;s.setAttribute('data-fv-combo','');s.setAttribute('data-fv-search','false')});window.FVCombo?.upgrade?.(document)}
  function filterVisibleJobs(){
    const status=document.getElementById('fv-ticket-job-status-filter');if(!ticket||!status||status.value!=='matching')return;
    const eligible=jobs.filter(j=>active(j)&&matchesTicket(j));
    const list=document.getElementById('fv-ticket-job-list');if(!list)return;
    [...list.children].forEach(card=>{
      const id=clean(card.dataset?.jobId||card.dataset?.haulingJobId||card.getAttribute?.('data-id'));
      if(id){card.hidden=!eligible.some(j=>j.id===id);return}
      const text=norm(card.textContent);
      card.hidden=!eligible.some(j=>text.includes(norm(jobLocation(j)))&&text.includes(cropKey(jobCrop(j)))&&(!jobSoldUnder(j)||text.includes(norm(jobSoldUnder(j)))));
    });
    const count=[...list.children].filter(x=>!x.hidden).length;
    const countEl=document.getElementById('fv-ticket-job-count');if(countEl)countEl.textContent=`${count} job${count===1?'':'s'}`;
    const msg=document.getElementById('fv-ticket-hauling-message');if(msg){msg.textContent=`Matching ACTIVE hauling jobs for ${ticketLocation(ticket)||ticketBuyer(ticket)} — ${ticketCrop(ticket)}. Completed jobs are excluded.`;msg.classList.add('ready')}
  }
  async function load(){
    try{
      const F=await import('/js/firebase-init.js');await F.ready;const db=F.getFirestore();
      const[js,ts]=await Promise.all([F.getDocs(F.collection(db,'grain_hauling_jobs')),F.getDocs(F.collection(db,'grain_tickets'))]);
      jobs=js.docs.map(d=>({id:d.id,...d.data()}));const tickets=ts.docs.map(d=>({id:d.id,...d.data()}));
      const tile=document.querySelector('.fv-hauling-partial-tile.unassigned, .fv-hauling-partial-tile.spot');const tid=clean(tile?.dataset?.ticketId||tile?.getAttribute?.('data-ticket-id'));
      ticket=tickets.find(t=>clean(t.id)===tid)||null;
      if(!ticket&&tile){const m=clean(tile.textContent).match(/Ticket\s+([^\s]+)/i);if(m)ticket=tickets.find(t=>clean(t.ticketNumber||t.ticketNo||t.ticket)===m[1])||null}
      const eligible=jobs.filter(j=>active(j)&&matchesTicket(j));
      fill('fv-ticket-filter-buyer','Buyers',eligible.map(jobBuyer));fill('fv-ticket-filter-sold-under','Sold Under',eligible.map(jobSoldUnder));fill('fv-ticket-filter-crop','Crops',eligible.map(jobCrop));combos();requestAnimationFrame(filterVisibleJobs);
    }catch(e){console.warn('[FarmVista] active split matching helper skipped:',e)}
  }
  function start(){requestAnimationFrame(()=>setTimeout(load,350))}
  document.addEventListener('click',e=>{if(e.target?.closest?.('#fv-refresh-ticket-hauling'))setTimeout(load,100)},true);
  document.addEventListener('change',e=>{if(e.target?.id==='fv-ticket-job-status-filter')requestAnimationFrame(filterVisibleJobs)},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
