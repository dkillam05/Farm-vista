import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-dictation.js',import.meta.url),'utf8');
const {wireChatDictation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function setup(){
 const made=[],timers=new Map();let next=1,status='',allowed=true;
 class Rec{constructor(){made.push(this);}start(){this.started=true;this.onstart?.();}abort(){this.aborted=true;}}
 class El extends EventTarget {value='';disabled=false;attrs={};classList={toggle(){}};setAttribute(k,v){this.attrs[k]=v;}}
 const win=new EventTarget();Object.assign(win,{SpeechRecognition:Rec,Event,setTimeout(fn){const id=next++;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
 const doc=new EventTarget();doc.visibilityState='visible';
 const button=new El(),input=new El(),section=new El();input.value='Existing draft';
 const api=wireChatDictation({button,input,section,doc,win,isAllowed:()=>allowed,onStatus:s=>status=s,onIdle:()=>status=''});
 const result=(rec,...words)=>rec.onresult({results:words.map(word=>[{transcript:word}]),resultIndex:words.length-1});
 const tick=()=>{const fns=[...timers.values()];timers.clear();fns.forEach(fn=>fn());};
 return {made,timers,button,input,section,doc,api,result,tick,get status(){return status;},setAllowed(v){allowed=v;}};
}
test('dictation resumes after a session ends and preserves earlier words',()=>{
 const s=setup();s.button.dispatchEvent(new Event('click'));assert.equal(s.made[0].continuous,true);
 s.result(s.made[0],'What is planted');s.made[0].onend();s.tick();
 assert.equal(s.made.length,2);s.result(s.made[1],'in this field');
 assert.equal(s.input.value,'Existing draft What is planted in this field');assert.equal(s.button.attrs['aria-pressed'],'true');
});
test('cumulative and revised speech results never duplicate final text',()=>{
 const s=setup();s.button.dispatchEvent(new Event('click'));s.result(s.made[0],'corn');s.result(s.made[0],'corn','yield');s.result(s.made[0],'corn','yields');
 assert.equal(s.input.value,'Existing draft corn yields');
});
test('stop cancels a pending restart and ignores late recognition results',()=>{
 const s=setup();s.button.dispatchEvent(new Event('click'));s.result(s.made[0],'How many acres');const late=s.made[0].onresult;s.made[0].onend();s.api.stop();s.input.value='';s.tick();late({results:[[{transcript:'late words'}]]});
 assert.equal(s.made.length,1);assert.equal(s.input.value,'');assert.equal(s.button.attrs['aria-pressed'],'false');
});
test('closing, backgrounding and manual edits stop the microphone while preserving the draft',()=>{
 for(const action of ['close','background','edit']){
 const s=setup();s.button.dispatchEvent(new Event('click'));s.result(s.made[0],'Save these words');
 if(action==='close'){const e=new Event('fv:copilot-toggle');e.detail={open:false};s.section.dispatchEvent(e);}
 if(action==='background'){s.doc.visibilityState='hidden';s.doc.dispatchEvent(new Event('visibilitychange'));}
 if(action==='edit'){s.input.value+=' please';s.input.dispatchEvent(new Event('input'));}
 assert.equal(s.made[0].aborted,true);assert.match(s.input.value,/Save these words/);s.tick();assert.equal(s.made.length,1);
 }
});
test('permission errors do not retry and silence retries are bounded',()=>{
 const s=setup();s.button.dispatchEvent(new Event('click'));s.made[0].onerror({error:'not-allowed'});s.tick();assert.equal(s.made.length,1);assert.match(s.status,/not allowed/);
 const quiet=setup();quiet.button.dispatchEvent(new Event('click'));
 for(let i=0;i<3;i++){quiet.made[i].onerror({error:'no-speech'});quiet.made[i].onend();quiet.tick();}
 assert.equal(quiet.made.length,3);assert.equal(quiet.button.attrs['aria-pressed'],'false');
});
test('sign-out cleanup aborts capture and a disabled session cannot restart',()=>{
 const s=setup();s.button.dispatchEvent(new Event('click'));s.made[0].onend();s.setAllowed(false);s.tick();assert.equal(s.made.length,1);
 s.setAllowed(true);s.button.dispatchEvent(new Event('click'));s.api.destroy();assert.equal(s.made[1].aborted,true);s.button.dispatchEvent(new Event('click'));assert.equal(s.made.length,2);
});
