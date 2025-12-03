// /Farm-vista/js/fv-pdf.js
// Shared helper for sending reports to the Cloud Run PDF service
// and opening the generated PDF (mainly for mobile).
//
// Supports two modes:
//  1) URL mode   → GET  /pdf?url=...    (same as before)
//  2) HTML mode  → POST /pdf-html       (new, auth-safe)
//
// Desktop print flows in your report pages DO NOT change – they
// still use hidden iframes + window.print(). This file is only
// for the "Download PDF for Phone" style flows.

(function (global) {
  'use strict';

  // 👉 Your Cloud Run service URL (include /pdf route)
  // We derive the /pdf-html endpoint from this automatically.
  const CLOUD_RUN_PDF_URL =
    'https://farmvista-pdf-300398089669.us-central1.run.app/pdf';

  // Derive /pdf-html from the /pdf URL so you only edit one string.
  const CLOUD_RUN_PDF_HTML_URL = CLOUD_RUN_PDF_URL.replace(
    /\/pdf\b/,
    '/pdf-html'
  );

  const FVPdf = {
    CLOUD_RUN_PDF_URL,
    CLOUD_RUN_PDF_HTML_URL,

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
     * URL mode (existing behavior):
     * Sends the current report URL to Cloud Run and opens the PDF.
     * Used by any button with [data-fv-pdf-button] that does NOT
     * opt into HTML mode.
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
    },

    /**
     * HTML mode (NEW):
     * Accepts a fully built HTML string and posts it to Cloud Run
     * /pdf-html. The service returns a PDF blob that we open in a
     * new tab – perfect for mobile "Download PDF" flows where the
     * report itself is behind Firebase auth.
     *
     * Usage (from a report page):
     *
     *   const html = buildDetailedPrintHtml(...); // same as desktop
     *   FVPdf.openPdfFromHtml(html, { filename: 'Trial-Detailed.pdf' });
     */
    async openPdfFromHtml(html, options = {}) {
      if (!html || typeof html !== 'string') {
        console.warn('[FVPdf] openPdfFromHtml called with empty HTML');
        alert('No HTML content available to build a PDF.');
        return;
      }

      const endpoint = this.CLOUD_RUN_PDF_HTML_URL;
      const filename = options.filename || 'report.pdf';

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          // We send raw text/html; index.js accepts text or JSON.
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: html
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          console.error(
            '[FVPdf] /pdf-html error',
            resp.status,
            resp.statusText,
            errText
          );
          alert(
            'PDF service returned an error (' +
              resp.status +
              '). Try again in a moment.'
          );
          return;
        }

        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Try to open in a new tab; if blocked, redirect.
        const win = window.open(blobUrl, '_blank');
        if (!win) {
          window.location.href = blobUrl;
        }

        // Let the browser reclaim it later; we don't revoke immediately
        // since the tab might still need it.
        // setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch (err) {
        console.error('[FVPdf] openPdfFromHtml network error:', err);
        alert(
          'Could not reach the PDF service right now. Check your connection and try again.'
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

          // If the button explicitly opts into HTML mode, emit an event
          // that the page can handle and call openPdfFromHtml().
          //
          // Example on a page:
          //   <button data-fv-pdf-button data-fv-pdf-html-mode="1">Download</button>
          //
          //   document.addEventListener('fv:build-pdf-html', async (e) => {
          //     const html = buildDetailedPrintHtml(...);
          //     e.detail.resolve(html);
          //   });
          //
          // This keeps the HTML-building logic on the report page, not here.
          if (btn.hasAttribute('data-fv-pdf-html-mode')) {
            const detail = {};
            let resolver;
            const htmlPromise = new Promise((resolve) => {
              resolver = resolve;
            });
            detail.resolve = resolver;

            const event = new CustomEvent('fv:build-pdf-html', {
              bubbles: true,
              cancelable: false,
              detail
            });

            document.dispatchEvent(event);

            htmlPromise
              .then((html) => {
                if (html && typeof html === 'string') {
                  FVPdf.openPdfFromHtml(html);
                } else {
                  console.warn(
                    '[FVPdf] fv:build-pdf-html did not provide HTML'
                  );
                  alert(
                    'Could not build the PDF HTML. Try again or refresh the page.'
                  );
                }
              })
              .catch((err) => {
                console.error(
                  '[FVPdf] error while waiting for HTML from fv:build-pdf-html',
                  err
                );
                alert(
                  'Something went wrong while building the PDF. Try again in a moment.'
                );
              });

            return;
          }

          // Default behavior: URL mode (what you have today).
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
