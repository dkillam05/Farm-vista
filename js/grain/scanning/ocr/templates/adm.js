/* FarmVista — ADM grain-ticket template
   Generic across ADM locations. Elevator-specific interpretation belongs here,
   not in Cloud OCR. Never invent a decimal point or shift a missing grade. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};

  const clean = v => String(v == null ? '' : v).trim();
  const num = v => {
    const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const round2 = n => Number(Number(n).toFixed(2));

  function matches(ticket, text) {
    const s = [ticket?.elevatorName, text].filter(Boolean).join('\n');
    return /\bADM\b|ARCHER\s+DANIELS\s+MIDLAND|ADM\s+PROCESSING/i.test(s);
  }

  function crop(text, current) {
    const s = String(text || '');
    if (/YELLOW\s+SOYBEANS?|\bSOYBEANS?\b/i.test(s)) return 'Soybeans';
    if (/YELLOW\s+CORN|\bCORN\b/i.test(s)) return 'Corn';
    return current || null;
  }

  function ticketNumber(text, current) {
    const s = String(text || '');
    const patterns = [
      /TICKET\s*(?:#|NO\.?|NUMBER)?\s*[:#-]?\s*(T?\d{5,8})\b/i,
      /GRAIN\s+RECEIPT[\s\S]{0,180}?\b(T\d{5,8})\b/i
    ];
    for (const pattern of patterns) { const m = s.match(pattern); if (m) return m[1].toUpperCase(); }
    return current || null;
  }

  function ticketDate(text, current) {
    const m = String(text || '').match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})\b/);
    if (m) return `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
    return current || null;
  }

  function labeledWeight(text, labels) {
    const s = String(text || '');
    for (const label of labels) {
      const after = s.match(new RegExp(label + '\\s*:?\\s*([0-9]{2,3}(?:[, ]?[0-9]{3}))\\s*(?:LB|LBS)?\\b', 'i'));
      if (after) { const n=num(after[1]); if (n != null) return n; }
      const nextLine = s.match(new RegExp(label + '[^\\n]*\\n\\s*([0-9]{2,3}(?:[, ]?[0-9]{3}))\\s*(?:LB|LBS)?\\b', 'i'));
      if (nextLine) { const n=num(nextLine[1]); if (n != null) return n; }
    }
    return null;
  }

  function weights(text, ticket) {
    const gross = labeledWeight(text, ['WEIGH\\s+IN', 'GROSS(?:\\s+LBS?|\\s+WT|\\s+WEIGHT)?']);
    const tare = labeledWeight(text, ['WEIGH\\s+OUT', 'TARE(?:\\s+LBS?|\\s+WT|\\s+WEIGHT)?']);
    const net = labeledWeight(text, ['NET\\s+WT', 'NET(?:\\s+LBS?|\\s+WEIGHT)']);
    const g = gross ?? num(ticket?.grossWeight), t = tare ?? num(ticket?.tareWeight), n = net ?? num(ticket?.netWeight);
    if (![g,t,n].every(Number.isFinite)) return null;
    if (g < 40000 || g > 120000 || t < 15000 || t > 50000 || n < 10000 || n > 90000) return null;
    if (Math.abs((g - t) - n) > 20) return null;
    return { grossWeight:g, tareWeight:t, netWeight:n, confidence:'adm_labeled_weight_math_verified' };
  }

  function gradeSection(text) {
    const s=String(text||'').replace(/\r/g,'\n');
    let start=s.search(/Grade\s+U\.?S\.?/i);
    if(start<0) start=s.search(/(?:^|\n)\s*TW\b/im);
    if(start<0) return '';
    let block=s.slice(start,start+2600);
    const stop=block.search(/\b(?:WEIGH\s+IN|GROSS\s+(?:LBS?|WT|WEIGHT))\b/i);
    if(stop>0) block=block.slice(0,stop);
    return block;
  }

  function explicitGradeAfterLabel(block, label, min, max) {
    const escaped=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const patterns=[
      new RegExp('(?:^|\\n)\\s*'+escaped+'\\s*[:=-]?\\s*([0-9]{1,2}\\.[0-9]{1,2})\\b','im'),
      new RegExp('(?:^|\\n)\\s*'+escaped+'[^\\n]*\\n\\s*([0-9]{1,2}\\.[0-9]{1,2})\\b','im')
    ];
    for(const p of patterns){const m=block.match(p);if(!m)continue;const n=Number(m[1]);if(Number.isFinite(n)&&n>=min&&n<=max)return n;}
    return null;
  }

  function explicitGradeBeforeCode(block, code, min, max) {
    const p=new RegExp('(?:^|\\n)\\s*([0-9]{1,2}\\.[0-9]{1,2})\\s*'+code+'\\b','im');
    const m=block.match(p);if(!m)return null;const n=Number(m[1]);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
  }

  function grades(text) {
    const block=gradeSection(text); if(!block) return null;
    /* ADM's printed tracked rows are TW, MO, DM, FM. Some OCR linearizations
       place the companion row codes AC, GN, OP, CO beside those same rows.
       Those codes are only positional fallbacks on a positively identified ADM
       ticket; HD/IF and SP/SR remain separate rows and are never shifted. */
    const tw=explicitGradeAfterLabel(block,'TW',45,70) ?? explicitGradeBeforeCode(block,'AC',45,70);
    const mo=explicitGradeAfterLabel(block,'MO',7,35) ?? explicitGradeBeforeCode(block,'GN',7,35);
    const dm=explicitGradeAfterLabel(block,'DM',0,20) ?? explicitGradeBeforeCode(block,'OP',0,20);
    const fm=explicitGradeAfterLabel(block,'FM',0,20) ?? explicitGradeBeforeCode(block,'CO',0,20);
    if (![tw,mo,dm,fm].every(Number.isFinite)) return null;
    return { testWeight:tw, moisture:mo, damage:dm, foreignMaterial:fm, confidence:'adm_explicit_printed_rows' };
  }

  function printedBushels(text) {
    return [...String(text||'').matchAll(/(?<!\d)(\d{3,4}[.,]\d{1,2})\s*(?:BU|BUSHELS?)\b/gi)]
      .map(m=>Number(String(m[1]).replace(',','.')))
      .filter(v=>Number.isFinite(v)&&v>100&&v<1500);
  }

  function bushels(text, cropName, w) {
    const divisor=cropName==='Soybeans'?60:cropName==='Corn'?56:null;
    const derived=w?.netWeight&&divisor?round2(w.netWeight/divisor):null;
    const printed=printedBushels(text);
    if(derived!=null&&printed.length){const close=printed.filter(v=>Math.abs(v-derived)<=Math.max(1,derived*.02));if(close.length)return {grossBushels:close[0],netBushels:close[close.length-1],confidence:'adm_printed_weight_crosscheck'};}
    if(derived!=null)return {grossBushels:derived,netBushels:derived,confidence:'adm_verified_weight_derived'};
    return null;
  }

  function customer(text) {
    const s=String(text||'');
    const vendor=s.match(/VENDOR\s*:?\s*([0-9-]+)/i);
    return vendor ? clean(vendor[1]) : null;
  }

  function apply(ticket, text) {
    if(!matches(ticket,text)) return {matched:false,changed:false,complete:false};
    ticket.crop=crop(text,ticket.crop);
    ticket.ticketNumber=ticketNumber(text,ticket.ticketNumber);
    ticket.ticketDate=ticketDate(text,ticket.ticketDate);
    const g=grades(text), w=weights(text,ticket), b=bushels(text,ticket.crop,w);
    let changed=false;
    if(g){Object.assign(ticket,{testWeight:g.testWeight,moisture:g.moisture,damage:g.damage,foreignMaterial:g.foreignMaterial});changed=true;}
    if(w){Object.assign(ticket,{grossWeight:w.grossWeight,tareWeight:w.tareWeight,netWeight:w.netWeight});changed=true;}
    if(b){ticket.grossBushels=b.grossBushels;ticket.netBushels=b.netBushels;ticket.calculatedGrossBushels=b.grossBushels;ticket.calculatedNetBushels=b.netBushels;ticket.shrinkBushels=round2(Math.max(0,b.grossBushels-b.netBushels));changed=true;}
    const account=customer(text);if(account){ticket.customerAccountText=account;changed=true;}
    ticket.parserProfile='adm_github';
    const complete=!!(g&&w&&b&&ticket.ticketNumber&&ticket.ticketDate&&ticket.crop);
    console.log('[Grain Ticket] ADM template result:',{complete,ticketNumber:ticket.ticketNumber,ticketDate:ticket.ticketDate,crop:ticket.crop,grades:g,weights:w,bushels:b,ocrSource:'full_ticket_document_ocr'});
    return {matched:true,changed,complete,grades:g,weights:w,bushels:b};
  }

  window.FVGrainTicketTemplates.adm={matches,apply};
})();
