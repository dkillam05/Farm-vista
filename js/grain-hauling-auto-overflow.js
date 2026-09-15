/* FarmVista — automatic hauling-job overflow routing — Sept. 15, 2026
   When a ticket finishes one hauling job, carry the remainder forward through
   the next eligible SAME destination + crop + Sold Under jobs before Spot.
   Manual cross-entity moves remain separate and require acknowledgement.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_AUTO_OVERFLOW_20260915_V1) return;
  window.__FV_HAULING_AUTO_OVERFLOW_20260915_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const num=v=>{const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
  const r2=v=>Number(num(v).toFixed(2));
  const EPS=.005;
  let F,db,running=false,timer=null;

  const crop=v=>{const k=norm(v);if(k==='corn'||k==='yellowcorn')return'corn';if(['soy','soybean','soybeans','beans','yellowsoybeans'].includes(k))return'soybeans';return k};
  const match=(ai,an,bi,bn)=>ai&&bi?clean(ai)===clean(bi):an&&bn?norm(an)===norm(bn):true;
  const tBuyerId=t=>clean(t?.buyerId||t?.grainBuyerId||t?.destinationBuyerId), tBuyer=t=>clean(t?.buyerName||t?.destinationBuyerName||t?.elevatorName);
  const tLocId=t=>clean(t?.deliveryLocationId||t?.locationId||t?.destinationId), tLoc=t=>clean(t?.deliveryLocationName||t?.locationName||t?.destinationName||t?.destination||t?.elevator);
  const tEntityId=t=>clean(t?.customerId||t?.soldUnderId||t?.customerAccountId), tEntity=t=>clean(t?.customerName||t?.soldUnderName||t?.soldUnder||t?.customer);
  const tCrop=t=>clean(t?.crop||t?.commodity||t?.grain||t?.cropName), tDate=t=>t?.ticketDate??t?.date??t?.deliveryDate;
  const jBuyerId=j=>clean(j?.buyerId||j?.grainBuyerId), jBuyer=j=>clean(j?.buyerName||j?.buyer||j?.grainBuyerName);
  const jLocId=j=>clean(j?.deliveryLocationId||j?.locationId||j?.destinationId), jLoc=j=>clean(j?.deliveryLocationName||j?.locationName||j?.destinationName||j?.destination);
  const jEntityId=j=>clean(j?.customerId||j?.soldUnderId||j?.customerAccountId), jEntity=j=>clean(j?.customerName||j?.soldUnderName||j?.soldUnder||j?.customer);
  const jCrop=j=>clean(j?.crop||j?.commodity||j?.cropName||j?.cropType);
  const target=j=>Math.max(0,r2(j?.startingBushels??j?.jobBushels??j?.bushels));
  const total=t=>Math.max(0,r2(t?.netBushels??t?.netBu??t?.bushels));
  const voided=x=>x?.voided===true||clean(x?.status).toLowerCase().includes('void');
  function date(v){if(!v)return null;if(typeof v?.toDate==='function')return v.toDate();if(typeof v?.seconds==='number')return new Date(v.seconds*1000);const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?`${clean(v)}T12:00:00`:v);return isNaN(d)?null:d}
  const day=d=>d?new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime():null;
  function eligible(t,j){
    if(voided(j))return false;
    if(!match(tBuyerId(t),tBuyer(t),jBuyerId(j),jBuyer(j)))return false;
    if(!match(tLocId(t),tLoc(t),jLocId(j),jLoc(j)))return false;
    if(crop(tCrop(t))&&crop(jCrop(j))&&crop(tCrop(t))!==crop(jCrop(j)))return false;
    if(!match(tEntityId(t),tEntity(t),jEntityId(j),jEntity(j)))return false;
    const td=day(date(tDate(t))), s=day(date(j?.startDate||j?.deliveryStartDate||j?.beginDate)), e=day(date(j?.endDate||j?.deliveryEndDate||j?.expirationDate));
    return td==null||!((s!=null&&td<s)||(e!=null&&td>e));
  }
  function allocs(t){return(Array.isArray(t?.haulingJobSplitAllocations)?t.haulingJobSplitAllocations:[]).map((a,i)=>({id:clean(a?.id)||`legacy-${i}`,sourceJobId:clean(a?.sourceJobId||t?.haulingJobId),haulingJobId:clean(a?.haulingJobId||a?.jobId),bushels:r2(a?.bushels),allocationType:clean(a?.allocationType||a?.type||'job').toLowerCase(),source:clean(a?.source),createdAt:clean(a?.createdAt)})).filter(a=>a.bushels>EPS)}
  function usedByJob(jobId,tickets){let n=0;tickets.forEach(t=>{if(voided(t))return;if(clean(t?.haulingJobId)===jobId){const carved=allocs(t).filter(a=>a.sourceJobId===jobId&&(a.allocationType==='unassigned'||a.allocationType==='spot'||(a.haulingJobId&&a.haulingJobId!==jobId))).reduce((s,a)=>s+a.bushels,0);n+=Math.max(0,total(t)-carved)}allocs(t).forEach(a=>{if(a.allocationType!=='unassigned'&&a.haulingJobId===jobId&&a.haulingJobId!==clean(t?.haulingJobId))n+=a.bushels})});return r2(n)}
  function jobOrder(a,b){const da=day(date(a?.startDate||a?.deliveryStartDate))??0,dbb=day(date(b?.startDate||b?.deliveryStartDate))??0;return da-dbb||clean(a.id).localeCompare(clean(b.id),undefined,{numeric:true})}

  async function run(){
    if(running)return;running=true;
    try{
      F=F||await import('/js/firebase-init.js');await F.ready;db=db||F.getFirestore();
      const [ts,js]=await Promise.all([F.getDocs(F.collection(db,'grain_tickets')),F.getDocs(F.collection(db,'grain_hauling_jobs'))]);
      const tickets=ts.docs.map(s=>({id:s.id,...s.data()})), jobs=js.docs.map(s=>({id:s.id,...s.data()}));
      for(const t of tickets){
        if(voided(t)||!clean(t?.haulingJobId))continue;
        let aa=allocs(t), changed=false;
        // Only auto-route portions that the classifier currently regards as Spot on the source job.
        // Existing explicit manual spot allocations are intentionally left alone.
        if(aa.some(a=>a.source==='manual_split_dnd'&&a.allocationType==='spot'))continue;
        const source=jobs.find(j=>j.id===clean(t.haulingJobId));if(!source)continue;
        const sourceUsed=usedByJob(source.id,tickets);
        const overflow=Math.max(0,r2(sourceUsed-target(source)));
        if(overflow<=EPS)continue;
        let remaining=Math.min(overflow,total(t));
        const candidates=jobs.filter(j=>j.id!==source.id&&eligible(t,j)&&Math.max(0,r2(target(j)-usedByJob(j.id,tickets)))>EPS).sort(jobOrder);
        for(const j of candidates){if(remaining<=EPS)break;const room=Math.max(0,r2(target(j)-usedByJob(j.id,tickets)));const take=Math.min(remaining,room);if(take<=EPS)continue;aa.push({id:`auto-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,sourceJobId:source.id,haulingJobId:j.id,bushels:r2(take),allocationType:'job',source:'automatic_overflow',createdAt:new Date().toISOString()});remaining=r2(remaining-take);changed=true}
        if(changed){await F.updateDoc(F.doc(db,'grain_tickets',t.id),{haulingJobSplitAllocations:aa,haulingJobSplitUpdatedAt:F.serverTimestamp(),haulingJobAutomaticOverflowAt:F.serverTimestamp(),updatedAt:F.serverTimestamp()});break}
      }
      if(document.getElementById('fv-refresh-ticket-hauling'))document.getElementById('fv-refresh-ticket-hauling').click();
    }catch(e){console.warn('[FarmVista] automatic hauling overflow failed:',e)}finally{running=false}
  }
  function schedule(ms=350){clearTimeout(timer);timer=setTimeout(run,ms)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(500),{once:true});else schedule(500);
  document.addEventListener('click',e=>{if(e.target.closest?.('#fv-refresh-ticket-hauling,#refresh-hauling-link-btn'))schedule(700)},true);
})();
