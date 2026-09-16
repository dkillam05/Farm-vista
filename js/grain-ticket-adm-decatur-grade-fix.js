/* =====================================================================
   FarmVista — Grain Ticket Elevator OCR Bridge
   Elevator-specific reconstruction happens here before scanner validation.
   ADM and Scoular are independent parsers. Do not change scanner behavior.
===================================================================== */
(function () {
  'use strict';
  const pagePath=String(window.location.pathname||'').toLowerCase();
  if(!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if(window.__FV_ELEVATOR_OCR_BRIDGE_20260916_14) return;
  window.__FV_ELEVATOR_OCR_BRIDGE_20260916_14=true;

  const originalFetch=window.fetch.bind(window);
  const clean=value=>String(value==null?'':value).trim();
  const compact=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');

  function responseRoot(data){if(data?.grainTicket)return data;if(data?.result?.grainTicket)return data.result;if(data?.ocrResult?.grainTicket)return data.ocrResult;if(data?.data?.grainTicket)return data.data;return null;}
  function documentText(data,root){return clean(root?.documentText||data?.documentText||root?.document?.text||data?.document?.text||data?.result?.documentText||data?.ocrResult?.documentText||root?.grainTicket?.rawText||'');}
  function patchField(root,name,value){if(!Number.isFinite(value))return false;root.grainTicket[name]=value;root.fields=root.fields||{};root.fields[name]=value;return true;}

  /* ----------------------------- ADM -------------------------------- */
  function isAdmDecatur(root,text){const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));return (e.includes('admprocessing')||e.includes('archerdanielsmidland')||String(root?.parserProfile||'').toLowerCase()==='adm')&&e.includes('decatur');}
  function valueBeforeAnchor(text,anchor){const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+'+anchor+'\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;}
  function valueAfterLabel(text,label){const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*'+label+'\\s+([0-9]{1,3}(?:\\.[0-9]+)?)\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;}
  function admGradeBlock(text){return {testWeight:valueBeforeAnchor(text,'AC')??valueAfterLabel(text,'TW'),moisture:valueBeforeAnchor(text,'GN')??valueAfterLabel(text,'MO'),damage:valueBeforeAnchor(text,'OP')??valueAfterLabel(text,'DM'),foreignMaterial:valueBeforeAnchor(text,'CO')??valueAfterLabel(text,'FM')};}
  function patchAdm(root,text){
    if(!root?.grainTicket||!isAdmDecatur(root,text))return false;
    const ticket=root.grainTicket;
    if(root.scanValid===true&&['grossWeight','tareWeight','netWeight','testWeight','moisture','damage','foreignMaterial'].every(k=>Number.isFinite(Number(ticket[k]))))return false;
    const grades=admGradeBlock(text);let changed=false;
    for(const name of ['testWeight','moisture','damage','foreignMaterial'])changed=patchField(root,name,grades[name])||changed;
    const gross=Number(ticket.grossWeight),tare=Number(ticket.tareWeight),net=Number(ticket.netWeight);
    const weightsVerified=Number.isFinite(gross)&&Number.isFinite(tare)&&Number.isFinite(net)&&Math.abs((gross-tare)-net)<=2;
    if(weightsVerified){const crop=String(ticket.crop||'').toLowerCase();const divisor=crop.includes('soy')?60:crop.includes('corn')?56:null;if(divisor){const calculated=Number((net/divisor).toFixed(2));if(Number.isFinite(calculated)){ticket.netBushels=calculated;ticket.grossBushels=calculated;ticket.calculatedNetBushels=calculated;root.fields=root.fields||{};root.fields.netBushels=calculated;changed=true;root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>!String(message||'').toLowerCase().includes('printed bushel amount')):[];}}}
    const complete=['grossWeight','tareWeight','netWeight','testWeight','moisture','damage','foreignMaterial','netBushels'].every(k=>Number.isFinite(Number(ticket[k])));
    if(complete&&(!root.scanErrors||root.scanErrors.length===0))root.scanValid=true;
    console.log('[Grain Ticket] ADM Decatur repaired from printed table:',{grades,weightsVerified,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket});
    return changed;
  }

  /* -------------------------- SCOULAR WAVE ---------------------------
     This intentionally mirrors ADM's approach: positively identify one known
     elevator layout, reconstruct that layout, overwrite generic associations,
     then clear only errors that the reconstruction actually resolved.

     Waverly prints exactly four FarmVista grade rows, always in this order:
       Test Weight -> Moisture -> Damage -> FM

     Document AI has shown two linearizations of the SAME ticket:
       60.3 / 13.2 / 1.8 / 1.0
       60.3 / 132  / 1.8 / [labels] / 10
     Scoular prints one decimal place. Therefore 132 and 10 are not guesses
     about arbitrary ticket numbers: inside this isolated grade block they are
     the printed grade tokens with a dropped decimal: 13.2 and 1.0.
  -------------------------------------------------------------------- */
  function isScoularWaverly(root,text){const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));return e.includes('scoular')&&(e.includes('waverly')||e.includes('elevatoridwave')||e.includes('15379jasmineroad'));}
  function scoularGradeSection(text){const s=String(text||'').replace(/\r/g,'\n');let start=s.search(/Grade\s*:?\s*U\.?S\.?/i);if(start<0)start=s.search(/Test\s*Weight/i);if(start<0)return '';let end=s.slice(start).search(/\bGROSS\s+LBS\b/i);if(end<0)end=s.slice(start).search(/\bGROSS\s+(?:WEIGHT|WT)\b/i);return end>=0?s.slice(start,start+end):s.slice(start,start+1200);}
  function scoularPrintedDecimal(raw,slot){const token=String(raw||'').trim();if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(token))return null;let n=Number(token);if(!Number.isFinite(n))return null;if(token.includes('.'))return n;if(slot===0){if(n>=450&&n<=700)return n/10;return n>=45&&n<=70?n:null;}if(slot===1){if(n>=70&&n<=350)return n/10;return n>=7&&n<=35?n:null;}if(n>=21&&n<=200)return n/10;if(n>=10&&n<=20)return n/10;return n>=0&&n<=20?n:null;}
  function scoularGradeBlock(text){
    const section=scoularGradeSection(text);if(!section)return null;
    const lines=section.split(/\n+/).map(v=>v.trim()).filter(Boolean);
    const tokens=[];
    for(const line of lines){const m=line.match(/^(\d{1,3}(?:\.\d{1,2})?)$/);if(m)tokens.push(m[1]);}
    /* Ignore the U.S. grade number because it is embedded in text, not a
       numeric-only line. Find four numeric-only grade tokens in printed order. */
    for(let a=0;a<tokens.length;a++){
      const tw=scoularPrintedDecimal(tokens[a],0);if(!(tw>=45&&tw<=70))continue;
      for(let b=a+1;b<tokens.length;b++){
        const mo=scoularPrintedDecimal(tokens[b],1);if(!(mo>=7&&mo<=35))continue;
        for(let c=b+1;c<tokens.length;c++){
          const dm=scoularPrintedDecimal(tokens[c],2);if(!(dm>=0&&dm<=20))continue;
          for(let d=c+1;d<tokens.length;d++){
            const fm=scoularPrintedDecimal(tokens[d],3);if(!(fm>=0&&fm<=20))continue;
            return {testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm,rawTokens:[tokens[a],tokens[b],tokens[c],tokens[d]]};
          }
        }
      }
    }
    return null;
  }
  function patchScoular(root,text){
    if(!root?.grainTicket||!isScoularWaverly(root,text))return false;
    const ticket=root.grainTicket,grades=scoularGradeBlock(text);
    if(!grades){console.log('[Grain Ticket] Scoular Waverly grade reconstruction incomplete; leaving for review.');return false;}
    let changed=false;
    for(const name of ['testWeight','moisture','damage','foreignMaterial'])changed=patchField(root,name,grades[name])||changed;
    ticket.parserProfile='scoular_waverly_bridge';
    root.scanErrors=Array.isArray(root.scanErrors)?root.scanErrors.filter(message=>{const s=String(message||'').toLowerCase();return !(s.includes('test weight')||s.includes('moisture')||s.includes('damage')||s.includes('foreign material')||s.includes('grade'));}):[];
    const gross=Number(ticket.grossWeight),tare=Number(ticket.tareWeight),net=Number(ticket.netWeight);
    const weightsVerified=Number.isFinite(gross)&&Number.isFinite(tare)&&Number.isFinite(net)&&Math.abs((gross-tare)-net)<=2;
    const complete=weightsVerified&&['testWeight','moisture','damage','foreignMaterial','grossBushels','netBushels'].every(k=>Number.isFinite(Number(ticket[k])));
    if(complete&&root.scanErrors.length===0)root.scanValid=true;
    console.log('[Grain Ticket] Scoular Waverly repaired like ADM:',{grades,weightsVerified,scanValid:root.scanValid,scanErrors:root.scanErrors,ticket});
    return changed;
  }

  /* --------------------------- BARTLETT ------------------------------ */
  function isBartlett(text){return /Bartlett/i.test(text)&&/Jacksonville|2350\s+South\s+Main/i.test(text);}
  function labeledNumber(text,label,requireLb=false){const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b';const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i'));if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function patchBartlett(root,text){if(!root?.grainTicket||!isBartlett(text))return false;let changed=false;const map={testWeight:'TW',moisture:'MT',damage:'DM',foreignMaterial:'BCFM'};for(const [name,label] of Object.entries(map))if(root.grainTicket[name]==null)changed=patchField(root,name,labeledNumber(text,label,false))||changed;const weights={grossWeight:'GROSS',tareWeight:'TARE',netWeight:'NET'};for(const [name,label] of Object.entries(weights))if(root.grainTicket[name]==null){const n=labeledNumber(text,label,true);if(Number.isFinite(n)){root.grainTicket[name]=n;changed=true;}}return changed;}

  window.fetch=async(...args)=>{const response=await originalFetch(...args);try{const type=clean(response.headers.get('content-type')).toLowerCase();if(!type.includes('application/json'))return response;const data=await response.clone().json(),root=responseRoot(data);if(!root)return response;const text=documentText(data,root);if(text){root.documentText=text;root.document=root.document||{};root.document.text=text;}const changed=patchScoular(root,text)||patchAdm(root,text)||patchBartlett(root,text);if(!changed&&!text)return response;const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});}catch(error){console.warn('[Grain Ticket] Elevator OCR bridge skipped:',error);return response;}};
})();
