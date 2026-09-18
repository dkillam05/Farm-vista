// FarmVista Grain Operations — hauling job read model
import { clean, round2, jobTarget, effectiveJobTotals, haulingStatus,normalizeSplitAllocations,ticketBushels,EPS } from '../core/grain-rules.js';

export function buildHaulingRows(state){
  const totals = effectiveJobTotals(state?.tickets || []);
  return (state?.haulingJobs || []).map(job => {
    const target = jobTarget(job);
    const hauled = round2(totals.get(clean(job.id)) || 0);
    return {
      ...job,
      targetBushels:target,
      hauledBushels:hauled,
      remainingBushels:Math.max(0,round2(target-hauled)),
      overhaulBushels:Math.max(0,round2(hauled-target)),
      effectiveStatus:haulingStatus(job,state?.tickets || [])
    };
  });
}

export function ticketsForHaulingJob(jobId,state){
  const id=clean(jobId);
  return (state?.tickets || []).filter(ticket => {
    const splits=normalizeSplitAllocations(ticket);
    if(clean(ticket?.haulingJobId)===id){
      const moved=round2(splits.filter(a=>a.allocationType==='job'||a.allocationType==='unassigned').reduce((sum,a)=>sum+a.bushels,0));
      if(ticketBushels(ticket)-moved>EPS)return true;
    }
    return splits.some(a=>a.allocationType==='job'&&clean(a.haulingJobId)===id&&a.bushels>EPS);
  });
}
