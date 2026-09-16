/* =====================================================================
   FarmVista — Elevator OCR Template Safety
   Generic Cloud OCR + elevator-specific GitHub interpretation.
===================================================================== */
(function () {
  'use strict';
  const pagePath=String(window.location.pathname||'').toLowerCase();
  if(!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if(window.__FV_ELEVATOR_GRADE_FIX_20260916_6) return;
  window.__FV_ELEVATOR_GRADE_FIX_20260916_6=true;

  /* Preserve ticket detail for OCR. The production scanner normally reduces
     images before sending them. Keep the original pixel dimensions and use
     maximum JPEG quality on this page only. */
  if(!window.__FV_GRAIN_TICKET_FULL_RES_CAPTURE_20260916_V2){
    window.__FV_GRAIN_TICKET_FULL_RES_CAPTURE_20260916_V2=true;
    const originalDrawImage=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
      try{
        if(source instanceof HTMLImageElement&&args.length===4&&source.naturalWidth>0&&source.naturalHeight>0&&
          (source.naturalWidth>this.canvas.width||source.naturalHeight>this.canvas.height)&&Math.max(this.canvas.width,this.canvas.height)<=2200){
          this.canvas.width=source.naturalWidth; this.canvas.height=source.naturalHeight;
          return originalDrawImage.call(this,source,0,0,source.naturalWidth,source.naturalHeight);
        }
      }catch(_){}
      return originalDrawImage.call(this,source,...args);
    };
    const originalToBlob=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){
      const mime=String(type||'').toLowerCase();
      return originalToBlob.call(this,callback,type,(mime==='image/jpeg'||mime==='image/jpg')?1.0:quality);
    };
  }

  const scoularTemplateReady=(()=>{
    if(window.FVGrainTicketTemplates?.scoularWaverly) return Promise.resolve(true);
    return new Promise(resolve=>{
      const old=document.querySelector('script[data-fv-scoular-waverly-template]');
      if(old) old.remove();
      const script=document.createElement('script');
      script.src='/js/grain-ticket-templates/scoular-waverly.js?v=20260916-6';
      script.dataset.fvScoularWaverlyTemplate='1';
      script.onload=()=>resolve(true);
      script.onerror=()=>{console.warn('[Grain Ticket] Scoular Waverly template failed to load.');resolve(false);};
      document.head.appendChild(script);
    });
  })();

  const originalFetch=window.fetch.bind(window);
  const clean=v=>String(v==null?'':v).trim();
  const compact=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const responseRoot=data=>data?.grainTicket?data:data?.result?.grainTicket?data.result:data?.ocrResult?.grainTicket?data.ocrResult:null;
  const documentText=(data,root)=>clean(root?.documentText||data?.documentText||root?.document?.text||data?.document?.text||data?.result?.documentText||data?.ocrResult?.documentText||root?.grainTicket?.rawText||'');
  const patchField=(root,name,value)=>{if(!Number.isFinite(value))return false;root.grainTicket||={};root.fields||={};root.grainTicket[name]=value;root.fields[name]=value;return true;};

  function isAdmDecatur(root,text){const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));return(e.includes('admprocessing')||e.includes('archerdanielsmidland'))&&e.includes('decatur')&&(e.includes('4666fairiesparkway')||e.includes('fairiesparkway'));}
  function valueBeforeAnchor(text,anchor){const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+'+anchor+'\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;}
  function patchAdm(data){const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);if(!isAdmDecatur(root,text))return false;let changed=false;changed=patchField(root,'testWeight',valueBeforeAnchor(text,'AC'))||changed;changed=patchField(root,'moisture',valueBeforeAnchor(text,'GN'))||changed;changed=patchField(root,'damage',valueBeforeAnchor(text,'OP'))||changed;changed=patchField(root,'foreignMaterial',valueBeforeAnchor(text,'CO'))||changed;return changed;}

  function isBartlettJacksonville(root,text){const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));return e.includes('bartlett')&&e.includes('jacksonville')&&(e.includes('2350southmain')||e.includes('southmain')||e.includes('unitedstateswarehouseact'));}
  function bartlettGradeBlock(text){const source=String(text||'').replace(/\r/g,'\n');const start=source.search(/GRADE\s*FACTOR/i);if(start<0)return null;let block=source.slice(start,start+700);const stop=block.search(/(?:\bINSPECTOR\b|\bGROSS\s+BU\b|\bNET\s+BU\b|\bSHRINK\s+BU\b)/i);if(stop>0)block=block.slice(0,stop);const read=label=>{const m=block.match(new RegExp('(?:^|\\n|\\s)'+label+'\\s*[:=-]?\\s*([0-9]{1,3}(?:\\.[0-9]{1,2})?)\\b','i'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;};return{testWeight:read('TW'),moisture:read('MT'),damage:read('DM'),foreignMaterial:read('BCFM')};}
  function labeledNumber(text,label,requireLb=false){const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b';const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i'));if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function patchBartlett(data){const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);if(!isBartlettJacksonville(root,text))return false;const ticket=root.grainTicket,grades=bartlettGradeBlock(text)||{};let changed=false;changed=patchField(root,'testWeight',grades.testWeight)||changed;changed=patchField(root,'moisture',grades.moisture)||changed;changed=patchField(root,'damage',grades.damage)||changed;changed=patchField(root,'foreignMaterial',grades.foreignMaterial)||changed;const gross=labeledNumber(text,'GROSS',true),tare=labeledNumber(text,'TARE',true),net=labeledNumber(text,'NET',true);if(Number.isFinite(gross)){ticket.grossWeight=gross;changed=true;}if(Number.isFinite(tare)){ticket.tareWeight=tare;changed=true;}if(Number.isFinite(net)){ticket.netWeight=net;changed=true;}ticket.elevatorName='Bartlett Grain';ticket.deliveryStreet='2350 South Main';ticket.deliveryCity='Jacksonville';ticket.deliveryState='IL';ticket.deliveryZip='62650';return changed;}

  function resolvedScoularError(message,result){
    const s=String(message||'').toLowerCase();
    if(result.grades&&(s.includes('test weight')||s.includes('moisture')||s.includes('damage')||s.includes('foreign material')||s.includes('grade')))return true;
    if(result.weights&&(s.includes('gross minus tare')||s.includes('gross weight')||s.includes('tare weight')||s.includes('net weight')))return true;
    if(result.bushels&&s.includes('bushel'))return true;
    return false;
  }

  function patchScoular(data){
    const root=responseRoot(data);if(!root?.grainTicket)return false;
    const text=documentText(data,root),template=window.FVGrainTicketTemplates?.scoularWaverly;
    if(!template||!text)return false;
    const result=template.apply(root.grainTicket,text);if(!result.matched)return false;

    /* The generic Cloud response now intentionally carries documentText rather
       than the enormous Document AI object. The existing scanner still checks
       result.document.text in a few places, so expose the SAME text there too. */
    root.document=root.document||{};
    root.document.text=text;
    root.documentText=text;

    root.fields=root.fields||{};
    for(const name of ['testWeight','moisture','damage','foreignMaterial']){
      if(Number.isFinite(root.grainTicket[name]))root.fields[name]=root.grainTicket[name];
    }

    root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>!resolvedScoularError(message,result)):[];
    if(result.complete){
      root.scanValid=root.scanErrors.length===0;
    }else{
      root.scanValid=false;
      if(!root.scanErrors.some(x=>String(x).includes('Scoular Waverly ticket could not be fully verified'))){
        root.scanErrors.push('Scoular Waverly ticket could not be fully verified from OCR. Please review.');
      }
    }
    console.log('[Grain Ticket] Scoular Waverly FINAL GitHub template:',{result,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket:root.grainTicket});
    return true;
  }

  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);
    try{
      const type=clean(response.headers.get('content-type')).toLowerCase();
      if(!type.includes('application/json'))return response;
      const data=await response.clone().json();
      await scoularTemplateReady;
      const changed=patchAdm(data)||patchBartlett(data)||patchScoular(data);
      if(!changed)return response;
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
      return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
    }catch(error){console.warn('[Grain Ticket] Elevator layout template skipped:',error);return response;}
  };
})();