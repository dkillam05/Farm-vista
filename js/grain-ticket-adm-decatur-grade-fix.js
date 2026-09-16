/* =====================================================================
   FarmVista — Grain Ticket OCR Response Compatibility Bridge

   CLEAN BASELINE — Sept. 16, 2026

   fvOcr is the only parser for this test. No ADM, Bartlett, Scoular, CHS,
   Cahokia, or other elevator template is loaded or allowed to rewrite OCR
   fields here.

   The scanner core historically reads result.document.text while the generic
   fvOcr response now exposes documentText at the top level. This bridge only
   mirrors that raw text into document.text. It does NOT alter grainTicket,
   fields, scanValid, scanErrors, weights, grades, bushels, buyer, customer,
   or any other parsed value.
===================================================================== */
(function () {
  'use strict';

  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_GENERIC_OCR_COMPAT_BRIDGE_20260916_1) return;
  window.__FV_GENERIC_OCR_COMPAT_BRIDGE_20260916_1 = true;

  const originalFetch = window.fetch.bind(window);

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

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

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const requestUrl = String(args?.[0]?.url || args?.[0] || '');
      if (!requestUrl.includes('/fvOcr')) return response;

      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      if (!contentType.includes('application/json')) return response;

      const data = await response.clone().json();
      const root = responseRoot(data);
      if (!root) return response;

      const text = rawDocumentText(data, root);
      if (!text) return response;

      root.documentText = text;
      root.document = root.document || {};
      root.document.text = text;

      console.log('[Grain Ticket] Generic fvOcr baseline response:', {
        parserProfile: root.parserProfile || data?.parserProfile || null,
        documentTextLength: text.length,
        scanValid: root.scanValid,
        scanErrors: root.scanErrors,
        grainTicket: root.grainTicket
      });

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');

      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.warn('[Grain Ticket] Generic OCR compatibility bridge skipped:', error);
      return response;
    }
  };
})();
