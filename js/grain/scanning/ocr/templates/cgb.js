/* FarmVista — CGB grain-ticket template
   Company-level template for Consolidated Grain and Barge (CGB) tickets.
   Dedicated Google Document OCR supplies raw text; this file maps explicit
   printed labels only and never invents ambiguous values. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};

  const num = v => {
    const n = Number(String(v == null ? '' : v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const round2 = n => Number(Number(n).toFixed(2));

  function matches(ticket, text) {
    return /CONSOLIDATED\s+GRAIN\s+AND\s+BARGE|\bCGB\s+ELEVATORS?\b/i.test(
      [ticket?.elevatorName, text].filter(Boolean).join('\n')
    );
  }

  function crop(text, current) {
    const s = String(text || '');
    if (/YELLOW\s+SOYBEANS?|\bSOYBEANS?\b/i.test(s)) return 'Soybeans';
    if (/YELLOW\s+CORN|\bCORN\b/i.test(s)) return 'Corn';
    return current || null;
  }

  function ticketNumber(text, current) {
    const m = String(text || '').match(/Scale\s+Ticket\s*:?\s*(\d{5,9})\b/i);
    return m ? m[1] : (current || null);
  }

  function ticketDate(text, current) {
    const s = String(text || '');
    const m = s.match(/Shipment\s*Date\s*:?\s*(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})/i)
      || s.match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](20\d{2})\b/);
    return m ? `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}` : (current || null);
  }

  function labeledDecimal(text, label, min, max) {
    const m = String(text || '').match(new RegExp(label + '\\s*:?\\s*([0-9]{1,2}\\.[0-9]{1,2})\\b', 'i'));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  function grades(text) {
    const tw = labeledDecimal(text, 'TEST\\s+WEIGHT', 45, 70);
    const mo = labeledDecimal(text, 'MOISTURE', 7, 35);
    const dm = labeledDecimal(text, 'DAMAGE', 0, 20);
    const fm = labeledDecimal(text, 'FOREIGN\\s+MATE(?:R(?:IAL)?)?', 0, 20);
    if (![tw, mo, dm, fm].every(Number.isFinite)) return null;
    return { testWeight: tw, moisture: mo, damage: dm, foreignMaterial: fm, confidence: 'cgb_explicit_labels' };
  }

  function labeledWeight(text, label) {
    const m = String(text || '').match(new RegExp(label + '\\s*:?\\s*([0-9]{2,3}(?:,[0-9]{3})|[0-9]{5,6})\\b', 'i'));
    return m ? num(m[1]) : null;
  }

  function weights(text, ticket) {
    const gross = labeledWeight(text, 'Gross\\s+Weight') ?? num(ticket?.grossWeight);
    const tare = labeledWeight(text, 'Tare\\s+Weight') ?? num(ticket?.tareWeight);
    const net = labeledWeight(text, 'Net\\s+Weight') ?? num(ticket?.netWeight);
    if (![gross, tare, net].every(Number.isFinite)) return null;
    if (Math.abs((gross - tare) - net) > 20) return null;
    return { grossWeight: gross, tareWeight: tare, netWeight: net, confidence: 'cgb_labeled_weight_math_verified' };
  }

  function bushels(text, cropName, w) {
    const s = String(text || '');
    const grossMatch = s.match(/(?:BUSHELS[\s\S]{0,100}?)?Gross\s*:?\s*(\d{3,4}[.,]\d{1,2})\b/i);
    const printed = grossMatch ? Number(grossMatch[1].replace(',', '.')) : null;
    const divisor = cropName === 'Soybeans' ? 60 : cropName === 'Corn' ? 56 : null;
    const derived = w?.netWeight && divisor ? round2(w.netWeight / divisor) : null;
    if (Number.isFinite(printed) && derived != null && Math.abs(printed - derived) <= Math.max(1, derived * .02)) {
      return { grossBushels: printed, netBushels: printed, confidence: 'cgb_printed_weight_crosscheck' };
    }
    if (derived != null) return { grossBushels: derived, netBushels: derived, confidence: 'cgb_verified_weight_derived' };
    return null;
  }

  function apply(ticket, text) {
    if (!matches(ticket, text)) return { matched:false, changed:false, complete:false };

    ticket.crop = crop(text, ticket.crop);
    ticket.ticketNumber = ticketNumber(text, ticket.ticketNumber);
    ticket.ticketDate = ticketDate(text, ticket.ticketDate);

    const g = grades(text);
    const w = weights(text, ticket);
    const b = bushels(text, ticket.crop, w);
    let changed = false;

    if (g) {
      Object.assign(ticket, {
        testWeight:g.testWeight, moisture:g.moisture,
        damage:g.damage, foreignMaterial:g.foreignMaterial
      });
      changed = true;
    }
    if (w) {
      Object.assign(ticket, {
        grossWeight:w.grossWeight, tareWeight:w.tareWeight, netWeight:w.netWeight
      });
      changed = true;
    }
    if (b) {
      ticket.grossBushels = b.grossBushels;
      ticket.netBushels = b.netBushels;
      ticket.calculatedGrossBushels = b.grossBushels;
      ticket.calculatedNetBushels = b.netBushels;
      ticket.shrinkBushels = round2(Math.max(0, b.grossBushels - b.netBushels));
      changed = true;
    }

    const customer = String(text || '').match(/Customer\s*:?\s*([0-9]+)[\s\n]+([^\n]+)/i);
    if (customer) {
      ticket.customerAccountText = customer[1].trim();
      ticket.customerText = customer[2].trim();
      changed = true;
    }

    if (!ticket.elevatorName) ticket.elevatorName = 'CGB';
    ticket.parserProfile = 'cgb_github';

    const complete = !!(g && w && b && ticket.ticketNumber && ticket.ticketDate && ticket.crop);
    console.log('[Grain Ticket] CGB template result:', {
      complete, ticketNumber:ticket.ticketNumber, ticketDate:ticket.ticketDate,
      crop:ticket.crop, grades:g, weights:w, bushels:b,
      ocrSource:'full_ticket_document_ocr'
    });
    return { matched:true, changed, complete, grades:g, weights:w, bushels:b };
  }

  window.FVGrainTicketTemplates.cgb = { matches, apply };
})();
