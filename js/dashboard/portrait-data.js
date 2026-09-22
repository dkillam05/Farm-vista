import {ready,getFirestore,collection,getDocs} from '/js/firebase/firebase-init.js';
import {grainSummary} from './grain-summary.js';
const $ = id => document.getElementById(id);
const grain = $('portrait-grain'), hauling = $('portrait-hauling'), list = $('portrait-hauling-list'), toggle = $('hauling-toggle');
const grainToggle = $('grain-overview-toggle'), bagGrid = $('portrait-grain-bags');
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value.toLocaleString('en-US',{maximumFractionDigits:2});
let jobs = null, tickets = null, bagEvents = null, failed = false, expanded = false, grainExpanded = false, generation = 0, identity = '', loading = false;
const canView = () => Boolean(window.FV_DASH_CAN?.('cap-kpi-grain','view') && window.FV_DASH_CAN?.('grain-ctr','view'));
const snapshotKey = key => `fv:dashboard:grain-snapshot:${key || 'device'}`;
const valueDateMs = value => {
  try { if (value?.toDate) return value.toDate().getTime(); } catch {}
  if (typeof value?.seconds === 'number') return value.seconds*1000;
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
};
function loadSnapshot(key){
  try {
    const saved=JSON.parse(localStorage.getItem(snapshotKey(key))||'null');
    if(!saved||saved.version!==1||!Array.isArray(saved.jobs)||!Array.isArray(saved.tickets)||!Array.isArray(saved.bagEvents))return false;
    jobs=saved.jobs;tickets=saved.tickets;bagEvents=saved.bagEvents;return true;
  } catch { return false; }
}
function saveSnapshot(key){
  try {
    const savedJobs=(jobs||[]).map(row=>({
      id:row.id,startingBushels:row.startingBushels,jobBushels:row.jobBushels,bushels:row.bushels,
      deliveryStartDate:row.deliveryStartDate,startDate:row.startDate,deliveryEndDate:row.deliveryEndDate,endDate:row.endDate,
      status:row.status,manualClosed:row.manualClosed,active:row.active,crop:row.crop,commodity:row.commodity,cropName:row.cropName,cropType:row.cropType,
      buyerName:row.buyerName,buyer:row.buyer,deliveryLocationName:row.deliveryLocationName,locationName:row.locationName,
      destinationName:row.destinationName,destination:row.destination,displayName:row.displayName,jobName:row.jobName,haulingJobName:row.haulingJobName
    }));
    const savedTickets=(tickets||[]).map(row=>({
      id:row.id,voided:row.voided,status:row.status,haulingJobId:row.haulingJobId,
      netBushels:row.netBushels,netBu:row.netBu,bushels:row.bushels,
      haulingJobSplitAllocations:Array.isArray(row.haulingJobSplitAllocations)?row.haulingJobSplitAllocations.map(item=>({
        sourceJobId:item.sourceJobId,haulingJobId:item.haulingJobId,jobId:item.jobId,allocationType:item.allocationType,type:item.type,bushels:item.bushels
      })):[]
    }));
    const savedBags=(bagEvents||[]).map(row=>({
      id:row.id,type:row.type,status:row.status,cropYear:row.cropYear,cropType:row.cropType,crop:row.crop,
      counts:row.counts?{full:row.counts.full,partial:row.counts.partial,partialFeet:row.counts.partialFeet}:null,
      partialFeet:row.partialFeet,_placedMs:valueDateMs(row.datePlaced||row.placedDate||row.createdAt)||row._placedMs||0
    }));
    localStorage.setItem(snapshotKey(key),JSON.stringify({version:1,savedAt:Date.now(),jobs:savedJobs,tickets:savedTickets,bagEvents:savedBags}));
  } catch(error){console.warn('[dashboard] Grain snapshot could not be saved',error);}
}
function render() {
  if (!canView()) return;
  if (failed || !jobs || !tickets) {
    $('portrait-grain-totals').textContent = failed ? 'Grain totals are unavailable. Open the hauling workspace to check records.' : 'Loading remaining bushels…';
    list.textContent = failed ? 'Hauling jobs could not be loaded.' : 'Loading hauling jobs…';
    toggle.hidden = true;
    return;
  }
  const summary = grainSummary(jobs,tickets);
  $('portrait-grain-totals').innerHTML = Object.entries(summary.totals).map(([crop,total])=>`<a class="portrait-grain-tile" href="pages/grain/grain-contracts.html?dashboardCrop=${encodeURIComponent(crop)}"><span>${crop === 'Corn' ? '🌽' : '🌱'} ${esc(crop)} remaining</span><strong>${fmt(total)} <small>bu</small></strong><small>View hauling jobs →</small></a>`).join('');
  const seasonYear = (()=>{const now=new Date();return now.getMonth()>=7?now.getFullYear():now.getFullYear()-1;})();
  const cropBags = new Map();
  (bagEvents || []).forEach(row=>{
    const type=String(row.type||'').toLowerCase().replace(/\s+/g,'');
    const status=String(row.status||'').toLowerCase().replace(/\s+/g,'');
    const placed=row.datePlaced?.toDate?.() || row.placedDate?.toDate?.() || row.createdAt?.toDate?.() || (row._placedMs ? new Date(row._placedMs) : null);
    const rowYear=Number(row.cropYear) || (placed ? (placed.getMonth()>=7?placed.getFullYear():placed.getFullYear()-1) : 0);
    if(type!=='putdown' || status==='pickedup' || rowYear!==seasonYear) return;
    const full=Math.max(0,Number(row.counts?.full)||0);
    let partial=Math.max(0,Number(row.counts?.partial)||0);
    const feet=row.partialFeet ?? row.counts?.partialFeet;
    const footTotal=Array.isArray(feet)?feet.reduce((sum,n)=>sum+(Number(n)||0),0):(Number(feet)||0);
    if(partial===0 && footTotal>0) partial=1;
    const count=full+partial;
    if(count<=0) return;
    const raw=String(row.cropType||row.crop||'Unknown').trim();
    const crop=raw ? raw.charAt(0).toUpperCase()+raw.slice(1).toLowerCase() : 'Unknown';
    cropBags.set(crop,(cropBags.get(crop)||0)+count);
  });
  bagGrid.innerHTML=[...cropBags.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([crop,count])=>`<a class="portrait-bag-tile" href="/pages/grain/grain-bags.html"><span>${crop === 'Corn' ? '🌽' : '🌱'} ${esc(crop)} bags</span><strong>${fmt(count)}</strong><small>Open grain bag inventory →</small></a>`).join('') || '<p class="portrait-note">No grain bags are currently down.</p>';
  grainToggle.hidden = false;
  grainToggle.textContent = grainExpanded ? 'View less' : 'View more';
  grainToggle.setAttribute('aria-expanded',String(grainExpanded));
  grain.classList.toggle('is-expanded',grainExpanded);
  const shown = expanded ? summary.rows : summary.rows.slice(0,2);
  let group = '';
  list.innerHTML = shown.map(row=>{
    const heading = row.status !== group && row.status !== 'active' ? `<h3 class="portrait-job-group">${row.status === 'upcoming' ? 'Upcoming jobs' : 'Past due'}</h3>` : '';
    group = row.status;
    const state = row.status === 'active' ? 'Active' : row.status === 'upcoming' ? 'Upcoming' : 'Past due';
    return `${heading}<a class="portrait-job" href="pages/grain/grain-contracts.html?dashboardJob=${encodeURIComponent(row.id)}"><div class="portrait-job-title"><strong>${esc(row.title)} · ${esc(row.crop)}</strong><span class="portrait-job-status ${row.status}">${state}</span></div><small>${row.spot ? `Spot loads · ${fmt(row.ticketed)} bu hauled` : `${fmt(row.remaining)} bu remaining · ${fmt(row.ticketed)} of ${fmt(row.total)} bu hauled`}</small>${row.spot ? '' : `<progress value="${Math.min(row.ticketed,row.total)}" max="${row.total}" aria-label="Hauling progress"></progress>`}${row.start || row.end ? `<small>${esc(row.start || 'Open start')} – ${esc(row.end || 'Open end')}</small>` : ''}</a>`;
  }).join('') || '<p class="portrait-note">No open hauling jobs.</p>';
  toggle.hidden = summary.rows.length <= 2;
  toggle.textContent = expanded ? 'View less' : 'View more';
  toggle.setAttribute('aria-expanded',String(expanded));
}
toggle.addEventListener('click',()=>{expanded = !expanded;render();if(!expanded && hauling.getBoundingClientRect().top < 0) hauling.scrollIntoView({block:'start'});});
grainToggle.addEventListener('click',()=>{grainExpanded=!grainExpanded;render();if(!grainExpanded && grain.getBoundingClientRect().top<0) grain.scrollIntoView({block:'start'});});
function stop(){identity='';jobs=null;tickets=null;bagEvents=null;generation++;loading=false;}
async function sync(refresh = false){
  const allowed = canView();
  grain.hidden = !allowed; hauling.hidden = !allowed;
  if (!allowed) {stop();$('portrait-grain-totals').replaceChildren();list.replaceChildren();return;}
  const context = window.FVUserContext?.get?.();
  const key = `${context?.uid || ''}:${window.FV_FARM_KEY || ''}`;
  if (identity === key && (loading || refresh !== true)) return;
  if (identity !== key) {
    stop();identity=key;
    if(loadSnapshot(key)){failed=false;render();}
  }
  failed=false;loading=true;render();
  const request=generation;
  try {
    await ready;
    if (request !== generation || !canView()) return;
    const db=getFirestore();
    const snapshots = await Promise.all([
      getDocs(collection(db,'grain_hauling_jobs')),
      getDocs(collection(db,'grain_tickets')),
      getDocs(collection(db,'grain_bag_events'))
    ]);
    if (request !== generation || !canView()) return;
    [jobs,tickets,bagEvents] = snapshots.map(snapshot=>snapshot.docs.map(doc=>({...doc.data(),id:doc.id})));
    saveSnapshot(key);
    render();
  } catch(error){if(request !== generation) return;console.warn('[dashboard] Grain overview refresh unavailable',error);failed=!(jobs&&tickets&&bagEvents);render();}
  finally {if(request === generation) loading=false;}
}
document.addEventListener('fv:dash-perms-ready',sync);
document.addEventListener('fv:user-ready',sync);
addEventListener('pagehide',stop);
addEventListener('pageshow',()=>sync(true));
addEventListener('focus',()=>sync(true));
setInterval(()=>{if(!document.hidden) sync(true);},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden) sync(true);});
sync();
