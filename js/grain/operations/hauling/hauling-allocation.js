// FarmVista Grain Operations — automatic hauling rollover/split planner
import { clean,planHaulingAllocation,ticketBushels,isVoided,round2,normalizeSplitAllocations,sameBuyer,sameDeliveryLocation,sameCustomer,sameCrop,timestampValue } from '../core/grain-rules.js';
const otherTickets=(ticket,state)=>(state?.tickets||[]).filter(x=>clean(x?.id)!==clean(ticket?.id));
export function buildAutomaticHaulingAssignment(ticket,state){
  const plan=planHaulingAllocation(ticket,state?.haulingJobs||[],otherTickets(ticket,state));
  const total=ticketBushels(ticket);
  const source=(plan.spotBushels>0?plan.allocations.at(-1):plan.allocations[0])||{haulingJobId:plan.spotHaulingJobId,bushels:0};
  const sourceJobId=clean(source.haulingJobId),splits=[];
  for(const part of plan.allocations.filter(part=>part!==source))splits.push({sourceJobId,haulingJobId:part.haulingJobId,bushels:part.bushels,allocationType:'job'});
  if(sourceJobId&&plan.spotBushels>0)splits.push({sourceJobId,haulingJobId:'',bushels:plan.spotBushels,allocationType:'spot'});
  return{sourceJobId,haulingJobId:sourceJobId,sourceBushels:source.bushels,haulingJobSplitAllocations:splits,spotBushels:plan.spotBushels,totalBushels:total};
}
export function describeAutomaticAssignment(result,state){const name=id=>{const job=(state?.haulingJobs||[]).find(x=>clean(x.id)===clean(id));return clean(job?.jobName??job?.deliveryLocationName??job?.buyerName)||id},parts=[];if(result?.sourceJobId)parts.push(`${name(result.sourceJobId)}: ${result.sourceBushels} bu`);for(const split of result?.haulingJobSplitAllocations||[])parts.push(split.allocationType==='unassigned'?`Unassigned: ${split.bushels} bu`:split.allocationType==='spot'?`Spot: ${split.bushels} bu`:`${name(split.haulingJobId)}: ${split.bushels} bu`);return parts}

// Rebuild a matching group in ticket chronology, reserving deliberate manual assignments.
// This is a preview only; opening a page must never rewrite grain records.
export function allocationSignature(ticket){return JSON.stringify({job:clean(ticket?.haulingJobId),splits:normalizeSplitAllocations(ticket).map(a=>[a.sourceJobId,a.haulingJobId,a.allocationType,round2(a.bushels)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})}
export function buildHaulingReconciliation(state,anchor){
  const matches=t=>sameBuyer(anchor,t)&&sameDeliveryLocation(anchor,t)&&sameCustomer(anchor,t)&&sameCrop(anchor.crop??anchor.commodity,t.crop??t.commodity);
  const group=(state?.tickets||[]).filter(t=>!isVoided(t)&&matches(t));
  const today=new Date(),day=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const candidates=group.filter(t=>t.manualHaulingOverride!==true&&/^\d{4}-\d{2}-\d{2}$/.test(clean(t.date||t.ticketDate))&&clean(t.date||t.ticketDate)<=day);
  const ids=new Set(candidates.map(t=>clean(t.id)));
  const working={...state,tickets:(state?.tickets||[]).filter(t=>!ids.has(clean(t.id)))};
  candidates.sort((a,b)=>clean(a.date||a.ticketDate).localeCompare(clean(b.date||b.ticketDate))||timestampValue(a.createdAt)-timestampValue(b.createdAt)||clean(a.ticketNumber||a.ticketNo||a.id).localeCompare(clean(b.ticketNumber||b.ticketNo||b.id),undefined,{numeric:true})||clean(a.id).localeCompare(clean(b.id)));
  const changes=[];
  for(const ticket of candidates){
    // Invalid dates stay untouched for office review, never guessed into a job.
    const date=clean(ticket.date||ticket.ticketDate),today=new Date(),day=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>day){working.tickets.push(ticket);continue}
    const result=buildAutomaticHaulingAssignment(ticket,working);
    // No eligible destination: retain the existing record for office review.
    if(!result.haulingJobId){working.tickets.push(ticket);continue}
    const next={...ticket,haulingJobId:result.haulingJobId,haulingJobSplitAllocations:result.haulingJobSplitAllocations};
    working.tickets.push(next);
    if(allocationSignature(ticket)!==allocationSignature(next))changes.push({ticket,result});
  }
  return {changes,manualCount:group.filter(t=>t.manualHaulingOverride===true).length,state:working};
}
