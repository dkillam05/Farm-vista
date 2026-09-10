/* FarmVista Grain Ticket dashboard destination / hauling-job warning
   Rev 2026-09-10c

   Rule:
   A scanned ticket does NOT need a contract merely to avoid a red warning.
   Contract assignment normally happens later unless the scan auto-links to a
   FarmVista load. The red Warning is specifically for a ticket whose resolved
   destination + crop have NO CURRENT OPEN HAULING JOB.
*/
(async function(){
  'use strict';

  if(!String(location.pathname||'').toLowerCase().endsWith('/pages/grain/grain-ticket.html'))return;

  const {ready,getFirestore,collection,getDocs}=await import('/js/firebase-init.js');
  await ready;

  const db=getFirestore();
  const byNumber=new Map();
  let haulingJobs=[];
  let applying=false;

  const clean=value=>String(value??'').trim();
  const norm=value=>clean(value)
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const cropKey=value=>{
    const v=norm(value);
    if(v.includes('soy'))return 'soybeans';
    if(v.includes('corn'))return 'corn';
    return v;
  };

  const todayISO=()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function jobIsOpen(job){
    if(!job||job.active===false||job.isActive===false)return false;

    const status=norm(job.status||job.contractStatus||'active');
    if(
      status.includes('closed')||
      status.includes('complete')||
      status.includes('cancel')||
      status.includes('void')
    )return false;

    const remainingRaw=
      job.remainingBushels??
      job.bushelsRemaining??
      job.remainingBu??
      null;

    if(
      remainingRaw!==null&&
      remainingRaw!==''&&
      Number.isFinite(Number(remainingRaw))&&
      Number(remainingRaw)<=0
    )return false;

    const end=clean(job.deliveryEndDate||job.endDate||job.expirationDate);
    if(end&&end<todayISO())return false;

    return true;
  }

  function destinationAliases(record){
    const values=[
      record?.deliveryLocationName,
      record?.destinationName,
      record?.locationName,
      record?.buyerName,
      record?.ocrElevatorName,
      record?.elevatorName,
      [record?.buyerName,record?.deliveryLocationName].filter(Boolean).join(' '),
      [record?.buyerName,record?.destinationName].filter(Boolean).join(' ')
    ];

    return [...new Set(values.map(norm).filter(Boolean))];
  }

  function aliasesMatch(a,b){
    if(!a.length||!b.length)return false;
    return a.some(left=>b.some(right=>
      left===right||
      (left.length>=5&&right.includes(left))||
      (right.length>=5&&left.includes(right))
    ));
  }

  function hasOpenHaulingJobForTicket(ticket){
    const ticketDest=destinationAliases(ticket);
    const ticketCrop=cropKey(ticket?.crop||ticket?.commodity);

    if(!ticketDest.length)return true; // destination itself unresolved is handled by normal review logic.

    return haulingJobs.some(job=>{
      if(!jobIsOpen(job))return false;

      const jobCrop=cropKey(job?.crop||job?.commodity);
      if(ticketCrop&&jobCrop&&ticketCrop!==jobCrop)return false;

      const ticketLocationId=clean(ticket?.deliveryLocationId||ticket?.destinationId);
      const jobLocationId=clean(job?.deliveryLocationId||job?.locationId||job?.destinationId);

      if(ticketLocationId&&jobLocationId&&ticketLocationId===jobLocationId)return true;

      return aliasesMatch(ticketDest,destinationAliases(job));
    });
  }

  async function refreshData(){
    try{
      const [ticketSnap,jobSnap]=await Promise.all([
        getDocs(collection(db,'grain_tickets')),
        getDocs(collection(db,'grain_hauling_jobs'))
      ]);

      byNumber.clear();
      ticketSnap.docs.forEach(d=>{
        const data={id:d.id,...d.data()};
        const number=clean(data.ticketNumber);
        if(number)byNumber.set(number,data);
      });

      haulingJobs=jobSnap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(error){
      console.warn('[grain warning] destination/job lookup failed:',error);
    }
  }

  function resetBadge(row,badge){
    if(!badge?.dataset?.fvDestinationJobWarning)return;
    row.classList.remove('ticket-warning-row');
    row.classList.add('ticket-review-row');
    badge.classList.remove('warning');
    badge.classList.add('review');
    badge.textContent='Review';
    badge.removeAttribute('title');
    delete badge.dataset.fvDestinationJobWarning;
  }

  function apply(){
    if(applying)return;
    applying=true;

    try{
      const tbody=document.getElementById('grain-ticket-table-body');
      if(!tbody)return;

      tbody.querySelectorAll('tr').forEach(row=>{
        const cells=row.querySelectorAll('td');
        if(cells.length<5)return;

        const ticket=byNumber.get(clean(cells[2]?.textContent));
        if(!ticket)return;

        let badge=row.querySelector('.ticket-status');
        if(!badge)return;

        const noOpenJob=!hasOpenHaulingJobForTicket(ticket);

        if(!noOpenJob){
          resetBadge(row,badge);
          return;
        }

        /* Only elevate unresolved/review-style tickets. A verified ticket that
           already linked through a FarmVista load keeps its normal good state. */
        const unresolved=
          norm(ticket.validationStatus)==='needs review'||
          norm(ticket.validationStatus)==='needs_review'||
          badge.classList.contains('review');

        if(!unresolved)return;

        row.classList.remove('ticket-review-row');
        row.classList.add('ticket-warning-row');
        badge.classList.remove('review','job','good');
        badge.classList.add('warning');
        badge.textContent='Warning';
        badge.title='No current open hauling job matches this ticket destination and crop.';
        badge.dataset.fvDestinationJobWarning='1';
      });
    }finally{
      applying=false;
    }
  }

  await refreshData();
  apply();

  const tbody=document.getElementById('grain-ticket-table-body');
  if(tbody)new MutationObserver(apply).observe(tbody,{childList:true,subtree:true});

  setInterval(async()=>{
    await refreshData();
    apply();
  },30000);
})();