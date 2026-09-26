import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-transport.js',import.meta.url),'utf8');
const {recoverableChat}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const payload={requestId:'test-request-123456',text:'Cody RTK?',continuation:'old'};
const base={endpoint:'https://test.invalid/chat',payload,getToken:async()=>'verified',sameSession:()=>true,sleep:async()=>{}};
test('dropped response and pending status recover with identical request body, not a new question',async()=>{
 let calls=0,modelRuns=0;const bodies=[],statuses=[];const answer={ok:true,text:'Divernon 4010',meta:{continuation:'next'}};
 const result=await recoverableChat({...base,onRecover:s=>statuses.push(s),fetchImpl:async(u,o)=>{bodies.push(o.body);calls++;
   if(calls===1){modelRuns++;throw new TypeError('Load failed');}
   if(calls===2)return {status:202,ok:true,json:async()=>({ok:true,pending:true})};
   return {status:200,ok:true,json:async()=>answer};
 }});
 assert.deepEqual(result,answer);assert.equal(modelRuns,1);assert.equal(new Set(bodies).size,1);assert.equal(statuses.length,2);
});
test('permission errors are terminal and a changed login stops recovery',async()=>{
 let calls=0;await assert.rejects(recoverableChat({...base,fetchImpl:async()=>{calls++;return {status:403,ok:false,json:async()=>({error:'Denied'})};}}),/Denied/);assert.equal(calls,1);
 await assert.rejects(recoverableChat({...base,sameSession:()=>false,fetchImpl:async()=>{throw new Error('must not send');}}),/sign-in changed/);
});
test('broken JSON after completed response is recovered using the same identifier',async()=>{
 let calls=0;const r=await recoverableChat({...base,fetchImpl:async()=>({status:200,ok:true,json:async()=>{if(++calls===1)throw new TypeError('stream interrupted');return {ok:true,text:'Saved answer'};}})});
 assert.equal(r.text,'Saved answer');assert.equal(calls,2);
});
test('stopping a question interrupts recovery before any further request',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(recoverableChat({...base,signal:controller.signal,onRecover:()=>controller.abort(new Error('Stopped')),
   fetchImpl:async()=>{calls++;throw new TypeError('Failed to fetch');}}),/Stopped/);
 assert.equal(calls,1);
});
