/* Read-only dashboard projection of the hauling split ledger. No allocation writes. */
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase();
const num = value => { const n = Number(clean(value).replace(/,/g,'')); return Number.isFinite(n) ? n : 0; };
const round = value => Math.round(value * 100) / 100;
export function farmToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part = key => parts.find(p=>p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function effectiveTotals(tickets) {
  const totals = new Map();
  const add = (id,bu) => { if(id) totals.set(id, round((totals.get(id)||0)+bu)); };
  for (const ticket of tickets) {
    if (ticket.voided === true || norm(ticket.status).includes('void')) continue;
    const source = clean(ticket.haulingJobId);
    const portions = new Map();
    const credit = (id,bu) => { if(id) portions.set(id,round((portions.get(id)||0)+bu)); };
    credit(source,Math.max(0,num(ticket.netBushels ?? ticket.netBu ?? ticket.bushels)));
    for (const item of Array.isArray(ticket.haulingJobSplitAllocations) ? ticket.haulingJobSplitAllocations : []) {
      const from = clean(item.sourceJobId || source);
      const dest = clean(item.haulingJobId || item.jobId);
      const type = norm(item.allocationType || item.type || 'job');
      const amount = Math.max(0,num(item.bushels));
      if (!from || amount <= .005) continue;
      if (from === source && (type === 'unassigned' || type === 'spot' || (dest && dest !== source))) credit(source,-amount);
      if (type !== 'unassigned' && dest && !(dest === source && type !== 'spot')) credit(dest,amount);
    }
    portions.forEach((bu,id)=>add(id,Math.max(0,bu)));
  }
  return totals;
}
export function grainSummary(jobs,tickets,today = farmToday()) {
  const delivered = effectiveTotals(tickets);
  const rows = jobs.map(job=>{
    const total = Math.max(0,num(job.startingBushels ?? job.jobBushels ?? job.bushels));
    const ticketed = delivered.get(clean(job.id)) || 0;
    const remaining = round(Math.max(0,total-ticketed));
    const spot = total <= .005;
    const start = clean(job.deliveryStartDate || job.startDate);
    const end = clean(job.deliveryEndDate || job.endDate);
    const raw = norm(job.status);
    let status = 'active';
    if (job.manualClosed === true || job.active === false || /void|closed|cancel/.test(raw)) status = 'closed';
    else if (!spot && (/complete/.test(raw) || remaining <= .005)) status = 'complete';
    else if (start && start > today) status = 'upcoming';
    else if (end && end < today) status = spot ? 'complete' : 'past_due';
    const rawCrop = clean(job.crop || job.commodity || job.cropName || job.cropType);
    const crop = /soy/i.test(rawCrop) ? 'Soybeans' : /corn/i.test(rawCrop) ? 'Corn' : rawCrop || 'Other';
    const buyer = clean(job.buyerName || job.buyer);
    const location = clean(job.deliveryLocationName || job.locationName || job.destinationName || job.destination);
    const place = location && buyer && !norm(location).startsWith(norm(buyer)) ? `${buyer} · ${location}` : location || buyer;
    const title = clean(job.displayName || job.jobName || job.haulingJobName) || place || 'Hauling job';
    return {id:clean(job.id),title,crop,total,ticketed,remaining,spot,start,end,status};
  }).filter(row=>['active','upcoming','past_due'].includes(row.status));
  const totals = {Corn:0,Soybeans:0};
  rows.forEach(row=>{ if(!row.spot) totals[row.crop] = round((totals[row.crop]||0)+row.remaining); });
  const rank = {active:0,past_due:1,upcoming:2};
  rows.sort((a,b)=>rank[a.status]-rank[b.status] || Number(a.spot)-Number(b.spot) || a.remaining-b.remaining || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return {rows,totals};
}
