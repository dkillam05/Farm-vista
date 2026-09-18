/* FarmVista — Scoular grain-ticket template
   Generic across Scoular locations using this ticket layout.
   Elevator-specific interpretation belongs here, not in Cloud OCR.
   This template never invents a decimal point or changes an ambiguous number. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};

  const clean = v => String(v == null ? '' : v).trim();
  const compact = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = v => {
    const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const round2 = n => Number(Number(n).toFixed(2));

  function matches(ticket, text) {
    const hay = compact([ticket?.elevatorName,text].filter(Boolean).join(' '));
    return hay.includes('scoular');
  }

  function crop(text, ticket) {
    const s = String(text || '');
    if (/Yellow\s+Corn|\bCorn\s*\(YC\)|\bCorn\b/i.test(s)) return 'Corn';
    if (/Soybeans?|\bSoy\b/i.test(s)) return 'Soybeans';
    return ticket?.crop || null;
  }

  function gradeBlock(text) {
    const s = String(text || '').replace(/\r/g, '\n');
    let start = s.search(/Grade\s*:?\s*U\.?S\.?/i);
    if (start < 0) start = s.search(/Calibration\s+ID/i);
    if (start < 0) start = s.search(/Test\s*Weight|Testyveight|Moisture|Damaged\s+Kernels|Broken\s+Corn|Foreign\s+Mat/i);
    if (start < 0) return '';
    let block = s.slice(start, start + 2200);
    const stop = block.search(/\bGROSS\s+(?:L\.?BS|LBS|WEIGHT)\b|\bGross\s+Bushels\b/i);
    if (stop > 0) block = block.slice(0, stop);
    return block;
  }

  function plausibleGradeSet(values) {
    if (!values || values.length !== 4) return null;
    const [tw, mo, dm, fm] = values;
    if (!(tw >= 45 && tw <= 70)) return null;
    if (!(mo >= 7 && mo <= 35)) return null;
    if (!(dm >= 0 && dm <= 20)) return null;
    if (!(fm >= 0 && fm <= 20)) return null;
    return { testWeight: tw, moisture: mo, damage: dm, foreignMaterial: fm };
  }

  function grades(text) {
    const block = gradeBlock(text);
    if (!block) return null;
    const tokens = [...block.matchAll(/(?<![\d.])(\d{1,3}[.,]\d{1,2})(?!\d)/g)]
      .map(m => Number(String(m[1]).replace(',', '.')))
      .filter(Number.isFinite);
    for (let i = 0; i <= tokens.length - 4; i++) {
      const set = plausibleGradeSet(tokens.slice(i, i + 4));
      if (set) return { ...set, confidence: 'scoular_explicit_decimals' };
    }
    return null;
  }

  function allWeightCandidates(text, ticket) {
    const s = String(text || '');
    const values = [...s.matchAll(/(?<![\d.])(\d{2,3}[, ]\d{3}|\d{5,6})(?:\s*LBS?)?(?![\d.])/gi)]
      .map(m => num(m[1]))
      .filter(n => Number.isFinite(n) && n >= 15000 && n <= 120000);
    [ticket?.grossWeight,ticket?.tareWeight,ticket?.netWeight].map(Number)
      .filter(n => Number.isFinite(n) && n >= 15000 && n <= 120000).forEach(n => values.push(n));
    return [...new Set(values)];
  }

  function weights(text, ticket) {
    const vals = allWeightCandidates(text, ticket);
    let best = null;
    for (const gross of vals) for (const tare of vals) for (const net of vals) {
      if (gross === tare || gross === net || tare === net) continue;
      if (gross < 40000 || gross > 120000 || tare < 15000 || tare > 50000 || net < 10000 || net > 90000) continue;
      const error = Math.abs((gross - tare) - net);
      if (error > 20) continue;
      if (!best || error < best.error) best = { grossWeight:gross, tareWeight:tare, netWeight:net, error };
    }
    return best ? { ...best, confidence:'raw_weight_math_verified' } : null;
  }

  function printedBushels(text) {
    return [...String(text || '').matchAll(/(?<!\d)(\d{3,4}[.,]\d{1,2})\s*(?:BU|Bushels?)\b/gi)]
      .map(m => num(String(m[1]).replace(',', '.')))
      .filter(v => Number.isFinite(v) && v > 100 && v < 1500);
  }

  function bushels(text, ticket, w) {
    const vals = printedBushels(text);
    const divisor = ticket?.crop === 'Soybeans' ? 60 : ticket?.crop === 'Corn' ? 56 : null;
    const derived = w?.netWeight && divisor ? round2(w.netWeight / divisor) : null;
    if (vals.length && derived != null) {
      const close = vals.filter(v => Math.abs(v - derived) <= Math.max(1, derived * 0.02));
      if (close.length) {
        const net = close[close.length - 1];
        const gross = close.length > 1 ? close[0] : net;
        return { grossBushels:gross, netBushels:net, confidence:'printed_weight_crosscheck' };
      }
    }
    if (derived != null) return { grossBushels:derived, netBushels:derived, confidence:'verified_weight_derived' };
    return null;
  }

  function ticketNumber(text, current) {
    const s = String(text || '');
    const patterns = [
      /Inbound\s+Ticket\s*(?:No\.?|#|Number)?\s*[:#-]?\s*(\d{5,8})/i,
      /Ticket\s*(?:No\.?|#|Number)\s*[:#-]?\s*(\d{5,8})/i,
      /(?:^|\n)\s*(\d{5,8})\s*\n\s*(?:DOWSON[^\n]*\n\s*)?Inbound\s+Ticket\b/im,
      /(?:^|\n)\s*(\d{5,8})\s*\n(?=[\s\S]{0,160}\bInbound\s+Ticket\b)/im
    ];
    for (const pattern of patterns) { const m = s.match(pattern); if (m) return m[1]; }
    return current || null;
  }

  function ticketDate(text, current) {
    const m = String(text || '').match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})\b/);
    if (m) return `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
    return current || null;
  }

  function apply(ticket, text) {
    if (!matches(ticket, text)) return { matched:false, changed:false, complete:false };
    ticket.crop = crop(text, ticket);
    ticket.ticketNumber = ticketNumber(text, ticket.ticketNumber);
    ticket.ticketDate = ticketDate(text, ticket.ticketDate);
    const g = grades(text), w = weights(text, ticket), b = bushels(text, ticket, w);
    let changed = false;
    if (g) { Object.assign(ticket,{testWeight:g.testWeight,moisture:g.moisture,damage:g.damage,foreignMaterial:g.foreignMaterial}); changed=true; }
    if (w) { Object.assign(ticket,{grossWeight:w.grossWeight,tareWeight:w.tareWeight,netWeight:w.netWeight}); changed=true; }
    if (b) {
      ticket.grossBushels=b.grossBushels; ticket.netBushels=b.netBushels;
      ticket.calculatedGrossBushels=b.grossBushels; ticket.calculatedNetBushels=b.netBushels;
      ticket.printedGrossBushels=b.confidence.startsWith('printed')?b.grossBushels:null;
      ticket.printedNetBushels=b.confidence.startsWith('printed')?b.netBushels:null;
      ticket.shrinkBushels=round2(Math.max(0,b.grossBushels-b.netBushels)); changed=true;
    }
    const customer = String(text || '').match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (customer) { ticket.customerText=clean(customer[1]); ticket.customerAccountText=clean(customer[1]); changed=true; }
    const elevator = String(text || '').match(/Scoular\s*-\s*([^\n]+)/i);
    if (elevator) ticket.elevatorName=`Scoular - ${clean(elevator[1])}`;
    else if (!ticket.elevatorName) ticket.elevatorName='Scoular';
    ticket.parserProfile='scoular_github';
    const complete=!!(g&&w&&b&&ticket.ticketNumber&&ticket.ticketDate&&ticket.crop);
    console.log('[Grain Ticket] Scoular template result:',{complete,ticketNumber:ticket.ticketNumber,ticketDate:ticket.ticketDate,crop:ticket.crop,grades:g,weights:w,bushels:b,ocrSource:'full_ticket_document_ocr'});
    return { matched:true,changed,complete,grades:g,weights:w,bushels:b };
  }

  window.FVGrainTicketTemplates.scoular={matches,apply};
})();
