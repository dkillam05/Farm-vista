import {ready,getFirestore,collection,getDocs,doc,getDoc} from '/js/firebase/firebase-init.js';
import {ticketSummary} from './grain-ticket-summary.js';
import {gradeAlertClass} from '../../grain/operations/core/grain-validation.js';
const $ = id => document.getElementById(id);
const allowed = () => Boolean(window.FV_DASH_CAN?.('cap-kpi-grain','view') && window.FV_DASH_CAN?.('grain-tix','view'));
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const crop = t => /soy|bean/i.test(t.crop || t.commodity) ? 'Soybeans' : /corn/i.test(t.crop || t.commodity) ? 'Corn' : (t.crop || t.commodity || 'Unknown crop');
const labels = {review:'Review',warning:'Warning',needs_job:'Needs hauling job',good:'Good'};
let alertSettings=null, alertSettingsFailed=false;
let tickets=null, jobs=null, loading=false, generation=0, identity='', failed=false, mode='today', selectedCrop='';
const dialog=document.createElement('dialog');
dialog.className='grain-kpi-dialog';
dialog.setAttribute('aria-labelledby','grain-kpi-heading');
dialog.innerHTML='<header><h2 id="grain-kpi-heading"></h2><button type="button" data-close aria-label="Close ticket list">Close</button></header><p data-summary></p><nav data-crops aria-label="Filter tickets by crop"></nav><div data-list></div>';
document.body.append(dialog);
dialog.querySelector('[data-close]').onclick=()=>dialog.close();
dialog.addEventListener('click',event=>{const button=event.target.closest('[data-crop]');if(button){selectedCrop=button.dataset.crop;renderDialog();}});
dialog.addEventListener('click',event=>{const row=event.target.closest('[data-ticket-href]');if(row&&!event.target.closest('a'))location.assign(row.dataset.ticketHref);});
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
  const visible=rows.filter(t=>!selectedCrop||crop(t)===selectedCrop);
  const grade=(t,keys,metric)=>{
    const raw=keys.map(k=>t[k]).find(v=>v!==null&&v!==undefined&&String(v).trim()!=='');
    const n=raw===undefined?NaN:Number(String(raw).replace(/[, %]/g,''));
    const cls=Number.isFinite(n)&&metric?gradeAlertClass({...t,[keys[0]]:n},alertSettings,metric):'';
    return `<span class="grain-grade ${cls}" title="${cls==='severe'?'Severe':cls==='warn'?'Elevated':''}">${Number.isFinite(n)?n.toFixed(1).padStart(4,'0'):'—'}</span>`;
  };
  list.innerHTML=(alertSettingsFailed?'<p>Grade highlighting unavailable — alert settings could not be loaded.</p>':'')+(visible.length?`<p class="grain-kpi-hint">Tap a ticket to open its details.</p><div class="grain-kpi-table-wrap"><table class="grain-kpi-table"><thead><tr><th>Ticket / Date</th><th>Crop</th><th>Destination</th><th>Sold Under / Driver</th><th>Net bu</th><th>TW</th><th>MO</th><th>FM</th><th>DM</th><th>Status</th></tr></thead><tbody>${visible.map(t=>{
    const raw=t.netBushels??t.netBu;
    const bu=raw===null||raw===undefined||String(raw).trim()===''?NaN:Number(String(raw).replace(/,/g,''));
    const href=`/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(t.id)}`;
    const reasons=t.dashboardStatus!=='good'?(t.dashboardReasons||[]):[];
    return `<tr data-ticket-href="${esc(href)}"><td><a href="${esc(href)}">${esc(t.ticketNumber||'—')}</a><small>${esc(t.ticketDate||'Date unavailable')}</small></td><td>${esc(crop(t))}</td><td>${esc(t.deliveryLocationName||t.destinationName||t.buyerName||t.ocrElevatorName||'Unknown')}</td><td>${esc(t.customerName||t.soldUnderName||'—')}<small>${esc(t.driverName||'—')}</small></td><td class="number">${Number.isFinite(bu)?bu.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}</td><td>${grade(t,['testWeight','tw','TW'])}</td><td>${grade(t,['moisture','mo','MO'],'mo')}</td><td>${grade(t,['foreignMaterial','fm','FM'],'fm')}</td><td>${grade(t,['damage','dm','DM'],'damage')}</td><td><span class="grain-ticket-state ${esc(t.dashboardStatus)}">${labels[t.dashboardStatus]}</span></td></tr>${reasons.length?`<tr class="grain-kpi-reason" data-ticket-href="${esc(href)}"><td colspan="10"><a href="${esc(href)}"><strong>Needs attention:</strong> ${reasons.map(esc).join(' · ')} <span>Open ticket →</span></a></td></tr>`:''}`;
  }).join('')}</tbody></table></div>`:'<p>No tickets in this view.</p>');

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
function stop(){generation++;loading=false;identity='';tickets=null;jobs=null;alertSettings=null;alertSettingsFailed=false;failed=false;if(dialog.open)dialog.close();}
async function sync(refresh=false){
  if(!allowed()){stop();return;}
  const key=`${window.FVUserContext?.get?.()?.uid||''}:${window.FV_FARM_KEY||''}`;
  if(identity===key && (loading || refresh!==true))return;
  if(identity!==key){stop();identity=key;}
  loading=true;failed=false;const request=generation;render();
  try{
    await ready;if(request!==generation||!allowed())return;
    const db=getFirestore();
    const [snapshots,settingsResult]=await Promise.all([Promise.all(['grain_tickets','grain_hauling_jobs'].map(name=>getDocs(collection(db,name)))),getDoc(doc(db,'settings','grainTicketAlerts')).then(s=>({settings:s.exists()?s.data():null})).catch(()=>({failed:true}))]);
    if(request!==generation||!allowed())return;
    alertSettings=settingsResult.settings||null;alertSettingsFailed=!!settingsResult.failed;
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
