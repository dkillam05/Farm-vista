/* =====================================================================
   FarmVista — Elevator OCR Template Safety
   Known layouts: ADM Decatur + Bartlett Jacksonville
===================================================================== */
(function () {
  'use strict';
  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_ADM_DECATUR_GRADE_FIX_20260904) return;
  window.__FV_ADM_DECATUR_GRADE_FIX_20260904 = true;

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

    Do NOT parse these four grade values independently from the whole OCR text.
    They are one fixed vertical block on every supplied Jacksonville ticket:

      GRADE FACTOR
      TW    <value>
      MT    <value>
      DM    <value>
      BCFM  <value>

    Generic OCR had been assigning MT's value to Damage. This parser first
    isolates the GRADE FACTOR block, then reads each complete label/value row.
  */
  function bartlettGradeBlock(text) {
    const source = String(text || '').replace(/\r/g,'\n');
    const start = source.search(/GRADE\s*FACTOR/i);
    if (start < 0) return null;

    let block = source.slice(start, start + 700);
    const stop = block.search(/(?:\bINSPECTOR\b|\bGROSS\s+BU\b|\bNET\s+BU\b|\bSHRINK\s+BU\b)/i);
    if (stop > 0) block = block.slice(0, stop);

    const read = label => {
      /* Label followed by its number; whitespace/newlines are allowed, but
         another grade label may not intervene. */
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

    /* Template values always win over generic structured OCR. */
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

    /* Bartlett tickets supplied so far explicitly show 0.00 shrink. For that
       layout, gross/net bushels must equal net pounds / crop divisor. This is
       more reliable than OCR reading order in the horizontal bottom row. */
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

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const type = clean(response.headers.get('content-type')).toLowerCase();
      if (!type.includes('application/json')) return response;
      const data = await response.clone().json();
      const changed = patchAdm(data) || patchBartlett(data);
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
