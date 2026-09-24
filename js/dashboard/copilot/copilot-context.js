// Conversation context belongs to one Firebase project AND one signed-in user.
// Never migrate old globally stored history into a different farm/user session.
export function scopeKeys(options, projectId, uid) {
  if (!projectId || !uid) throw new Error('A signed-in farm is required');
  const scope = encodeURIComponent(projectId) + ':' + encodeURIComponent(uid);
  return Object.fromEntries(['storageKey','threadKey','contKey','lastKey'].map(key => [key, `${options[key]}:${scope}`]));
}
export function requestHistory(history, currentPrompt) {
  const messages = (Array.isArray(history) ? history : [])
    .filter(message => message && !message.failed && ['user','assistant'].includes(message.role) && typeof message.text === 'string' && !message.text.startsWith('[[FV_PDF]]:'))
    .slice(-13).map(message => ({ role:message.role, content:message.text.slice(0,3000) }));
  if (messages.at(-1)?.role === 'user' && messages.at(-1).content === currentPrompt) messages.pop();
  return messages.slice(-12);
}
const allowedPaths = new Set([
  '/pages/setup/company-details.html',
  '/pages/grain/grain-contracts.html', '/pages/grain/grain-bags.html',
  '/pages/setup/grain-bin-sites.html', '/pages/setup/fields.html',
  '/pages/setup/farms.html', '/pages/equipment/index.html', '/pages/setup/rtk-tower-information.html'
]);
export function safeSources(sources) {
  const seen = new Set();
  return (Array.isArray(sources) ? sources : []).filter(source => {
    if (!source || !allowedPaths.has(source.path) || seen.has(source.path)) return false;
    seen.add(source.path); return true;
  }).slice(0,9).map(source => ({ path:source.path, label:String(source.label || 'farm records').slice(0,80) }));
}

export function readProof(meta) {
  if(meta?.dataMode!=='live' || !(meta.successfulReads>0))return null;
  const sources=Array.isArray(meta.sources)?meta.sources:[];
  const deere=sources.filter(s=>s?.system==='john_deere'||/^John Deere\b/.test(s?.label||''));
  const farm=sources.some(s=>s?.system==='farmvista'||allowedPaths.has(s?.path)&&!deere.includes(s));
  const when=new Date(meta.asOf),time=Number.isFinite(when.getTime())?' '+when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
  const source=deere.length?(farm?'John Deere + FarmVista':'John Deere'):farm?'FarmVista':'Farm records';
  const clean=value=>String(value||'').replace(/[\u0000-\u001f]/g,' ').slice(0,80);
  const count=value=>Number.isInteger(value)&&value>=0?value:null;
  const detail=deere.filter(s=>s.coverage).map(s=>{
    const c=s.coverage,fields=count(c.fieldsChecked),ops=count(c.operationsChecked);
    const breakdowns=count(c.breakdownsChecked),q=s.query||{};
    const filters=[q.field?'Field: '+clean(q.field):null,q.cropSeason?'Season: '+clean(q.cropSeason):null,
      q.crop?'Crop: '+clean(q.crop):null,q.variety?'Variety: '+clean(q.variety):null,q.product?'Product: '+clean(q.product):null,
      q.startDate||q.endDate?'Dates: '+clean(q.startDate||'unbounded')+' to '+clean(q.endDate||'unbounded'):null].filter(Boolean);
    return [clean(s.organization?.name),clean(s.dataset),fields!==null?fields+' fields':null,ops!==null?ops+' operations':null,
      c.completeMatchList===true?'scope fully checked':'incomplete search',
      breakdowns!==null?breakdowns+' breakdowns checked':null,count(c.filteredByCrop)>0?c.filteredByCrop+' excluded by crop':null,
      count(c.filteredByDates)>0?c.filteredByDates+' outside dates':null].filter(Boolean).join(' · ')+(filters.length?'\n'+filters.join(' · '):'');
  });
  return source+' checked'+time+(detail.length?'\n'+[...new Set(detail)].join('\n'):'');
}
