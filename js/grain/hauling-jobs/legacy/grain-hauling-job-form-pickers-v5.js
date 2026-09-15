// FarmVista — Hauling Job field-local pickers v5
// Reads the same Firestore collections used by grain-hauling-jobs-core directly.
// No legacy popup is used for normal selection.

import {
  ready,
  getFirestore,
  collection,
  getDocs
} from '/js/core/firebase/firebase-init.js';

await ready;
const db = getFirestore();

const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();

const CONFIG = {
  buyer:    { id:'hauling-job-buyer',    placeholder:'Select buyer',    addLabel:'+ Add New Buyer' },
  location: { id:'hauling-job-location', placeholder:'Select location', addLabel:'+ Add New Location' },
  customer: { id:'hauling-job-customer', placeholder:'Select customer', addLabel:'+ Add New Sold Under' },
  crop:     { id:'hauling-job-crop',     placeholder:'Select crop',     addLabel:'' }
};

const cache = { buyers:[], locations:[], customers:[] };
const state = new Map();
let modalObserver = null;
let loadingPromise = null;

function installStyles(){
  if(document.getElementById('fv-hauling-local-picker-style-v5')) return;
  const style=document.createElement('style');
  style.id='fv-hauling-local-picker-style-v5';
  style.textContent=`
    #hauling-job-modal .fv-combo[data-fv-hauling-legacy-combo="1"]{display:none!important}
    #hauling-job-modal .hj5-picker{position:relative!important;width:100%!important;min-width:0!important;overflow:visible!important}
    #hauling-job-modal .hj5-button{width:100%!important;min-height:46px;display:flex;align-items:center;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box!important;background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important}
    #hauling-job-modal .hj5-button:disabled{opacity:.55;cursor:not-allowed}
    #hauling-job-modal .hj5-menu{position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;z-index:30000!important;display:none;width:100%!important;max-height:min(390px,48dvh);overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);padding:0;margin:0!important;box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #hauling-job-modal .hj5-menu.open{display:block}
    #hauling-job-modal .hj5-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
    #hauling-job-modal .hj5-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
    #hauling-job-modal .hj5-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
    #hauling-job-modal .hj5-choice:hover,#hauling-job-modal .hj5-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
    #hauling-job-modal .hj5-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}
    html.dark #hauling-job-modal .hj5-button,html.dark #hauling-job-modal .hj5-menu,html.dark #hauling-job-modal .hj5-search-wrap,html.dark #hauling-job-modal .hj5-search,html.dark #hauling-job-modal .hj5-choice,html[data-theme="dark"] #hauling-job-modal .hj5-button,html[data-theme="dark"] #hauling-job-modal .hj5-menu,html[data-theme="dark"] #hauling-job-modal .hj5-search-wrap,html[data-theme="dark"] #hauling-job-modal .hj5-search,html[data-theme="dark"] #hauling-job-modal .hj5-choice{background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important}
  `;
  document.head.appendChild(style);
}

function displayName(data, fallback=''){
  return clean(data?.name || data?.customerName || data?.buyerName || data?.locationName || data?.companyName || data?.displayName || fallback);
}

async function loadData(force=false){
  if(loadingPromise && !force) return loadingPromise;
  loadingPromise=(async()=>{
    const [b,l,c]=await Promise.all([
      getDocs(collection(db,'grain_buyers')),
      getDocs(collection(db,'grain_delivery_locations')),
      getDocs(collection(db,'grain_customers'))
    ]);
    cache.buyers=b.docs.map(d=>({id:d.id,...d.data()})).filter(x=>displayName(x)).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
    cache.locations=l.docs.map(d=>({id:d.id,...d.data()})).filter(x=>displayName(x)).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
    cache.customers=c.docs.map(d=>({id:d.id,...d.data()})).filter(x=>displayName(x)).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
  })().catch(err=>console.warn('[Hauling Job Picker] data load failed',err));
  return loadingPromise;
}

function closeAll(except=null){
  state.forEach(e=>{ if(e!==except){e.menu.classList.remove('open');e.button.setAttribute('aria-expanded','false');} });
}

function ensureSelectOption(select,value,label){
  let option=Array.from(select.options||[]).find(o=>String(o.value)===String(value));
  if(!option){ option=document.createElement('option'); option.value=value; option.textContent=label; select.appendChild(option); }
  return option;
}

function setSelectValue(entry,value,label){
  const {select}=entry;
  ensureSelectOption(select,value,label);
  select.value=value;
  select.dispatchEvent(new Event('change',{bubbles:true}));
  syncEntry(entry);
  setTimeout(syncAll,25);
  setTimeout(syncAll,100);
}

