/* =====================================================================
/Farm-vista/js/fv-pdf.js

Shared helper for generating PDFs of any FarmVista report via
Cloud Run PDF service.

Usage in a report page:
  1) Include this script:
       <script src="/Farm-vista/js/fv-pdf.js"></script>

  2) Add a button:
       <button type="button" data-fv-pdf-button>
         Download PDF for Phone
       </button>

  3) For auto-print pages, replace your window.print() logic with:
       window.addEventListener('load', () => {
         if (window.FVPdf && window.FVPdf.shouldAutoPrint()) {
           window.print();
         }
       });

This file assumes your Cloud Run PDF service URL is:
  https://farmvista-pdf-300398089669.us-central1.run.app
===================================================================== */

(() => {
  // TODO: if you ever change the Cloud Run service name/region,
  // update this one constant.
  const PDF_SERVICE_URL = 'https://farmvista-pdf-300398089669.us-central1.run.app';

  /**
   * Returns true if this page should auto-print (normal browser use),
   * false when being rendered by the PDF service.
   */
  function shouldAutoPrint() {
    try {
      const params = new URLSearchParams(window.location.search);
      // When pdfPreview=1, we are being rendered for PDF -> do NOT auto-print
      return params.get('pdfPreview') !== '1';
    } catch (err) {
      console.warn('FVPdf.shouldAutoPrint error:', err);
      return true;
    }
  }

  /**
   * Build a URL for the current report that is safe for PDF generation.
   * Adds pdfPreview=1 so the page does not call window.print().
   * You can pass extraParams if needed (rare).
   */
  function buildReportUrlForPdf(extraParams = {}) {
    const url = new URL(window.location.href);

    // Mark this as a PDF render so the page skips auto-print
    url.searchParams.set('pdfPreview', '1');

    Object.entries(extraParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    return url.toString();
  }

  /**
   * Open a PDF for the current report in a new tab/window.
   * On the phone, this will use the native PDF viewer.
   */
  function openPdfForCurrentReport(extraParams = {}) {
    try {
      const reportUrl = buildReportUrlForPdf(extraParams);
      const finalUrl = `${PDF_SERVICE_URL}?url=${encodeURIComponent(reportUrl)}`;

      window.open(finalUrl, '_blank');
    } catch (err) {
      console.error('FVPdf.openPdfForCurrentReport error:', err);
      alert('Sorry, there was a problem generating the PDF.');
    }
  }

  /**
   * Auto-wires any element with [data-fv-pdf-button] to open a PDF
   * for the current report when clicked.
   */
  function wirePdfButtons() {
    const buttons = document.querySelectorAll('[data-fv-pdf-button]');
    if (!buttons.length) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        openPdfForCurrentReport();
      });
    });
  }

  // Wire up buttons on DOM ready
  document.addEventListener('DOMContentLoaded', wirePdfButtons);

  // Expose a tiny API for report pages
  window.FVPdf = {
    PDF_SERVICE_URL,
    shouldAutoPrint,
    buildReportUrlForPdf,
    openPdfForCurrentReport
  };
})();
