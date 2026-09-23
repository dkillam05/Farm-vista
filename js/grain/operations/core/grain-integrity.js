// FarmVista Grain Operations — non-destructive integrity checks for migration/testing.
import { clean,round2,ticketBushels,normalizeSplitAllocations } from './grain-rules.js';
export function inspectTicketIntegrity(ticket,state){const issues=[],total=ticketBushels(ticket),jobIds=new Set((state?.haulingJobs||[]).map(x=>clean(x.id))),contractIds=new Set((state?.contracts||[]).map(x=>clean(x.id)));const source=clean(ticket?.haulingJobId);if(source&&!jobIds.has(source))issues.push('Source hauling job is missing');let moved=0,unassigned=0;for(const split of normalizeSplitAllocations(ticket)){if(split.allocationType==='job'){moved+=split.bushels;if(split.haulingJobId&&!jobIds.has(split.haulingJobId))issues.push('Split hauling job is missing')}if(split.allocationType==='unassigned')unassigned+=split.bushels}if(round2(moved+unassigned)>round2(total))issues.push('Hauling split allocations exceed ticket bushels');const allocations=Array.isArray(ticket?.contractAllocations)?ticket.contractAllocations:[];const contractTotal=round2(allocations.reduce((sum,x)=>sum+Math.max(0,Number(x?.bushels||0)),0));for(const allocation of allocations)if(clean(allocation?.contractId)&&!contractIds.has(clean(allocation.contractId)))issues.push('Contract allocation references a missing contract');if(contractTotal>round2(total))issues.push('Contract allocations exceed ticket bushels');return{ticketId:clean(ticket?.id),ok:issues.length===0,issues,totalBushels:total,contractAllocatedBushels:contractTotal}}
export function inspectGrainState(state){const tickets=(state?.tickets||[]).map(t=>inspectTicketIntegrity(t,state));return{ok:tickets.every(x=>x.ok),ticketCount:tickets.length,issueCount:tickets.reduce((n,x)=>n+x.issues.length,0),ticketsWithIssues:tickets.filter(x=>!x.ok)}}

// Firestore reads can return identical maps in different property orders.
// Compare the values, retaining array order and timestamp precision.
export function grainRecordSignature(value){
  return JSON.stringify(value,(_,item)=>{
    if(item&&typeof item==='object'&&!Array.isArray(item))return Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]]));
    return item;
  });
}
