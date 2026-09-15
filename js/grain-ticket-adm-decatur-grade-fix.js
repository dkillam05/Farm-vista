/* =====================================================================
   FarmVista — Elevator OCR Template Safety
   Known layouts: ADM Decatur + Bartlett Jacksonville + Scoular Waverly
===================================================================== */
(function () {
  'use strict';
  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_ELEVATOR_GRADE_FIX_20260915_2) return;
  window.__FV_ELEVATOR_GRADE_FIX_20260915_2 = true;

  const originalFetch = window.fetch.bind(window);
  const clean = v => String(v == null ? '' : v).trim();
  const compact = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');

  function responseRoot(data) {
    if (data?.grainTicket) return data;
    if (data?.result?.grainTicket) return data.result;
    if (data?.ocrResult?.grainTicket) return data.ocrResult;
    return null;
  }
  function documentText(data, root) {
    return clean(root?.document?.text || data?.document?.text || data?.result?.document?.text || data?.ocrResult?.document?.text || root?.grainTicket?.rawText || '');
  }
  function isAdmDecatur(root,text) {
    const t=root?.grainTicket||{}; const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));
    return (e.includes('admprocessing')||e.includes('archerdanielsmidland'))&&e.includes('decatur')&&(e.includes('4666fairiesparkway')||e.includes('fairiesparkway'));
  }
  function isBartlettJacksonville(root,text) {
    const t=root?.grainTicket||{}; const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));
    return e.includes('bartlett')&&e.includes('jacksonville')&&(e.includes('2350southmain')||e.includes('southmain')||e.includes('unitedstateswarehouseact'));
  }
  function isScoularWaverly(root,text) {
    const t=root?.grainTicket||{}; const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));
    return e.includes('scoular')&&e.includes('waverly')&&(e.includes('wave')||e.includes('15379jasmineroad')||e.includes('jasmineroad'));
  }
  function valueBeforeAnchor(text,anchor) {
    const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+'+anchor+'\\b','im')); const n=m?Number(m[1]):NaN; return Number.isFinite(n)?n:null;
  }
  function patchField(root,name,value) {
    if(!Number.isFinite(value)) return false; root.grainTicket||={}; root.fields||={}; root.grainTicket[name]=value; root.fields[name]=value; return true;
  }
  function patchAdm(data) {
    const root=responseRoot(data); if(!root?.grainTicket)return false; const text=documentText(data,root); if(!isAdmDecatur(root,text))return false; let changed=false;
    changed=patchField(root,'testWeight',valueBeforeAnchor(text,'AC'))||changed; changed=patchField(root,'moisture',valueBeforeAnchor(text,'GN'))||changed; changed=patchField(root,'damage',valueBeforeAnchor(text,'OP'))||changed; changed=patchField(root,'foreignMaterial',valueBeforeAnchor(text,'CO'))||changed; return changed;
  }
  function bartlettGradeBlock(text) {
    const source=String(text||'').replace(/\r/g,'\n'); const start=source.search(/GRADE\s*FACTOR/i); if(start<0)return null; let block=source.slice(start,start+700); const stop=block.search(/(?:\bINSPECTOR\b|\bGROSS\s+BU\b|\bNET\s+BU\b|\bSHRINK\s+BU\b)/i); if(stop>0)block=block.slice(0,stop);
    const read=label=>{const m=block.match(new RegExp('(?:^|\\n|\\s)'+label+'\\s*[:=-]?\\s*([0-9]{1,3}(?:\\.[0-9]{1,2})?)\\b','i')); const n=m?Number(m[1]):NaN; return Number.isFinite(n)?n:null;};
    return {testWeight:read('TW'),moisture:read('MT'),damage:read('DM'),foreignMaterial:read('BCFM')};
  }
  function labeledNumber(text,label,requireLb=false) {
    const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b'; const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i')); if(!m)return null; const n=Number(m[1].replace(/,/g,'')); return Number.isFinite(n)?n:null;
  }
  function patchBartlett(data) {
    const root=responseRoot(data); if(!root?.grainTicket)return false; const text=documentText(data,root); if(!isBartlettJacksonville(root,text))return false; const ticket=root.grainTicket; const grades=bartlettGradeBlock(text)||{}; let changed=false;
    changed=patchField(root,'testWeight',grades.testWeight)||changed; changed=patchField(root,'moisture',grades.moisture)||changed; changed=patchField(root,'damage',grades.damage)||changed; changed=patchField(root,'foreignMaterial',grades.foreignMaterial)||changed;
    const gross=labeledNumber(text,'GROSS',true),tare=labeledNumber(text,'TARE',true),net=labeledNumber(text,'NET',true),shrink=labeledNumber(text,'SHRINK\\s+BU');
    if(Number.isFinite(gross)){ticket.grossWeight=gross;changed=true;} if(Number.isFinite(tare)){ticket.tareWeight=tare;changed=true;} if(Number.isFinite(net)){ticket.netWeight=net;changed=true;} if(Number.isFinite(shrink)){ticket.shrinkBushels=shrink;changed=true;}
    const cropMatch=text.match(/Kind\s+of\s+Grain\s*:\s*([^\n\r]+)/i); if(cropMatch){if(/corn/i.test(cropMatch[1]))ticket.crop='Corn';else if(/soy/i.test(cropMatch[1]))ticket.crop='Soybeans';else if(/wheat/i.test(cropMatch[1]))ticket.crop='Wheat';}
    const ticketMatch=text.match(/\bTicket\s*No\.?\s*[:#]?\s*([A-Z0-9-]{3,})\b/i); if(ticketMatch)ticket.ticketNumber=clean(ticketMatch[1]);
    if(ticket.shrinkBushels===0&&Number.isFinite(ticket.netWeight)){const divisor=ticket.crop==='Soybeans'?60:ticket.crop==='Corn'?56:null;if(divisor){const bu=Number((ticket.netWeight/divisor).toFixed(2));ticket.grossBushels=bu;ticket.netBushels=bu;changed=true;}}
    ticket.elevatorName='Bartlett Grain';ticket.deliveryStreet='2350 South Main';ticket.deliveryCity='Jacksonville';ticket.deliveryState='IL';ticket.deliveryZip='62650'; return changed;
  }

  /* SCOULAR WAVERLY: grade meaning is POSITIONAL, not label-dependent.
     Printed order is always TW, MO, DM, FM/BCFM. OCR does NOT have to read
     Test Weight/Moisture/Damaged/Broken Corn labels for this template. */
  function scoularGradeValues(text) {
    const source=String(text||'').replace(/\r/g,'\n');
    let start=source.search(/Grade\s*:\s*U\.?S\.?/i); if(start<0)start=source.search(/U\.?S\.?\s*No\.?\s*\d/i); if(start<0)return null;
    let block=source.slice(start,start+1500); let stop=block.search(/\bGROSS\s+L\.?BS\s*:/i); if(stop<0)stop=block.search(/\bTARE\s+L\.?BS\s*:/i); if(stop>0)block=block.slice(0,stop);
    const nums=[...block.matchAll(/(?:^|\s)(\d{1,2}(?:\.\d{1,2}))(?=\s|$)/g)].map(m=>Number(m[1])).filter(Number.isFinite);
    /* Find the grade quartet by VALUE SHAPE. This deliberately ignores every
       grade label. A Scoular TW must be 45-70 and is followed, in printed row
       order, by plausible corn moisture, damage and FM values. */
    for(let i=0;i<=nums.length-4;i++){
      const tw=nums[i],mo=nums[i+1],dm=nums[i+2],fm=nums[i+3];
      if(tw>=45&&tw<=70&&mo>=7&&mo<=35&&dm>=0&&dm<=20&&fm>=0&&fm<=20) return {testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm};
    }
    /* Column-major OCR may place TW before the label column and MO/DM/FM after
       it. Still do not require any label: use the only plausible TW in the
       grade block and the first subsequent plausible MO/DM/FM triple. */
    for(let i=0;i<nums.length;i++){
      const tw=nums[i]; if(!(tw>=45&&tw<=70))continue;
      for(let j=i+1;j<=nums.length-3;j++){
        const mo=nums[j],dm=nums[j+1],fm=nums[j+2];
        if(mo>=7&&mo<=35&&dm>=0&&dm<=20&&fm>=0&&fm<=20) return {testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm};
      }
    }
    return null;
  }
  function scoularPrintedBushels(text) {
    const source=String(text||'').replace(/\r/g,'\n'); const start=source.search(/Gross\s+Bushels\s*:/i); if(start<0)return null; const block=source.slice(start,start+350); const values=[]; const re=/([0-9][0-9,]*\.\d{1,2})\s*BU\b/gi; let m; while((m=re.exec(block))&&values.length<2){const n=Number(m[1].replace(/,/g,''));if(Number.isFinite(n))values.push(n);} return values.length>=2?{grossBushels:values[0],netBushels:values[1]}:null;
  }
  function scoularWeights(text) {
    const source=String(text||'').replace(/\r/g,'\n'); const start=source.search(/GROSS\s+L\.?BS\s*:/i); if(start<0)return null; let block=source.slice(start,start+500); const stop=block.search(/Gross\s+Bushels\s*:/i);if(stop>0)block=block.slice(0,stop);const values=[];const re=/\b([2-9]\d{4,5}|[2-9]\d{1,2},\d{3})\s+L\.?BS\b/gi;let m;while((m=re.exec(block))&&values.length<3){const n=Number(m[1].replace(/,/g,''));if(Number.isFinite(n))values.push(n);}return values.length>=3?{grossWeight:values[0],tareWeight:values[1],netWeight:values[2]}:null;
  }
  function patchScoular(data) {
    const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);if(!isScoularWaverly(root,text))return false;const ticket=root.grainTicket;const grades=scoularGradeValues(text)||{};const weights=scoularWeights(text);const bushels=scoularPrintedBushels(text);let changed=false;
    changed=patchField(root,'testWeight',grades.testWeight)||changed;changed=patchField(root,'moisture',grades.moisture)||changed;changed=patchField(root,'damage',grades.damage)||changed;changed=patchField(root,'foreignMaterial',grades.foreignMaterial)||changed;
    if(weights){ticket.grossWeight=weights.grossWeight;ticket.tareWeight=weights.tareWeight;ticket.netWeight=weights.netWeight;changed=true;}
    if(bushels){ticket.grossBushels=bushels.grossBushels;ticket.printedGrossBushels=bushels.grossBushels;ticket.netBushels=bushels.netBushels;ticket.printedNetBushels=bushels.netBushels;ticket.shrinkBushels=Number(Math.max(0,bushels.grossBushels-bushels.netBushels).toFixed(2));changed=true;}
    const ticketMatch=text.match(/(?:^|\n)\s*(\d{5,8})\s*(?:\n|$)/m);if(ticketMatch)ticket.ticketNumber=ticketMatch[1];const customerIdMatch=text.match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);if(customerIdMatch){ticket.customerText=clean(customerIdMatch[1]);ticket.customerAccountText=clean(customerIdMatch[1]);}const truckMatch=text.match(/Truck\s+ID\s*:\s*([A-Z0-9-]+)/i);if(truckMatch)ticket.vehicleId=clean(truckMatch[1]);
    if(/Yellow\s+Corn|Corn\s*\(YC\)/i.test(text))ticket.crop='Corn';else if(/Soybeans?|Soy\s*\(/i.test(text))ticket.crop='Soybeans';ticket.elevatorName='Scoular - Waverly';ticket.deliveryStreet='15379 Jasmine Road';ticket.deliveryCity='Waverly';ticket.deliveryState='IL';ticket.deliveryZip='62692';
    console.log('[Grain Ticket] Scoular positional grade template:',{ticketNumber:ticket.ticketNumber,TW:ticket.testWeight,MO:ticket.moisture,DM:ticket.damage,FM:ticket.foreignMaterial});return changed;
  }

  window.fetch=async(...args)=>{const response=await originalFetch(...args);try{const type=clean(response.headers.get('content-type')).toLowerCase();if(!type.includes('application/json'))return response;const data=await response.clone().json();const changed=patchAdm(data)||patchBartlett(data)||patchScoular(data);if(!changed)return response;const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});}catch(error){console.warn('[Grain Ticket] Elevator layout template skipped:',error);return response;}};
})();