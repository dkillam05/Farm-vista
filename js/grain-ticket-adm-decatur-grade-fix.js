/* =====================================================================
   FarmVista — Grain Ticket Elevator OCR Bridge
   Restores the proven ADM/Bartlett paths and the dedicated Scoular Waverly
   GitHub template. Cloud OCR remains the source of raw text/structured data.
===================================================================== */
(function () {
  'use strict';
  const pagePath=String(window.location.pathname||'').toLowerCase();
  if(!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if(window.__FV_ELEVATOR_OCR_BRIDGE_20260916_11) return;
  window.__FV_ELEVATOR_OCR_BRIDGE_20260916_11=true;

  const originalFetch=window.fetch.bind(window);
  const clean=value=>String(value==null?'':value).trim();

  const scoularTemplateReady=(()=>{
    if(window.FVGrainTicketTemplates?.scoularWaverly)return Promise.resolve(true);
    return new Promise(resolve=>{
      const old=document.querySelector('script[data-fv-scoular-waverly-template]');if(old)old.remove();
      const script=document.createElement('script');
      script.src='/js/grain-ticket-templates/scoular-waverly.js?v=20260916-11';
      script.dataset.fvScoularWaverlyTemplate='1';
      script.onload=()=>resolve(true);
      script.onerror=()=>{console.warn('[Grain Ticket] Scoular Waverly template failed to load.');resolve(false);};
      document.head.appendChild(script);
    });
  })();

  function responseRoot(data){if(data?.grainTicket)return data;if(data?.result?.grainTicket)return data.result;if(data?.data?.grainTicket)return data.data;return null;}
  function documentText(data,root){return clean(root?.documentText||data?.documentText||root?.document?.text||data?.document?.text||root?.grainTicket?.rawText||data?.grainTicket?.rawText);}
  function patchField(root,name,value){if(!Number.isFinite(value))return false;root.grainTicket[name]=value;root.fields=root.fields||{};root.fields[name]=value;return true;}

  /* ADM and Bartlett are already parsed successfully by fvOcr in production.
     Do not overwrite a valid Cloud parse. The local fallbacks below only fill
     missing fields from raw OCR when the Cloud response is incomplete. */
  function isAdm(root,text){return /ARCHER DANIELS MIDLAND|ADM PROCESSING|\bADM\b/i.test(text)||String(root?.parserProfile||'').toLowerCase()==='adm';}
  function admGradeBlock(text){
    const s=String(text||'');
    const values={};
    const patterns={
      testWeight:/(?:Test\s*Weight|\bTW\b|\bAC\b)[^0-9]{0,18}(\d{2}(?:\.\d+)?)/i,
      moisture:/(?:Moisture|\bMO\b|\bGN\b)[^0-9]{0,18}(\d{1,2}(?:\.\d+)?)/i,
      damage:/(?:Damage(?:d)?(?:\s*Kernels)?|\bDM\b|\bOP\b)[^0-9]{0,18}(\d{1,2}(?:\.\d+)?)/i,
      foreignMaterial:/(?:Foreign\s*Material|\bFM\b|\bCO\b)[^0-9]{0,18}(\d{1,2}(?:\.\d+)?)/i
    };
    for(const [name,re] of Object.entries(patterns)){const m=s.match(re);if(m){const n=Number(m[1]);if(Number.isFinite(n))values[name]=n;}}
    return values;
  }
  function patchAdm(root,text){
    if(!root?.grainTicket||!isAdm(root,text))return false;
    /* If Cloud already produced a valid ADM ticket, preserve it exactly. */
    if(root.scanValid===true&&['grossWeight','tareWeight','netWeight','testWeight','moisture','damage','foreignMaterial'].every(k=>Number.isFinite(Number(root.grainTicket[k]))))return false;
    const grades=admGradeBlock(text);let changed=false;
    for(const name of ['testWeight','moisture','damage','foreignMaterial']){
      const existing=root.grainTicket[name];
      if(existing==null||existing===''||!Number.isFinite(Number(existing)))changed=patchField(root,name,grades[name])||changed;
    }
    return changed;
  }

  function isBartlett(text){return /Bartlett/i.test(text)&&/Jacksonville|2350\s+South\s+Main/i.test(text);}
  function labeledNumber(text,label,requireLb=false){const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b';const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i'));if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function patchBartlett(root,text){
    if(!root?.grainTicket||!isBartlett(text))return false;let changed=false;
    const map={testWeight:'TW',moisture:'MT',damage:'DM',foreignMaterial:'BCFM'};
    for(const [name,label] of Object.entries(map))if(root.grainTicket[name]==null)changed=patchField(root,name,labeledNumber(text,label,false))||changed;
    const weights={grossWeight:'GROSS',tareWeight:'TARE',netWeight:'NET'};
    for(const [name,label] of Object.entries(weights))if(root.grainTicket[name]==null){const n=labeledNumber(text,label,true);if(Number.isFinite(n)){root.grainTicket[name]=n;changed=true;}}
    return changed;
  }

  function resolvedScoularError(message,result){const s=String(message||'').toLowerCase();if(result.grades&&(s.includes('test weight')||s.includes('moisture')||s.includes('damage')||s.includes('foreign material')||s.includes('grade')))return true;if(result.weights&&(s.includes('gross minus tare')||s.includes('gross weight')||s.includes('tare weight')||s.includes('net weight')))return true;if(result.bushels&&s.includes('bushel'))return true;return false;}
  function patchScoular(root,text){
    const template=window.FVGrainTicketTemplates?.scoularWaverly;
    if(!root?.grainTicket||!template||!text||!template.matches(root.grainTicket,text))return false;
    const result=template.apply(root.grainTicket,text);if(!result?.matched)return false;
    root.fields=root.fields||{};
    for(const name of ['testWeight','moisture','damage','foreignMaterial'])if(Number.isFinite(root.grainTicket[name]))root.fields[name]=root.grainTicket[name];
    root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>!resolvedScoularError(message,result)):[];
    if(result.complete)root.scanValid=root.scanErrors.length===0;
    else{root.scanValid=false;const msg='Scoular Waverly ticket could not be fully verified from OCR. Please review.';if(!root.scanErrors.includes(msg))root.scanErrors.push(msg);}
    console.log('[Grain Ticket] Scoular Waverly template:',{result,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket:root.grainTicket});
    return true;
  }

  window.fetch=async(...args)=>{
    const response=await originalFetch(...args);
    try{
      const type=clean(response.headers.get('content-type')).toLowerCase();if(!type.includes('application/json'))return response;
      const data=await response.clone().json(),root=responseRoot(data);if(!root)return response;
      const text=documentText(data,root);
      if(text){root.documentText=text;root.document=root.document||{};root.document.text=text;}
      await scoularTemplateReady;
      const changed=patchScoular(root,text)||patchAdm(root,text)||patchBartlett(root,text);
      if(!changed&&!text)return response;
      const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');
      return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
    }catch(error){console.warn('[Grain Ticket] Elevator OCR bridge skipped:',error);return response;}
  };
})();
