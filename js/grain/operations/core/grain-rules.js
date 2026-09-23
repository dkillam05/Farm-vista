// FarmVista Grain Operations — centralized domain rules
// One authoritative place for hauling, contract, ticket and settlement relationships.

export const EPS = 0.005;
export const clean = value => String(value ?? '').trim();
export const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const round2 = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;

export const ticketBushels = ticket => Math.max(0, round2(ticket?.netBushels ?? ticket?.netBu ?? ticket?.bushels));
export const jobTarget = job => Math.max(0, round2(job?.startingBushels ?? job?.jobBushels ?? job?.bushels));
export const contractTarget = contract => Math.max(0, round2(contract?.bushels ?? contract?.contractBushels ?? contract?.quantity));
export const isSpotHaulingJob = job => job?.spotLoadOnly === true || (jobTarget(job) <= EPS && key(job?.jobName ?? job?.displayName).includes('spot loads'));

export function isVoided(record){
  return record?.isVoided === true || record?.voided === true || ['void','voided','cancelled','canceled'].includes(key(record?.status));
}

export function sameCrop(a,b){ return !!key(a) && key(a) === key(b); }
function sameKnownIdentity(aId,bId,aName,bName){const left=clean(aId),right=clean(bId);if(left&&right)return left===right;const an=key(aName),bn=key(bName);return !!an&&!!bn&&an===bn}
export function sameBuyer(job,ticket){return sameKnownIdentity(job?.buyerId,ticket?.buyerId,job?.buyerName,ticket?.buyerName)}
export function sameDeliveryLocation(job,ticket){const a=clean(job?.deliveryLocationId),b=clean(ticket?.deliveryLocationId);if(a&&b)return a===b;const an=key(job?.deliveryLocationName),bn=key(ticket?.deliveryLocationName);if(an&&bn)return an===bn;return !(a||b||an||bn)}
export function sameCustomer(job,ticket){
  const a = clean(job?.customerId ?? job?.grainCustomerId);
  const b = clean(ticket?.customerId ?? ticket?.grainCustomerId);
  if(a && b) return a === b;
  return key(job?.customerName ?? job?.soldUnder) === key(ticket?.customerName ?? ticket?.soldUnder);
}

export function normalizeSplitAllocations(ticket){
  const sourceJobId = clean(ticket?.haulingJobId);
  const raw = Array.isArray(ticket?.haulingJobSplitAllocations) ? ticket.haulingJobSplitAllocations : [];
  return raw.map(item => ({
    sourceJobId: clean(item?.sourceJobId || sourceJobId),
    haulingJobId: clean(item?.haulingJobId),
    contractId: clean(item?.contractId),
    bushels: Math.max(0, round2(item?.bushels)),
    allocationType: ['job','spot','unassigned'].includes(key(item?.allocationType)) ? key(item?.allocationType) : 'job'
  })).filter(item => item.sourceJobId && item.bushels > EPS);
}

// Every split row represents physical bushels that no longer belong to the source job's normal
// capacity. Job rows move those bushels to another job; unassigned and genuine Spot rows remove
// them from the source total. This keeps one physical ticket from being counted twice.
export function effectiveJobTotals(tickets){
  const totals = new Map();
  const add = (id,bu) => { if(id && Math.abs(bu) > EPS) totals.set(id, round2((totals.get(id)||0)+bu)); };
  for(const ticket of tickets || []){
    if(isVoided(ticket)) continue;
    const source = clean(ticket?.haulingJobId);
    const total = ticketBushels(ticket);
    if(source && total > EPS) add(source,total);
    for(const allocation of normalizeSplitAllocations(ticket)){
      if(allocation.sourceJobId !== source) continue;
      if(allocation.allocationType === 'unassigned' || allocation.allocationType === 'spot') add(source,-allocation.bushels);
      if(allocation.allocationType === 'job' && allocation.haulingJobId && allocation.haulingJobId !== source){
        add(source,-allocation.bushels);
        add(allocation.haulingJobId,allocation.bushels);
      }
    }
  }
  return totals;
}

// Normal capacity excludes Spot; delivered totals include its attached Spot portions.
export function ticketJobBushels(ticket,jobId){
  if(isVoided(ticket))return 0;
  return effectiveJobTotals([ticket]).get(clean(jobId))||0;
}
export function ticketSpotBushels(ticket,jobId){
  if(isVoided(ticket)||clean(ticket?.haulingJobId)!==clean(jobId))return 0;
  return round2(normalizeSplitAllocations(ticket).filter(a=>a.sourceJobId===clean(jobId)&&a.allocationType==='spot').reduce((n,a)=>n+a.bushels,0));
}
export const ticketDeliveredBushels=(ticket,jobId)=>round2(ticketJobBushels(ticket,jobId)+ticketSpotBushels(ticket,jobId));
export const timestampValue=value=>typeof value?.toMillis==='function'?value.toMillis():Number(value?.seconds??value?._seconds)*1000||Date.parse(clean(value))||0;

