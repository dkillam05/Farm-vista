// FarmVista Grain Operations — centralized drag/drop allocation decisions.
// DOM code asks this controller; compatibility and capacity stay out of UI files.
import { clean,round2,ticketBushels,isVoided,compatibleHaulingJob,jobTarget,effectiveJobTotals,isSpotHaulingJob,normalizeSplitAllocations,sameCrop } from '../core/grain-rules.js';
import { compatibleContract } from '../contracts/contract-allocation.js';
import { contractTarget } from '../core/grain-rules.js';
import { deliveredToContract } from '../contracts/contract-model.js';

const otherTickets=(ticket,state)=>(state?.tickets||[]).filter(x=>clean(x?.id)!==clean(ticket?.id));
const contractAllocations=ticket=>(Array.isArray(ticket?.contractAllocations)?ticket.contractAllocations:[])
  .map(a=>({contractId:clean(a?.contractId),bushels:Math.max(0,round2(a?.bushels))}))
  .filter(a=>a.contractId&&a.bushels>0);
const hasContractLedger=ticket=>contractAllocations(ticket).length>0;
const contractAllocatedBushels=ticket=>hasContractLedger(ticket)
  ?round2(contractAllocations(ticket).reduce((sum,a)=>sum+a.bushels,0))
  :(clean(ticket?.contractId)?ticketBushels(ticket):0);
const contractUnallocatedBushels=ticket=>Math.max(0,round2(ticketBushels(ticket)-contractAllocatedBushels(ticket)));
const contractAllocatedTo=(ticket,contractId)=>{const id=clean(contractId);if(hasContractLedger(ticket))return round2(contractAllocations(ticket).filter(a=>a.contractId===id).reduce((sum,a)=>sum+a.bushels,0));return clean(ticket?.contractId)===id?ticketBushels(ticket):0};
const soleContractId=ticket=>{const rows=contractAllocations(ticket);if(rows.length===1&&rows[0].bushels+0.005>=ticketBushels(ticket))return rows[0].contractId;if(!rows.length&&clean(ticket?.contractId))return clean(ticket.contractId);return''};
const haulingMovedBushels=ticket=>round2(normalizeSplitAllocations(ticket)
  .filter(x=>x.allocationType==='job'||x.allocationType==='unassigned'||x.allocationType==='spot')
  .reduce((sum,x)=>sum+Math.max(0,Number(x.bushels)||0),0));
const haulingSpotBushels=ticket=>round2(normalizeSplitAllocations(ticket)
  .filter(x=>x.allocationType==='spot')
  .reduce((sum,x)=>sum+Math.max(0,Number(x.bushels)||0),0));
const haulingSourceBushels=ticket=>Math.max(0,round2(ticketBushels(ticket)-haulingMovedBushels(ticket)));
const haulingAssignableBushels=ticket=>round2(haulingSourceBushels(ticket)+haulingSpotBushels(ticket));
const haulingAllocatedTo=(ticket,jobId)=>round2(normalizeSplitAllocations(ticket)
  .filter(x=>x.allocationType==='job'&&clean(x.haulingJobId)===clean(jobId))
  .reduce((sum,x)=>sum+Math.max(0,Number(x.bushels)||0),0));

export function canAssignTicketToHaulingJob(ticket,job,state={}){
  if(!ticket||!job||isVoided(ticket)||isVoided(job))return{ok:false,reason:'Unavailable'};
  const movingWholeSource=clean(ticket?.haulingJobId)&&clean(ticket?.haulingJobId)!==clean(job?.id);
  if(movingWholeSource){
    if(!sameCrop(job?.crop??job?.commodity,ticket?.crop??ticket?.commodity))return{ok:false,reason:'Crop does not match'};
    const date=clean(ticket?.date??ticket?.ticketDate);
    if(date&&job?.deliveryStartDate&&date<clean(job.deliveryStartDate))return{ok:false,reason:'Ticket date is before this hauling job starts'};
    if(date&&job?.deliveryEndDate&&date>clean(job.deliveryEndDate))return{ok:false,reason:'Ticket date is after this hauling job ends'};
  }else{
    if(!sameCrop(job?.crop??job?.commodity,ticket?.crop??ticket?.commodity))return{ok:false,reason:'Crop does not match'};
    const date=clean(ticket?.date??ticket?.ticketDate);
    if(date&&job?.deliveryStartDate&&date<clean(job.deliveryStartDate))return{ok:false,reason:'Ticket date is before this hauling job starts'};
    if(date&&job?.deliveryEndDate&&date>clean(job.deliveryEndDate))return{ok:false,reason:'Ticket date is after this hauling job ends'};
  }
  const targetId=clean(job.id),sourceId=clean(ticket?.haulingJobId);
  if(targetId&&targetId===sourceId)return{ok:false,reason:'Ticket is already sourced to this hauling job'};
  const sourceCapacity=haulingAssignableBushels(ticket);
  if(sourceCapacity<=0)return{ok:false,reason:'No assignable bushels remain on this ticket'};
  if(isSpotHaulingJob(job))return{ok:true,reason:'',capacity:sourceCapacity,spotLoadOnly:true};
  const otherUsed=effectiveJobTotals(otherTickets(ticket,state)).get(targetId)||0;
  const currentTarget=haulingAllocatedTo(ticket,targetId);
  const jobCapacity=Math.max(0,round2(jobTarget(job)-otherUsed-currentTarget));
  const capacity=Math.min(sourceCapacity,jobCapacity);
  if(jobCapacity<=0)return{ok:false,reason:'Hauling job is full'};
  if(capacity<=0)return{ok:false,reason:'No bushels to assign'};
  return{ok:true,reason:'',capacity};
}