function choicesFor(key){
  if(key==='buyer') return cache.buyers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='customer') return cache.customers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='crop') return [{value:'Corn',label:'Corn'},{value:'Soybeans',label:'Soybeans'}];
  if(key==='location'){
    const buyerId=clean(document.getElementById(CONFIG.buyer.id)?.value);
    return cache.locations
      .filter(x=>!buyerId || clean(x.buyerId||x.grainBuyerId)===buyerId)
      .map(x=>({value:x.id,label:displayName(x)}));
  }
  return [];
}

function triggerAdd(entry){
  const legacy=entry.select.closest('.fv-combo');
  const sourceButton=legacy?.querySelector('.fv-buttonish');
  if(!sourceButton || !entry.config.addLabel) return;
  sourceButton.click();
  const clickAdd=()=>{
    const panels=Array.from(document.querySelectorAll('.fv-panel.show'));
    const panel=panels[panels.length-1];
    const target=Array.from(panel?.querySelectorAll?.('.fv-item')||[]).find(i=>clean(i.textContent)===entry.config.addLabel);
    if(target){ target.click(); return true; }
    return false;
  };
  if(!clickAdd()){ setTimeout(clickAdd,0); setTimeout(clickAdd,50); }
}

function render(entry){
  const query=norm(entry.search?.value);
  entry.menu.querySelectorAll('.hj5-choice,.hj5-empty').forEach(n=>n.remove());
  if(entry.config.addLabel){
    const add=document.createElement('button'); add.type='button'; add.className='hj5-choice'; add.textContent=entry.config.addLabel;
    add.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();entry.menu.classList.remove('open');triggerAdd(entry);});
    entry.menu.appendChild(add);
  }
  const rows=choicesFor(entry.key).filter(x=>!query||norm(x.label).includes(query));
  rows.forEach(row=>{
    const b=document.createElement('button'); b.type='button'; b.className='hj5-choice'; b.textContent=row.label;
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setSelectValue(entry,row.value,row.label);entry.menu.classList.remove('open');entry.button.setAttribute('aria-expanded','false');});
    entry.menu.appendChild(b);
  });
  if(!rows.length){ const empty=document.createElement('div'); empty.className='hj5-empty'; empty.textContent='No options found.'; entry.menu.appendChild(empty); }
}

function syncEntry(entry){
  const selected=entry.select.options?.[entry.select.selectedIndex];
  entry.button.textContent=clean(selected?.textContent)||entry.config.placeholder;
  entry.button.disabled=!!entry.select.disabled;
}
function syncAll(){state.forEach(syncEntry)}

function enhance(key,config){
  const select=document.getElementById(config.id); if(!select) return;
  const legacy=select.closest('.fv-combo'); if(legacy) legacy.dataset.fvHaulingLegacyCombo='1';
  if(state.has(config.id)){syncEntry(state.get(config.id));return;}
  const field=select.closest('.field')||select.parentElement; if(!field) return;
  const picker=document.createElement('div'); picker.className='hj5-picker';
  const button=document.createElement('button'); button.type='button'; button.className='hj5-button'; button.setAttribute('aria-haspopup','listbox'); button.setAttribute('aria-expanded','false');
  const menu=document.createElement('div'); menu.className='hj5-menu'; menu.setAttribute('role','listbox');
  let search=null;
  if(key!=='crop'){
    const wrap=document.createElement('div'); wrap.className='hj5-search-wrap';
    search=document.createElement('input'); search.type='search'; search.className='hj5-search'; search.placeholder='Search'; search.autocomplete='off';
    wrap.appendChild(search); menu.appendChild(wrap);
  }
  picker.append(button,menu); field.appendChild(picker);
  const entry={key,config,select,button,menu,search}; state.set(config.id,entry);
  button.addEventListener('click',async e=>{
    e.preventDefault();e.stopPropagation();if(button.disabled)return;
    const opening=!menu.classList.contains('open'); closeAll(entry); menu.classList.toggle('open',opening); button.setAttribute('aria-expanded',opening?'true':'false');
    if(!opening)return; if(search)search.value=''; await loadData(); render(entry);
  });
  search?.addEventListener('input',()=>render(entry)); search?.addEventListener('click',e=>e.stopPropagation());
  select.addEventListener('change',()=>{syncEntry(entry); if(key==='buyer'){const loc=state.get(CONFIG.location.id); if(loc&&loc.menu.classList.contains('open')) render(loc);} });
  syncEntry(entry);
}

function enhanceAll(){Object.entries(CONFIG).forEach(([k,c])=>enhance(k,c));syncAll();}
function init(){
  installStyles(); enhanceAll(); loadData();
  const modal=document.getElementById('hauling-job-modal');
  if(modal&&!modalObserver){modalObserver=new MutationObserver(()=>{if(modal.classList.contains('open')){enhanceAll();loadData(true).then(syncAll);}else closeAll();});modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});}
  document.addEventListener('click',e=>{if(!e.target.closest?.('.hj5-picker')) closeAll();},true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
