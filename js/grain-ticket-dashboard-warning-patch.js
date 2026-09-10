/* FarmVista Grain Ticket dashboard unresolved-assignment warning
   Rev 2026-09-10b
   Needs Review stays amber for ordinary review work. A review ticket becomes
   red Warning when it is also missing a Hauling Job or Contract assignment.
*/
(async function(){
  'use strict';
  if(!String(location.pathname||'').toLowerCase().endsWith('/pages/grain/grain-ticket.html'))return;
  const {ready,getFirestore,collection,getDocs}=await import('/js/firebase-init.js');
  await ready;
  const db=getFirestore(),byNumber=new Map();
  let applying=false;
  const clean=value=>String(value??'').trim();
  const hasJob=t=>!!clean(t?.haulingJobId||t?.grainHaulingJobId||t?._linkedHaulingJobId);
  const hasContract=t=>!!clean(t?.contractId||t?.grainContractId||t?.postedContractId);

  async function refreshData(){
    try{
      const snap=await getDocs(collection(db,'grain_tickets'));
      byNumber.clear();
      snap.docs.forEach(d=>{const data={id:d.id,...d.data()},number=clean(data.ticketNumber);if(number)byNumber.set(number,data);});
    }catch(error){console.warn('[grain warning] ticket lookup failed:',error);}
  }

  function apply(){
    if(applying)return; applying=true;
    try{
      const tbody=document.getElementById('grain-ticket-table-body'); if(!tbody)return;
      tbody.querySelectorAll('tr').forEach(row=>{
        const badge=row.querySelector('.ticket-status.review'); if(!badge)return;
        const cells=row.querySelectorAll('td'),ticket=byNumber.get(clean(cells[2]?.textContent)); if(!ticket)return;
        if(hasJob(ticket)&&hasContract(ticket))return;
        row.classList.remove('ticket-review-row'); row.classList.add('ticket-warning-row');
        badge.classList.remove('review'); badge.classList.add('warning'); badge.textContent='Warning';
        const missing=[]; if(!hasJob(ticket))missing.push('Hauling Job'); if(!hasContract(ticket))missing.push('Contract');
        badge.title=`Missing ${missing.join(' and ')} — office action required.`;
      });
    }finally{applying=false;}
  }

  await refreshData(); apply();
  const tbody=document.getElementById('grain-ticket-table-body');
  if(tbody)new MutationObserver(apply).observe(tbody,{childList:true,subtree:true});
  setInterval(async()=>{await refreshData();apply();},30000);
})();