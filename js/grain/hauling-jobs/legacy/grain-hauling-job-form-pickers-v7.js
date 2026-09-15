// FarmVista — Hauling Job field-local pickers v7
// Keeps Location local even when the hauling core rebuilds the Location combo.

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
let locationObserver = null;
let loadingPromise = null;

function installStyles(){
  if(document.getElementById('fv-hauling-local-picker-style-v7')) return;
  const style=document.createElement('style');
  style.id='fv-hauling-local-picker-style-v7';
  style.textContent=`
    #hauling-job-modal .fv-combo[data-fv-hauling-legacy-combo="1"],
    #hauling-job-modal .fv-combo:has(#hauling-job-buyer),
    #hauling-job-modal .fv-combo:has(#hauling-job-location),
    #hauling-job-modal .fv-combo:has(#hauling-job-customer),
    #hauling-job-modal .fv-combo:has(#hauling-job-crop){display:none!important;pointer-events:none!important}
    #hauling-job-modal .hj7-picker{position:relative!important;width:100%!important;min-width:0!important;overflow:visible!important}
    #hauling-job-modal .hj7-button{width:100%!important;min-height:46px;display:flex;align-items:center;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box!important;background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important}
    #hauling-job-modal .hj7-button:disabled{opacity:.55;cursor:not-allowed}
    #hauling-job-modal .hj7-menu{position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;bottom:auto!important;z-index:30000!important;display:none;width:100%!important;max-width:100%!important;max-height:min(390px,48dvh);overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);padding:0;margin:0!important;box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #hauling-job-modal .hj7-menu.open{display:block!important}
    #hauling-job-modal .hj7-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
    #hauling-job-modal .hj7-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
    #hauling-job-modal .hj7-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
    #hauling-job-modal .hj7-choice:hover,#hauling-job-modal .hj7-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
    #hauling-job-modal .hj7-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}
    html.dark #hauling-job-modal .hj7-button,html.dark #hauling-job-modal .hj7-menu,html.dark #hauling-job-modal .hj7-search-wrap,html.dark #hauling-job-modal .hj7-search,html.dark #hauling-job-modal .hj7-choice,
    html[data-theme="dark"] #hauling-job-modal .hj7-button,html[data-theme="dark"] #hauling-job-modal .hj7-menu,html[data-theme="dark"] #hauling-job-modal .hj7-search-wrap,html[data-theme="dark"] #hauling-job-modal .hj7-search,html[data-theme="dark"] #hauling-job-modal .hj7-choice{background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important}
  `;
  document.head.appendChild(style);
}

function displayName(data,fallback=''){
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
  })().catch(err=>console.warn('[Hauling Job Picker v7] data load failed',err));
  return loadingPromise;
}

function closeAll(except=null){
  state.forEach(e=>{
    if(e===except) return;
    e.menu?.classList.remove('open');
    e.button?.setAttribute('aria-expanded','false');
  });
}

function forceHideLegacy(select){
  const combo=select?.closest?.('.fv-combo');
  if(!combo) return;
  combo.dataset.fvHaulingLegacyCombo='1';
  combo.style.setProperty('display','none','important');
  combo.style.setProperty('pointer-events','none','important');
}

function ensureSelectOption(select,value,label){
  let option=Array.from(select.options||[]).find(o=>String(o.value)===String(value));
  if(!option){option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
}

function choicesFor(key){
  if(key==='buyer') return cache.buyers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='customer') return cache.customers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='crop') return [{value:'Corn',label:'Corn'},{value:'Soybeans',label:'Soybeans'}];
  if(key==='location'){
    const buyerId=clean(document.getElementById(CONFIG.buyer.id)?.value);
    if(!buyerId) return [];
    return cache.locations.filter(x=>clean(x.buyerId||x.grainBuyerId)===buyerId).map(x=>({value:x.id,label:displayName(x)}));
  }
  return [];
}

function syncEntry(entry){
  if(!entry?.select?.isConnected) return;
  forceHideLegacy(entry.select);
  const selected=entry.select.options?.[entry.select.selectedIndex];
  entry.button.textContent=clean(selected?.textContent)||entry.config.placeholder;
  entry.button.disabled=entry.key==='location' ? !clean(document.getElementById(CONFIG.buyer.id)?.value) : false;
}
function syncAll(){state.forEach(syncEntry)}

function setSelectValue(entry,value,label){
  ensureSelectOption(entry.select,value,label);
  entry.select.value=value;
  entry.select.dispatchEvent(new Event('change',{bubbles:true}));
  syncEntry(entry);
  setTimeout(()=>{
    if(entry.key==='buyer') repairLocationPicker();
    syncAll();
  },0);
  setTimeout(()=>{if(entry.key==='buyer') repairLocationPicker();syncAll();},80);
}

function triggerAdd(entry){
  const combo=entry.select.closest('.fv-combo');
  if(!combo||!entry.config.addLabel) return;
  combo.style.removeProperty('display');
  combo.style.removeProperty('pointer-events');
  const sourceButton=combo.querySelector('.fv-buttonish');
  if(!sourceButton) return;
  sourceButton.click();
  const clickAdd=()=>{
    const panels=Array.from(document.querySelectorAll('.fv-panel.show'));
    const panel=panels[panels.length-1];
    const target=Array.from(panel?.querySelectorAll?.('.fv-item')||[]).find(i=>clean(i.textContent)===entry.config.addLabel);
    if(target){target.click();return true;}
    return false;
  };
  if(!clickAdd()){setTimeout(clickAdd,0);setTimeout(clickAdd,50);}
  setTimeout(()=>forceHideLegacy(entry.select),80);
}

