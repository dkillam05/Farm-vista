/* FarmVista — Scoular Waverly grain-ticket template
   Elevator-specific interpretation belongs here, not in Cloud OCR. */
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
    const hay = compact([
      ticket?.elevatorName,
      ticket?.deliveryStreet,
      ticket?.deliveryCity,
      ticket?.deliveryState,
      ticket?.deliveryZip,
      text
    ].filter(Boolean).join(' '));
    const scoular = hay.includes('scoular');
    const wave = hay.includes('elevatoridwave') || hay.includes('waverly');
    const address = hay.includes('15379jasmineroad') || hay.includes('jasmineroad');
    return (scoular && (wave || address)) || (wave && address);
  }

  function crop(text, ticket) {
    const s = String(text || '');
    if (/Yellow\s+Corn|\bCorn\s*\(YC\)/i.test(s)) return 'Corn';
    if (/Soybeans?|\bSoy\b/i.test(s)) return 'Soybeans';
    return ticket?.crop || null;
  }

  function gradeBlock(text) {
    const s = String(text || '').replace(/\r/g, '\n');
    let start = s.search(/Grade\s*:?\s*U\.?S\.?/i);
    if (start < 0) start = s.search(/Calibration\s+ID/i);
    if (start < 0) start = s.search(/Test\s*Weight|Moisture|Damaged\s+Kernels|Broken\s+Corn/i);
    if (start < 0) return '';
    let block = s.slice(start, start + 1400);
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

    /*
      SCOULAR WAVERLY PRINTED LAYOUT
      The four tracked values are always TW -> MO -> DM -> FM.

      The Waverly printer/OCR frequently separates the numbers from their labels,
      and the word Moisture is especially unreliable. Therefore the template does
      NOT require any individual grade label. It reads the four decimal grade
      values in printed order inside the grade section and validates each against
      the FarmVista grade ranges before accepting the set.

      We intentionally accept 1-3 digits before the decimal. This matters because
      OCR may return DM/FM as 00.8 or 00.0 rather than 0.8 or 0.0.
    */
    const decimalTokens = [...block.matchAll(/(?<![\d.])(\d{1,3}\.\d{1,2})(?!\d)/g)]
      .map(m => Number(m[1]))
      .filter(Number.isFinite);

    for (let i = 0; i <= decimalTokens.length - 4; i++) {
      const set = plausibleGradeSet(decimalTokens.slice(i, i + 4));
      if (set) return { ...set, confidence: 'scoular_waverly_fixed_grade_order' };
    }

    /* Conservative fallback for a dropped decimal point. Stay within the same
       grade block and preserve order; never search arbitrary ticket numbers. */
    const rawTokens = [...block.matchAll(/(?<!\d)(\d{1,3}(?:\.\d{1,2})?)(?!\d)/g)].map(m => m[1]);
    const normalize = (raw, slot) => {
      const t = String(raw || '');
      let n = Number(t);
      if (!Number.isFinite(n)) return null;
      if (slot === 0) {
        if (n >= 45 && n <= 70) return n;
        if (!t.includes('.') && n >= 450 && n <= 700) return n / 10;
        return null;
      }
      if (slot === 1) {
        if (n >= 7 && n <= 35) return n;
        if (!t.includes('.') && n >= 70 && n <= 350) return n / 10;
        return null;
      }
      if (n >= 0 && n <= 20) return n;
      if (!t.includes('.') && n >= 21 && n <= 200) return n / 10;
      return null;
    };

    for (let i = 0; i <= rawTokens.length - 4; i++) {
      const vals = rawTokens.slice(i, i + 4).map((v, slot) => normalize(v, slot));
      if (vals.every(v => v != null)) {
        const set = plausibleGradeSet(vals);
        if (set) return { ...set, confidence: 'scoular_waverly_fixed_grade_order_recovered' };
      }
    }
    return null;
  }

  function weightBlock(text) {
    const s = String(text || '').replace(/\r/g, '\n');
    let start = s.search(/GROSS\s+(?:L\.?BS|LBS|WEIGHT)\s*:?/i);
    if (start < 0) start = s.search(/TARE\s+(?:L\.?BS|LBS|WEIGHT)\s*:?/i);
    if (start < 0) start = s.search(/NET\s+(?:L\.?BS|LBS|WEIGHT)\s*:?/i);
    if (start < 0) return '';
    let block = s.slice(start, start + 1300);
    const stop = block.search(/Gross\s+Bushels\s*:?/i);
    if (stop > 0) block = block.slice(0, stop);
    return block;
  }

  function weightCandidates(text) {
    const block = weightBlock(text);
    if (!block) return [];
    return [...block.matchAll(/(?<!\d)(\d{2,3}[, ]\d{3}|\d{5,6})(?!\d)/g)]
      .map(m => num(m[1]))
      .filter(n => Number.isFinite(n) && n >= 15000 && n <= 100000);
  }

  function weights(text, ticket) {
    const vals = weightCandidates(text);
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 1; j < vals.length; j++) {
        for (let k = j + 1; k < vals.length; k++) {
          const gross = vals[i], tare = vals[j], net = vals[k];
          if (gross >= 40000 && gross <= 95000 && tare >= 20000 && tare <= 35000 && net > 0 && Math.abs((gross - tare) - net) <= 20) {
            return { grossWeight: gross, tareWeight: tare, netWeight: net, confidence: 'printed_math_verified' };
          }
        }
      }
    }
    const generic = [ticket?.grossWeight, ticket?.tareWeight, ticket?.netWeight]
      .map(Number).filter(n => Number.isFinite(n) && n >= 15000 && n <= 95000);
    const all = [...new Set([...vals, ...generic])];
    for (const gross of all) {
      for (const tare of all) {
        if (gross <= tare || gross < 40000 || gross > 95000 || tare < 20000 || tare > 35000) continue;
        const net = gross - tare;
        if (net >= 15000 && net <= 75000) return { grossWeight: gross, tareWeight: tare, netWeight: net, confidence: 'gross_tare_math_derived' };
      }
    }
    return null;
  }

  function bushels(text, ticket, w) {
    const s = String(text || '').replace(/\r/g, '\n');
    const start = s.search(/Gross\s+Bushels\s*:?/i);
    if (start >= 0) {
      const block = s.slice(start, start + 500);
      const vals = [...block.matchAll(/\b(\d{2,4}\.\d{1,2})\s*BU\b/gi)]
        .map(m => num(m[1])).filter(Number.isFinite).filter(v => v > 100 && v < 1200);
      if (vals.length) {
        const second = vals.length > 1 ? vals[1] : vals[0];
        return { grossBushels: vals[0], netBushels: second, confidence: vals.length > 1 ? 'printed' : 'single_printed' };
      }
    }
    if (w?.netWeight) {
      const divisor = ticket?.crop === 'Soybeans' ? 60 : ticket?.crop === 'Corn' ? 56 : null;
      if (divisor) {
        const bu = round2(w.netWeight / divisor);
        return { grossBushels: bu, netBushels: bu, confidence: 'weight_derived' };
      }
    }
    return null;
  }

  function apply(ticket, text) {
    if (!matches(ticket, text)) return { matched: false, changed: false, complete: false };
    ticket.crop = crop(text, ticket);
    const g = grades(text);
    const w = weights(text, ticket);
    const b = bushels(text, ticket, w);
    let changed = false;

    if (g) {
      Object.assign(ticket, { testWeight: g.testWeight, moisture: g.moisture, damage: g.damage, foreignMaterial: g.foreignMaterial });
      changed = true;
    }
    if (w) {
      Object.assign(ticket, { grossWeight: w.grossWeight, tareWeight: w.tareWeight, netWeight: w.netWeight });
      changed = true;
    }
    if (b) {
      ticket.grossBushels = b.grossBushels;
      ticket.netBushels = b.netBushels;
      ticket.calculatedGrossBushels = b.grossBushels;
      ticket.calculatedNetBushels = b.netBushels;
      ticket.printedGrossBushels = b.confidence.startsWith('printed') ? b.grossBushels : null;
      ticket.printedNetBushels = b.confidence === 'printed' ? b.netBushels : null;
      ticket.shrinkBushels = round2(Math.max(0, b.grossBushels - b.netBushels));
      changed = true;
    }

    const customer = String(text || '').match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (customer) {
      ticket.customerText = clean(customer[1]);
      ticket.customerAccountText = clean(customer[1]);
      changed = true;
    }

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
