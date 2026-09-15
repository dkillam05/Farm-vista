// FarmVista — Hauling Job field-local pickers v10
// Buyer, Location, Sold Under, and Crop all use the exact same local picker.
// Location's real form control is #hauling-job-destination.
import { ready, getFirestore, collection, getDocs } from '/js/core/firebase/firebase-init.js';

await ready;
const db = getFirestore();
const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase();

const CONFIG = {
  buyer:    { id:'hauling-job-buyer',       placeholder:'Select buyer',    addLabel:'+ Add New Buyer' },
  location: { id:'hauling-job-destination', placeholder:'Select location', addLabel:'+ Add New Location' },
  customer: { id:'hauling-job-customer',    placeholder:'Select customer', addLabel:'+ Add New Sold Under' },
  crop:     { id:'hauling-job-crop',        placeholder:'Select crop',     addLabel:'' }
};

const cache = { buyers:[], locations:[], customers:[] };
const state = new Map();
let loadPromise = null;
let modalObserver = null;

function installStyles(){
  if(document.getElementById('fv-hauling-picker-v10-style')) return;
  const style = document.createElement('style');
  style.id = 'fv-hauling-picker-v10-style';
  style.textContent = `
    #hauling-job-modal .hj10-legacy-combo{display:none!important;pointer-events:none!important}
    #hauling-job-modal .hj10-picker{position:relative!important;width:100%!important;min-width:0!important;overflow:visible!important}
    #hauling-job-modal .hj10-button{
      width:100%!important;min-height:46px;display:flex;align-items:center;
      border:1px solid var(--border,#d4d4d4);border-radius:11px;
      background-color:var(--surface,#fff)!important;color:var(--text,#142018);
      padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box!important;
      background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;
      background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important
    }
    #hauling-job-modal .hj10-button:disabled{opacity:.55;cursor:not-allowed}
    #hauling-job-modal .hj10-menu{
      position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;bottom:auto!important;
      z-index:30000!important;display:none;width:100%!important;max-width:100%!important;max-height:min(390px,48dvh);
      overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;
      background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);
      padding:0;margin:0!important;box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain
    }
    #hauling-job-modal .hj10-menu.open{display:block!important}
    #hauling-job-modal .hj10-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
    #hauling-job-modal .hj10-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
    #hauling-job-modal .hj10-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
    #hauling-job-modal .hj10-choice:hover,#hauling-job-modal .hj10-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
    #hauling-job-modal .hj10-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}
    html.dark #hauling-job-modal .hj10-button,html.dark #hauling-job-modal .hj10-menu,html.dark #hauling-job-modal .hj10-search-wrap,html.dark #hauling-job-modal .hj10-search,html.dark #hauling-job-modal .hj10-choice,
    html[data-theme="dark"] #hauling-job-modal .hj10-button,html[data-theme="dark"] #hauling-job-modal .hj10-menu,html[data-theme="dark"] #hauling-job-modal .hj10-search-wrap,html[data-theme="dark"] #hauling-job-modal .hj10-search,html[data-theme="dark"] #hauling-job-modal .hj10-choice{
      background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important
    }
  `;
  document.head.appendChild(style);
}

function displayName(x){
  return clean(x?.name || x?.customerName || x?.buyerName || x?.locationName || x?.companyName || x?.displayName);
}

function locationName(x){
  return clean(x?.locationName || x?.deliveryLocationName || x?.destinationName || x?.name || x?.displayName);
}

async function loadData(force=false){
  if(loadPromise && !force) return loadPromise;
  loadPromise = (async()=>{
    const [buyers,locations,customers] = await Promise.all([
      getDocs(collection(db,'grain_buyers')),
      getDocs(collection(db,'grain_delivery_locations')),
      getDocs(collection(db,'grain_customers'))
    ]);
    cache.buyers = buyers.docs.map(d=>({id:d.id,...d.data()})).filter(displayName).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
    cache.locations = locations.docs.map(d=>({id:d.id,...d.data()})).filter(x=>locationName(x)).sort((a,b)=>locationName(a).localeCompare(locationName(b)));
    cache.customers = customers.docs.map(d=>({id:d.id,...d.data()})).filter(displayName).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
  })().catch(err=>console.warn('[Hauling Job Picker v10] load failed',err));
  return loadPromise;
}

function choicesFor(key){
  if(key==='buyer') return cache.buyers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='customer') return cache.customers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='crop') return [{value:'Corn',label:'Corn'},{value:'Soybeans',label:'Soybeans'}];
  if(key==='location'){
    const buyerId = clean(document.getElementById(CONFIG.buyer.id)?.value);
    if(!buyerId) return [];
    return cache.locations
      .filter(x=>clean(x.buyerId || x.grainBuyerId)===buyerId)
      .map(x=>({value:x.id,label:locationName(x)}));
  }
  return [];
}

function closeAll(except=null){
  state.forEach(entry=>{
    if(entry===except) return;
    entry.menu.classList.remove('open');
    entry.button.setAttribute('aria-expanded','false');
  });
}

function ensureOption(select,value,label){
  let option=[...select.options].find(o=>String(o.value)===String(value));
  if(!option){
    option=document.createElement('option');
    option.value=value;
    option.textContent=label;
    select.appendChild(option);
  }
}

