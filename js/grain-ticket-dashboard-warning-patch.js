/* FarmVista Grain Ticket dashboard destination / hauling-job warning
   Rev 2026-09-12a

   Office dashboard status helper only. This file never runs in the driver
   scanner, never blocks a save, and never changes hauling-job assignment.

   Resolved tickets that are already assigned to a valid hauling job normally
   show Good on the dashboard even when an older OCR/review flag is still stored
   on the ticket. However, office-only sanity checks may still mark that linked
   ticket Review so the ticket image can be verified without interrupting the
   driver's workflow.

   Sanity-review ranges:
     - Gross weight: Review over 95,000 lb
     - Tare weight: Review below 20,000 or above 35,000 lb
     - Gross bushels: Review at 1,200 bu or more
     - Net bushels: Review when more than 15% different from gross bushels
     - Test weight (TW): 45 through 70
     - Moisture (MO): 7 through 35
     - Damage (DM): 0 through 20
     - Foreign material (FM): 0 through 20

   Unassigned review tickets can still become Warning when their resolved
   destination + crop have no current open hauling job. Missing contract alone
   is not a warning.

   IMPORTANT: keep DOM mutations idempotent. This helper runs beside the
   dashboard renderer; a subtree MutationObserver that rewrites badge text can
   self-trigger forever on Safari/mobile.
*/
(async function(){
  'use strict';

  if(!String(location.pathname||'').toLowerCase().endsWith('/pages/grain/grain-ticket.html')) return;

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

  const present=value=>{
    const v=norm(value);
    return !!v&&v!=='unknown'&&v!=='none'&&v!=='not selected'&&v!=='notselected';
  };

  const numeric=(...values)=>{
    for(const raw of values){
      if(raw===null||raw===undefined||clean(raw)==='') continue;
      const value=Number(clean(raw).replace(/,/g,'').replace(/%/g,''));
      if(Number.isFinite(value)) return value;
    }
    return null;
  };

  const cropKey=value=>{
    const v=norm(value);
    if(v.includes('soy')) return 'soybeans';
    if(v.includes('corn')) return 'corn';
    return v;
  };

  const todayISO=()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function ticketSanityReviewReasons(ticket){
    const reasons=[];

    const grossWeight=numeric(
      ticket?.grossWeight,
      ticket?.gross,
      ticket?.grossLbs,
      ticket?.grossLb
    );

    const tareWeight=numeric(
      ticket?.tareWeight,
      ticket?.tare,
      ticket?.tareLbs,
      ticket?.tareLb
    );

    const grossBushels=numeric(
      ticket?.grossBushels,
      ticket?.grossBu,
      ticket?.grossBushel
    );

    const netBushels=numeric(
      ticket?.netBushels,
      ticket?.netBu,
      ticket?.netBushel
    );

    const testWeight=numeric(
      ticket?.testWeight,
      ticket?.tw,
      ticket?.TW
    );

    const moisture=numeric(
      ticket?.moisture,
      ticket?.mo,
      ticket?.MO
    );

    const damage=numeric(
      ticket?.damage,
      ticket?.dm,
      ticket?.DM
    );

    const foreignMaterial=numeric(
      ticket?.foreignMaterial,
      ticket?.fm,
      ticket?.FM
    );

    if(grossWeight!==null&&grossWeight>95000){
      reasons.push('gross_weight_over_95000');
    }

    if(tareWeight!==null&&(tareWeight<20000||tareWeight>35000)){
      reasons.push('tare_weight_outside_20000_35000');
    }

    if(grossBushels!==null&&grossBushels>=1200){
      reasons.push('gross_bushels_1200_or_more');
    }

    if(
      grossBushels!==null&&
      grossBushels>0&&
      netBushels!==null&&
      Math.abs(netBushels-grossBushels)/grossBushels>0.15
    ){
      reasons.push('net_bushels_over_15_percent_from_gross');
    }

    if(testWeight!==null&&(testWeight<45||testWeight>70)){
      reasons.push('test_weight_outside_45_70');
    }

    if(moisture!==null&&(moisture<7||moisture>35)){
      reasons.push('moisture_outside_7_35');
    }

    if(damage!==null&&(damage<0||damage>20)){
      reasons.push('damage_outside_0_20');
    }

    if(foreignMaterial!==null&&(foreignMaterial<0||foreignMaterial>20)){
      reasons.push('foreign_material_outside_0_20');
    }

    return reasons;
  }

  function jobIsOpen(job){
    if(!job||job.active===false||job.isActive===false) return false;

    const status=norm(job.status||job.contractStatus||'active');
    if(
      status.includes('closed')||
      status.includes('complete')||
      status.includes('cancel')||
      status.includes('void')
    ) return false;

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
    ) return false;

    const end=clean(job.deliveryEndDate||job.endDate||job.expirationDate);
    if(end&&end<todayISO()) return false;

    return true;
  }

  function linkedJobForTicket(ticket){
    const jobId=clean(ticket?.haulingJobId||ticket?.jobId);
    if(!jobId) return null;
    return haulingJobs.find(job=>clean(job?.id)===jobId)||null;
  }

  function linkedJobIsValid(job){
    if(!job||job.active===false||job.isActive===false) return false;
    const status=norm(job.status||job.contractStatus);
    return !status.includes('void')&&!status.includes('cancel');
  }

  function ticketHasResolvedAssignment(ticket){
    const job=linkedJobForTicket(ticket);
    if(!linkedJobIsValid(job)) return false;

    const customerResolved=
      present(ticket?.customerId)||
      present(ticket?.grainCustomerId)||
      present(ticket?.customerName)||
      present(ticket?.soldUnderId)||
      present(ticket?.soldUnderName)||
      present(ticket?.soldUnder);

    const destinationResolved=
      present(ticket?.deliveryLocationId)||
      present(ticket?.destinationId)||
      present(ticket?.deliveryLocationName)||
      present(ticket?.destinationName)||
      present(ticket?.locationName)||
      present(ticket?.buyerId)||
      present(ticket?.buyerName);

    const cropResolved=present(ticket?.crop||ticket?.commodity);

    const sourceResolved=
      present(ticket?.grainSourceType)||
      present(ticket?.grainSourceName)||
      present(ticket?.grainSourceValue)||
      present(ticket?.grainSourceId)||
      present(ticket?.fieldId)||
      present(ticket?.fieldName);

    return customerResolved&&destinationResolved&&cropResolved&&sourceResolved;
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
    if(!a.length||!b.length) return false;
    return a.some(left=>b.some(right=>
      left===right||
      (left.length>=5&&right.includes(left))||
      (right.length>=5&&left.includes(right))
    ));
  }

  function hasOpenHaulingJobForTicket(ticket){
    const ticketDest=destinationAliases(ticket);
    const ticketCrop=cropKey(ticket?.crop||ticket?.commodity);

    if(!ticketDest.length) return true;

    return haulingJobs.some(job=>{
      if(!jobIsOpen(job)) return false;

      const jobCrop=cropKey(job?.crop||job?.commodity);
      if(ticketCrop&&jobCrop&&ticketCrop!==jobCrop) return false;

      const ticketLocationId=clean(ticket?.deliveryLocationId||ticket?.destinationId);
      const jobLocationId=clean(job?.deliveryLocationId||job?.locationId||job?.destinationId);

      if(ticketLocationId&&jobLocationId&&ticketLocationId===jobLocationId) return true;

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
        if(number) byNumber.set(number,data);
      });

      haulingJobs=jobSnap.docs.map(d=>({id:d.id,...d.data()}));
    }catch(error){
      console.warn('[grain warning] destination/job lookup failed:',error);
    }
  }

  function makeGood(row,badge){
    row.classList.remove('ticket-warning-row','ticket-review-row');
    badge.classList.remove('warning','review','job');
    badge.classList.add('good');
    if(badge.textContent!=='Good') badge.textContent='Good';
    badge.removeAttribute('title');
    delete badge.dataset.fvDestinationJobWarning;
    delete badge.dataset.fvSanityReview;
  }

  function makeReview(row,badge){
    row.classList.remove('ticket-warning-row');
    row.classList.add('ticket-review-row');
    badge.classList.remove('warning','job','good');
    badge.classList.add('review');
    if(badge.textContent!=='Review') badge.textContent='Review';
    badge.removeAttribute('title');
    delete badge.dataset.fvDestinationJobWarning;
    badge.dataset.fvSanityReview='1';
  }

  function resetBadge(row,badge){
    if(!badge?.dataset?.fvDestinationJobWarning) return;

    row.classList.remove('ticket-warning-row');
    row.classList.add('ticket-review-row');
    badge.classList.remove('warning');
    badge.classList.add('review');
    if(badge.textContent!=='Review') badge.textContent='Review';
    badge.removeAttribute('title');
    delete badge.dataset.fvDestinationJobWarning;
  }

  function makeWarning(row,badge){
    if(
      badge.dataset.fvDestinationJobWarning==='1'&&
      badge.classList.contains('warning')&&
      badge.textContent==='Warning'
    ) return;

    row.classList.remove('ticket-review-row');
    row.classList.add('ticket-warning-row');
    badge.classList.remove('review','job','good');
    badge.classList.add('warning');
    if(badge.textContent!=='Warning') badge.textContent='Warning';
    badge.title='No current open hauling job matches this ticket destination and crop.';
    badge.dataset.fvDestinationJobWarning='1';
    delete badge.dataset.fvSanityReview;
  }

  function apply(){
    if(applying) return;
    applying=true;

    try{
      const tbody=document.getElementById('grain-ticket-table-body');
      if(!tbody) return;

      tbody.querySelectorAll('tr').forEach(row=>{
        const cells=row.querySelectorAll('td');
        if(cells.length<5) return;

        const ticket=byNumber.get(clean(cells[2]?.textContent));
        if(!ticket) return;

        const badge=row.querySelector('.ticket-status');
        if(!badge) return;

        const sanityReviewReasons=ticketSanityReviewReasons(ticket);
        const sanityNeedsReview=sanityReviewReasons.length>0;

        /*
          A real hauling-job assignment remains fully active. The sanity checks
          below are only an office dashboard Review marker and never undo,
          delay, or block that assignment.
        */
        if(ticketHasResolvedAssignment(ticket)){
          if(sanityNeedsReview){
            makeReview(row,badge);
          }else{
            makeGood(row,badge);
          }
          return;
        }

        /*
          Preserve the existing operational Warning behavior. If a ticket has
          no current open hauling job for its resolved destination/crop, that
          remains Warning rather than being downgraded to a sanity Review.
        */
        if(!hasOpenHaulingJobForTicket(ticket)){
          const unresolved=
            norm(ticket.validationStatus)==='needs review'||
            badge.classList.contains('review')||
            badge.dataset.fvDestinationJobWarning==='1';

          if(unresolved){
            makeWarning(row,badge);
            return;
          }
        }

        if(sanityNeedsReview){
          makeReview(row,badge);
          return;
        }

        if(hasOpenHaulingJobForTicket(ticket)){
          resetBadge(row,badge);
        }
      });
    }finally{
      applying=false;
    }
  }

  await refreshData();
  apply();

  const tbody=document.getElementById('grain-ticket-table-body');
  if(tbody){
    /* Watch only row additions/removals. Watching the entire subtree while this
       helper edits badge text creates a self-triggering mutation loop. */
    new MutationObserver(apply).observe(tbody,{childList:true});
  }

  setInterval(async()=>{
    await refreshData();
    apply();
  },30000);
})();
