/* =====================================================================
   FarmVista — ADM Decatur Grade Factor Safety

   ADM Processing — Decatur currently prints the left-side grade labels close
   enough to the paper edge that OCR can lose the first character (DM -> OM,
   FM -> M, etc.). The right-side ADM row codes remain stable and the rows are
   consistently ordered on these tickets:

     AC = Test Weight
     GN = Moisture
     OP = Damage
     IF = Heat Damage (not stored by FarmVista yet)
     CO = Foreign Material / FM
     SR = Splits (not stored by FarmVista yet)

   Apply this only to ADM Processing, 4666 Fairies Parkway, Decatur, IL.
   Patch both grainTicket and fields so grain-ticket-scan.html cannot later
   overwrite the corrected value with the structured OCR value.
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

  function valueBeforeAnchor(text, anchor) {
    if (!text || !anchor) return null;

    /*
      Read the numeric value immediately before the stable ADM row code.
      Examples from the current Decatur printer:
        57.0 AC
        10.4 GN
        00.8 OP
        0.0  IF
        00.6 CO
        08.0 SR
    */
    const pattern = new RegExp(
      '(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+' + anchor + '\\b',
      'im'
    );

    const match = String(text).match(pattern);
    if (!match) return null;

    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function patchField(root, fieldName, value) {
    if (value === null || !Number.isFinite(value)) return false;

    root.grainTicket = root.grainTicket || {};
    root.fields = root.fields || {};

    root.grainTicket[fieldName] = value;
    root.fields[fieldName] = value;
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

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      if (!contentType.includes('application/json')) return response;

      const data = await response.clone().json();
      if (!patchAdmDecaturGrades(data)) return response;

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
      console.warn('[Grain Ticket] ADM Decatur grade correction skipped:', error);
      return response;
    }
  };
})();
