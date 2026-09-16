/* FarmVista — Scoular Waverly grain-ticket template
   This is intentionally elevator-specific. The Cloud OCR service should read
   text; this helper owns Scoular Waverly layout interpretation in FarmVista. */
(function () {
  'use strict';
  window.FVGrainTicketTemplates = window.FVGrainTicketTemplates || {};

  const clean = v => String(v == null ? '' : v).trim();
  const compact = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const number = v => {
    const n = Number(String(v || '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  function matches(ticket, text) {
    const hay = compact([
      ticket?.elevatorName, ticket?.deliveryStreet, ticket?.deliveryCity,
      ticket?.deliveryState, ticket?.deliveryZip, text
    ].filter(Boolean).join(' '));
    return hay.includes('scoular') &&
      (hay.includes('waverly') || hay.includes('elevatoridwave') ||
       hay.includes('15379jasmineroad') || hay.includes('jasmineroad'));
  }

  function gradeBlock(text) {
    const source = String(text || '').replace(/\r/g, '\n');
    let start = source.search(/Grade\s*:?\s*U\.?S\.?/i);
    if (start < 0) start = source.search(/Test\s*Weight|Moisture|Damaged\s+Kernels|Broken\s+Corn/i);
    if (start < 0) return '';
    let block = source.slice(start, start + 1200);
    const stop = block.search(/\bGROSS\s+L\.?BS\s*:?|\bTARE\s+L\.?BS\s*:?|\bGross\s+Bushels\b/i);
    if (stop > 0) block = block.slice(0, stop);
    return block;
  }

  function grades(text) {
    const block = gradeBlock(text);
    if (!block) return null;
    // Scoular Waverly prints these four grade values in fixed order:
    // TW, MO, DM, FM. Only decimal-form grade readings are accepted here;
    // unrelated integers such as grade number, calibration ID, times, etc.
    // must never become a grade.
    const vals = [...block.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2})(?!\d)/g)]
      .map(m => Number(m[1]));
    for (let i = 0; i <= vals.length - 4; i++) {
      const [tw, mo, dm, fm] = vals.slice(i, i + 4);
      if (tw >= 45 && tw <= 70 && mo >= 7 && mo <= 35 &&
          dm >= 0 && dm <= 20 && fm >= 0 && fm <= 20) {
        return { testWeight: tw, moisture: mo, damage: dm, foreignMaterial: fm };
      }
    }
    return null;
  }

  function weights(text) {
    const source = String(text || '').replace(/\r/g, '\n');
    const start = source.search(/GROSS\s+L\.?BS\s*:?/i);
    if (start < 0) return null;
    let block = source.slice(start, start + 650);
    const stop = block.search(/Gross\s+Bushels\s*:?/i);
    if (stop > 0) block = block.slice(0, stop);
    const vals = [...block.matchAll(/\b(\d{2,3},\d{3}|\d{5,6})\s*L\.?BS\b/gi)]
      .map(m => number(m[1])).filter(Number.isFinite);
    for (let i = 0; i <= vals.length - 3; i++) {
      const gross = vals[i], tare = vals[i + 1], net = vals[i + 2];
      if (gross >= 40000 && gross <= 95000 && tare >= 20000 && tare <= 35000 &&
          net > 0 && gross - tare === net) {
        return { grossWeight: gross, tareWeight: tare, netWeight: net };
      }
    }
    return null;
  }

  function bushels(text, ticket, parsedWeights) {
    const source = String(text || '').replace(/\r/g, '\n');
    const start = source.search(/Gross\s+Bushels\s*:?/i);
    if (start >= 0) {
      const block = source.slice(start, start + 400);
      const vals = [...block.matchAll(/\b(\d{2,4}\.\d{1,2})\s*BU\b/gi)]
        .map(m => number(m[1])).filter(Number.isFinite);
      if (vals.length >= 2 && vals[0] < 1200 && vals[1] < 1200) {
        return { grossBushels: vals[0], netBushels: vals[1] };
      }
    }
    if (parsedWeights?.netWeight) {
      const divisor = ticket?.crop === 'Soybeans' ? 60 : ticket?.crop === 'Corn' ? 56 : null;
      if (divisor) {
        const bu = Number((parsedWeights.netWeight / divisor).toFixed(2));
        return { grossBushels: bu, netBushels: bu };
      }
    }
    return null;
  }

  function apply(ticket, text) {
    if (!matches(ticket, text)) return { matched: false, changed: false };
    const g = grades(text);
    const w = weights(text);
    const b = bushels(text, ticket, w);
    let changed = false;
    if (g) { Object.assign(ticket, g); changed = true; }
    if (w) { Object.assign(ticket, w); changed = true; }
    if (b) {
      ticket.grossBushels = b.grossBushels;
      ticket.netBushels = b.netBushels;
      ticket.printedGrossBushels = b.grossBushels;
      ticket.printedNetBushels = b.netBushels;
      ticket.shrinkBushels = Number(Math.max(0, b.grossBushels - b.netBushels).toFixed(2));
      changed = true;
    }
    const truck = String(text || '').match(/Truck\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (truck) { ticket.vehicleId = clean(truck[1]); changed = true; }
    const customer = String(text || '').match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (customer) { ticket.customerText = clean(customer[1]); ticket.customerAccountText = clean(customer[1]); changed = true; }
    ticket.elevatorName = 'Scoular - Waverly';
    ticket.deliveryStreet = '15379 Jasmine Road';
    ticket.deliveryCity = 'Waverly'; ticket.deliveryState = 'IL'; ticket.deliveryZip = '62692';
    return { matched: true, changed, grades: g, weights: w, bushels: b };
  }

  window.FVGrainTicketTemplates.scoularWaverly = { matches, apply };
})();