export function planManualHaulingMove(ticket,targetJob,{bushels,state}={}){
  const allowed=canAssignTicketToHaulingJob(ticket,targetJob,state);
  if(!allowed.ok)return{...allowed,changes:null};
  const requested=Math.max(0,round2(bushels??allowed.capacity));
  const amount=Math.min(requested,allowed.capacity);
  if(amount<=0)return{ok:false,reason:'No bushels to assign',changes:null};
  return{ok:true,reason:'',changes:{targetHaulingJobId:clean(targetJob.id),bushels:round2(amount),manualOverride:true,spotLoadOnly:allowed.spotLoadOnly===true},remainingBushels:round2(haulingAssignableBushels(ticket)-amount)};
}

export function planUnassignHaulingPortion(ticket,{bushels}={}){
  const available=haulingAssignableBushels(ticket),amount=Math.max(0,Math.min(available,round2(bushels??available)));
  return{ok:amount>0,reason:amount>0?'':'No bushels to unassign',changes:amount>0?{bushels:amount,allocationType:'unassigned'}:null};
}

export function canAssignTicketToContract(ticket,contract,state={}){
  if(!ticket||!contract||isVoided(ticket)||isVoided(contract))return{ok:false,reason:'Unavailable'};
  if(!compatibleContract(contract,ticket))return{ok:false,reason:'Crop, destination, Sold Under, or delivery dates do not match'};
  const ticketCapacity=contractUnallocatedBushels(ticket);
  if(ticketCapacity<=0)return{ok:false,reason:'Ticket is fully allocated to contracts'};
  const target=contractTarget(contract),targetId=clean(contract.id);
  if(target<=0)return{ok:true,reason:'',capacity:ticketCapacity,spotLoadOnly:true};
  const otherDelivered=deliveredToContract(targetId,otherTickets(ticket,state));
  const currentTarget=contractAllocatedTo(ticket,targetId);
  const contractCapacity=Math.max(0,round2(target-otherDelivered-currentTarget));
  if(contractCapacity<=0)return{ok:false,reason:'Contract is full'};
  return{ok:true,reason:'',capacity:Math.min(ticketCapacity,contractCapacity)};
}

export function planContractMove(ticket,contract,{bushels,state}={}){
  const targetId=clean(contract?.id),sourceContractId=soleContractId(ticket),total=ticketBushels(ticket);
  // Established workflow allows an already-assigned whole ticket to be dragged directly from
  // one contract to another. This is a replacement, not an additive allocation.
  if(sourceContractId&&sourceContractId!==targetId&&contractUnallocatedBushels(ticket)<=0.005){
    if(!ticket||!contract||isVoided(ticket)||isVoided(contract))return{ok:false,reason:'Unavailable',changes:null};
    if(!compatibleContract(contract,ticket))return{ok:false,reason:'Crop, destination, Sold Under, or delivery dates do not match',changes:null};
    const target=contractTarget(contract),available=target<=0?total:Math.max(0,round2(target-deliveredToContract(targetId,otherTickets(ticket,state))));
    if(available+0.005<total)return{ok:false,reason:'Contract does not have enough remaining bushels for this whole ticket',changes:null};
    return{ok:true,reason:'',replaceWhole:true,changes:{contractId:targetId,bushels:total},remainingBushels:0};
  }
  const allowed=canAssignTicketToContract(ticket,contract,state);
  if(!allowed.ok)return{...allowed,changes:null};
  const requested=Math.max(0,round2(bushels??allowed.capacity)),amount=Math.min(requested,allowed.capacity);
  return{ok:amount>0,reason:amount>0?'':'No bushels to assign',changes:amount>0?{contractId:targetId,bushels:round2(amount)}:null,remainingBushels:round2(contractUnallocatedBushels(ticket)-amount)};
}
