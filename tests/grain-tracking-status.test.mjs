import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ticketStatus} from '../js/dashboard/kpi/grain-ticket-summary.js';

process.env.TZ = 'America/Chicago';

// Execute the tracking page's actual loader, counters, filters, and row renderer.
const html = readFileSync(new URL('../pages/grain/grain-ticket.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function updateKPIs()'));
const elements = new Map();
function element(dataset = {}) {
  return {
    dataset, textContent:'', children:[], events:{}, classList:{add(){}, toggle(){}},
    set innerHTML(value){this.markup=value;this.children=[];},
    get innerHTML(){return this.markup || '';},
    addEventListener(name, handler){this.events[name]=handler;},
    appendChild(child){this.children.push(child);}
  };
}
const filters = ['all','verified','needs_job','needs_review'].map(ticketFilter=>element({ticketFilter}));
const tbody = element({fvSharedStatus:'1'});
elements.set('grain-ticket-table-body',tbody);
const document = {
  events:{}, visibilityState:'visible',
  getElementById(id){if(!elements.has(id)) elements.set(id,element());return elements.get(id);},
  querySelectorAll(){return filters;}, createElement:element,
  addEventListener(name,handler){this.events[name]=handler;}, dispatchEvent(){}
};
const window = {events:{},location:{},addEventListener(name,handler){this.events[name]=handler;}};
const now = new Date();
const today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
const good = {
  validationStatus:'verified', ticketDate:today, createdAt:{seconds:now.getTime()/1000},
  haulingJobId:'job', customerId:'customer', customerName:'Customer',
  deliveryLocationId:'elevator', crop:'Corn', grainSourceType:'field',
  damage:0, foreignMaterial:0, netBushels:944.8
};
let tickets = Array.from({length:5},(_,i)=>({...good,id:String(i),ticketNumber:String(i)}));
tickets[4] = {...tickets[4],validationStatus:'needs_review',grainSourceType:null};
let reads = 0;
let writes = 0;
const jobs = [{id:'job',status:'active'}];
const snapshot = rows => ({docs:rows.map(row=>({id:row.id,data:()=>({...row})}))});
const sandbox = {
  document,window,console,Date,Map,Set,Intl,ticketStatus,
  ready:Promise.resolve(),getFirestore:()=>({}),getAuth:()=>({}),
  collection:(_db,name)=>name,doc:()=>({}),getDoc:async()=>({exists:()=>false}),
  getDocs:async name=>{reads++;return snapshot(name==='grain_tickets'?tickets:name==='grain_hauling_jobs'?jobs:[]);},
  updateDoc:()=>{writes++;},setDoc:()=>{writes++;},serverTimestamp:()=>({}),
  setInterval(){},CustomEvent:class {}
};
const source = script.replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']+["'];/g,'');
const api = await vm.runInNewContext(`(async()=>{${source}\nreturn {loadTickets,filteredTickets};})()`,sandbox);
await api.loadTickets();
const count = id => elements.get(`ticket-${id}`).textContent;
assert.equal(count('today-count'),'5');
assert.equal(count('verified-count'),'4');
assert.equal(count('review-count'),'1');

// A resolved ticket may still carry its old scanner flag: every UI view must agree.
tickets[4] = {...tickets[4],grainSourceType:'field'};
window.events.pageshow({persisted:true});
await api.loadTickets();
assert.equal(count('verified-count'),'5');
assert.equal(count('review-count'),'0');
assert.equal(count('contract-count'),'0');
assert.equal(count('today-bushels'),'4,724.00 bu');
assert.ok(tbody.children.every(row=>/class="ticket-status good"/.test(row.innerHTML)));
filters.find(button=>button.dataset.ticketFilter==='verified').events.click();
assert.equal(api.filteredTickets().length,5);
filters.find(button=>button.dataset.ticketFilter==='needs_review').events.click();
assert.equal(api.filteredTickets().length,0);
assert.equal(tickets[4].validationStatus,'needs_review','Display must not rewrite ticket verification or accounting');
assert.equal(writes,0);

// A normal Save & Verify is reflected on returning to the visible page too.
tickets[4] = {...tickets[4],validationStatus:'verified',reviewReasons:[]};
document.events.visibilitychange();
const pending = api.loadTickets();
assert.equal(api.loadTickets(),pending,'Concurrent refreshes must share one fetch');
await pending;
assert.equal(count('verified-count'),'5');
assert.equal(count('review-count'),'0');

// Genuine review, warning, unassigned, spot, and void cases stay distinct.
tickets = [
  {...good,id:'missing-grade',damage:''},
  {...good,id:'future',ticketDate:'2999-01-01'},
  {...good,id:'unassigned',haulingJobId:null},
  {...good,id:'spot',haulingJobId:null,spotLoad:true},
  {...good,id:'warning',haulingJobId:null,validationStatus:'needs_review',reviewReasons:['buyer_not_matched']},
  {...good,id:'void',voided:true},
  {...good,id:'legacy-void',status:'voided'}
];
filters[0].events.click();
await api.loadTickets();
assert.equal(count('today-count'),'4');
assert.equal(count('verified-count'),'1');
assert.equal(count('review-count'),'2');
assert.equal(count('contract-count'),'1');
assert.equal(api.filteredTickets().length,5,'Future review retained; void tickets excluded');
filters.find(button=>button.dataset.ticketFilter==='needs_review').events.click();
assert.deepEqual(Array.from(api.filteredTickets(),t=>t.id).sort(),['future','missing-grade','warning']);
for(const field of ['grainHaulingJobId','_linkedHaulingJobId']) {
  assert.equal(ticketStatus({...good,validationStatus:'needs_review',haulingJobId:null,[field]:'job'},jobs),'good');
}
assert.equal(writes,0,'Loading status must not post unresolved inventory or change tickets');
assert.ok(reads>0);

// The old DOM patch must leave the shared renderer alone, without another data load.
assert.match(html,/<tbody id="grain-ticket-table-body" data-fv-shared-status="1">/);
const legacy = readFileSync(new URL('../js/grain/tickets/grain-ticket-dashboard-warning-patch.js',import.meta.url),'utf8');
await vm.runInNewContext(legacy,{document,location:{pathname:'/pages/grain/grain-ticket.html'}});
console.log('PASS: tracking counters, filters, badges, corrected legacy status, return refresh, real review cases, and no status writes');
