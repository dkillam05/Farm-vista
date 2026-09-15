// FarmVista — Hauling Job field-local pickers v9.1
// ALL four fields use the exact same local picker implementation.
// IMPORTANT: no subtree MutationObserver; it caused a self-triggering repair loop.
import { ready, getFirestore, collection, getDocs } from '/js/firebase-init.js';
await ready;
const db=getFirestore();
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase();
const CONFIG={
  buyer:{id:'hauling-job-buyer',placeholder:'Select buyer',addLabel:'+ Add New Buyer'},
  location:{id:'hauling-job-location',placeholder:'Select location',addLabel:'+ Add New Location'},
  customer:{id:'hauling-job-customer',placeholder:'Select customer',addLabel:'+ Add New Sold Under'},
  crop:{id:'hauling-job-crop',placeholder:'Select crop',addLabel:''}
};
const cache={buyers:[],locations:[],customers:[]};
const state=new Map();
let loadPromise=null;
let modalObserver=null;

function installStyles(){
  if(document.getElementById('fv-hauling-picker-v9-style')) return;
  const s=document.createElement('style');
  s.id='fv-hauling-picker-v9-style';
  s.textContent=`
    #hauling-job-modal .fv-combo:has(#hauling-job-buyer),
    #hauling-job-modal .fv-combo:has(#hauling-job-location),
    #hauling-job-modal .fv-combo:has(#hauling-job-customer),
    #hauling-job-modal .fv-combo:has(#hauling-job-crop){display:none!important;pointer-events:none!important}
    #hauling-job-modal .hj9-picker{position:relative!important;width:100%!important;min-width:0!important;overflow:visible!important}
    #hauling-job-modal .hj9-button{width:100%!important;min-height:46px;display:flex;align-items:center;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 38px 9px 11px;font:inherit;text-align:left;cursor:pointer;box-sizing:border-box!important;background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8"><path d="M1 1l6 6 6-6" fill="none" stroke="%2367706B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')!important;background-repeat:no-repeat!important;background-position:right 11px center!important;background-size:14px 8px!important}
    #hauling-job-modal .hj9-button:disabled{opacity:.55;cursor:not-allowed}
    #hauling-job-modal .hj9-menu{position:absolute!important;left:0!important;right:0!important;top:calc(100% + 5px)!important;bottom:auto!important;z-index:30000!important;display:none;width:100%!important;max-width:100%!important;max-height:min(390px,48dvh);overflow-x:hidden;overflow-y:auto;border:1px solid var(--border,#d4d4d4);border-radius:11px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);box-shadow:0 14px 34px rgba(0,0,0,.20);padding:0;margin:0!important;box-sizing:border-box;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    #hauling-job-modal .hj9-menu.open{display:block!important}
    #hauling-job-modal .hj9-search-wrap{position:sticky;top:0;z-index:2;padding:8px;background-color:var(--surface,#fff)!important;border-bottom:1px solid var(--border,#d4d4d4)}
    #hauling-job-modal .hj9-search{width:100%;box-sizing:border-box;border:1px solid var(--border,#d4d4d4);border-radius:9px;background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:9px 10px;font:inherit}
    #hauling-job-modal .hj9-choice{width:100%;appearance:none;border:0;border-bottom:1px solid var(--border,#d4d4d4);background-color:var(--surface,#fff)!important;color:var(--text,#142018);padding:11px 13px;font:inherit;font-weight:650;text-align:left;cursor:pointer}
    #hauling-job-modal .hj9-choice:hover,#hauling-job-modal .hj9-choice:focus{background-color:var(--surface-2,rgba(59,126,70,.08))!important;outline:none}
    #hauling-job-modal .hj9-empty{padding:12px;color:var(--muted,#68716c);font-size:12px;font-weight:700}
    html.dark #hauling-job-modal .hj9-button,html.dark #hauling-job-modal .hj9-menu,html.dark #hauling-job-modal .hj9-search-wrap,html.dark #hauling-job-modal .hj9-search,html.dark #hauling-job-modal .hj9-choice,
    html[data-theme="dark"] #hauling-job-modal .hj9-button,html[data-theme="dark"] #hauling-job-modal .hj9-menu,html[data-theme="dark"] #hauling-job-modal .hj9-search-wrap,html[data-theme="dark"] #hauling-job-modal .hj9-search,html[data-theme="dark"] #hauling-job-modal .hj9-choice{background-color:#18231b!important;color:#eef4ef!important;border-color:#314137!important}
  `;
  document.head.appendChild(s);
}
function displayName(x){return clean(x?.name||x?.customerName||x?.buyerName||x?.locationName||x?.companyName||x?.displayName);}
async function loadData(force=false){
  if(loadPromise&&!force)return loadPromise;
  loadPromise=(async()=>{
    const [b,l,c]=await Promise.all([getDocs(collection(db,'grain_buyers')),getDocs(collection(db,'grain_delivery_locations')),getDocs(collection(db,'grain_customers'))]);
    cache.buyers=b.docs.map(d=>({id:d.id,...d.data()})).filter(displayName).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
    cache.locations=l.docs.map(d=>({id:d.id,...d.data()})).filter(displayName).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
    cache.customers=c.docs.map(d=>({id:d.id,...d.data()})).filter(displayName).sort((a,b)=>displayName(a).localeCompare(displayName(b)));
  })().catch(e=>console.warn('[Hauling Job Picker v9.1] load failed',e));
  return loadPromise;
}
function choicesFor(key){
  if(key==='buyer')return cache.buyers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='customer')return cache.customers.map(x=>({value:x.id,label:displayName(x)}));
  if(key==='crop')return [{value:'Corn',label:'Corn'},{value:'Soybeans',label:'Soybeans'}];
  if(key==='location'){
    const buyerId=clean(document.getElementById(CONFIG.buyer.id)?.value);
    if(!buyerId)return [];
    return cache.locations.filter(x=>clean(x.buyerId||x.grainBuyerId)===buyerId).map(x=>({value:x.id,label:displayName(x)}));
  }
  return [];
}
function closeAll(except=null){state.forEach(e=>{if(e!==except){e.menu.classList.remove('open');e.button.setAttribute('aria-expanded','false');}});}
function ensureOption(select,value,label){let o=[...select.options].find(x=>String(x.value)===String(value));if(!o){o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o);}}
function sync(entry){
  const o=entry.select.options?.[entry.select.selectedIndex];
  entry.button.textContent=clean(o?.textContent)||entry.config.placeholder;
  entry.button.disabled=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value);
}
function syncAll(){state.forEach(sync);}
function triggerAdd(entry){
  const combo=entry.select.closest('.fv-combo');
  const source=combo?.querySelector('.fv-buttonish');
  if(!source||!entry.config.addLabel)return;
  combo.style.setProperty('display','block','important');
  combo.style.setProperty('pointer-events','auto','important');
  source.click();
  const clickAdd=()=>{const panels=[...document.querySelectorAll('.fv-panel.show')];const panel=panels[panels.length-1];const item=[...(panel?.querySelectorAll('.fv-item')||[])].find(i=>clean(i.textContent)===entry.config.addLabel);if(item){item.click();return true;}return false;};
  if(!clickAdd()){setTimeout(clickAdd,0);setTimeout(clickAdd,50);}
  setTimeout(()=>{combo.style.removeProperty('display');combo.style.removeProperty('pointer-events');},80);
}
function render(entry){
  const q=norm(entry.search?.value);
  entry.menu.querySelectorAll('.hj9-choice,.hj9-empty').forEach(n=>n.remove());
  if(entry.config.addLabel){const a=document.createElement('button');a.type='button';a.className='hj9-choice';a.textContent=entry.config.addLabel;a.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();entry.menu.classList.remove('open');triggerAdd(entry);});entry.menu.appendChild(a);}
  const rows=choicesFor(entry.key).filter(x=>!q||norm(x.label).includes(q));
  rows.forEach(row=>{const b=document.createElement('button');b.type='button';b.className='hj9-choice';b.textContent=row.label;b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();ensureOption(entry.select,row.value,row.label);entry.select.value=row.value;entry.select.dispatchEvent(new Event('change',{bubbles:true}));sync(entry);entry.menu.classList.remove('open');entry.button.setAttribute('aria-expanded','false');if(entry.key==='buyer'){setTimeout(repairAll,0);setTimeout(repairAll,80);}});entry.menu.appendChild(b);});
  if(!rows.length){const d=document.createElement('div');d.className='hj9-empty';d.textContent=entry.key==='location'&&!clean(document.getElementById(CONFIG.buyer.id)?.value)?'Select buyer first.':'No options found.';entry.menu.appendChild(d);}
}
function makePicker(key,config){
  const select=document.getElementById(config.id);if(!select)return;
  const combo=select.closest('.fv-combo');if(combo){combo.style.setProperty('display','none','important');combo.style.setProperty('pointer-events','none','important');}
  const old=state.get(config.id);
  if(old&&old.select===select&&old.picker?.isConnected){sync(old);return;}
  old?.picker?.remove();state.delete(config.id);
  const field=select.closest('.field')||combo?.parentElement||select.parentElement;if(!field)return;
  const picker=document.createElement('div');picker.className='hj9-picker';picker.dataset.for=config.id;
  const button=document.createElement('button');button.type='button';button.className='hj9-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const menu=document.createElement('div');menu.className='hj9-menu';menu.setAttribute('role','listbox');
  let search=null;if(key!=='crop'){const w=document.createElement('div');w.className='hj9-search-wrap';search=document.createElement('input');search.type='search';search.className='hj9-search';search.placeholder='Search';search.autocomplete='off';w.appendChild(search);menu.appendChild(w);}
  picker.append(button,menu);field.appendChild(picker);
  const entry={key,config,select,picker,button,menu,search};state.set(config.id,entry);
  button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();sync(entry);if(button.disabled)return;const opening=!menu.classList.contains('open');closeAll(entry);menu.classList.toggle('open',opening);button.setAttribute('aria-expanded',opening?'true':'false');if(!opening)return;if(search)search.value='';await loadData();render(entry);});
  search?.addEventListener('input',()=>render(entry));search?.addEventListener('click',e=>e.stopPropagation());
  select.addEventListener('change',()=>{sync(entry);if(key==='buyer'){setTimeout(repairAll,0);setTimeout(repairAll,80);setTimeout(repairAll,180);}});
  sync(entry);
}
function repairAll(){Object.entries(CONFIG).forEach(([k,c])=>makePicker(k,c));syncAll();}
function init(){
  installStyles();repairAll();loadData();
  const modal=document.getElementById('hauling-job-modal');
  if(modal&&!modalObserver){
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
  document.addEventListener('click',e=>{if(!e.target.closest?.('.hj9-picker'))closeAll();},true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
