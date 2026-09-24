// No model-provided HTML is trusted. Only paragraphs, bullets and bold text.
export function messageBlocks(value) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => { if (paragraph.length) blocks.push({type:'paragraph', text:paragraph.join('\n')}); paragraph=[]; };
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').replace(/\s+•\s+/g, '\n• ').split('\n');
  for (const line of lines) {
    const text = line.trim();
    if (!text) { flush(); list=null; continue; }
    const bullet = text.match(/^(?:[-*+•]\s+|\d+[.)]\s+)(.+)$/);
    if (bullet) {
      flush();
      if (!list) { list={type:'list', items:[]}; blocks.push(list); }
      list.items.push(bullet[1]);
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length-1] += ' ' + text;
    } else {
      list=null;
      paragraph.push(text.replace(/^#{1,6}\s+/, ''));
    }
  }
  flush();
  return blocks;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function inlineHtml(value) {
  return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
export function messageHtml(value) {
  return messageBlocks(value).map(block => block.type==='list'
    ? '<ul>' + block.items.map(item => '<li>' + inlineHtml(item) + '</li>').join('') + '</ul>'
    : '<p>' + inlineHtml(block.text) + '</p>').join('');
}
export function messageText(value) {
  const plain = text => text.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  return messageBlocks(value).map(block => block.type==='list'
    ? block.items.map(item => '• ' + plain(item)).join('\n') : plain(block.text)).join('\n\n');
}
export function chatTranscript(history) {
  const messages = (Array.isArray(history) ? history : []).filter(message =>
    message && ['user','assistant'].includes(message.role) && typeof message.text==='string' && message.text.trim());
  if (!messages.length) return '';
  return 'FarmVista Copilot — conversation\n\n' + messages.map(message => {
    // Never export a legacy PDF URL, which may contain private access parameters.
    const text = message.text.startsWith('[[FV_PDF]]:') ? '[Report attachment not included]' : messageText(message.text);
    return (message.role==='user' ? 'You' : 'Copilot') + ':\n' + text + (message.proof ? '\n' + String(message.proof) : '');
  }).join('\n\n');
}

// Called directly from a click so iPhone's user-activation requirement is kept.
export async function transferChat(text, action, nav) {
  if (!text) return 'empty';
  if (action==='share' && typeof nav.share==='function') {
    try { await nav.share({title:'FarmVista Copilot conversation', text}); return 'shared'; }
    catch (error) { return error?.name==='AbortError' ? 'cancelled' : 'manual'; }
  }
  if (typeof nav.clipboard?.writeText==='function') {
    try { await nav.clipboard.writeText(text); return action==='share' ? 'copied-fallback' : 'copied'; }
    catch { /* Manual selection remains available when clipboard access is denied. */ }
  }
  return 'manual';
}

export function mountChatActions({host, getHistory, isCurrent, doc=document, nav=navigator}) {
  const root=doc.createElement('div');
  root.className='fv-chat-transfer';
  root.innerHTML=`<div class="fv-chat-transfer-buttons">
    <button type="button" class="fv-chat-icon" data-action="copy" title="Copy chat" aria-label="Copy chat"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
    <button type="button" class="fv-chat-icon" data-action="share" title="Share chat" aria-label="Share chat"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M7 10H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/></svg></button>
  </div><span class="fv-chat-transfer-status" role="status" aria-live="polite"></span>`;
  const style=doc.createElement('style');
  style.textContent=`
    .fv-chat-transfer{margin-left:auto;flex:0 0 auto;max-width:120px;align-self:center}
    #ai-section .ai-actions{flex-wrap:wrap}
    #ai-section .ai-status{flex:1 1 60px;min-width:0;overflow-wrap:anywhere}
    .fv-chat-transfer-buttons{display:flex;gap:2px;justify-content:flex-end}
    #ai-section .fv-chat-icon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border:0;border-radius:9px;background:transparent;color:var(--text,#18251c);cursor:pointer}
    #ai-section .fv-chat-icon svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    #ai-section .fv-chat-icon:disabled{opacity:.35;cursor:default}
    #ai-section .fv-chat-icon:focus-visible{outline:2px solid var(--green,#3b7e46);outline-offset:1px}
    #ai-section .fv-chat-icon:not(:disabled):hover{background:color-mix(in srgb,currentColor 8%,transparent)}
    .fv-chat-transfer-status{display:block;text-align:right;font-size:11px;line-height:1.3;color:var(--text,#18251c)}
    #ai-section .fv-chat-content{white-space:normal;line-height:1.55;overflow-wrap:anywhere}
    #ai-section .fv-chat-content p{margin:0 0 10px}
    #ai-section .fv-chat-content ul{display:block;list-style:disc outside;margin:8px 0 12px;padding-left:22px}
    #ai-section .fv-chat-content li{display:list-item;margin:0 0 7px;padding-left:2px}
    #ai-section .fv-chat-content>:last-child{margin-bottom:0}
    .fv-chat-copy-dialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:85vh;border:1px solid var(--border,#ccc);border-radius:14px;padding:18px;background:var(--surface,#fff);color:var(--text,#18251c)}
    .fv-chat-copy-dialog::backdrop{background:rgba(0,0,0,.55)}
    .fv-chat-copy-dialog textarea{box-sizing:border-box;width:100%;height:40vh;font:16px/1.5 sans-serif;background:var(--surface,#fff);color:inherit;border:1px solid var(--border,#ccc)}
    .fv-chat-copy-dialog button{min-height:44px;margin-top:10px;padding:8px 14px;border:0;border-radius:8px;background:#2f6c3c;color:#fff;font:inherit}
  `;
  doc.head.appendChild(style);
  host.appendChild(root);
  const buttons=[...root.querySelectorAll('button')];
  const feedback=root.querySelector('[role="status"]');
  let busy=false, dialog=null;
  function refresh() {
    const current=isCurrent();
    buttons.forEach(button => { button.disabled=busy || !current || !chatTranscript(getHistory()); });
    if (!current) { feedback.textContent=''; dialog?.close(); dialog?.remove(); dialog=null; }
  }
  function manualCopy(text) {
    dialog?.remove();
    const modal=doc.createElement('dialog');
    dialog=modal;
    modal.className='fv-chat-copy-dialog';
    modal.setAttribute('aria-label','Copy conversation');
    modal.innerHTML='<p>Your browser could not copy or share automatically. Select the conversation below and choose Copy.</p><textarea readonly aria-label="Conversation to copy"></textarea><button type="button">Done</button>';
    const area=modal.querySelector('textarea');
    area.value=text;
    modal.querySelector('button').addEventListener('click',()=>modal.close());
    modal.addEventListener('close',()=>{modal.remove();if(dialog===modal) dialog=null;});
    doc.body.appendChild(modal);
    modal.showModal(); area.focus(); area.select();
  }
  buttons.forEach(button => button.addEventListener('click',async()=>{
    if (busy || !isCurrent()) return;
    const text=chatTranscript(getHistory());
    busy=true; feedback.textContent=''; refresh();
    try {
      const result=await transferChat(text,button.dataset.action,nav);
      if (!isCurrent()) return;
      if (result==='manual') manualCopy(text);
      feedback.textContent=({copied:'Chat copied', 'copied-fallback':'Chat copied — paste to share', shared:'Chat shared', empty:'No messages yet'})[result] || '';
    } finally {busy=false;refresh();}
  }));
  refresh();
  return {refresh};
}
