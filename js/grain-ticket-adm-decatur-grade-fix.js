/* =====================================================================
   FarmVista — Elevator OCR Template Safety
   Known layouts: ADM Decatur + Bartlett Jacksonville + Scoular Waverly
===================================================================== */
(function () {
  'use strict';
  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_ADM_DECATUR_GRADE_FIX_20260911) return;
  window.__FV_ADM_DECATUR_GRADE_FIX_20260911 = true;

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
    return clean(root?.document?.text || data?.document?.text || data?.result?.document?.text ||
      data?.ocrResult?.document?.text || root?.grainTicket?.rawText || '');
  }

  function isAdmDecatur(root, text) {
    const t = root?.grainTicket || {};
    const e = compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));
    return (e.includes('admprocessing') || e.includes('archerdanielsmidland')) &&
      e.includes('decatur') && (e.includes('4666fairiesparkway') || e.includes('fairiesparkway'));
  }

  function isBartlettJacksonville(root, text) {
    const t = root?.grainTicket || {};
    const e = compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));
    return e.includes('bartlett') && e.includes('jacksonville') &&
      (e.includes('2350southmain') || e.includes('southmain') || e.includes('unitedstateswarehouseact'));
  }

  function isScoularWaverly(root, text) {
    const t = root?.grainTicket || {};
    const e = compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));
    return e.includes('scoular') && e.includes('waverly') &&
      (e.includes('wave') || e.includes('15379jasmineroad') || e.includes('jasmineroad'));
  }

  function valueBeforeAnchor(text, anchor) {
    const m = String(text || '').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+' + anchor + '\\b','im'));
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? n : null;
  }

  function patchField(root, name, value) {
    if (!Number.isFinite(value)) return false;
    root.grainTicket ||= {};
    root.fields ||= {};
    root.grainTicket[name] = value;
    root.fields[name] = value;
    return true;
  }

  function patchAdm(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;
    const text = documentText(data, root);
    if (!isAdmDecatur(root,text)) return false;
    let changed = false;
    changed = patchField(root,'testWeight',valueBeforeAnchor(text,'AC')) || changed;
    changed = patchField(root,'moisture',valueBeforeAnchor(text,'GN')) || changed;
    changed = patchField(root,'damage',valueBeforeAnchor(text,'OP')) || changed;
    changed = patchField(root,'foreignMaterial',valueBeforeAnchor(text,'CO')) || changed;
    return changed;
  }

  /*
    BARTLETT JACKSONVILLE LAYOUT TEMPLATE

      GRADE FACTOR
      TW    <value>
      MT    <value>
      DM    <value>
      BCFM  <value>
  */
  function bartlettGradeBlock(text) {
    const source = String(text || '').replace(/\r/g,'\n');
    const start = source.search(/GRADE\s*FACTOR/i);
    if (start < 0) return null;

    let block = source.slice(start, start + 700);
    const stop = block.search(/(?:\bINSPECTOR\b|\bGROSS\s+BU\b|\bNET\s+BU\b|\bSHRINK\s+BU\b)/i);
    if (stop > 0) block = block.slice(0, stop);

    const read = label => {
      const re = new RegExp('(?:^|\\n|\\s)' + label + '\\s*[:=-]?\\s*([0-9]{1,3}(?:\\.[0-9]{1,2})?)\\b','i');
      const m = block.match(re);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    };

    return {
      testWeight: read('TW'),
      moisture: read('MT'),
      damage: read('DM'),
      foreignMaterial: read('BCFM')
    };
  }

  function labeledNumber(text, label, requireLb=false) {
    const suffix = requireLb ? '\\s*(?:lb|lbs)\\b' : '\\b';
    const re = new RegExp('\\b' + label + '\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)' + suffix,'i');
    const m = String(text || '').match(re);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g,''));
    return Number.isFinite(n) ? n : null;
  }

  function patchBartlett(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;
    const text = documentText(data, root);
    if (!isBartlettJacksonville(root,text)) return false;

    const ticket = root.grainTicket;
    const grades = bartlettGradeBlock(text) || {};
    let changed = false;

    changed = patchField(root,'testWeight',grades.testWeight) || changed;
    changed = patchField(root,'moisture',grades.moisture) || changed;
    changed = patchField(root,'damage',grades.damage) || changed;
    changed = patchField(root,'foreignMaterial',grades.foreignMaterial) || changed;

    const gross = labeledNumber(text,'GROSS',true);
    const tare = labeledNumber(text,'TARE',true);
    const net = labeledNumber(text,'NET',true);
    const shrink = labeledNumber(text,'SHRINK\\s+BU');

    if (Number.isFinite(gross)) { ticket.grossWeight = gross; changed = true; }
    if (Number.isFinite(tare)) { ticket.tareWeight = tare; changed = true; }
    if (Number.isFinite(net)) { ticket.netWeight = net; changed = true; }
    if (Number.isFinite(shrink)) { ticket.shrinkBushels = shrink; changed = true; }

    const cropMatch = text.match(/Kind\s+of\s+Grain\s*:\s*([^\n\r]+)/i);
    if (cropMatch) {
      if (/corn/i.test(cropMatch[1])) ticket.crop = 'Corn';
      else if (/soy/i.test(cropMatch[1])) ticket.crop = 'Soybeans';
      else if (/wheat/i.test(cropMatch[1])) ticket.crop = 'Wheat';
    }

    const ticketMatch = text.match(/\bTicket\s*No\.?\s*[:#]?\s*([A-Z0-9-]{3,})\b/i);
    if (ticketMatch) ticket.ticketNumber = clean(ticketMatch[1]);

    if (ticket.shrinkBushels === 0 && Number.isFinite(ticket.netWeight)) {
      const divisor = ticket.crop === 'Soybeans' ? 60 : ticket.crop === 'Corn' ? 56 : null;
      if (divisor) {
        const bu = Number((ticket.netWeight / divisor).toFixed(2));
        ticket.grossBushels = bu;
        ticket.netBushels = bu;
        changed = true;
      }
    }

    ticket.elevatorName = 'Bartlett Grain';
    ticket.deliveryStreet = '2350 South Main';
    ticket.deliveryCity = 'Jacksonville';
    ticket.deliveryState = 'IL';
    ticket.deliveryZip = '62650';

    console.log('[Grain Ticket] Bartlett Jacksonville FIXED-LAYOUT template:', {
      ticketNumber: ticket.ticketNumber,
      TW: grades.testWeight,
      MT: grades.moisture,
      DM: grades.damage,
      BCFM: grades.foreignMaterial,
      grossWeight: ticket.grossWeight,
      tareWeight: ticket.tareWeight,
      netWeight: ticket.netWeight,
      grossBushels: ticket.grossBushels,
      shrinkBushels: ticket.shrinkBushels,
      netBushels: ticket.netBushels
    });
    return changed;
  }

  /*
    SCOULAR WAVERLY LAYOUT TEMPLATE

    The two supplied Waverly samples use the same four-row grade order:
      Test Weight
      Moisture
      Damaged Kernels (total)
      Broken Corn & Foreign Mat

    Document AI sometimes emits those labels and their numeric values out of
    visual order, and fields={} on both supplied scans. The reliable signal is
    the first four decimal grade values in the section beginning at Grade and
    ending before Gross Bushels. Their fixed meaning is TW, MO, DM, FM.

    Scoular also prints BOTH Gross Bushels and Net Bushels. Those printed values
    must win over pounds/divisor math because Scoular may apply shrink. FarmVista
    derives shrink as printedGrossBu - printedNetBu.
  */
  function scoularGradeValues(text) {
    const source = String(text || '').replace(/\r/g,'\n');
    const start = source.search(/Grade\s*:\s*U\.?S\.?/i);
    if (start < 0) return null;
    let block = source.slice(start, start + 1300);
    const stop = block.search(/\bGross\s+Bushels\s*:/i);
    if (stop > 0) block = block.slice(0, stop);

    const values = [];
    const re = /(?:^|\s)(\d{1,2}\.\d{1,2})(?=\s|$)/g;
    let match;
    while ((match = re.exec(block)) && values.length < 8) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) values.push(n);
    }

    if (values.length < 4) return null;
    const [tw,mo,dm,fm] = values;
    if (!(tw >= 35 && tw <= 70)) return null;
    if (!(mo >= 0 && mo <= 40)) return null;
    if (!(dm >= 0 && dm <= 50)) return null;
    if (!(fm >= 0 && fm <= 50)) return null;
    return {testWeight:tw,moisture:mo,damage:dm,foreignMaterial:fm};
  }

  function scoularPrintedBushels(text) {
    const source = String(text || '').replace(/\r/g,'\n');
    const start = source.search(/Gross\s+Bushels\s*:/i);
    if (start < 0) return null;
    const block = source.slice(start, start + 350);
    const values = [];
    const re = /([0-9][0-9,]*\.\d{1,2})\s*BU\b/gi;
    let match;
    while ((match = re.exec(block)) && values.length < 2) {
      const n = Number(match[1].replace(/,/g,''));
      if (Number.isFinite(n)) values.push(n);
    }
    if (values.length < 2) return null;
    return {grossBushels:values[0],netBushels:values[1]};
  }

  function scoularWeights(text) {
    const source = String(text || '').replace(/\r/g,'\n');
    const start = source.search(/GROSS\s+L\.?BS\s*:/i);
    if (start < 0) return null;
    let block = source.slice(start, start + 500);
    const stop = block.search(/Gross\s+Bushels\s*:/i);
    if (stop > 0) block = block.slice(0, stop);
    const values = [];
    const re = /\b([2-9]\d{4,5}|[2-9]\d{1,2},\d{3})\s+L\.?BS\b/gi;
    let match;
    while ((match = re.exec(block)) && values.length < 3) {
      const n = Number(match[1].replace(/,/g,''));
      if (Number.isFinite(n)) values.push(n);
    }
    return values.length >= 3 ? {grossWeight:values[0],tareWeight:values[1],netWeight:values[2]} : null;
  }

  function patchScoular(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;
    const text = documentText(data, root);
    if (!isScoularWaverly(root,text)) return false;

    const ticket = root.grainTicket;
    const grades = scoularGradeValues(text) || {};
    const weights = scoularWeights(text);
    const bushels = scoularPrintedBushels(text);
    let changed = false;

    changed = patchField(root,'testWeight',grades.testWeight) || changed;
    changed = patchField(root,'moisture',grades.moisture) || changed;
    changed = patchField(root,'damage',grades.damage) || changed;
    changed = patchField(root,'foreignMaterial',grades.foreignMaterial) || changed;

    if (weights) {
      ticket.grossWeight = weights.grossWeight;
      ticket.tareWeight = weights.tareWeight;
      ticket.netWeight = weights.netWeight;
      changed = true;
    }

    if (bushels) {
      ticket.grossBushels = bushels.grossBushels;
      ticket.printedGrossBushels = bushels.grossBushels;
      ticket.netBushels = bushels.netBushels;
      ticket.printedNetBushels = bushels.netBushels;
      ticket.shrinkBushels = Number(Math.max(0,bushels.grossBushels - bushels.netBushels).toFixed(2));
      changed = true;
    }

    const ticketMatch = text.match(/(?:^|\n)\s*(\d{5,8})\s*(?:\n|$)/m);
    if (ticketMatch) ticket.ticketNumber = ticketMatch[1];

    const customerIdMatch = text.match(/Customer\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (customerIdMatch) {
      ticket.customerText = clean(customerIdMatch[1]);
      ticket.customerAccountText = clean(customerIdMatch[1]);
    }

    const truckMatch = text.match(/Truck\s+ID\s*:\s*([A-Z0-9-]+)/i);
    if (truckMatch) ticket.vehicleId = clean(truckMatch[1]);

    if (/Yellow\s+Corn|Corn\s*\(YC\)/i.test(text)) ticket.crop = 'Corn';
    else if (/Soybeans?|Soy\s*\(/i.test(text)) ticket.crop = 'Soybeans';

    ticket.elevatorName = 'Scoular - Waverly';
    ticket.deliveryStreet = '15379 Jasmine Road';
    ticket.deliveryCity = 'Waverly';
    ticket.deliveryState = 'IL';
    ticket.deliveryZip = '62692';

    console.log('[Grain Ticket] Scoular Waverly FIXED-LAYOUT template:', {
      ticketNumber:ticket.ticketNumber,
      TW:ticket.testWeight,
      MO:ticket.moisture,
      DM:ticket.damage,
      FM:ticket.foreignMaterial,
      grossWeight:ticket.grossWeight,
      tareWeight:ticket.tareWeight,
      netWeight:ticket.netWeight,
      grossBushels:ticket.grossBushels,
      shrinkBushels:ticket.shrinkBushels,
      netBushels:ticket.netBushels,
      customerText:ticket.customerText,
      vehicleId:ticket.vehicleId
    });
    return changed;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const type = clean(response.headers.get('content-type')).toLowerCase();
      if (!type.includes('application/json')) return response;
      const data = await response.clone().json();
      const changed = patchAdm(data) || patchBartlett(data) || patchScoular(data);
      if (!changed) return response;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(JSON.stringify(data), {status:response.status,statusText:response.statusText,headers});
    } catch (error) {
      console.warn('[Grain Ticket] Elevator layout template skipped:',error);
      return response;
    }
  };
})();
