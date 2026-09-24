import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-presentation.js',import.meta.url),'utf8');
const {messageBlocks,messageHtml,messageText,chatTranscript,transferChat}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('field lists render real bullets and preserve every record and detail',()=>{
  const answer='Fields:\n\n- North 40 — 42 acres\n- Creek Farm — 17 acres\n\nTotal: 59 acres';
  assert.equal(messageHtml(answer),'<p>Fields:</p><ul><li>North 40 — 42 acres</li><li>Creek Farm — 17 acres</li></ul><p>Total: 59 acres</p>');
  assert.equal(messageText(answer),'Fields:\n\n• North 40 — 42 acres\n• Creek Farm — 17 acres\n\nTotal: 59 acres');
});
test('numbered, asterisk, unicode and wrapped lists are consistently bulleted',()=>{
  assert.deepEqual(messageBlocks('1. A\n2) B\n* C\n  related detail\n• D'),[{type:'list',items:['A','B','C related detail','D']}]);
  assert.equal(messageHtml('Fields: • North • South'),'<p>Fields:</p><ul><li>North</li><li>South</li></ul>');
});
test('ordinary commas and numeric values are not guessed into list items',()=>{
  assert.equal(messageHtml('Smith, Jones & Sons: 1,200.5 acres.\nUpdated today.'),'<p>Smith, Jones &amp; Sons: 1,200.5 acres.<br>Updated today.</p>');
});
test('model text is escaped, including scripts and image error handlers',()=>{
  const html=messageHtml('**Fields**\n- <img src=x onerror=alert(1)>\n- <script>bad()</script>');
  assert.ok(html.includes('<strong>Fields</strong>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;'));
});
test('transcript includes both sides and errors but not hidden metadata or PDF URLs',()=>{
  const result=chatTranscript([{role:'user',text:'Which fields?',uid:'private-user'},
    {role:'assistant',text:'- North\n- South',proof:'Farm records checked 6:15 AM',token:'private-token'},
    {role:'assistant',text:'API error 403',failed:true},
    {role:'assistant',text:'[[FV_PDF]]:https://private/report?token=secret'},
    {role:'system',text:'hidden'}]);
  assert.match(result,/You:\nWhich fields\?/);
  assert.match(result,/Copilot:\n• North\n• South/);
  assert.match(result,/API error 403/);
  for (const secret of ['private-user','private-token','https://private','secret','hidden']) assert.ok(!result.includes(secret));
  assert.equal(chatTranscript([]),'');
});
test('copy exports exact full text without opening share',async()=>{
  let copied;
  const result=await transferChat('Full chat','copy',{clipboard:{writeText:async text=>{copied=text;}},share:()=>assert.fail('must not share')});
  assert.equal(result,'copied');assert.equal(copied,'Full chat');
});
test('share opens native picker with text, not a public chat link',async()=>{
  let payload;
  assert.equal(await transferChat('Full chat','share',{share:async data=>{payload=data;}}),'shared');
  assert.deepEqual(payload,{title:'FarmVista Copilot conversation',text:'Full chat'});
});
test('share cancellation is silent and never copies or sends elsewhere',async()=>{
  assert.equal(await transferChat('chat','share',{share:async()=>{throw {name:'AbortError'};},clipboard:{writeText:()=>assert.fail('must not copy')}}),'cancelled');
});
test('unsupported sharing copies; permission failures offer manual selection',async()=>{
  assert.equal(await transferChat('chat','share',{clipboard:{writeText:async()=>{}}}),'copied-fallback');
  assert.equal(await transferChat('chat','copy',{clipboard:{writeText:async()=>{throw new Error('denied');}}}),'manual');
  assert.equal(await transferChat('chat','share',{share:async()=>{throw {name:'NotAllowedError'};}}),'manual');
  assert.equal(await transferChat('','copy',{}),'empty');
});
