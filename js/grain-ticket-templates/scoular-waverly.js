/* FarmVista — Scoular Waverly grain-ticket template
   Elevator-specific interpretation belongs here, not in Cloud OCR. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};
  const clean=v=>String(v==null?'':v).trim();
  const compact=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  const num=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:null;};
  const round2=n=>Number(Number(n).toFixed(2));

  function matches(ticket,text){
    const hay=compact([ticket?.elevatorName,ticket?.deliveryStreet,ticket?.deliveryCity,ticket?.deliveryState,ticket?.deliveryZip,text].filter(Boolean).join(' '));
    return (hay.includes('scoular')||hay.includes('elevatoridwave'))&&(hay.includes('waverly')||hay.includes('elevatoridwave')||hay.includes('15379jasmineroad')||hay.includes('jasmineroad'));
  }
  function crop(text,ticket){const s=String(text||'');if(/Yellow\s+Corn|\bCorn\s*\(YC\)/i.test(s))return'Corn';if(/Soybeans?|\bSoy\b/i.test(s))return'Soybeans';return ticket?.crop||null;}
  function gradeBlock(text){
    const s=String(text||'').replace(/\r/g,'\n');let start=s.search(/Grade\s*:?\s*U\.?S\.?/i);if(start<0)start=s.search(/Test\s*Weight|Moisture|Damaged\s+Kernels|Broken\s+Corn/i);if(start<0)return'';
    let block=s.slice(start,start+1600);const stop=block.search(/\bGROSS\s+(?:L\.?BS|LBS|WEIGHT)\b|\bGross\s+Bushels\b/i);if(stop>0)block=block.slice(0,stop);return block;
  }
  function normalizedGradeToken(raw,slot){
    const t=String(raw||'').replace(/[^0-9.]/g,'');if(!t)return null;let n=num(t);if(!Number.isFinite(n))return null;
    if(slot==='tw'){if(n>=45&&n<=70)return n;if(!t.includes('.')&&n>=450&&n<=700)return n/10;return null;}
    if(slot==='mo'){if(n>=7&&n<=35)return n;if(!t.includes('.')&&n>=70&&n<=350)return n/10;return null;}
    if(n>=0&&n<=20){if(!t.includes('.')&&n>=10&&n<=99)return n/10;return n;}
    if(!t.includes('.')&&n>=0&&n<=200)return n/10;return null;
  }
  function grades(text){
    const block=gradeBlock(text);if(!block)return null;
    const decimals=[...block.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2})(?!\d)/g)].map(m=>Number(m[1]));
    for(let i=0;i<=decimals.length-4;i++){const [tw,mo,dm,fm]=decimals.slice(i,i+4);if(tw>=45&&tw<=70&&mo>=7&&mo<=35&&dm>=0&&dm<=20&&fm>=0&&fm<=20)return{testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm,confidence:'exact_decimal_quartet'};}
    /* Scoular Waverly always prints the grade values in TW -> MO -> DM -> FM order.
       Phone OCR may drop decimal points or scatter the labels, so inspect only the
       grade-table neighborhood and require a plausible ordered quartet. */
    const tokens=[...block.matchAll(/(?<!\d)(\d{1,3}(?:\.\d{1,2})?)(?!\d)/g)].map(m=>m[1]);
    for(let i=0;i<tokens.length;i++)for(let j=i+1;j<Math.min(tokens.length,i+5);j++)for(let k=j+1;k<Math.min(tokens.length,j+4);k++)for(let l=k+1;l<Math.min(tokens.length,k+4);l++){
      const tw=normalizedGradeToken(tokens[i],'tw'),mo=normalizedGradeToken(tokens[j],'mo'),dm=normalizedGradeToken(tokens[k],'dm'),fm=normalizedGradeToken(tokens[l],'fm');
      if(tw!=null&&mo!=null&&dm!=null&&fm!=null)return{testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm,confidence:'scoular_fixed_order_recovered'};
    }
    return null;
  }
  function weightCandidates(text){
    const s=String(text||'').replace(/\r/g,'\n');let start=s.search(/GROSS\s+(?:L\.?BS|LBS|WEIGHT)\s*:?/i);if(start<0)start=s.search(/83[,.]?\s*340|28[,.]?\s*200|55[,.]?\s*140/i);if(start<0)return[];
    let block=s.slice(start,start+1100);const stop=block.search(/Gross\s+Bushels\s*:?/i);if(stop>0)block=block.slice(0,stop);
    return [...block.matchAll(/(?<!\d)(\d{2,3}[, ]?\d{3}|\d{5,6})(?!\d)/g)].map(m=>num(m[1].replace(/\s/g,''))).filter(n=>Number.isFinite(n)&&n>=15000&&n<=100000);
  }
  function weights(text,ticket){
    const vals=weightCandidates(text);
    for(let i=0;i<vals.length;i++)for(let j=i+1;j<vals.length;j++)for(let k=j+1;k<vals.length;k++){
      const gross=vals[i],tare=vals[j],net=vals[k];if(gross>=40000&&gross<=95000&&tare>=20000&&tare<=35000&&net>0&&Math.abs((gross-tare)-net)<=20)return{grossWeight:gross,tareWeight:tare,netWeight:net,confidence:'printed_math_verified'};
    }
    /* If OCR read exactly two trustworthy weights, derive the third only when
       the generic parse supplies a compatible missing member. Never accept small
       note/time values such as 1717 as a weight. */
    const validGeneric=[ticket?.grossWeight,ticket?.tareWeight,ticket?.netWeight].map(Number).filter(n=>Number.isFinite(n)&&n>=15000&&n<=95000);
    const all=[...new Set([...vals,...validGeneric])];
    for(const gross of all)for(const tare of all){if(gross<=tare||gross<40000||tare<20000||tare>35000)continue;const net=gross-tare;if(net>=15000&&net<=75000)return{grossWeight:gross,tareWeight:tare,netWeight:net,confidence:'two_weights_math_derived'};}
    return null;
  }
  function bushels(text,ticket,w){
    const s=String(text||'').replace(/\r/g,'\n');const start=s.search(/Gross\s+Bushels\s*:?/i);if(start>=0){const block=s.slice(start,start+500);const vals=[...block.matchAll(/\b(\d{2,4}\.\d{1,2})\s*BU\b/gi)].map(m=>num(m[1])).filter(Number.isFinite);if(vals.length>=1&&vals[0]>100&&vals[0]<1200){const second=vals.find((v,idx)=>idx>0&&v>100&&v<1200);return{grossBushels:vals[0],netBushels:second??vals[0],confidence:second?'printed':'single_printed'};}}
    if(w?.netWeight){const divisor=ticket?.crop==='Soybeans'?60:ticket?.crop==='Corn'?56:null;if(divisor){const bu=round2(w.netWeight/divisor);return{grossBushels:bu,netBushels:bu,confidence:'weight_derived'};}}return null;
  }
  function apply(ticket,text){
    if(!matches(ticket,text))return{matched:false,changed:false,complete:false};ticket.crop=crop(text,ticket);const g=grades(text),w=weights(text,ticket),b=bushels(text,ticket,w);let changed=false;
    if(g){Object.assign(ticket,{testWeight:g.testWeight,moisture:g.moisture,damage:g.damage,foreignMaterial:g.foreignMaterial});changed=true;}
    if(w){Object.assign(ticket,{grossWeight:w.grossWeight,tareWeight:w.tareWeight,netWeight:w.netWeight});changed=true;}
    if(b){ticket.grossBushels=b.grossBushels;ticket.netBushels=b.netBushels;ticket.calculatedGrossBushels=b.grossBushels;ticket.calculatedNetBushels=b.netBushels;ticket.printedGrossBushels=b.confidence.startsWith('printed')?b.grossBushels:null;ticket.printedNetBushels=b.confidence==='printed'?b.netBushels:null;ticket.shrinkBushels=round2(Math.max(0,b.grossBushels-b.netBushels));changed=true;}
    const truck=String(text||'').match(/Truck\s+ID\s*:\s*([A-Z0-9-]+)/i);if(truck){ticket.vehicleId=clean(truck[1]);changed=true;}const customer=String(text||'').match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);if(customer){ticket.customerText=clean(customer[1]);ticket.customerAccountText=clean(customer[1]);changed=true;}
    ticket.elevatorName='Scoular - Waverly';ticket.deliveryStreet='15379 Jasmine Road';ticket.deliveryCity='Waverly';ticket.deliveryState='IL';ticket.deliveryZip='62692';ticket.parserProfile='scoular_waverly_github';
    const complete=!!(g&&w&&b&&ticket.ticketNumber&&ticket.crop);return{matched:true,changed,complete,grades:g,weights:w,bushels:b};
  }
  window.FVGrainTicketTemplates.scoularWaverly={matches,apply};
})();