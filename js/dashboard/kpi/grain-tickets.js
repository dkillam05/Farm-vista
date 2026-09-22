import {ready,getFirestore,collection,getDocs} from '/js/firebase/firebase-init.js';
import {ticketSummary} from './grain-ticket-summary.js';
const $ = id => document.getElementById(id);
const allowed = () => Boolean(window.FV_DASH_CAN?.('cap-kpi-grain','view') && window.FV_DASH_CAN?.('grain-tix','view'));
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const crop = t => /soy|bean/i.test(t.crop || t.commodity) ? 'Soybeans' : /corn/i.test(t.crop || t.commodity) ? 'Corn' : (t.crop || t.commodity || 'Unknown crop');
const labels = {review:'Review',warning:'Warning',needs_job:'Needs hauling job',good:'Good'};
let tickets=null, jobs=null, loading=false, generation=0, identity='', failed=false, mode='today', selectedCrop='';
const dialog=document.createElement('dialog');
dialog.className='grain-kpi-dialog';
dialog.setAttribute('aria-labelledby','grain-kpi-heading');
dialog.innerHTML='<header><h2 id="grain-kpi-heading"></h2><button type="button" data-close aria-label="Close ticket list">Close</button></header><p data-summary></p><nav data-crops aria-label="Filter tickets by crop"></nav><div data-list></div>';
document.body.append(dialog);
dialog.querySelector('[data-close]').onclick=()=>dialog.close();
dialog.addEventListener('click',event=>{const button=event.target.closest('[data-crop]');if(button){selectedCrop=button.dataset.crop;renderDialog();}});
function summary(){return ticketSummary(tickets || [],jobs || []);}
function renderDialog(){
  if(!dialog.open)return;
  dialog.querySelector('h2').textContent=mode==='today' ? 'Grain loads today' : 'Tickets needing attention';
  const status=dialog.querySelector('[data-summary]'),list=dialog.querySelector('[data-list]'),nav=dialog.querySelector('[data-crops]');
  if(failed || tickets===null || jobs===null){status.textContent=failed?'Tickets could not be loaded. Close and reopen to retry.':'Loading tickets…';list.replaceChildren();nav.replaceChildren();return;}
  const rows=summary()[mode],counts=new Map();
  rows.forEach(t=>counts.set(crop(t),(counts.get(crop(t))||0)+1));
  if(selectedCrop && !counts.has(selectedCrop))selectedCrop='';
  status.textContent=`${rows.length.toLocaleString()} ${rows.length===1?'ticket':'tickets'} · ${mode==='today'?'Scanned today (Central time)':'Review, warnings, and hauling jobs to assign · all dates'}`;
  nav.innerHTML=[['',rows.length],...counts.entries()].map(([name,count])=>`<button type="button" data-crop="${esc(name)}" aria-pressed="${name===selectedCrop}">${esc(name||'All crops')} · ${count}</button>`).join('');
  list.innerHTML=rows.filter(t=>!selectedCrop||crop(t)===selectedCrop).map(t=>{
    const bu=Number(String(t.netBushels??t.netBu??'').replace(/,/g,''));
    return `<a class="grain-kpi-ticket" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(t.id)}"><div><strong>Ticket ${esc(t.ticketNumber||'—')}</strong><span class="grain-ticket-state ${esc(t.dashboardStatus)}">${labels[t.dashboardStatus]}</span></div><p>${esc(crop(t))} · ${Number.isFinite(bu)?bu.toLocaleString('en-US',{maximumFractionDigits:2}):'—'} bu · ${esc(t.ticketDate||'Date unavailable')}</p><p>${esc(t.deliveryLocationName||t.destinationName||t.buyerName||t.ocrElevatorName||'Destination unknown')}</p><small>${esc([t.customerName||t.soldUnderName,t.driverName].filter(Boolean).join(' · '))}</small></a>`;
  }).join('') || '<p>No tickets in this view.</p>';
}
function render(){
  if(!allowed())return;
  const data=summary();
  for(const [key,rows] of [['loads',data.today],['review',data.attention]]){
    const unavailable=failed||tickets===null||jobs===null;
    const text=unavailable?'–':rows.length.toLocaleString();
    if($( `grain-${key}-count`).textContent!==text)$( `grain-${key}-count`).textContent=text;
    $(`grain-${key}-sub`).textContent=failed?'Unable to load · tap to retry':unavailable?'Loading tickets…':key==='loads'?'Scanned today · view by crop →':rows.length?'Review / warnings / assignment →':'All tickets clear';
    $(`grain-${key}-kpi`).classList.toggle('has-ticket-attention',key==='review'&&!unavailable&&rows.length>0);
  }
  renderDialog();
}
function stop(){generation++;loading=false;identity='';tickets=null;jobs=null;failed=false;if(dialog.open)dialog.close();}
async function sync(refresh=false){
  if(!allowed()){stop();return;}
  const key=`${window.FVUserContext?.get?.()?.uid||''}:${window.FV_FARM_KEY||''}`;
  if(identity===key && (loading || refresh!==true))return;
  if(identity!==key){stop();identity=key;}
  loading=true;failed=false;const request=generation;render();
  try{
    await ready;if(request!==generation||!allowed())return;
    const db=getFirestore();
    const snapshots=await Promise.all(['grain_tickets','grain_hauling_jobs'].map(name=>getDocs(collection(db,name))));
    if(request!==generation||!allowed())return;
    [tickets,jobs]=snapshots.map(snapshot=>snapshot.docs.map(doc=>({...doc.data(),id:doc.id})));
    render();
  }catch(error){if(request===generation){failed=true;render();}}
  finally{if(request===generation)loading=false;}
}
for(const [key,value] of [['loads','today'],['review','attention']]){
  $(`grain-${key}-kpi`).addEventListener('click',event=>{
    if(event.defaultPrevented||!allowed())return;
    event.preventDefault();if(failed){stop();sync();}mode=value;selectedCrop='';dialog.showModal();renderDialog();
  });
}
document.addEventListener('fv:dash-perms-ready',sync);
document.addEventListener('fv:user-ready',sync);
addEventListener('pagehide',stop);
addEventListener('pageshow',sync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){sync(true);render();}});
addEventListener('focus',()=>sync(true));
setInterval(()=>{if(!document.hidden)sync(true);},30000);
sync();
