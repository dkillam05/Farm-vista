import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-context.js',import.meta.url),'utf8');
const {scopeKeys,requestHistory,safeSources,readProof}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('chat history storage is isolated by farm and user',()=>{
  const options={storageKey:'chat',threadKey:'thread',contKey:'cont',lastKey:'last'};
  assert.notEqual(scopeKeys(options,'a','u').storageKey,scopeKeys(options,'b','u').storageKey);
  assert.notEqual(scopeKeys(options,'a','u').storageKey,scopeKeys(options,'a','v').storageKey);
  assert.throws(()=>scopeKeys(options,'a',''));
});
test('send prior turns once, exclude errors and PDF placeholders',()=>{
  const history=[{role:'user',text:'How much corn?'},{role:'assistant',text:'200 bu'},{role:'assistant',text:'API error',failed:true},{role:'assistant',text:'[[FV_PDF]]:bad'},{role:'user',text:'What about beans?'}];
  assert.deepEqual(requestHistory(history,'What about beans?'),[{role:'user',content:'How much corn?'},{role:'assistant',content:'200 bu'}]);
});
test('source links only allow known FarmVista pages, never external or script URLs',()=>{
  const sources=[{path:'javascript:alert(1)'},{path:'https://example.com'},{path:'//example.com'},{path:'/pages/setup/fields.html',label:'Fields'},{path:'/pages/setup/fields.html',label:'Duplicate'}];
  assert.deepEqual(safeSources(sources),[{path:'/pages/setup/fields.html',label:'Fields'}]);
});

test('source evidence distinguishes Deere, FarmVista and incomplete searches',()=>{
  const base={dataMode:'live',successfulReads:1,asOf:'2026-09-24T20:00:00Z'};
  const farm={system:'farmvista',path:'/pages/grain/grain-bags.html',label:'Grain bags'};
  const deere={system:'john_deere',path:'/pages/setup/company-details.html',label:'John Deere agronomic operations',dataset:'seeding',organization:{name:'Dowson Farms'},coverage:{fieldsChecked:125,operationsChecked:340,completeMatchList:true}};
  assert.match(readProof({...base,sources:[farm]}),/^FarmVista checked/);
  const proof=readProof({...base,sources:[deere]});
  assert.match(proof,/^John Deere checked/);assert.match(proof,/Dowson Farms/);assert.match(proof,/125 fields · 340 operations · scope fully checked/);
  assert.match(readProof({...base,sources:[farm,deere]}),/^John Deere \+ FarmVista checked/);
  assert.match(readProof({...base,sources:[{...deere,coverage:{...deere.coverage,completeMatchList:false}}]}),/incomplete search/);
  assert.equal(readProof({...base,successfulReads:0,sources:[deere]}),null);
  assert.equal(readProof({unverified:true}),null);
});
test('proof shows actual crop, variety, field and date scope with breakdown coverage',()=>{
  const proof=readProof({dataMode:'live',successfulReads:1,asOf:'2026-09-24T20:00:00Z',sources:[{
    system:'john_deere',dataset:'seeding',query:{field:'West',crop:'corn',variety:'Pioneer 1742',cropSeason:2026,startDate:'2026-04-01',endDate:'2026-05-01'},
    coverage:{fieldsChecked:1,operationsChecked:4,breakdownsChecked:2,filteredByCrop:1,filteredByDates:1,completeMatchList:true}
  }]});
  for(const text of ['Crop: corn','Variety: Pioneer 1742','Field: West','Season: 2026','Dates: 2026-04-01 to 2026-05-01','2 breakdowns checked','1 excluded by crop','1 outside dates'])assert.ok(proof.includes(text),text);
  assert.ok(!proof.includes('undefined'));
});