function sync(entry){
  const option=entry.select.options?.[entry.select.selectedIndex];
  entry.button.textContent=clean(option?.textContent)||entry.config.placeholder;
  entry.button.disabled=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value);
}

function syncAll(){ state.forEach(sync); }

function triggerAdd(entry){
  const combo=entry.select.closest('.fv-combo');
  const source=combo?.querySelector('.fv-buttonish');
  if(!combo || !source || !entry.config.addLabel) return;

  combo.classList.remove('hj10-legacy-combo');
  source.click();
  const clickAdd=()=>{
    const panels=[...document.querySelectorAll('.fv-panel.show')];
    const panel=panels[panels.length-1];
    const target=[...(panel?.querySelectorAll('.fv-item')||[])].find(item=>clean(item.textContent)===entry.config.addLabel);
    if(target){ target.click(); return true; }
    return false;
  };
  if(!clickAdd()){
    setTimeout(clickAdd,0);
    setTimeout(clickAdd,50);
  }
  setTimeout(()=>combo.classList.add('hj10-legacy-combo'),100);
}

function render(entry){
  const q=norm(entry.search?.value);
  entry.menu.querySelectorAll('.hj10-choice,.hj10-empty').forEach(node=>node.remove());

  if(entry.config.addLabel){
    const add=document.createElement('button');
    add.type='button';
    add.className='hj10-choice';
    add.textContent=entry.config.addLabel;
    add.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      entry.menu.classList.remove('open');
      entry.button.setAttribute('aria-expanded','false');
      triggerAdd(entry);
    });
    entry.menu.appendChild(add);
  }

  const rows=choicesFor(entry.key).filter(row=>!q||norm(row.label).includes(q));
  rows.forEach(row=>{
    const button=document.createElement('button');
    button.type='button';
    button.className='hj10-choice';
    button.textContent=row.label;
    button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      ensureOption(entry.select,row.value,row.label);
      entry.select.value=row.value;
      entry.select.dispatchEvent(new Event('change',{bubbles:true}));
      sync(entry);
      entry.menu.classList.remove('open');
      entry.button.setAttribute('aria-expanded','false');
      if(entry.key==='buyer') setTimeout(syncAll,0);
    });
    entry.menu.appendChild(button);
  });

  if(!rows.length){
    const empty=document.createElement('div');
    empty.className='hj10-empty';
    empty.textContent=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value)
      ? 'Select buyer first.'
      : 'No options found.';
    entry.menu.appendChild(empty);
  }
}

function makePicker(key,config){
  const select=document.getElementById(config.id);
  if(!select) return;

  const combo=select.closest('.fv-combo');
  if(combo) combo.classList.add('hj10-legacy-combo');

  const old=state.get(config.id);
  if(old && old.select===select && old.picker?.isConnected){
    sync(old);
    return;
  }
  old?.picker?.remove();
  state.delete(config.id);

  const field=select.closest('.field') || combo?.parentElement || select.parentElement;
  if(!field) return;

  const picker=document.createElement('div');
  picker.className='hj10-picker';
  picker.dataset.for=config.id;

  const button=document.createElement('button');
  button.type='button';
  button.className='hj10-button';
  button.setAttribute('aria-haspopup','listbox');
  button.setAttribute('aria-expanded','false');

  const menu=document.createElement('div');
  menu.className='hj10-menu';
  menu.setAttribute('role','listbox');

  let search=null;
  if(key!=='crop'){
    const wrap=document.createElement('div');
    wrap.className='hj10-search-wrap';
    search=document.createElement('input');
    search.type='search';
    search.className='hj10-search';
    search.placeholder='Search';
    search.autocomplete='off';
    wrap.appendChild(search);
    menu.appendChild(wrap);
  }

  picker.append(button,menu);
  field.appendChild(picker);

  const entry={key,config,select,picker,button,menu,search};
  state.set(config.id,entry);

  button.addEventListener('click',async event=>{
    event.preventDefault();event.stopPropagation();
    sync(entry);
    if(button.disabled) return;
    const opening=!menu.classList.contains('open');
    closeAll(entry);
    menu.classList.toggle('open',opening);
    button.setAttribute('aria-expanded',opening?'true':'false');
    if(!opening) return;
    if(search) search.value='';
    await loadData();
    render(entry);
  });

  search?.addEventListener('input',()=>render(entry));
  search?.addEventListener('click',event=>event.stopPropagation());
  select.addEventListener('change',()=>{
    sync(entry);
    if(key==='buyer'){
      const location=state.get(CONFIG.location.id);
      if(location){
        setTimeout(()=>sync(location),0);
        setTimeout(()=>sync(location),80);
      }
    }
  });
  sync(entry);
}

function repairAll(){
  Object.entries(CONFIG).forEach(([key,config])=>makePicker(key,config));
  syncAll();
}

function init(){
  installStyles();
  repairAll();
  loadData();

  const modal=document.getElementById('hauling-job-modal');
  if(modal && !modalObserver){
    modalObserver=new MutationObserver(()=>{
      if(modal.classList.contains('open')){
        repairAll();
        loadData(true).then(syncAll);
      }else{
        closeAll();
      }
    });
    modalObserver.observe(modal,{attributes:true,attributeFilter:['class']});
  }

  document.addEventListener('click',event=>{
    if(!event.target.closest?.('.hj10-picker')) closeAll();
  },true);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
