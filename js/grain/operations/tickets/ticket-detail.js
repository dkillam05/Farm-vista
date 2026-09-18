// FarmVista Grain Operations — ticket detail/read model
import { clean, normalizeSplitAllocations, ticketBushels, round2 } from '../core/grain-rules.js';
import { ticketReviewReasons,gradeAlertClass } from '../core/grain-validation.js';
const find=(rows,id)=>(rows||[]).find(x=>clean(x.id)===clean(id));
export function buildTicketDetail(ticket,state){
  if(!ticket)return null;
  const total=ticketBushels(ticket),sourceJob=find(state?.haulingJobs,ticket.haulingJobId),contract=find(state?.contracts,ticket.contractId),rawSplits=normalizeSplitAllocations(ticket);
  // Detail uses the same physical-bushel ledger as effectiveJobTotals: every split row is no
  // longer part of the source job's normal capacity, including a genuine Spot remainder.
  const splitBushels=round2(rawSplits.reduce((sum,x)=>sum+x.bushels,0));
  const sourceBushels=Math.max(0,round2(total-splitBushels));
  const haulingAllocations=[];
  if(sourceJob&&sourceBushels>0)haulingAllocations.push({haulingJobId:clean(sourceJob.id),job:sourceJob,bushels:sourceBushels,allocationType:'source'});
  for(const split of rawSplits)haulingAllocations.push({...split,job:split.haulingJobId?find(state?.haulingJobs,split.haulingJobId):null});
  const contractAllocations=(Array.isArray(ticket?.contractAllocations)?ticket.contractAllocations:[]).map(a=>({...a,contract:find(state?.contracts,a?.contractId),bushels:Math.max(0,round2(a?.bushels))})).filter(a=>clean(a?.contractId)&&a.bushels>0);
  if(!contractAllocations.length&&contract)contractAllocations.push({contractId:clean(contract.id),contractNumber:clean(ticket?.contractNumber??contract?.contractNumber??contract?.number),contract,bushels:total,legacyWholeTicket:true});
  const reviewReasons=ticketReviewReasons(ticket),gradeAlerts={mo:gradeAlertClass(ticket,state?.alertSettings,'mo'),fm:gradeAlertClass(ticket,state?.alertSettings,'fm'),damage:gradeAlertClass(ticket,state?.alertSettings,'damage')};
  return{...ticket,effectiveBushels:total,sourceJob,sourceBushels,contract,splits:rawSplits,haulingAllocations,contractAllocations,reviewReasons,needsReview:reviewReasons.length>0,gradeAlerts,hasGradeAlert:Object.values(gradeAlerts).some(Boolean),buyerDisplay:clean(ticket.buyerName??ticket.deliveryLocationName),customerDisplay:clean(ticket.customerName??ticket.soldUnder),ticketDisplay:clean(ticket.ticketNumber??ticket.ticketNo??ticket.id)};
}
