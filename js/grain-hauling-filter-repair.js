/* FarmVista — hauling ticket DND filter/matching repair — Sept. 15, 2026
   Matching Jobs must mean ALL jobs matching the current Buyer / Sold Under / Crop,
   including brand-new jobs with zero tickets. Also rebuild filter choices from the
   hauling jobs themselves so All Buyers / Sold Under / Crop are never empty shells.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_FILTER_REPAIR_20260915_V1) return;
  window.__FV_HAULING_FILTER_REPAIR_20260915_V1 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const cropKey=v=>{const k=norm(v);if(k==='yellowcorn'||k==='corn')return'corn';if(['soy','soybean','soybeans','beans','yellowsoybeans'].includes(k))return'soybeans';return k};
  let F,db,timer=0,running=false;

  function label(job,type){
    if(type==='buyer')return clean(job?.buyerName||job?.buyer||job?.grainBuyerName);
    if(type==='sold')return clean(job?.customerName||job?.soldUnderName||job?.soldUnder||job?.customer);
    return clean(job?.crop||job?.commodity||job?.cropName||job?.cropType);
  }
  function unique(jobs,type){const m=new Map();jobs.forEach(j=>{const text=label(j,type);const key=type==='crop'?cropKey(text):norm(text);if(text&&key&&!m.has(key))m.set(key,text)});return [...m.values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}))}
  function voided(j){const s=clean(j?.status).toLowerCase();return j?.voided===true||s.includes('void')||s.includes('cancel')||s.includes('closed')}
  function fill(select,values,allLabel){if(!select)return;const old=clean(select.value),oldKey=select.id.includes('crop')?cropKey(old):norm(old);select.innerHTML='';const all=document.createElement('option');all.value='';all.textContent=allLabel;select.appendChild(all);values.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;select.appendChild(o)});const found=[...select.options].find(o=>(select.id.includes('crop')?cropKey(o.value):norm(o.value))===oldKey);select.value=found?.value||'';select.disabled=false}

  async function run(){
    if(running)return;running=true;
    try{
      F=F||await import('/js/firebase-init.js');await F.ready;db=db||F.getFirestore();
      const snap=await F.getDocs(F.collection(db,'grain_hauling_jobs'));
      const jobs=snap.docs.map(s=>({id:s.id,...s.data()})).filter(j=>!voided(j));
      const buyer=document.getElementById('fv-ticket-filter-buyer');
      const sold=document.getElementById('fv-ticket-filter-sold-under');
      const crop=document.getElementById('fv-ticket-filter-crop');
      fill(buyer,unique(jobs,'buyer'),'All Buyers');
      const buyerValue=clean(buyer?.value);
      const buyerJobs=buyerValue?jobs.filter(j=>norm(label(j,'buyer'))===norm(buyerValue)):jobs;
      fill(sold,unique(buyerJobs,'sold'),'All Sold Under');
      const soldValue=clean(sold?.value);
      const soldJobs=soldValue?buyerJobs.filter(j=>norm(label(j,'sold'))===norm(soldValue)):buyerJobs;
      fill(crop,unique(soldJobs,'crop'),'All Crops');

      const mode=document.getElementById('fv-ticket-job-status-filter')?.value||'matching';
      const message=document.getElementById('fv-ticket-hauling-message');
      if(message&&mode==='matching'){
        const filters=[buyer?.value,sold?.value,crop?.value].map(clean).filter(Boolean);
        message.textContent=filters.length
          ? `Showing hauling jobs matching ${filters.join(' • ')}. New jobs are included even when they do not have tickets yet.`
          : 'Showing all matching hauling jobs, including new jobs with zero tickets. Use Buyer, Sold Under, and Crop to narrow the list.';
        message.classList.add('ready');
      }
    }catch(e){console.warn('[FarmVista] hauling filter repair failed:',e)}finally{running=false}
  }
  function schedule(ms=120){clearTimeout(timer);timer=setTimeout(run,ms)}
  document.addEventListener('change',e=>{if(['fv-ticket-filter-buyer','fv-ticket-filter-sold-under'].includes(e.target?.id))schedule(20)},true);
  document.addEventListener('click',e=>{if(e.target.closest?.('#fv-refresh-ticket-hauling,#refresh-hauling-link-btn'))schedule(250)},true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>schedule(250),{once:true});else schedule(250);
})();
