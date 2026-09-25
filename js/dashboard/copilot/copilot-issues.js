import {wireChatDictation} from './copilot-dictation.js';
export const ISSUE_CATEGORIES={error:'Error or failed to load',wrong_resource:'Wrong farm, field, or equipment',wrong_numbers:'Numbers or calculations seem wrong',incomplete:'Missing information or incomplete answer',other:'Other'};
// Beta-only private repair reports. No farm credentials or continuation tokens are submitted.
export function issuePayload(history,index,note,requestId,clientVersion='',category=''){
  if(!Number.isInteger(index)||history[index]?.role!=='assistant')throw new Error('Select an answer to report.');
  if(!Object.hasOwn(ISSUE_CATEGORIES,category))throw new Error('Choose what went wrong.');
  if(category!=='error'&&!String(note||'').trim())throw new Error('Please explain what seems wrong or what you expected.');
  const messages=history.slice(Math.max(0,index-19),index+1).filter(m=>['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.trim()).map(m=>({role:m.role,text:m.text.slice(0,6000)}));
  return {requestId,messages,category,note:String(note||'').trim().slice(0,1500),clientVersion};
}
export function createIssueManager({getHistory,getToken,isCurrent,projectId,endpoint='https://farmvista-copilot-300398089669.us-central1.run.app/issues/beta',doc=document,request=fetch}){
  let dialog=null,controller=null,dictation=null;
  async function api(path='',options={}){
    if(!isCurrent())throw new Error('Reload FarmVista to continue.');
    const token=await getToken();if(!isCurrent())throw new Error('Your sign-in changed.');
    const res=await request(endpoint+path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:controller?.signal});
    if(!isCurrent())throw new Error('Your sign-in changed.');
    if(!res.ok){let data;try{data=await res.json();}catch{}throw new Error(typeof data?.error==='string'?data.error:'The issue service could not be reached. Try again.');}
    return res;
  }
  function destroy(){dictation?.destroy();dictation=null;controller?.abort();controller=null;const old=dialog;dialog=null;old?.close();old?.remove();}
  function open(){
    if(!isCurrent())return;destroy();controller=new AbortController();
    const modal=doc.createElement('dialog');dialog=modal;modal.className='fv-chat-copy-dialog fv-issue-dialog';modal.setAttribute('aria-label','Report an issue');
    modal.innerHTML=`<style>
      dialog.fv-issue-dialog select{border:1px solid var(--border,#b9c4bc)!important;border-radius:9px;padding:10px 12px;box-shadow:0 1px 2px rgba(0,0,0,.04);font-size:16px!important;appearance:auto;-webkit-appearance:menulist;}
      dialog.fv-issue-dialog button:not([data-mic]){background:#2f6c3c!important;color:#fff!important;-webkit-text-fill-color:#fff!important;}
      dialog.fv-issue-dialog .fv-issue-note-wrap{position:relative;margin-top:6px;}
      dialog.fv-issue-dialog .fv-issue-note-wrap textarea{display:block;margin:0;padding:10px 48px 12px 10px;min-height:110px;resize:vertical;}
      dialog.fv-issue-dialog button[data-mic]{position:absolute;right:4px;bottom:4px;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;min-height:40px;margin:0;padding:0;border:0;border-radius:8px;background:transparent!important;color:var(--text,#18251c)!important;-webkit-text-fill-color:currentColor!important;cursor:pointer;}
      dialog.fv-issue-dialog button[data-mic] svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
      dialog.fv-issue-dialog button[data-mic].mic-active{background:#2f6c3c!important;color:#fff!important;-webkit-text-fill-color:#fff!important;}
      dialog.fv-issue-dialog button[data-mic]:disabled{opacity:.4;cursor:default;}
      dialog.fv-issue-dialog :is(select,textarea,button):focus-visible{outline:2px solid #3b7e46;outline-offset:2px;}
      </style><h2 style="margin:0 0 10px;font-size:18px">Report an issue <small style="font-size:11px;opacity:.6">BETA</small></h2>
      <p style="font-size:14px;line-height:1.5">Send an answer and nearby conversation privately to the repair agent. It can investigate and prepare a tested code fix for owner review. Publishing and a corrected live answer are not automatic.</p>
      <label style="display:block;font-size:14px">Answer to report<select data-answer style="display:block;box-sizing:border-box;width:100%;min-height:44px;margin:6px 0 12px;font:inherit;color:inherit;background:var(--surface,#fff)"></select></label>
      <label style="display:block;font-size:14px">What went wrong? (required)<select data-category required style="display:block;box-sizing:border-box;width:100%;min-height:44px;margin:6px 0 12px;font:inherit;color:inherit;background:var(--surface,#fff)"><option value="">Choose a reason</option>${Object.entries(ISSUE_CATEGORIES).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>
      <label for="fv-issue-note" style="display:block;font-size:14px"><span data-note-label>What seems wrong or what did you expect? (required)</span></label>
      <div class="fv-issue-note-wrap"><textarea id="fv-issue-note" data-note maxlength="1500" style="height:110px;border-radius:8px" placeholder="For example: These acres seem too low."></textarea><button type="button" data-mic aria-label="Start dictation" title="Start dictation"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg></button></div><p data-mic-status role="status" style="font-size:12px;margin:6px 0"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-submit>Send report</button><button type="button" data-list>My reports</button><button type="button" data-close>Close</button></div>
      <p data-status role="status" aria-live="polite" style="font-size:14px;line-height:1.5"></p><div data-results></div>`;
    const select=modal.querySelector('[data-answer]'),note=modal.querySelector('[data-note]'),submit=modal.querySelector('[data-submit]'),status=modal.querySelector('[data-status]'),results=modal.querySelector('[data-results]');
    const category=modal.querySelector('[data-category]'),mic=modal.querySelector('[data-mic]'),micStatus=modal.querySelector('[data-mic-status]');
    category.addEventListener('change',()=>{note.required=category.value!=='error';modal.querySelector('[data-note-label]').textContent=note.required?'What seems wrong or what did you expect? (required)':'Anything else? (optional)';});
    note.required=true;
    const snapshot=getHistory().map(m=>({...m}));
    snapshot.forEach((m,index)=>{if(m.role!=='assistant')return;const option=doc.createElement('option');option.value=String(index);option.textContent=m.text.slice(0,110);select.appendChild(option);select.value=String(index);});
    submit.disabled=!select.options.length;
    if(!select.options.length)status.textContent='No answers in this chat. Your previous reports are still available.';
    let requestId=crypto.randomUUID(),submitted=false;
    const current=()=>dialog===modal&&isCurrent();
    function showIssue(issue){
      const card=doc.createElement('div');card.style.cssText='padding:12px 0;border-top:1px solid var(--border,#ccc);font-size:14px;overflow-wrap:anywhere';
      const heading=doc.createElement('strong');heading.textContent=({starting:'Starting',investigating:'Investigating',ready_for_review:'Fix ready for owner review',needs_attention:'Needs attention'})[issue.status]||'Report saved';card.appendChild(heading);
      const date=doc.createElement('div');date.style.cssText='font-size:12px;opacity:.65;margin-top:4px';date.textContent=new Date(issue.createdAt).toLocaleString();card.appendChild(date);
      const summary=doc.createElement('p');summary.textContent=issue.summary;card.appendChild(summary);
      const refresh=doc.createElement('button');refresh.type='button';refresh.textContent='Check progress';refresh.addEventListener('click',async()=>{refresh.disabled=true;try{const data=await(await api('/'+issue.id)).json();if(current()){card.remove();showIssue(data.issue);}}catch(e){if(current())status.textContent=e.message;}finally{refresh.disabled=false;}});card.appendChild(refresh);
      for(const artifact of issue.artifacts||[]){const button=doc.createElement('button');button.type='button';button.textContent='Download '+artifact.name;button.style.marginLeft='8px';button.addEventListener('click',async()=>{button.disabled=true;try{const res=await api('/'+issue.id+'/artifacts/'+encodeURIComponent(artifact.id));const blob=await res.blob();if(!current())return;const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download=artifact.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(current())status.textContent=e.message;}finally{button.disabled=false;}});card.appendChild(button);}
      results.appendChild(card);
    }
    submit.addEventListener('click',async()=>{
      if(submitted||!current())return;
      dictation?.stop();let payload;try{payload=issuePayload(snapshot,Number(select.value),note.value,requestId,window.FV_VERSION?.number||'',category.value);}catch(e){status.textContent=e.message;if(!category.value)category.focus();else note.focus();return;}
      submit.disabled=true;select.disabled=true;note.disabled=true;category.disabled=true;mic.disabled=true;status.textContent='Saving report and starting the repair agent…';
      try{const body={...payload,projectId};const data=await(await api('',{method:'POST',body:JSON.stringify(body)})).json();if(!current())return;submitted=true;status.textContent='Report saved. You can close this window and check My reports later.';results.replaceChildren();showIssue(data.issue);}
      catch(e){if(current()){status.textContent=e.message+' You can retry safely.';submit.disabled=false;/* Keep the same report body and ID after an uncertain response. */}}
    });
    dictation=wireChatDictation({button:mic,input:note,section:modal,doc,isAllowed:()=>current()&&!note.disabled,onStatus:text=>{micStatus.textContent=text;},onIdle:()=>{micStatus.textContent='';}});
    note.addEventListener('input',()=>{if(note.value.length>1500)note.value=note.value.slice(0,1500);});
    modal.querySelector('[data-list]').addEventListener('click',async()=>{status.textContent='Loading your reports…';try{const data=await(await api()).json();if(!current())return;results.replaceChildren();data.issues.forEach(showIssue);status.textContent=data.issues.length?'Reports stay saved when you clear chat history.':'No reports submitted yet.';}catch(e){if(current())status.textContent=e.message;}});
    modal.querySelector('[data-close]').addEventListener('click',()=>modal.close());
    modal.addEventListener('close',()=>{if(dialog===modal)destroy();});doc.body.appendChild(modal);modal.showModal();
  }
  return {open,destroy};
}
