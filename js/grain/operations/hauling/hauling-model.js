// FarmVista Grain Operations — hauling job read model
import { clean, round2, jobTarget, effectiveJobTotals, haulingStatus,EPS,ticketDeliveredBushels,ticketSpotBushels } from '../core/grain-rules.js';

export function buildHaulingRows(state){
  const totals = effectiveJobTotals(state?.tickets || []);
  return (state?.haulingJobs || []).map(job => {
    const target = jobTarget(job);
    const applied = round2(totals.get(clean(job.id)) || 0);
    const spot = round2((state?.tickets||[]).reduce((sum,t)=>sum+ticketSpotBushels(t,job.id),0));
    const hauled = round2(applied+spot);
    return {
      ...job,
      targetBushels:target,
      hauledBushels:hauled,
      appliedBushels:applied,
      spotBushels:spot,
      remainingBushels:Math.max(0,round2(target-applied)),
      overhaulBushels:Math.max(0,round2(hauled-target)),
      effectiveStatus:haulingStatus(job,state?.tickets || [])
    };
  });
}

export function ticketsForHaulingJob(jobId,state){
  const id=clean(jobId);
  return (state?.tickets || []).filter(ticket=>ticketDeliveredBushels(ticket,id)>EPS);
}
