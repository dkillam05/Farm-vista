// A tap starts a dictation session; ordinary browser session endings resume it.
// Explicit stop, send, close, manual editing and backgrounding always end it.
export function wireChatDictation({button,input,section,isAllowed=()=>true,onStatus=()=>{},onIdle=()=>{},doc=document,win=window}) {
  const Recognition=win.SpeechRecognition||win.webkitSpeechRecognition;
  if(!Recognition){button.disabled=true;button.title='Use your keyboard microphone for dictation';return {supported:false,stop(){},destroy(){}};}
  let wanted=false,current=null,restart=0,emptyEnds=0,writing=false,disposed=false;
  const listeners=[];
  const on=(target,name,fn)=>{target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));};
  function paint(){button.classList.toggle('mic-active',wanted);button.setAttribute('aria-pressed',String(wanted));button.setAttribute('aria-label',wanted?'Stop dictation':'Start dictation');button.title=wanted?'Stop dictation':'Start dictation';}
  function stop(message=''){
    wanted=false;win.clearTimeout(restart);restart=0;
    const old=current;current=null;
    if(old){old.onresult=old.onend=old.onerror=old.onstart=null;try{old.abort();}catch{}}
    paint();if(message)onStatus(message);else onIdle();
  }
  function startRecognition(){
    if(disposed||!wanted||!isAllowed()||doc.visibilityState!=='visible'){stop();return;}
    const rec=new Recognition();current=rec;
    rec.lang='en-US';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
    const base=input.value.trim();let hadSpeech=false;
    rec.onstart=()=>{if(current===rec&&wanted)onStatus('Listening… tap the mic to stop.');};
    rec.onresult=event=>{
      if(current!==rec||!wanted||!isAllowed())return;
      // Results are cumulative within this recognition instance. Rebuild rather
      // than append final results again when Safari revises an earlier entry.
      const words=Array.from(event.results,r=>r?.[0]?.transcript?.trim()||'').filter(Boolean).join(' ');
      if(words){hadSpeech=true;emptyEnds=0;}
      writing=true;input.value=[base,words].filter(Boolean).join(' ');input.dispatchEvent(new win.Event('input',{bubbles:true}));writing=false;
    };
    rec.onend=()=>{
      if(current!==rec)return;current=null;
      if(!wanted)return;
      if(!hadSpeech&&++emptyEnds>=3){stop('Dictation paused. Tap the mic when you’re ready.');return;}
      restart=win.setTimeout(()=>{restart=0;startRecognition();},300);
    };
    rec.onerror=event=>{
      if(current!==rec)return;
      if(event.error==='no-speech')return; // onend resumes the still-requested session.
      const denied=['not-allowed','service-not-allowed'].includes(event.error);
      stop(denied?'Microphone access was not allowed. Use your keyboard microphone or check browser permissions.':event.error==='audio-capture'?'No microphone is available. Try your keyboard microphone.':'Dictation stopped. Your words are saved; tap the mic to try again.');
    };
    try{rec.start();}catch{stop('Tap the mic again to start dictation.');}
  }
  on(button,'click',()=>{if(wanted){stop();return;}if(button.disabled||!isAllowed())return;wanted=true;emptyEnds=0;paint();onStatus('Starting microphone…');startRecognition();});
  on(input,'input',()=>{if(wanted&&!writing)stop('Dictation paused while you edit.');});
  on(section,'fv:copilot-toggle',event=>{if(!event.detail?.open)stop();});
  on(doc,'visibilitychange',()=>{if(doc.visibilityState!=='visible')stop();});
  on(win,'pagehide',()=>stop());
  paint();
  return {supported:true,stop,destroy(){disposed=true;stop();listeners.forEach(off=>off());}};
}
