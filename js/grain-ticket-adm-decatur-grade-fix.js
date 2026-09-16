/* =====================================================================
   FarmVista — Grain Ticket Elevator OCR Bridge
   Cloud OCR supplies raw text/structured data. Elevator layout rules repair
   only fields that OCR could not reliably associate with their printed label.
===================================================================== */
(function () {
  'use strict';
  const pagePath=String(window.location.pathname||'').toLowerCase();
  if(!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if(window.__FV_ELEVATOR_OCR_BRIDGE_20260916_12) return;
  window.__FV_ELEVATOR_OCR_BRIDGE_20260916_12=true;

  const originalFetch=window.fetch.bind(window);
  const clean=value=>String(value==null?'':value).trim();
  const compact=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');

  const scoularTemplateReady=(()=>{
    if(window.FVGrainTicketTemplates?.scoularWaverly)return Promise.resolve(true);
    return new Promise(resolve=>{
      const old=document.querySelector('script[data-fv-scoular-waverly-template]');if(old)old.remove();
      const script=document.createElement('script');
      script.src='/js/grain-ticket-templates/scoular-waverly.js?v=20260916-12';
      script.dataset.fvScoularWaverlyTemplate='1';
      script.onload=()=>resolve(true);
      script.onerror=()=>{console.warn('[Grain Ticket] Scoular Waverly template failed to load.');resolve(false);};
      document.head.appendChild(script);
    });
  })();

  function responseRoot(data){if(data?.grainTicket)return data;if(data?.result?.grainTicket)return data.result;if(data?.ocrResult?.grainTicket)return data.ocrResult;if(data?.data?.grainTicket)return data.data;return null;}
  function documentText(data,root){return clean(root?.documentText||data?.documentText||root?.document?.text||data?.document?.text||data?.result?.documentText||data?.ocrResult?.documentText||root?.grainTicket?.rawText||'');}
  function patchField(root,name,value){if(!Number.isFinite(value))return false;root.grainTicket[name]=value;root.fields=root.fields||{};root.fields[name]=value;return true;}

  function isAdmDecatur(root,text){const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));return (e.includes('admprocessing')||e.includes('archerdanielsmidland')||String(root?.parserProfile||'').toLowerCase()==='adm')&&e.includes('decatur');}
  function valueBeforeAnchor(text,anchor){const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+'+anchor+'\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;}
  function valueAfterLabel(text,label){const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*'+label+'\\s+([0-9]{1,3}(?:\\.[0-9]+)?)\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;}
  function admGradeBlock(text){
    /* ADM prints a multi-column grade table. Document AI commonly reads each
       ROW across the page: "TW 55.0 AC 0.0 MU 0.0". Therefore the value before
       the next-column anchor is the reliable first-column value. */
    return {
      testWeight:valueBeforeAnchor(text,'AC') ?? valueAfterLabel(text,'TW'),
      moisture:valueBeforeAnchor(text,'GN') ?? valueAfterLabel(text,'MO'),
      damage:valueBeforeAnchor(text,'OP') ?? valueAfterLabel(text,'DM'),
      foreignMaterial:valueBeforeAnchor(text,'CO') ?? valueAfterLabel(text,'FM')
    };
  }
  function patchAdm(root,text){
    if(!root?.grainTicket||!isAdmDecatur(root,text))return false;
    const ticket=root.grainTicket;
    if(root.scanValid===true&&['grossWeight','tareWeight','netWeight','testWeight','moisture','damage','foreignMaterial'].every(k=>Number.isFinite(Number(ticket[k]))))return false;

    const grades=admGradeBlock(text);let changed=false;
    /* For a recognized ADM Decatur grade table, the table reconstruction is
       more trustworthy than a generic association such as MO=9 from a date. */
    for(const name of ['testWeight','moisture','damage','foreignMaterial'])changed=patchField(root,name,grades[name])||changed;

    const gross=Number(ticket.grossWeight),tare=Number(ticket.tareWeight),net=Number(ticket.netWeight);
    const weightsVerified=Number.isFinite(gross)&&Number.isFinite(tare)&&Number.isFinite(net)&&Math.abs((gross-tare)-net)<=2;
    if(weightsVerified){
      const crop=String(ticket.crop||'').toLowerCase();
      const divisor=crop.includes('soy')?60:crop.includes('corn')?56:null;
      if(divisor){
        const calculated=Number((net/divisor).toFixed(2));
        if(Number.isFinite(calculated)){
          ticket.netBushels=calculated;
          ticket.grossBushels=calculated;
          ticket.calculatedNetBushels=calculated;
          root.fields=root.fields||{};root.fields.netBushels=calculated;
          changed=true;
          root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>!String(message||'').toLowerCase().includes('printed bushel amount')):[];
        }
      }
    }

    const complete=['grossWeight','tareWeight','netWeight','testWeight','moisture','damage','foreignMaterial','netBushels'].every(k=>Number.isFinite(Number(ticket[k])));
    if(complete&&(!root.scanErrors||root.scanErrors.length===0))root.scanValid=true;
    console.log('[Grain Ticket] ADM Decatur repaired from printed table:',{grades,weightsVerified,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket});
    return changed;
  }

  function isBartlett(text){return /Bartlett/i.test(text)&&/Jacksonville|2350\s+South\s+Main/i.test(text);}
  function labeledNumber(text,label,requireLb=false){const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b';const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i'));if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function patchBartlett(root,text){if(!root?.grainTicket||!isBartlett(text))return false;let changed=false;const map={testWeight:'TW',moisture:'MT',damage:'DM',foreignMaterial:'BCFM'};for(const [name,label] of Object.entries(map))if(root.grainTicket[name]==null)changed=patchField(root,name,labeledNumber(text,label,false))||changed;const weights={grossWeight:'GROSS',tareWeight:'TARE',netWeight:'NET'};for(const [name,label] of Object.entries(weights))if(root.grainTicket[name]==null){const n=labeledNumber(text,label,true);if(Number.isFinite(n)){root.grainTicket[name]=n;changed=true;}}return changed;}

  function resolvedScoularError(message,result){const s=String(message||'').toLowerCase();if(result.grades&&(s.includes('test weight')||s.includes('moisture')||s.includes('damage')||s.includes('foreign material')||s.includes('grade')))return true;if(result.weights&&(s.includes('gross minus tare')||s.includes('gross weight')||s.includes('tare weight')||s.includes('net weight')))return true;if(result.bushels&&s.includes('bushel'))return true;return false;}
  function patchScoular(root,text){const template=window.FVGrainTicketTemplates?.scoularWaverly;if(!root?.grainTicket||!template||!text||!template.matches(root.grainTicket,text))return false;const result=template.apply(root.grainTicket,text);if(!result?.matched)return false;root.fields=root.fields||{};for(const name of ['testWeight','moisture','damage','foreignMaterial'])if(Number.isFinite(root.grainTicket[name]))root.fields[name]=root.grainTicket[name];root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>!resolvedScoularError(message,result)):[];if(result.complete)root.scanValid=root.scanErrors.length===0;else{root.scanValid=false;const msg='Scoular Waverly ticket could not be fully verified from OCR. Please review.';if(!root.scanErrors.includes(msg))root.scanErrors.push(msg);}console.log('[Grain Ticket] Scoular Waverly template:',{result,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket:root.grainTicket});return true;}

  window.fetch=async(...args)=>{const response=await originalFetch(...args);try{const type=clean(response.headers.get('content-type')).toLowerCase();if(!type.includes('application/json'))return response;const data=await response.clone().json(),root=responseRoot(data);if(!root)return response;const text=documentText(data,root);if(text){root.documentText=text;root.document=root.document||{};root.document.text=text;}await scoularTemplateReady;const changed=patchScoular(root,text)||patchAdm(root,text)||patchBartlett(root,text);if(!changed&&!text)return response;const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});}catch(error){console.warn('[Grain Ticket] Elevator OCR bridge skipped:',error);return response;}};
})();
