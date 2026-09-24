// Shared read-only office status for dashboard KPIs and the grain tracking table.
import {farmToday} from '../grain-summary.js';
function ticketAssessment(ticket, jobs = []) {
  const haulingJobs = jobs;
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

  const todayISO = farmToday;

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

    /*
      Zero is a valid grade value for Damage and Foreign Material.
      A null numeric result means OCR saved no usable value at all
      (blank, hyphen, em dash, unreadable text, etc.), which should be
      verified by the office against the ticket image.
    */
    if(damage===null){
      reasons.push('damage_missing_or_unreadable');
    }
    else if(damage<0||damage>20){
      reasons.push('damage_outside_0_20');
    }

    if(foreignMaterial===null){
      reasons.push('foreign_material_missing_or_unreadable');
    }
    else if(foreignMaterial<0||foreignMaterial>20){
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
    const jobId=clean(ticket?.haulingJobId||ticket?.grainHaulingJobId||ticket?._linkedHaulingJobId||ticket?.jobId);
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

  function isNeedsReview(
    ticket
  ) {
    return String(
      ticket.validationStatus ||
      ""
    )
      .toLowerCase() ===
      "needs_review";
  }
function ticketHasHaulingJob(
    ticket
  ) {
    return !!String(
      ticket?.haulingJobId ||
      ticket?.grainHaulingJobId ||
      ticket?._linkedHaulingJobId ||
      ""
    ).trim();
  }
  function isSpotLoad(
    ticket
  ) {
    return (
      ticket?.spotLoad === true ||
      String(ticket?.allocationType || "").trim().toLowerCase() === "spot_load" ||
      String(ticket?.haulingJobType || "").trim().toLowerCase() === "spot_load"
    );
  }
  function isNeedsHaulingJob(
    ticket
  ) {
    // A manually confirmed Spot Load is intentionally not tied to a hauling job.
    if (isSpotLoad(ticket)) {
      return false;
    }
    if (
      isNeedsReview(
        ticket
      )
    ) {
      return false;
    }
    return !ticketHasHaulingJob(
      ticket
    );
  }
  function isTicketWarning(
    ticket
  ) {
    if (!isNeedsReview(ticket)) return false;
    const reasons = Array.isArray(ticket?.reviewReasons)
      ? ticket.reviewReasons.map(value => String(value || "").trim().toLowerCase())
      : [];
    const warningReasons = new Set([
      "buyer_not_matched",
      "delivery_location_not_matched",
      "delivery_location_conflict",
      "destination_not_matched",
      "destination_conflict",
      "customer_not_matched",
      "customer_not_selected",
      "sold_under_unknown",
      "sold_under_requires_review",
      "elevator_mismatch",
      "buyer_mismatch",
      "customer_mismatch"
    ]);
    /*
      RED WARNING RULE — NO OPEN MATCHING HAULING JOB
      Do not make a ticket red merely because it is unassigned.
      Make it red when the assignment engine definitively found ZERO
      hauling jobs matching this ticket's operational combination.
      For scanned elevator tickets customerName/customerId is the Sold Under
      party. buyer/delivery location is the destination. matchingHaulingJobIds
      is populated by the hauling-job matcher after checking destination,
      crop, Sold Under and active/open job eligibility.
    */
    const soldUnderKnown = !!String(
      ticket?.customerId || ticket?.customerName || ""
    ).trim();
    const destinationKnown = !!String(
      ticket?.deliveryLocationId || ticket?.buyerId ||
      ticket?.deliveryLocationName || ticket?.buyerName || ""
    ).trim();
    const cropKnown = !!String(ticket?.crop || "").trim();
    const matchingJobIds = Array.isArray(ticket?.matchingHaulingJobIds)
      ? ticket.matchingHaulingJobIds.filter(value => String(value || "").trim())
      : null;
    const scannerCouldNotAutoAssign =
      reasons.includes("hauling_job_not_auto_assigned") &&
      !ticketHasHaulingJob(ticket);
    const noOpenMatchingHaulingJob =
      soldUnderKnown &&
      destinationKnown &&
      cropKnown &&
      (
        (
          ticket?.haulingJobMatched === false &&
          matchingJobIds !== null &&
          matchingJobIds.length === 0
        ) ||
        scannerCouldNotAutoAssign
      );
    if (noOpenMatchingHaulingJob) return true;
    return reasons.some(reason => {
      if (warningReasons.has(reason)) return true;
      /*
        A clean/readable ticket that cannot be matched to an ACTIVE hauling
        job is an operational mismatch, not an OCR/data-entry review item.
        Keep these red so dispatch immediately sees that the destination /
        crop / Sold Under combination has no current hauling job available.
      */
      const haulingJobMismatch =
        (reason.includes("hauling") || reason.includes("job")) &&
        (
          reason.includes("not_matched") ||
          reason.includes("not_found") ||
          reason.includes("no_match") ||
          reason.includes("no_matching") ||
          reason.includes("missing") ||
          reason.includes("inactive") ||
          reason.includes("no_active") ||
          reason.includes("requires_review")
        );
      return haulingJobMismatch;
    });
  }
  const reasons = ticketSanityReviewReasons(ticket);
  const date = clean(ticket.ticketDate || ticket.date || ticket.deliveryDate).slice(0,10);
  const futureDate=/^\d{4}-\d{2}-\d{2}$/.test(date) && date > farmToday();
  if(futureDate) reasons.unshift('Ticket date is in the future — verify the scanned date');
  const resolved = ticketHasResolvedAssignment(ticket);
  let status;
  if(ticket.voided === true || /void|cancel/.test(norm(ticket.status))) status='voided';
  else if(futureDate) status='review';
  else if(resolved) status=reasons.length ? 'review' : 'good';
  else if(isTicketWarning(ticket) || (isNeedsReview(ticket) && !hasOpenHaulingJobForTicket(ticket)) || norm(ticket.validationStatus || ticket.status)==='warning') status='warning';
  else if(reasons.length || isNeedsReview(ticket) || /^(needs[ _]review|review|warning)$/.test(clean(ticket.validationStatus || ticket.status).toLowerCase())) status='review';
  else status=isNeedsHaulingJob(ticket) ? 'needs_job' : 'good';
  if(status!=='good' && status!=='voided' && !resolved){
    if(Array.isArray(ticket.reviewReasons)) reasons.push(...ticket.reviewReasons.filter(r=>typeof r==='string' && r.trim()));
    if(!ticketHasHaulingJob(ticket) && !isSpotLoad(ticket)) reasons.push('No hauling job assigned — check delivery date, destination, crop and Sold Under');
    if(typeof ticket.allocationBlockReason==='string' && ticket.allocationBlockReason.trim()) reasons.push(ticket.allocationBlockReason);
  }
  if(['review','warning','needs_job'].includes(status) && !reasons.length) reasons.push('Ticket flagged for review — open the ticket to verify its details');
  return {status,reasons:[...new Set(reasons.map(reasonText))]};
}
const reasonLabels = {
  gross_weight_over_95000:'Gross weight is over 95,000 lb',
  tare_weight_outside_20000_35000:'Tare weight is outside 20,000–35,000 lb',
  gross_bushels_1200_or_more:'Gross bushels are 1,200 or more',
  net_bushels_over_15_percent_from_gross:'Net bushels differ from gross by more than 15%',
  test_weight_outside_45_70:'Test weight is outside 45–70',
  moisture_outside_7_35:'Moisture is outside 7–35%',
  damage_missing_or_unreadable:'Damage is missing or unreadable',
  damage_outside_0_20:'Damage is outside 0–20%',
  foreign_material_missing_or_unreadable:'FM is missing or unreadable',
  foreign_material_outside_0_20:'FM is outside 0–20%',
  buyer_not_matched:'Buyer could not be matched',
  customer_not_matched:'Sold Under could not be matched',
  customer_not_selected:'Sold Under has not been selected',
  sold_under_unknown:'Sold Under is unknown',
  sold_under_requires_review:'Sold Under needs verification',
  hauling_job_not_auto_assigned:'A hauling job could not be assigned automatically',
  delivery_location_not_matched:'Delivery location could not be matched',
  delivery_location_conflict:'Delivery location conflicts with the scanned ticket',
  destination_not_matched:'Destination could not be matched',
  destination_conflict:'Destination conflicts with the scanned ticket'
};
function reasonText(reason){
  const text=reasonLabels[reason] || String(reason).replace(/_/g,' ');
  return text.charAt(0).toUpperCase()+text.slice(1);
}
export function ticketStatus(ticket,jobs=[]){return ticketAssessment(ticket,jobs).status;}
export function ticketAttentionReasons(ticket,jobs=[]){return ticketAssessment(ticket,jobs).reasons;}

export function scanMillis(ticket) {
  const value = ticket.scannedAt || ticket.createdAt;
  if(value?.toMillis) return value.toMillis();
  if(value?.toDate) return value.toDate().getTime();
  if(typeof value?.seconds === 'number') return value.seconds * 1000;
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}
export function ticketSummary(tickets, jobs, today = farmToday()) {
  const rows = tickets.map(ticket=>{const assessment=ticketAssessment(ticket,jobs);return {...ticket,dashboardStatus:assessment.status,dashboardReasons:assessment.reasons};}).filter(t=>t.dashboardStatus !== 'voided').sort((a,b)=>scanMillis(b)-scanMillis(a));
  return {
    today:rows.filter(t=>scanMillis(t)>0 && farmToday(new Date(scanMillis(t)))===today),
    attention:rows.filter(t=>['review','warning','needs_job'].includes(t.dashboardStatus))
  };
}
