// /Farm-vista/js/fv-pdf.js
// Shared helper for sending a report URL to Cloud Run PDF service
// and opening the generated PDF (mainly for mobile).

(function (global) {
  'use strict';

  // 👉 Your Cloud Run service URL (include /pdf route)
  const CLOUD_RUN_PDF_URL =
    'https://farmvista-pdf-300398089669.us-central1.run.app/pdf';

  const FVPdf = {
    CLOUD_RUN_PDF_URL,

    /**
     * Returns false when this page is being rendered specifically
     * for PDF (pdfPreview=1). Use this on pages that auto-call
     * window.print() so puppeteer doesn't see the print dialog.
     */
    shouldAutoPrint() {
      try {
        const url = new URL(window.location.href);
        const flag = url.searchParams.get('pdfPreview');
        return flag !== '1';
      } catch (err) {
        console.warn('[FVPdf] shouldAutoPrint error:', err);
        // If anything is weird, fall back to normal behavior.
        return true;
      }
    },

    /**
     * Builds the URL for this same report but with pdfPreview=1
     * so the page knows it's being rendered for PDF (no dialogs).
     */
    buildReportUrlForPdf() {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('pdfPreview', '1');
        return url.toString();
      } catch (err) {
        console.warn('[FVPdf] buildReportUrlForPdf error:', err);
        return window.location.href;
      }
    },

    /**
     * Sends the current report URL to Cloud Run and opens the PDF.
     * Used by any button with [data-fv-pdf-button].
     */
    openPdfForCurrentReport() {
      try {
        const reportUrl = this.buildReportUrlForPdf();
        const pdfUrl =
          this.CLOUD_RUN_PDF_URL + '?url=' + encodeURIComponent(reportUrl);

        const win = window.open(pdfUrl, '_blank');
        if (!win) {
          // Popup blocked – fall back to full redirect.
          window.location.href = pdfUrl;
        }
      } catch (err) {
        console.error('[FVPdf] openPdfForCurrentReport error:', err);
        alert(
          'Could not open PDF right now. Check your connection and try again.'
        );
      }
    }
  };

  global.FVPdf = FVPdf;

  /* ---------- auto-wire [data-fv-pdf-button] ---------- */

  function wirePdfButtons() {
    try {
      const buttons = document.querySelectorAll('[data-fv-pdf-button]');
      buttons.forEach((btn) => {
        if (btn.__fvPdfWired) return;
        btn.__fvPdfWired = true;
        btn.addEventListener('click', function (evt) {
          evt.preventDefault();
          FVPdf.openPdfForCurrentReport();
        });
      });
    } catch (err) {
      console.warn('[FVPdf] Failed to wire PDF buttons:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wirePdfButtons);
  } else {
    wirePdfButtons();
  }
})(window);
