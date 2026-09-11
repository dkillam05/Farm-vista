/* =====================================================================
   FarmVista — Elevator OCR Template Safety

   This helper patches known elevator layouts after fvOcr returns JSON but
   before grain-ticket-scan.html validates/saves the ticket.

   Templates currently handled here:

   1) ADM Processing — Decatur, IL
      AC = Test Weight
      GN = Moisture
      OP = Damage
      IF = Heat Damage (not stored by FarmVista yet)
      CO = Foreign Material / FM
      SR = Splits (not stored by FarmVista yet)

   2) Bartlett Grain — Jacksonville, IL
      Stable printed labels:
        TW   = Test Weight
        MT   = Moisture
        DM   = Damage
        BCFM = Foreign Material / BCFM

      Bartlett OCR sometimes returns the bottom bushel row in visual rather
      than reading order (for example "939.29 ... NET BU ... GROSS BU").
      This template accepts values either before or after the printed bushel
      labels and safely falls back to the net-pound crop divisor when shrink
      is zero and both printed gross/net bushels are the same.

   Patch both grainTicket and fields for grade factors so the scanner's
   structured-field safety pass cannot overwrite a corrected template value.
===================================================================== */

(function () {
  'use strict';

  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_ADM_DECATUR_GRADE_FIX_20260904) return;
  window.__FV_ADM_DECATUR_GRADE_FIX_20260904 = true;

  const originalFetch = window.fetch.bind(window);

  const clean = value => String(value == null ? '' : value).trim();
  const compact = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

  function responseRoot(data) {
    if (data?.grainTicket) return data;
    if (data?.result?.grainTicket) return data.result;
    if (data?.ocrResult?.grainTicket) return data.ocrResult;
    return null;
  }

  function documentText(data, root) {
    return clean(
      root?.document?.text ||
      data?.document?.text ||
      data?.result?.document?.text ||
      data?.ocrResult?.document?.text ||
      root?.grainTicket?.rawText ||
      ''
    );
  }

  function isAdmDecatur(root, text) {
    const ticket = root?.grainTicket || {};
    const evidence = compact([
      ticket.elevatorName,
      ticket.deliveryStreet,
      ticket.deliveryCity,
      ticket.deliveryState,
      text
    ].filter(Boolean).join(' '));

    const adm = evidence.includes('admprocessing') || evidence.includes('archerdanielsmidland');
    const decatur = evidence.includes('decaturil') || evidence.includes('decatur');
    const fairies = evidence.includes('4666fairiesparkway') || evidence.includes('fairiesparkway');

    return adm && decatur && fairies;
  }

  function isBartlettJacksonville(root, text) {
    const ticket = root?.grainTicket || {};
    const evidence = compact([
      ticket.elevatorName,
      ticket.deliveryStreet,
      ticket.deliveryCity,
      ticket.deliveryState,
      ticket.deliveryZip,
      text
    ].filter(Boolean).join(' '));

    const bartlett = evidence.includes('bartlett');
    const jacksonville = evidence.includes('jacksonvilleil') || evidence.includes('jacksonville');
    const southMain = evidence.includes('2350southmain') || evidence.includes('southmain');
    const warehouseCertificate = evidence.includes('unitedstateswarehouseact');

    return bartlett && jacksonville && (southMain || warehouseCertificate);
  }

  function valueBeforeAnchor(text, anchor) {
    if (!text || !anchor) return null;

    const pattern = new RegExp(
      '(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+' + anchor + '\\b',
      'im'
    );

    const match = String(text).match(pattern);
    if (!match) return null;

    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function numericAfterLabel(text, labelPattern, options = {}) {
    if (!text) return null;

    const { allowCommas = false, suffixPattern = '' } = options;
    const numberPattern = allowCommas
      ? '([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)'
      : '([0-9]+(?:\\.[0-9]+)?)';

    const pattern = new RegExp(
      '(?:^|\\n|\\s)' + labelPattern + '\\s*:?[\\s\\r\\n]*' + numberPattern + suffixPattern,
      'im'
    );

    const match = String(text).match(pattern);
    if (!match) return null;

    const value = Number(String(match[1]).replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function numericBeforeLabel(text, labelPattern, options = {}) {
    if (!text) return null;

    const { allowCommas = false } = options;
    const numberPattern = allowCommas
      ? '([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?|[0-9]+(?:\\.[0-9]+)?)'
      : '([0-9]+(?:\\.[0-9]+)?)';

    const pattern = new RegExp(
      '(?:^|\\n|\\s)' + numberPattern + '\\s*' + labelPattern + '(?:\\b|\\s|$)',
      'im'
    );

    const match = String(text).match(pattern);
    if (!match) return null;

    const value = Number(String(match[1]).replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function firstNumericAfterLabel(text, labels, options = {}) {
    for (const label of labels) {
      const value = numericAfterLabel(text, label, options);
      if (value !== null) return value;
    }
    return null;
  }

  function firstNumericNearLabel(text, labels, options = {}) {
    for (const label of labels) {
      const after = numericAfterLabel(text, label, options);
      if (after !== null) return after;

      const before = numericBeforeLabel(text, label, options);
      if (before !== null) return before;
    }
    return null;
  }

  function patchField(root, fieldName, value) {
    if (value === null || !Number.isFinite(value)) return false;

    root.grainTicket = root.grainTicket || {};
    root.fields = root.fields || {};

    root.grainTicket[fieldName] = value;
    root.fields[fieldName] = value;
    return true;
  }

  function patchTicketNumber(root, text) {
    const match = String(text || '').match(/\bTicket\s*No\.?\s*[:#]?\s*([A-Z0-9-]{3,})\b/i);
    if (!match) return false;

    const value = clean(match[1]);
    if (!value) return false;

    root.grainTicket.ticketNumber = value;
    return true;
  }

  function patchBartlettCrop(root, text) {
    const match = String(text || '').match(/\bKind\s+of\s+Grain\s*:\s*([^\n\r]+)/i);
    if (!match) return false;

    const raw = clean(match[1]);
    if (!raw) return false;

    if (/corn/i.test(raw)) root.grainTicket.crop = 'Corn';
    else if (/soy/i.test(raw)) root.grainTicket.crop = 'Soybeans';
    else if (/wheat/i.test(raw)) root.grainTicket.crop = 'Wheat';
    else return false;

    return true;
  }

  function patchAdmDecaturGrades(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;

    const text = documentText(data, root);
    if (!isAdmDecatur(root, text)) return false;

    const values = {
      testWeight: valueBeforeAnchor(text, 'AC'),
      moisture: valueBeforeAnchor(text, 'GN'),
      damage: valueBeforeAnchor(text, 'OP'),
      heatDamage: valueBeforeAnchor(text, 'IF'),
      foreignMaterial: valueBeforeAnchor(text, 'CO'),
      splits: valueBeforeAnchor(text, 'SR')
    };

    let changed = false;
    changed = patchField(root, 'testWeight', values.testWeight) || changed;
    changed = patchField(root, 'moisture', values.moisture) || changed;
    changed = patchField(root, 'damage', values.damage) || changed;
    changed = patchField(root, 'foreignMaterial', values.foreignMaterial) || changed;

    if (changed) {
      console.log('[Grain Ticket] ADM Decatur row-anchor grade correction:', {
        testWeight: values.testWeight,
        moisture: values.moisture,
        damage: values.damage,
        heatDamage: values.heatDamage,
        foreignMaterial: values.foreignMaterial,
        splits: values.splits,
        mapping: 'AC=TW, GN=MO, OP=DM, IF=HD, CO=FM, SR=SP'
      });
    }

    return changed;
  }

  function patchBartlettJacksonville(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;

    const text = documentText(data, root);
    if (!isBartlettJacksonville(root, text)) return false;

    const values = {
      testWeight: firstNumericAfterLabel(text, ['TW']),
      moisture: firstNumericAfterLabel(text, ['MT', 'MO']),
      damage: firstNumericAfterLabel(text, ['DM']),
      foreignMaterial: firstNumericAfterLabel(text, ['BCFM', 'FM']),
      grossWeight: firstNumericAfterLabel(text, ['GROSS'], {
        allowCommas: true,
        suffixPattern: '\\s*(?:lb|lbs)\\b'
      }),
      tareWeight: firstNumericAfterLabel(text, ['TARE'], {
        allowCommas: true,
        suffixPattern: '\\s*(?:lb|lbs)\\b'
      }),
      netWeight: firstNumericAfterLabel(text, ['NET'], {
        allowCommas: true,
        suffixPattern: '\\s*(?:lb|lbs)\\b'
      }),
      grossBushels: firstNumericNearLabel(text, ['GROSS\\s+BU']),
      netBushels: firstNumericNearLabel(text, ['NET\\s+BU']),
      shrinkBushels: firstNumericNearLabel(text, ['SHRINK\\s+BU'])
    };

    const ticket = root.grainTicket;

    /*
      The bottom row is a multi-column print block. Google OCR may flatten it
      into a sequence that makes GROSS BU and NET BU ambiguous. When Bartlett
      explicitly shows zero shrink, its printed gross and net bushels are the
      same. Use net pounds / crop divisor as a final sanity anchor instead of
      trusting a neighboring number from the flattened row.
    */
    const cropText = clean(ticket.crop || text).toLowerCase();
    const divisor = cropText.includes('soy') ? 60 : cropText.includes('corn') ? 56 : null;
    const calculatedUnshrunkBushels =
      divisor && Number.isFinite(values.netWeight)
        ? Number((values.netWeight / divisor).toFixed(2))
        : null;

    if (
      values.shrinkBushels === 0 &&
      calculatedUnshrunkBushels !== null
    ) {
      if (
        values.grossBushels === null ||
        Math.abs(values.grossBushels - calculatedUnshrunkBushels) > 0.05
      ) {
        values.grossBushels = calculatedUnshrunkBushels;
      }

      if (
        values.netBushels === null ||
        Math.abs(values.netBushels - calculatedUnshrunkBushels) > 0.05
      ) {
        values.netBushels = calculatedUnshrunkBushels;
      }
    }

    let changed = false;

    changed = patchField(root, 'testWeight', values.testWeight) || changed;
    changed = patchField(root, 'moisture', values.moisture) || changed;
    changed = patchField(root, 'damage', values.damage) || changed;
    changed = patchField(root, 'foreignMaterial', values.foreignMaterial) || changed;

    if (values.grossWeight !== null) {
      ticket.grossWeight = values.grossWeight;
      changed = true;
    }
    if (values.tareWeight !== null) {
      ticket.tareWeight = values.tareWeight;
      changed = true;
    }
    if (values.netWeight !== null) {
      ticket.netWeight = values.netWeight;
      changed = true;
    }
    if (values.grossBushels !== null) {
      ticket.grossBushels = values.grossBushels;
      changed = true;
    }
    if (values.netBushels !== null) {
      ticket.netBushels = values.netBushels;
      changed = true;
    }
    if (values.shrinkBushels !== null) {
      ticket.shrinkBushels = values.shrinkBushels;
      changed = true;
    }

    changed = patchTicketNumber(root, text) || changed;
    changed = patchBartlettCrop(root, text) || changed;

    ticket.elevatorName = ticket.elevatorName || 'Bartlett Grain';
    ticket.deliveryStreet = ticket.deliveryStreet || '2350 South Main';
    ticket.deliveryCity = ticket.deliveryCity || 'Jacksonville';
    ticket.deliveryState = ticket.deliveryState || 'IL';
    ticket.deliveryZip = ticket.deliveryZip || '62650';

    if (changed) {
      console.log('[Grain Ticket] Bartlett Jacksonville template correction:', {
        ticketNumber: ticket.ticketNumber,
        crop: ticket.crop,
        testWeight: values.testWeight,
        moisture: values.moisture,
        damage: values.damage,
        foreignMaterial: values.foreignMaterial,
        grossWeight: values.grossWeight,
        tareWeight: values.tareWeight,
        netWeight: values.netWeight,
        grossBushels: values.grossBushels,
        shrinkBushels: values.shrinkBushels,
        netBushels: values.netBushels,
        mapping: 'TW=TW, MT=MO, DM=DM, BCFM=FM'
      });
    }

    return changed;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      if (!contentType.includes('application/json')) return response;

      const data = await response.clone().json();
      const changed = patchAdmDecaturGrades(data) || patchBartlettJacksonville(data);
      if (!changed) return response;

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    catch (error) {
      console.warn('[Grain Ticket] Elevator OCR template correction skipped:', error);
      return response;
    }
  };
})();
