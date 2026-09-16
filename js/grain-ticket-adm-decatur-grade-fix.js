/* =====================================================================
   FarmVista — Scoular Waverly OCR Template Bridge

   Cloud fvOcr stays generic. This bridge only recognizes Scoular Waverly,
   applies its dedicated GitHub template to raw documentText, then validates
   the corrected structured result. It does not parse ADM or Bartlett.
===================================================================== */
(function () {
  'use strict';

  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_SCOULAR_WAVERLY_TEMPLATE_BRIDGE_20260916_10) return;
  window.__FV_SCOULAR_WAVERLY_TEMPLATE_BRIDGE_20260916_10 = true;

  const templateReady = (() => {
    if (window.FVGrainTicketTemplates?.scoularWaverly) return Promise.resolve(true);
    return new Promise(resolve => {
      const old = document.querySelector('script[data-fv-scoular-waverly-template]');
      if (old) old.remove();
      const script = document.createElement('script');
      script.src = '/js/grain-ticket-templates/scoular-waverly.js?v=20260916-10';
      script.dataset.fvScoularWaverlyTemplate = '1';
      script.onload = () => resolve(true);
      script.onerror = () => {
        console.warn('[Grain Ticket] Scoular Waverly template failed to load.');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  })();

  const originalFetch = window.fetch.bind(window);
  const clean = value => String(value == null ? '' : value).trim();

  function responseRoot(data) {
    if (data?.grainTicket) return data;
    if (data?.result?.grainTicket) return data.result;
    if (data?.ocrResult?.grainTicket) return data.ocrResult;
    return null;
  }

  function rawDocumentText(data, root) {
    return clean(
      root?.documentText ||
      data?.documentText ||
      root?.document?.text ||
      data?.document?.text ||
      data?.result?.documentText ||
      data?.ocrResult?.documentText ||
      root?.grainTicket?.rawText ||
      ''
    );
  }

  function isResolvedScoularError(message, result) {
    const text = String(message || '').toLowerCase();
    if (result.grades && (
      text.includes('test weight') ||
      text.includes('moisture') ||
      text.includes('damage') ||
      text.includes('foreign material') ||
      text.includes('grade')
    )) return true;

    if (result.weights && (
      text.includes('gross minus tare') ||
      text.includes('gross weight') ||
      text.includes('tare weight') ||
      text.includes('net weight')
    )) return true;

    if (result.bushels && text.includes('bushel')) return true;
    return false;
  }

  function patchScoular(data) {
    const root = responseRoot(data);
    if (!root?.grainTicket) return false;

    const text = rawDocumentText(data, root);
    const template = window.FVGrainTicketTemplates?.scoularWaverly;
    if (!template || !text || !template.matches(root.grainTicket, text)) return false;

    console.log('[Grain Ticket] RAW fvOcr documentText BEFORE Scoular template:\n' + text);

    const result = template.apply(root.grainTicket, text);
    if (!result?.matched) return false;

    /* Keep both response shapes populated so the scanner core always sees
       Google's original text regardless of which response property it reads. */
    root.documentText = text;
    root.document = root.document || {};
    root.document.text = text;

    root.fields = root.fields || {};
    for (const name of ['testWeight', 'moisture', 'damage', 'foreignMaterial']) {
      const value = Number(root.grainTicket[name]);
      if (Number.isFinite(value)) root.fields[name] = value;
    }

    /* The generic parser validates before it knows the Scoular layout. Remove
       only errors that the dedicated template has positively resolved. */
    root.scanErrors = Array.isArray(root.scanErrors)
      ? root.scanErrors.filter(message => !isResolvedScoularError(message, result))
      : [];

    if (result.complete) {
      root.scanValid = root.scanErrors.length === 0;
    } else {
      root.scanValid = false;
      const message = 'Scoular Waverly ticket could not be fully verified from OCR. Please review.';
      if (!root.scanErrors.includes(message)) root.scanErrors.push(message);
    }

    console.log('[Grain Ticket] Scoular Waverly template result:', {
      template: result,
      scanValid: root.scanValid,
      scanErrors: root.scanErrors,
      grainTicket: root.grainTicket
    });

    return true;
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const requestUrl = String(args?.[0]?.url || args?.[0] || '');
      if (!requestUrl.includes('/fvOcr')) return response;

      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      if (!contentType.includes('application/json')) return response;

      const data = await response.clone().json();
      await templateReady;
      if (!patchScoular(data)) return response;

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.warn('[Grain Ticket] Scoular Waverly template bridge skipped:', error);
      return response;
    }
  };
})();
