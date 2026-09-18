/* FarmVista Beta — Grain Ticket OCR transport
   Beta uses the dedicated FarmVista grain-ticket Document OCR service.
   The Cloud service returns raw OCR text/layout only; GitHub elevator templates
   remain authoritative for ticket interpretation.

   This module keeps the historical export name so the active scanner entry point
   does not need a risky large-file rewrite. There are NO regional crop rereads. */

const LEGACY_GRAIN_OCR = /https:\/\/fv-ocr-300398089669\.us-central1\.run\.app\/fvOcr/i;
const GRAIN_TICKET_OCR_URL = "https://farmvistagrainticketocr-300398089669.us-central1.run.app";
let installed = false;

function isGrainTicketRequest(init) {
  if (String(init?.method || "GET").toUpperCase() !== "POST") return false;
  try {
    const body = JSON.parse(String(init?.body || "{}"));
    return body?.mode === "grain_ticket" && !!body?.content;
  } catch (_) {
    return false;
  }
}

function adaptDocumentOcrResult(result) {
  if (!result || typeof result !== "object") return result;

  /* The new service intentionally does not parse elevator fields. Seed the
     shape expected by the existing scanner so the GitHub template dispatcher
     can build the ticket from Google's raw OCR evidence. */
  if (!result.grainTicket || typeof result.grainTicket !== "object") {
    result.grainTicket = {};
  }
  if (!result.fields || typeof result.fields !== "object") {
    result.fields = {};
  }
  if (!Array.isArray(result.scanErrors)) result.scanErrors = [];
  if (!Array.isArray(result.reviewWarnings)) result.reviewWarnings = [];
  if (result.scanValid !== true) result.scanValid = false;

  result.grainTicket.rawText = String(result.documentText || result.grainTicket.rawText || "");
  result.ocrTransport = {
    source: "farmvista_grain_ticket_ocr",
    engine: result.ocrEngine || "google_document_ai_document_ocr",
    regionalRereads: false
  };

  return result;
}

export function installTemplateGuidedRegionalReread() {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = async function farmVistaGrainTicketOcrFetch(input, init) {
    const originalUrl = typeof input === "string" ? input : String(input?.url || "");

    if (!LEGACY_GRAIN_OCR.test(originalUrl) || !isGrainTicketRequest(init)) {
      return nativeFetch(input, init);
    }

    console.log("[Grain Ticket] Beta OCR route: dedicated Document OCR service");

    const response = await nativeFetch(GRAIN_TICKET_OCR_URL, init);

    try {
      const result = adaptDocumentOcrResult(await response.clone().json());
      return new Response(JSON.stringify(result), {
        status: response.status,
        statusText: response.statusText,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      console.warn("[Grain Ticket] Could not adapt Document OCR response:", error);
      return response;
    }
  };
}
