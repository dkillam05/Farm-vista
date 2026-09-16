/* FarmVista — Scoular Waverly grain-ticket template
   Elevator-specific interpretation belongs here, not in Cloud OCR.
   The Cloud service supplies raw OCR text + a generic parse. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};

  const clean = v => String(v == null ? '' : v).trim();
  const compact = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = v => {
    const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const round2 = n => Number(Number(n).toFixed(2));

  function matches(ticket, text) {
    const hay = compact([
      ticket?.elevatorName, ticket?.deliveryStreet, ticket?.deliveryCity,
      ticket?.deliveryState, ticket?.deliveryZip, text
    ].filter(Boolean).join(' '));
    return hay.includes('scoular') &&
      (hay.includes('waverly') || hay.includes('elevatoridwave') ||
       hay.includes('15379jasmineroad') || hay.includes('jasmineroad'));
  }

  function crop(text, ticket) {
    const hay = String(text || '');
    if (/Yellow\s+Corn|\bCorn\s*\(YC\)/i.test(hay)) return 'Corn';
    if (/Soybeans?|\bSoy\b/i.test(hay)) return 'Soybeans';
    return ticket?.crop || null;
  }

  function gradeBlock(text) {
    const source = String(text || '').replace(/\r/g, '\n');
    let start = source.search(/Grade\s*:?\s*U\.?S\.?/i);
    if (start < 0) start = source.search(/Test\s*Weight|Moisture|Damaged\s+Kernels|Broken\s+Corn/i);
    if (start < 0) return '';
    let block = source.slice(start, start + 1400);
    const stop = block.search(/\bGROSS\s+L\.?BS\s*:?|\bTARE\s+L\.?BS\s*:?|\bGross\s+Bushels\b/i);
    if (stop > 0) block = block.slice(0, stop);
    return block;
  }

  function grades(text) {
    const block = gradeBlock(text);
    if (!block) return null;

    // Scoular Waverly prints TW -> MO -> DM -> FM in a fixed grade table.
    // Prefer the four decimal readings exactly as OCR saw them. We never use
    // unrelated whole numbers (grade number, truck ID, calibration, times).
    const vals = [...block.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2})(?!\d)/g)]
      .map(m => Number(m[1]));
    for (let i = 0; i <= vals.length - 4; i++) {
      const [tw, mo, dm, fm] = vals.slice(i, i + 4);
      if (tw >= 45 && tw <= 70 && mo >= 7 && mo <= 35 && dm >= 0 && dm <= 20 && fm >= 0 && fm <= 20) {
        return { testWeight: tw, moisture: mo, damage: dm, foreignMaterial: fm, confidence: 'exact_decimal_quartet' };
      }
    }

    // Phone OCR occasionally drops ONLY the decimal from moisture (13.2 -> 132).
    // Recover that one narrow case only when TW, DM and FM remain decimal and the
    // four values are consecutive. Do not repair TW/DM/FM from arbitrary integers.
    const tokens = [...block.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)(?!\d)/g)].map(m => m[1]);
    for (let i = 0; i <= tokens.length - 4; i++) {
      const [a,b,c,d] = tokens.slice(i, i + 4);
      if (!a.includes('.') || !c.includes('.') || !d.includes('.') || b.includes('.')) continue;
      const tw = num(a), rawMo = num(b), dm = num(c), fm = num(d);
      const mo = rawMo >= 70 && rawMo <= 350 ? rawMo / 10 : null;
      if (tw >= 45 && tw <= 70 && mo >= 7 && mo <= 35 && dm >= 0 && dm <= 20 && fm >= 0 && fm <= 20) {
        return { testWeight: tw, moisture: mo, damage: dm, foreignMaterial: fm, confidence: 'moisture_decimal_recovered' };
      }
    }
    return null;
  }

  function weights(text) {
    const source = String(text || '').replace(/\r/g, '\n');
    const start = source.search(/GROSS\s+L\.?BS\s*:?/i);
    if (start < 0) return null;
    let block = source.slice(start, start + 800);
    const stop = block.search(/Gross\s+Bushels\s*:?/i);
    if (stop > 0) block = block.slice(0, stop);
    const vals = [...block.matchAll(/\b(\d{2,3},\d{3}|\d{5,6})\s*L\.?BS\b/gi)]
      .map(m => num(m[1])).filter(Number.isFinite);
    for (let i = 0; i <= vals.length - 3; i++) {
      const gross = vals[i], tare = vals[i + 1], net = vals[i + 2];
      if (gross >= 40000 && gross <= 95000 && tare >= 20000 && tare <= 35000 && net > 0 && gross - tare === net) {
        return { grossWeight: gross, tareWeight: tare, netWeight: net, confidence: 'printed_math_verified' };
      }
    }
    return null;
  }

  function bushels(text, ticket, parsedWeights) {
    const source = String(text || '').replace(/\r/g, '\n');
    const start = source.search(/Gross\s+Bushels\s*:?/i);
    if (start >= 0) {
      const block = source.slice(start, start + 450);
      const vals = [...block.matchAll(/\b(\d{2,4}\.\d{1,2})\s*BU\b/gi)]
        .map(m => num(m[1])).filter(Number.isFinite);
      if (vals.length >= 2 && vals[0] > 0 && vals[0] < 1200 && vals[1] > 0 && vals[1] < 1200) {
        return { grossBushels: vals[0], netBushels: vals[1], confidence: 'printed' };
      }
    }
    if (parsedWeights?.netWeight) {
      const divisor = ticket?.crop === 'Soybeans' ? 60 : ticket?.crop === 'Corn' ? 56 : null;
      if (divisor) {
        const bu = round2(parsedWeights.netWeight / divisor);
        return { grossBushels: bu, netBushels: bu, confidence: 'weight_derived' };
      }
    }
    return null;
  }

  function apply(ticket, text) {
    if (!matches(ticket, text)) return { matched: false, changed: false, complete: false };

    ticket.crop = crop(text, ticket);
    const g = grades(text);
    const w = weights(text);
    const b = bushels(text, ticket, w);
    let changed = false;

    if (g) { Object.assign(ticket, { testWeight:g.testWeight, moisture:g.moisture, damage:g.damage, foreignMaterial:g.foreignMaterial }); changed = true; }
    if (w) { Object.assign(ticket, { grossWeight:w.grossWeight, tareWeight:w.tareWeight, netWeight:w.netWeight }); changed = true; }
    if (b) {
      ticket.grossBushels = b.grossBushels;
      ticket.netBushels = b.netBushels;
      ticket.calculatedGrossBushels = b.grossBushels;
      ticket.calculatedNetBushels = b.netBushels;
      ticket.printedGrossBushels = b.confidence === 'printed' ? b.grossBushels : null;
      ticket.printedNetBushels = b.confidence === 'printed' ? b.netBushels : null;
      ticket.shrinkBushels = round2(Math.max(0, b.grossBushels - b.netBushels));
      changed = true;
    }

    const truck = String(text || '').match(/Truck\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (truck) { ticket.vehicleId = clean(truck[1]); changed = true; }
    const customer = String(text || '').match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (customer) { ticket.customerText = clean(customer[1]); ticket.customerAccountText = clean(customer[1]); changed = true; }
    const ticketNo = String(text || '').match(/(?:^|\n)\s*([0-9]{5,8})\s*(?:\n|$)/m);
    if (!ticket.ticketNumber && ticketNo) { ticket.ticketNumber = ticketNo[1]; changed = true; }

    ticket.elevatorName = 'Scoular - Waverly';
    ticket.deliveryStreet = '15379 Jasmine Road';
    ticket.deliveryCity = 'Waverly';
    ticket.deliveryState = 'IL';
    ticket.deliveryZip = '62692';
    ticket.parserProfile = 'scoular_waverly_github';

    const complete = !!(g && w && b && ticket.ticketNumber && ticket.crop);
    return { matched: true, changed, complete, grades: g, weights: w, bushels: b };
  }

  window.FVGrainTicketTemplates.scoularWaverly = { matches, apply };
})();