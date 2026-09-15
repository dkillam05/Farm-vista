// FarmVista — Hauling Job field-local pickers v8
// Buyer / Sold Under / Crop use local replacement pickers.
// Location uses the EXISTING FarmVista combo box as the visible trigger,
// with its legacy click handler removed and a local menu attached underneath.

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
let repairingLocation = false;

function installStyles(){
  if(document.getElementById('fv-hauling-local-picker-style-v8')) return;
  const style=document.createElement('style');
  style.id='fv-hauling-local-picker-style-v8';
  style.textContent=`
    /* Hide legacy combos only for the three fields that receive a separate local button. */
    #hauling-job-modal .fv-combo:has(#hauling-job-buyer),
    #hauling-job-modal .fv-combo:has(#hauling-job-customer),
    #hauling-job-modal .fv-combo:has(#hauling-job-crop){display:none!important;pointer-events:none!important}

    #hauling-job-modal .hj8-picker,
    #hauling-job-modal .hj8-location-combo{
      position:relative!important;
      width:100%!important;
      min-width:0!important;
      overflow:visible!important;
    }

    #hauling-job-modal .hj8-button{
      width:100%!important;min-height:46px;display:flex;align-items:center;
      border:1px solid var(--border,#d4d4d4);border-radius:11px;
      background-color:var(--surface,#fff)!important;color:var(--text,#142018);
      padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box!important;
      background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;
      background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important
    }
    #hauling-job-modal .hj8-button:disabled{opacity:.55;cursor:not-allowed}

    /* Location uses the existing FarmVista visual button, but it is now ours. */
    #hauling-job-modal .hj8-location-combo > .fv-buttonish.hj8-location-button{
      position:relative!important;
      width:100%!important;
      pointer-events:auto!important;
      cursor:pointer!important;
    }
    #hauling-job-modal .hj8-location-legacy-source{display:none!important;pointer-events:none!important}
    #hauling-job-modal .hj8-location-combo > #hauling-job-location{display:none!important}

    #hauling-job-modal .hj8-menu{
      position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;bottom:auto!important;
      z-index:30000!important;display:none;width:100%!important;max-width:100%!important;max-height:min(390px,48dvh);
      overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;
      background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);
      padding:0;margin:0!important;box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain
    }
    #hauling-job-modal .hj8-menu.open{display:block!important}
    #hauling-job-modal .hj8-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
    #hauling-job-modal .hj8-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
    #hauling-job-modal .hj8-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
    #hauling-job-modal .hj8-choice:hover,#hauling-job-modal .hj8-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
    #hauling-job-modal .hj8-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}

    html.dark #hauling-job-modal .hj8-button,
    html.dark #hauling-job-modal .hj8-menu,
    html.dark #hauling-job-modal .hj8-search-wrap,
    html.dark #hauling-job-modal .hj8-search,
    html.dark #hauling-job-modal .hj8-choice,
    html[data-theme="dark"] #hauling-job-modal .hj8-button,
    html[data-theme="dark"] #hauling-job-modal .hj8-menu,
    html[data-theme="dark"] #hauling-job-modal .hj8-search-wrap,
    html[data-theme="dark"] #hauling-job-modal .hj8-search,
    html[data-theme="dark"] #hauling-job-modal .hj8-choice{
      background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important
    }
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
  })().catch(err=>console.warn('[Hauling Job Picker v8] data load failed',err));
  return loadingPromise;
}

function closeAll(except=null){
  state.forEach(entry=>{
    if(entry===except) return;
    entry.menu?.classList.remove('open');
    entry.button?.setAttribute?.('aria-expanded','false');
  });
}

function ensureSelectOption(select,value,label){
  let option=Array.from(select.options||[]).find(o=>String(o.value)===String(value));
  if(!option){option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
}

function selectedLabel(select,placeholder){
  const option=select?.options?.[select.selectedIndex];
  return clean(option?.textContent)||placeholder;
}

function choicesFor(key){
  if(key==='buyer') return cache.buyers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='customer') return cache.customers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='crop') return [{value:'Corn',label:'Corn'},{value:'Soybeans',label:'Soybeans'}];
  if(key==='location'){
    const buyerId=clean(document.getElementById(CONFIG.buyer.id)?.value);
    if(!buyerId) return [];
    return cache.locations
      .filter(x=>clean(x.buyerId||x.grainBuyerId)===buyerId)
      .map(x=>({value:x.id,label:displayName(x)}));
  }
  return [];
}

function syncEntry(entry){
  if(!entry?.select?.isConnected) return;
  const label=selectedLabel(entry.select,entry.config.placeholder);
  if(entry.key==='location'){
    if(entry.button) entry.button.textContent=label;
    entry.button?.setAttribute('aria-disabled',clean(document.getElementById(CONFIG.buyer.id)?.value)?'false':'true');
  }else{
    entry.button.textContent=label;
    entry.button.disabled=false;
  }
}

function syncAll(){state.forEach(syncEntry);}

function setSelectValue(entry,value,label){
  ensureSelectOption(entry.select,value,label);
  entry.select.value=value;
  entry.select.dispatchEvent(new Event('change',{bubbles:true}));
  syncEntry(entry);
  setTimeout(()=>{
    if(entry.key==='buyer') repairLocation();
    syncAll();
  },0);
  setTimeout(()=>{
    if(entry.key==='buyer') repairLocation();
    syncAll();
  },100);
}

function triggerAdd(entry){
  const source=entry.legacySource || entry.select.closest('.fv-combo')?.querySelector('.fv-buttonish');
  if(!source||!entry.config.addLabel) return;

  source.click();
  const clickAdd=()=>{
    const panels=Array.from(document.querySelectorAll('.fv-panel.show'));
    const panel=panels[panels.length-1];
    const target=Array.from(panel?.querySelectorAll?.('.fv-item')||[])
      .find(i=>clean(i.textContent)===entry.config.addLabel);
    if(target){target.click();return true;}
    return false;
  };
  if(!clickAdd()){setTimeout(clickAdd,0);setTimeout(clickAdd,50);}
}

function render(entry){
  const query=norm(entry.search?.value);
  entry.menu.querySelectorAll('.hj8-choice,.hj8-empty').forEach(n=>n.remove());

  if(entry.config.addLabel){
    const add=document.createElement('button');
    add.type='button';add.className='hj8-choice';add.textContent=entry.config.addLabel;
    add.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      entry.menu.classList.remove('open');
      entry.button?.setAttribute?.('aria-expanded','false');
      triggerAdd(entry);
    });
    entry.menu.appendChild(add);
  }

  const rows=choicesFor(entry.key).filter(x=>!query||norm(x.label).includes(query));
  rows.forEach(row=>{
    const button=document.createElement('button');
    button.type='button';button.className='hj8-choice';button.textContent=row.label;
    button.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      setSelectValue(entry,row.value,row.label);
      entry.menu.classList.remove('open');
      entry.button?.setAttribute?.('aria-expanded','false');
    });
    entry.menu.appendChild(button);
  });

  if(!rows.length){
    const empty=document.createElement('div');empty.className='hj8-empty';
    empty.textContent=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value)?'Select buyer first.':'No options found.';
    entry.menu.appendChild(empty);
  }
}

async function toggleEntry(entry){
  syncEntry(entry);
  if(entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value)) return;
  const opening=!entry.menu.classList.contains('open');
  closeAll(entry);
  entry.menu.classList.toggle('open',opening);
  entry.button?.setAttribute?.('aria-expanded',opening?'true':'false');
  if(!opening) return;
  if(entry.search) entry.search.value='';
  await loadData();
  render(entry);
}

function buildMenu(entry,className='hj8-menu'){
  const menu=document.createElement('div');menu.className=className;menu.setAttribute('role','listbox');
  let search=null;
  if(entry.key!=='crop'){
    const wrap=document.createElement('div');wrap.className='hj8-search-wrap';
    search=document.createElement('input');search.type='search';search.className='hj8-search';search.placeholder='Search';search.autocomplete='off';
    wrap.appendChild(search);menu.appendChild(wrap);
    search.addEventListener('input',()=>render(entry));
    search.addEventListener('click',e=>e.stopPropagation());
  }
  entry.search=search;
  return menu;
}

function enhanceStandard(key,config){
  const select=document.getElementById(config.id);if(!select)return null;
  const combo=select.closest('.fv-combo');if(combo){combo.style.setProperty('display','none','important');combo.style.setProperty('pointer-events','none','important');}

  const old=state.get(config.id);
  if(old&&old.select===select&&old.picker?.isConnected){syncEntry(old);return old;}
  if(old){old.picker?.remove();state.delete(config.id);}

  const field=select.closest('.field')||select.parentElement;if(!field)return null;
  const picker=document.createElement('div');picker.className='hj8-picker';
  const button=document.createElement('button');button.type='button';button.className='hj8-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const entry={key,config,select,picker,button,menu:null,search:null};
  const menu=buildMenu(entry);entry.menu=menu;
  picker.append(button,menu);field.appendChild(picker);
  state.set(config.id,entry);

  button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleEntry(entry);});
  select.addEventListener('change',()=>{
    syncEntry(entry);
    if(key==='buyer'){setTimeout(repairLocation,0);setTimeout(repairLocation,60);setTimeout(repairLocation,160);}
  });
  syncEntry(entry);
  return entry;
}

function repairLocation(){
  if(repairingLocation) return;
  repairingLocation=true;
  try{
    const select=document.getElementById(CONFIG.location.id);
    if(!select)return;
    const combo=select.closest('.fv-combo');
    if(!combo)return;

    combo.style.removeProperty('display');
    combo.style.removeProperty('pointer-events');
    combo.classList.add('hj8-location-combo');
    combo.style.setProperty('position','relative','important');
    combo.style.setProperty('overflow','visible','important');

    let entry=state.get(CONFIG.location.id);
    const currentButton=combo.querySelector(':scope > .fv-buttonish:not(.hj8-location-legacy-source)');

    if(entry&&entry.select===select&&entry.combo===combo&&entry.button?.isConnected&&entry.menu?.isConnected){
      syncEntry(entry);
      return;
    }

    if(entry){entry.menu?.remove();state.delete(CONFIG.location.id);}

    const original=currentButton;
    if(!original)return;

    // Keep the original event-bound button hidden for Add New Location only.
    const legacySource=original;
    legacySource.classList.add('hj8-location-legacy-source');
    legacySource.setAttribute('aria-hidden','true');

    // Clone strips all legacy event listeners. This clone is the visible Location box.
    const button=original.cloneNode(true);
    button.classList.remove('hj8-location-legacy-source');
    button.classList.add('hj8-location-button');
    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-haspopup','listbox');
    button.setAttribute('aria-expanded','false');

    legacySource.insertAdjacentElement('afterend',button);

    entry={key:'location',config:CONFIG.location,select,combo,button,legacySource,menu:null,search:null};
    const menu=buildMenu(entry);entry.menu=menu;
    combo.appendChild(menu);
    state.set(CONFIG.location.id,entry);

    button.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});
    button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleEntry(entry);});
    select.addEventListener('change',()=>syncEntry(entry));
    syncEntry(entry);
  }finally{
    repairingLocation=false;
  }
}

function enhanceAll(){
  enhanceStandard('buyer',CONFIG.buyer);
  repairLocation();
  enhanceStandard('customer',CONFIG.customer);
  enhanceStandard('crop',CONFIG.crop);
  syncAll();
}

function installLocationObserver(){
  const modal=document.getElementById('hauling-job-modal');
  if(!modal||locationObserver)return;
  locationObserver=new MutationObserver(records=>{
    if(records.some(r=>r.addedNodes?.length||r.removedNodes?.length)) queueMicrotask(repairLocation);
  });
  locationObserver.observe(modal,{childList:true,subtree:true});
}

function init(){
  installStyles();
  enhanceAll();
  loadData();
  installLocationObserver();

  const modal=document.getElementById('hauling-job-modal');
  if(modal&&!modalObserver){
    modalObserver=new MutationObserver(()=>{
      if(modal.classList.contains('open')){
        enhanceAll();
        loadData(true).then(syncAll);
      }else closeAll();
    });
    modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});
  }

  document.addEventListener('click',e=>{
    if(!e.target.closest?.('.hj8-picker')&&!e.target.closest?.('.hj8-location-combo')) closeAll();
  },true);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
