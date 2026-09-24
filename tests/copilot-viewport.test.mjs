import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-viewport.js',import.meta.url),'utf8');
const {expandedChatRect}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('expanded conversation uses the available phone or desktop screen',()=>{
  assert.deepEqual(expandedChatRect({width:390,height:844}),{top:0,left:0,width:390,height:844});
  assert.deepEqual(expandedChatRect({width:1440,height:900}),{top:0,left:0,width:1440,height:900});
});
test('keyboard and visual viewport panning keep the entire composer on screen',()=>{
  assert.deepEqual(expandedChatRect({width:390,height:844,viewport:{width:390,height:450,offsetTop:80,offsetLeft:0}}),{top:80,left:0,width:390,height:450});
});
test('rotation and keyboard dismissal use new bounds rather than a stale baseline',()=>{
  assert.deepEqual(expandedChatRect({width:844,height:390,viewport:{width:844,height:340,offsetTop:0}}),{top:0,left:0,width:844,height:340});
  assert.deepEqual(expandedChatRect({width:390,height:844,viewport:{width:390,height:844,offsetTop:0}}),{top:0,left:0,width:390,height:844});
});

const {wireChatViewport}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
// A small DOM harness exercises reparenting and queued dialog-close events.
function setup(){
 const queued=[],frames=new Map();let next=1,doc,observation;
 class Element extends EventTarget{
  constructor(tag='div'){super();this.tag=tag;this.children=[];this.attrs={};this.open=false;this.scrollTop=0;this.scrollHeight=1200;this.clientHeight=600;this.style={setProperty:(k,v)=>this.attrs[k]=v};const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)};}
  appendChild(el){el.remove();this.children.push(el);el.parentNode=this;return el;}
  before(el){el.remove();const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),0,el);el.parentNode=this.parentNode;}
  replaceWith(el){el.remove();const parent=this.parentNode;parent.children.splice(parent.children.indexOf(this),1,el);el.parentNode=parent;this.parentNode=null;}
  remove(){if(this.parentNode){const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k]??null;}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  focus(){doc.activeElement=this;}blur(){if(doc.activeElement===this)doc.activeElement=null;}
  querySelector(selector){return selector==='.portrait-toggle'?this.children.find(el=>el.tag==='button'):null;}
  showModal(){this.open=true;}
  close(){this.open=false;queued.push(()=>this.dispatchEvent(new Event('close')));}
 }
 doc={head:new Element('head'),body:new Element('body'),documentElement:new Element('html'),createElement:tag=>new Element(tag),activeElement:null};
 const win=new EventTarget();Object.assign(win,{innerWidth:390,innerHeight:844,visualViewport:new EventTarget(),CustomEvent:class extends Event{constructor(type,init){super(type);this.detail=init.detail;}},MutationObserver:class{constructor(callback){observation=callback;}observe(){}disconnect(){observation=()=>{};}},requestAnimationFrame(fn){const id=next++;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);}});
 const home=doc.body.appendChild(new Element()),section=home.appendChild(new Element()),button=section.appendChild(new Element('button')),input=new Element('textarea'),log=new Element();
 section.appendChild(input);section.appendChild(log);input.value='Keep this unsent draft';log.textContent='Saved conversation';button.focus();
 const api=wireChatViewport({section,input,log,doc,win});
 const dialog=doc.body.children.find(el=>el.tag==='dialog');
 const toggle=open=>{if(open)section.classList.add('is-expanded');else section.classList.remove('is-expanded');section.dispatchEvent(new win.CustomEvent('fv:copilot-toggle',{detail:{open}}));};
 const flush=()=>{queued.splice(0).forEach(fn=>fn());const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
 return {doc,win,home,section,button,input,log,api,dialog,toggle,flush,observe:()=>observation()};
}
test('opening, rotating and closing preserves the conversation, draft and responsive home',()=>{
 const s=setup();s.toggle(true);
 assert.equal(s.dialog.open,true);assert.equal(s.section.parentNode,s.dialog);assert.equal(s.doc.activeElement,s.button);
 assert.equal(s.dialog.attrs['--fv-chat-height'],'844px');
 // The dashboard moves the placeholder when a phone rotates to another column.
 const other=s.doc.createElement('aside');s.doc.body.appendChild(other);other.appendChild(s.home.children[0]);
 Object.assign(s.win.visualViewport,{width:844,height:340,offsetTop:12});s.win.visualViewport.dispatchEvent(new Event('resize'));s.flush();
 assert.equal(s.dialog.attrs['--fv-chat-height'],'340px');assert.equal(s.dialog.attrs['--fv-chat-top'],'12px');
 s.toggle(false);s.flush();
 assert.equal(s.section.parentNode,other);assert.equal(s.doc.documentElement.classList.contains('fv-copilot-expanded'),false);
 assert.equal(s.input.value,'Keep this unsent draft');assert.equal(s.log.textContent,'Saved conversation');assert.equal(s.button.attrs['aria-expanded'],'false');
});
test('a delayed close event cannot tear down a newly reopened chat',()=>{
 const s=setup();s.toggle(true);s.toggle(false);s.toggle(true);s.flush();
 assert.equal(s.dialog.open,true);assert.equal(s.section.parentNode,s.dialog);assert.equal(s.doc.documentElement.classList.contains('fv-copilot-expanded'),true);
 s.api.destroy();s.flush();assert.equal(s.section.parentNode,s.home);assert.equal(s.dialog.isConnected,false);
});
test('Escape and revoked access close the modal and release the dashboard',()=>{
 const s=setup();s.toggle(true);s.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));s.flush();
 assert.equal(s.dialog.open,false);assert.equal(s.section.parentNode,s.home);
 s.toggle(true);s.section.classList.add('perm-hidden');s.observe();s.flush();
 assert.equal(s.dialog.open,false);assert.equal(s.doc.documentElement.classList.contains('fv-copilot-expanded'),false);
});