export function haulingStatus(job,tickets,now=new Date()){
  if(isVoided(job)) return 'closed';
  const target = jobTarget(job);
  const used = effectiveJobTotals(tickets).get(clean(job?.id)) || 0;
  // A job completed by bushels must reopen automatically if a manual ticket move
  // drops it back below target. Only explicit non-completion deactivation stays closed.
  const rawStatus=clean(job?.status).toLowerCase(),completedByBushels=job?.completed===true||rawStatus==='completed';
  if(job?.active===false&&!completedByBushels)return 'closed';
  if(!isSpotHaulingJob(job) && target > EPS && used + EPS >= target) return used > target + EPS ? 'overhauled' : 'completed';
  const start = clean(job?.deliveryStartDate), end = clean(job?.deliveryEndDate);
  const today = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const localDay = new Date(today.getFullYear(),today.getMonth(),today.getDate());
  if(start && new Date(`${start}T00:00:00`) > localDay) return 'upcoming';
  if(end && new Date(`${end}T23:59:59`) < localDay) return isSpotHaulingJob(job) ? 'completed' : 'past due';
  return 'active';
}

export function compatibleHaulingJob(job,ticket){
  if(!job || !ticket || isVoided(job) || (job?.active===false && job?.completed!==true && key(job?.status)!=='completed') || (jobTarget(job) <= EPS && !isSpotHaulingJob(job))) return false;
  if(!sameCrop(job?.crop ?? job?.commodity,ticket?.crop ?? ticket?.commodity)) return false;
  if(!sameBuyer(job,ticket) || !sameDeliveryLocation(job,ticket) || !sameCustomer(job,ticket)) return false;
  const date = clean(ticket?.date ?? ticket?.ticketDate);
  if(date && job?.deliveryStartDate && date < clean(job.deliveryStartDate)) return false;
  if(date && job?.deliveryEndDate && date > clean(job.deliveryEndDate)) return false;
  return true;
}

export function planHaulingAllocation(ticket,jobs,tickets){
  let remaining = ticketBushels(ticket);
  const totals = effectiveJobTotals(tickets);
  // Do not filter by derived "completed" status here. A ticket can be the ticket that fills the
  // oldest job and rolls its remaining bushels into the next compatible job. Capacity, not the
  // display status, decides whether a job can accept another portion.
  const compatible=(jobs||[]).filter(job => compatibleHaulingJob(job,ticket));
  const datedSort=(a,b)=>clean(a.deliveryStartDate).localeCompare(clean(b.deliveryStartDate))||(timestampValue(a.createdAt)-timestampValue(b.createdAt))||clean(a.id).localeCompare(clean(b.id));
  const capacityJobs=compatible.filter(job=>!isSpotHaulingJob(job)).sort(datedSort),spotJobs=compatible.filter(isSpotHaulingJob).sort(datedSort);
  const allocations=[];
  for(const job of capacityJobs){
    if(remaining <= EPS) break;
    const capacity = Math.max(0,round2(jobTarget(job)-(totals.get(clean(job.id))||0)));
    if(capacity <= EPS) continue;
    const bushels = Math.min(remaining,capacity);
    allocations.push({haulingJobId:clean(job.id),bushels:round2(bushels),allocationType:'job'});
    remaining=round2(remaining-bushels);
  }
  // Explicit Spot-only hauling jobs are real operational jobs, but normal-capacity jobs always
  // take priority. Only use the oldest compatible Spot job after all normal capacity is exhausted.
  if(remaining>EPS&&spotJobs.length){allocations.push({haulingJobId:clean(spotJobs[0].id),bushels:round2(remaining),allocationType:'job',spotLoadOnly:true});remaining=0}
  // Once all eligible capacity is exhausted, keep a whole overflow load attached
  // to an eligible source (or the last job in the normal fill order). Completion
  // by bushels does not close that job's delivery window.
  const spotSource=remaining>EPS&&!allocations.length
    ?capacityJobs.at(-1)
    :null;
  return {allocations,spotBushels:Math.max(0,round2(remaining)),spotHaulingJobId:clean(spotSource?.id)};
}
