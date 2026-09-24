// Size the expanded conversation to the visible screen, including an iOS keyboard.
export function expandedChatRect({width,height,viewport}) {
  return {top:viewport?.offsetTop||0,left:viewport?.offsetLeft||0,width:viewport?.width||width,height:viewport?.height||height};
}
export function wireChatViewport({section,input,form,log,doc=document,win=window}) {
  const root=doc.documentElement,style=doc.createElement('style');
  style.textContent=`
    #ai-section .portrait-toggle{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:6px 12px;border:1px solid var(--border,#dce4de);border-radius:24px;background:var(--surface,#fff);color:var(--text,#18251c);font:600 14px system-ui;cursor:pointer}
    #ai-section .ai-input{font-size:16px}
    #ai-chat-expanded{position:fixed;inset:var(--fv-chat-top,0px) auto auto var(--fv-chat-left,0px);width:var(--fv-chat-width,100vw);height:var(--fv-chat-height,100dvh);max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;background:var(--surface,#fff);color:var(--text,#18251c);overflow:hidden;box-sizing:border-box}
    #ai-chat-expanded::backdrop{background:rgba(15,30,20,.4)}
    html.fv-copilot-expanded,html.fv-copilot-expanded body{overflow:hidden!important;overscroll-behavior:none}
    html.fv-copilot-expanded fv-shell::part(main){overflow:hidden!important}
    #ai-chat-expanded #ai-section{display:flex!important;flex-direction:column;width:100%;height:100%;max-width:none;margin:0!important;border:0;border-radius:0;box-shadow:none;overflow:hidden}
    #ai-chat-expanded #ai-section>.section-head{flex:0 0 auto;grid-template-columns:26px minmax(0,1fr) auto;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));background:var(--surface,#fff);border-bottom:2px solid #c5b933}
    #ai-chat-expanded .section-head strong{font-size:18px;line-height:1.25}
    #ai-chat-expanded .section-head .sub{font-size:12px;margin-top:3px;color:var(--muted,#67706b)}
    #ai-chat-expanded #ai-section>.ai-body{display:flex!important;flex-direction:column;flex:1 1 auto;min-height:0;gap:0;padding:0;background:var(--surface,#fff)}
    #ai-chat-expanded #ai-section .ai-log{flex:1 1 auto;min-height:0;max-height:none;height:auto;gap:18px;padding:20px max(16px,env(safe-area-inset-right,0px)) 20px max(16px,env(safe-area-inset-left,0px));border:0;border-radius:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable;background:color-mix(in srgb,var(--green,#3b7e46) 4%,var(--surface,#fff));font-size:16px}
    #ai-chat-expanded #ai-section .ai-form{flex:0 0 auto;gap:6px;padding:10px max(16px,env(safe-area-inset-right,0px)) max(10px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));border-top:1px solid var(--border,#dce4de);background:var(--surface,#fff)}
    #ai-chat-expanded #ai-section .ai-input{display:block;min-height:48px;max-height:96px;line-height:1.4;padding:12px 56px 12px 14px;border-radius:22px}
    #ai-chat-expanded #ai-section .ai-mic{width:40px;height:40px;right:5px;cursor:pointer;border-radius:50%;color:var(--text,#18251c)}
    #ai-chat-expanded #ai-section .ai-actions{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:4px;align-items:center}
    #ai-chat-expanded .ai-send{grid-column:1;grid-row:1}
    #ai-chat-expanded .fv-chat-transfer{grid-column:3;grid-row:1;margin:0}
    #ai-chat-expanded .fv-report-create{grid-column:4;grid-row:1}
    #ai-chat-expanded .ai-status{grid-column:1/-1;grid-row:2}
    #ai-chat-expanded .ai-status:empty{display:none}
    #ai-chat-expanded #ai-section .ai-send{min-height:44px;padding:8px 20px;font-size:15px}
    #ai-chat-expanded #ai-section .ai-status{font-size:12px;line-height:1.25}
    #ai-chat-expanded #ai-section .ai-hint{display:none}
    #ai-chat-expanded #ai-section .ai-empty{font-size:15px;max-width:540px;align-self:center;margin:auto;padding:24px;text-align:center}
    @media(min-width:900px){#ai-chat-expanded #ai-section .ai-log{padding-inline:max(28px,calc((100vw - 1040px)/2))}#ai-chat-expanded #ai-section .ai-form{padding-inline:max(28px,calc((100vw - 1040px)/2))}#ai-chat-expanded #ai-section .ai-input{padding-right:14px}}
    @media(max-height:450px){#ai-chat-expanded #ai-section>.section-head{padding-top:6px;padding-bottom:6px}#ai-chat-expanded .section-head .sub{display:none}#ai-chat-expanded #ai-section .ai-log{padding-block:12px}#ai-chat-expanded #ai-section .ai-form{padding-top:6px;padding-bottom:6px}}
  `;
  doc.head.appendChild(style);
  const dialog=doc.createElement('dialog');dialog.id='ai-chat-expanded';dialog.setAttribute('aria-label','FarmVista AI conversation');
  doc.body.appendChild(dialog);
  let home=null,frame=0,disposed=false,returnFocus=null;
  const listeners=[];
  const on=(target,name,fn)=>{target?.addEventListener(name,fn);listeners.push(()=>target?.removeEventListener(name,fn));};
  function resize(){
    frame=0;if(!dialog.open)return;
    const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<60;
    const rect=expandedChatRect({width:win.innerWidth,height:win.innerHeight,viewport:win.visualViewport});
    for(const [key,value]of Object.entries(rect))dialog.style.setProperty('--fv-chat-'+key,value+'px');
    if(nearBottom)log.scrollTop=log.scrollHeight;
  }
  const schedule=()=>{if(!disposed&&!frame)frame=win.requestAnimationFrame(resize);};
  function restore(){
    if(!home||dialog.open)return;
    input.blur();root.classList.remove('fv-copilot-expanded');
    if(home){home.replaceWith(section);home=null;}
    section.classList.remove('is-expanded');
    const button=section.querySelector('.portrait-toggle');
    button?.setAttribute('aria-expanded','false');if(button)button.textContent='Open';
    section.dispatchEvent(new win.CustomEvent('fv:copilot-toggle',{detail:{open:false}}));
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function close(){if(dialog.open)dialog.close();restore();}
  function open(){
    if(dialog.open||disposed||section.classList.contains('perm-hidden')||section.getAttribute('aria-hidden')==='true')return;
    returnFocus=doc.activeElement;
    home=doc.createElement('div');home.id='ai-chat-home';home.hidden=true;
    section.before(home);dialog.appendChild(section);
    root.classList.add('fv-copilot-expanded');
    dialog.showModal();resize();log.scrollTop=log.scrollHeight;
    // Opening a conversation should reveal its messages, not immediately cover
    // them with the keyboard. Typing begins when the user taps the composer.
    section.querySelector('.portrait-toggle')?.focus({preventScroll:true});
  }
  on(section,'fv:copilot-toggle',event=>event.detail?.open?open():close());
  on(dialog,'cancel',event=>{event.preventDefault();close();});
  on(dialog,'close',restore);
  on(win,'resize',schedule);on(win.visualViewport,'resize',schedule);on(win.visualViewport,'scroll',schedule);
  const observer=new win.MutationObserver(()=>{
    if(dialog.open&&(section.classList.contains('perm-hidden')||section.getAttribute('aria-hidden')==='true'))close();
  });
  observer.observe(section,{attributes:true,attributeFilter:['class','aria-hidden']});
  if(section.classList.contains('is-expanded'))open();
  return {close,destroy(){
    close();if(home)restore();disposed=true;listeners.forEach(off=>off());observer.disconnect();win.cancelAnimationFrame(frame);dialog.remove();style.remove();
  }};
}
