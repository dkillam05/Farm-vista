// npm install --no-save linkedom
// node --experimental-vm-modules tests/field-readiness-loading-dom.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
const {parseHTML}=createRequire(import.meta.url)('linkedom');
const root=path.resolve(import.meta.dirname,'..');
const noop=()=>{};
async function setup(){
 const {window,document}=parseHTML(`<html><head></head><body><select id="opSel"></select><select id="sortSel"></select><select id="pageSel"></select><input id="range"><input id="fieldSearch"><div id="fieldsTitle"></div><div id="fieldsGrid"></div><div id="emptyMsg"></div><details id="detailsPanel"></details></body></html>`);
 for(const [id,value] of Object.entries({opSel:'spring',sortSel:'name_az',pageSel:'25',range:'current',fieldSearch:''}))Object.defineProperty(document.getElementById(id),'value',{value,writable:true,configurable:true});
 window.matchMedia=()=>({matches:false});
 const fields=Array.from({length:150},(_,i)=>({id:String(i+1),name:'Field '+String(i+1).padStart(3,'0'),farmId:i<5?'five':'other'}));
 const state={fields,farmFilter:'__all__',pageSize:25,perm:{loaded:true,view:true,edit:false},selectedFieldId:'1'};
 window.__FV_FR=state;
 const calls={ready:[],rain:[],daily:[]};
 let delayMs=0,fail=false;const pause=()=>new Promise(r=>setTimeout(r,delayMs));
 const mocks={
  'params.js':{ensureSelectedParamsToSliders:noop},'thresholds.js':{getCurrentOp:()=>document.getElementById('opSel').value,getThresholdForOp:()=>70},
  'perm.js':{canEdit:()=>false},'quickview.js':{openQuickView:noop},'swipe.js':{initSwipeOnTiles:async()=>{}},
  'rain.js':{parseRangeFromInput:()=>({key:document.getElementById('range').value}),mrmsRainInRange:d=>({ready:true,inches:d.rain})},
  'data.js':{fetchAndHydrateFieldParams:async()=>{},loadFieldMrmsDoc:async(st,id)=>{calls.rain.push(id);await pause();return {rain:Number(id)};}},
  'firebase.js':{getAPI:()=>({kind:'module',getFirestore:()=>null,doc:(_,col,id)=>({col,id}),collection:(_,col,id,sub)=>({col,id,sub}),getDoc:async ref=>{calls.ready.push(ref.id);await pause();if(fail)throw Error('offline');return {exists:()=>true,data:()=>({fieldId:ref.id,readiness:Number(ref.id)%100})};},getDocs:async ref=>{calls.daily.push(ref.id);await pause();return {forEach:noop};}})}
 };
 const storage=new Map();let triviaCalls=0;
 const context=vm.createContext({window,document,console:{warn:noop,log:noop},setTimeout,clearTimeout,setInterval,clearInterval,Date,Promise,Intl,URL,URLSearchParams,AbortController,navigator:{maxTouchPoints:0},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},fetch:async url=>{triviaCalls++;const u=new URL(url);return {ok:true,json:async()=>({query:u.searchParams.has('list')?{categorymembers:[{pageid:101},{pageid:102},{pageid:103}]}:{pages:[101,102,103].map(id=>({pageid:id,title:'History '+id,extract:'Sample agricultural history excerpt number '+id+', returned with enough text for a small educational card.'}))}})};}});
 const modules=new Map();
 async function get(file){
  if(modules.has(file))return modules.get(file);
  const name=path.basename(file);let m;
  if(mocks[name])m=new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const [k,v] of Object.entries(mocks[name]))this.setExport(k,v);},{context,identifier:file});
  else m=new vm.SourceTextModule(fs.readFileSync(path.join(root,'js/field-readiness',file),'utf8'),{context,identifier:file});
  modules.set(file,m);await m.link(spec=>get(path.posix.normalize(path.posix.join(path.posix.dirname(file),spec))));return m;
 }
 const render=await get('render.js');await render.evaluate();
 const progress=await get('loading-progress.js');if(progress.status!=='evaluated')await progress.evaluate();
 return {document,state,calls,context,api:render.namespace,progress:progress.namespace,setDelay:v=>delayMs=v,setFail:v=>fail=v,triviaCalls:()=>triviaCalls,storage};
}
let t=await setup();await t.api.renderTiles(t.state);
assert.deepEqual(Object.fromEntries(Object.entries(t.calls).map(([k,v])=>[k,v.length])),{ready:25,rain:25,daily:25});assert.equal(t.document.querySelectorAll('.tile').length,25);assert.equal(t.triviaCalls(),0);
console.log('PASS: name sort limits expensive reads to the visible 25 of 150; no trivia requests on fast loads');
t=await setup();t.state.farmFilter='five';await t.api.renderTiles(t.state);
assert.deepEqual(Object.fromEntries(Object.entries(t.calls).map(([k,v])=>[k,v.length])),{ready:5,rain:5,daily:5});
console.log('PASS: selected five-field farm loads only five tile records');
t=await setup();t.document.getElementById('sortSel').value='rain_most';await t.api.renderTiles(t.state);
assert.equal(t.calls.rain.length,150);assert.equal(t.calls.ready.length,25);assert.equal(t.document.querySelector('.tile').dataset.fieldId,'150');
console.log('PASS: rainfall ranking considers all candidates but loads only top 25 readiness/ETA records');
t=await setup();t.document.getElementById('sortSel').value='ready_dry_wet';await t.api.renderTiles(t.state);
assert.equal(t.calls.ready.length,150);assert.equal(t.calls.rain.length,25);assert.equal(t.calls.daily.length,0);assert.equal(t.document.querySelector('.tile').dataset.fieldId,'99');
console.log('PASS: readiness ranking is correct; ready fields need no daily-history reads');
t=await setup();t.setDelay(10);const first=t.api.renderTiles(t.state);assert.equal(t.document.querySelectorAll('.tile').length,25);t.state.farmFilter='five';const second=t.api.refreshAll(t.state);await Promise.all([first,second]);assert.equal(t.document.querySelectorAll('.tile').length,5);
console.log('PASS: obsolete filter request stops scheduling and cannot overwrite newer selection');
t.calls.ready.length=0;const tasks=[t.api.refreshAll(t.state,{force:true}),t.api.refreshAll(t.state,{force:true}),t.api.refreshAll(t.state,{force:true})];assert.equal(t.document.querySelectorAll('.tile').length,5);await Promise.all(tasks);assert.equal(t.calls.ready.length,5);
console.log('PASS: refreshes coalesce and leave existing tiles visible');
const before=t.document.querySelector('.tile').textContent;t.setFail(true);await t.api.refreshAll(t.state,{force:true});assert.equal(t.document.querySelector('.tile').textContent,before);assert.match(t.document.getElementById('frLoadProgress').textContent,/could not update/);
console.log('PASS: failed refresh retains tiles and reports failure');
t=await setup();let time=0,id=0;const timers=new Map();t.context.Date=class extends Date{static now(){return 1800000000000+time;}};t.context.setTimeout=(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;};t.context.clearTimeout=x=>timers.delete(x);t.context.setInterval=(fn,ms)=>{timers.set(++id,{fn,at:time+ms,every:ms});return id;};t.context.clearInterval=x=>timers.delete(x);
async function advance(ms){const end=time+ms;while(true){const due=[...timers.entries()].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;if(due[1].every)due[1].at+=due[1].every;else timers.delete(due[0]);due[1].fn();await new Promise(r=>setImmediate(r));}time=end;}
const loading=t.progress.beginFieldLoading();loading.update(0,75);await advance(7900);assert.equal(t.triviaCalls(),0);await advance(200);assert.equal(t.triviaCalls(),2);const excerpt=t.document.querySelector('[data-history-text]').textContent;assert.ok(excerpt);await advance(15000);assert.notEqual(t.document.querySelector('[data-history-text]').textContent,excerpt);assert.equal(t.triviaCalls(),2);loading.stop();assert.equal(t.document.getElementById('frLoadProgress').hidden,false);assert.equal(t.document.querySelector('.fr-load-spinner').hidden,true);assert.equal(t.document.getElementById('fieldsGrid').getAttribute('aria-busy'),'false');await advance(14800);assert.equal(t.document.querySelector('aside').hidden,false);await advance(200);assert.equal(t.document.getElementById('frLoadProgress').hidden,true);await advance(15000);assert.equal(t.triviaCalls(),2);assert.equal(t.document.getElementById('frLoadProgress').hidden,true);
console.log('PASS: optional history delayed 8 seconds, rotated at 15 seconds, cached, attributed, not repeated, retained for the full 15 seconds after display without delaying field readiness');

const next=t.progress.beginFieldLoading();await advance(8100);const retained=t.document.querySelector('[data-history-text]').textContent;next.stop();const replacement=t.progress.beginFieldLoading();assert.equal(t.document.querySelector('aside').hidden,false);assert.equal(t.document.querySelector('[data-history-text]').textContent,retained);replacement.stop('Some fields could not update.');await advance(14800);assert.equal(t.document.querySelector('aside').hidden,false);await advance(200);assert.equal(t.document.querySelector('aside').hidden,true);assert.equal(t.document.getElementById('frLoadProgress').hidden,false);assert.match(t.document.querySelector('[data-progress-label]').textContent,/could not update/);
console.log('PASS: restarting loading preserves reading time; error status remains after history dismisses');