function render(entry){
  const query=norm(entry.search?.value);
  entry.menu.querySelectorAll('.hj7-choice,.hj7-empty').forEach(n=>n.remove());
  if(entry.config.addLabel){
    const add=document.createElement('button');add.type='button';add.className='hj7-choice';add.textContent=entry.config.addLabel;
    add.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();entry.menu.classList.remove('open');entry.button.setAttribute('aria-expanded','false');triggerAdd(entry);});
    entry.menu.appendChild(add);
  }
  const rows=choicesFor(entry.key).filter(x=>!query||norm(x.label).includes(query));
  rows.forEach(row=>{
    const b=document.createElement('button');b.type='button';b.className='hj7-choice';b.textContent=row.label;
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setSelectValue(entry,row.value,row.label);entry.menu.classList.remove('open');entry.button.setAttribute('aria-expanded','false');});
    entry.menu.appendChild(b);
  });
  if(!rows.length){const empty=document.createElement('div');empty.className='hj7-empty';empty.textContent=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value)?'Select buyer first.':'No options found.';entry.menu.appendChild(empty);}
}

function enhance(key,config){
  const select=document.getElementById(config.id);
  if(!select) return null;
  forceHideLegacy(select);

  const old=state.get(config.id);
  if(old && old.select===select && old.picker?.isConnected){syncEntry(old);return old;}
  if(old){old.picker?.remove();state.delete(config.id);}

  const field=select.closest('.field')||select.parentElement;
  if(!field) return null;

  const picker=document.createElement('div');picker.className='hj7-picker';picker.dataset.hj7For=config.id;
  const button=document.createElement('button');button.type='button';button.className='hj7-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='hj7-menu';menu.setAttribute('role','listbox');
  let search=null;
  if(key!=='crop'){
    const wrap=document.createElement('div');wrap.className='hj7-search-wrap';
    search=document.createElement('input');search.type='search';search.className='hj7-search';search.placeholder='Search';search.autocomplete='off';
    wrap.appendChild(search);menu.appendChild(wrap);
  }
  picker.append(button,menu);field.appendChild(picker);
  const entry={key,config,select,picker,button,menu,search};state.set(config.id,entry);

  button.addEventListener('click',async e=>{
    e.preventDefault();e.stopPropagation();syncEntry(entry);if(button.disabled)return;
    const opening=!menu.classList.contains('open');closeAll(entry);menu.classList.toggle('open',opening);button.setAttribute('aria-expanded',opening?'true':'false');
    if(!opening)return;if(search)search.value='';await loadData();render(entry);
  });
  search?.addEventListener('input',()=>render(entry));search?.addEventListener('click',e=>e.stopPropagation());
  select.addEventListener('change',()=>{syncEntry(entry);if(key==='buyer'){setTimeout(repairLocationPicker,0);setTimeout(repairLocationPicker,60);setTimeout(repairLocationPicker,160);}});
  syncEntry(entry);
  return entry;
}

function repairLocationPicker(){
  const select=document.getElementById(CONFIG.location.id);
  if(!select) return;
  forceHideLegacy(select);
  enhance('location',CONFIG.location);
  const entry=state.get(CONFIG.location.id);
  if(entry) syncEntry(entry);
}

function enhanceAll(){Object.entries(CONFIG).forEach(([k,c])=>enhance(k,c));syncAll();}

function installLocationObserver(){
  const select=document.getElementById(CONFIG.location.id);
  const field=select?.closest('.field');
  if(!field||locationObserver) return;
  locationObserver=new MutationObserver(()=>queueMicrotask(repairLocationPicker));
  locationObserver.observe(field,{childList:true,subtree:true});
}

function installLegacyLocationRedirect(){
  const modal=document.getElementById('hauling-job-modal');
  if(!modal) return;
  const redirect=e=>{
    const legacyButton=e.target.closest?.('.fv-combo .fv-buttonish');
    if(!legacyButton) return;
    const combo=legacyButton.closest('.fv-combo');
    if(!combo?.querySelector('#hauling-job-location')) return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    repairLocationPicker();
    const local=state.get(CONFIG.location.id)?.button;
    if(local && !local.disabled) local.click();
  };
  modal.addEventListener('pointerdown',redirect,true);
  modal.addEventListener('click',redirect,true);
}

function init(){
  installStyles();enhanceAll();loadData();installLocationObserver();installLegacyLocationRedirect();
  const modal=document.getElementById('hauling-job-modal');
  if(modal&&!modalObserver){
    modalObserver=new MutationObserver(()=>{
      if(modal.classList.contains('open')){enhanceAll();repairLocationPicker();installLocationObserver();loadData(true).then(syncAll);}else closeAll();
    });
    modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});
  }
  document.addEventListener('click',e=>{if(!e.target.closest?.('.hj7-picker'))closeAll();},true);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
