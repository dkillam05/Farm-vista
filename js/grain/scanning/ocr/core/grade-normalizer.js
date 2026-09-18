/* FarmVista — Grain Ticket OCR Verification Entry Point
   Dedicated Document OCR stays generic. Known elevator interpretation belongs
   to GitHub templates. Legacy cleanup is retained only for older OCR responses. */

import { normalizeGrainTicketGrades as normalizeLegacyGrades } from "../legacy/grain-ticket-ocr-grade-normalizer-legacy.js";
import { applyGrainTicketTemplate } from "./template-dispatcher.js?v=20260918-1";

function syncScannerFields(result) {
  const ticket = result?.grainTicket;
  if (!ticket || typeof ticket !== "object") return;

  if (!result.fields || typeof result.fields !== "object") result.fields = {};

  /* The active scanner still consumes the historical structured fields object
     after normalization. The dedicated OCR service intentionally returns raw
     OCR only, so copy only template-verified values into that compatibility
     shape. No values are inferred here. */
  const verified = {
    ticketNumber: ticket.ticketNumber,
    ticketDate: ticket.ticketDate,
    crop: ticket.crop,
    testWeight: ticket.testWeight,
    moisture: ticket.moisture,
    damage: ticket.damage,
    foreignMaterial: ticket.foreignMaterial,
    grossWeight: ticket.grossWeight,
    tareWeight: ticket.tareWeight,
    netWeight: ticket.netWeight,
    grossBushels: ticket.grossBushels,
    netBushels: ticket.netBushels,
    shrinkBushels: ticket.shrinkBushels,
    customerText: ticket.customerText,
    customerAccountText: ticket.customerAccountText,
    elevatorName: ticket.elevatorName,
    deliveryStreet: ticket.deliveryStreet,
    deliveryCity: ticket.deliveryCity,
    deliveryState: ticket.deliveryState,
    deliveryZip: ticket.deliveryZip
  };

  for (const [key, value] of Object.entries(verified)) {
    if (value !== null && value !== undefined && value !== "") result.fields[key] = value;
  }
}

export function normalizeGrainTicketGrades(result) {
  if (!result || typeof result !== "object") return result;

  const isDocumentOcr =
    result.ocrEngine === "google_document_ai_document_ocr" ||
    result.grainTicket?.ocrEngine === "google_document_ai_document_ocr" ||
    result.ocrTransport?.source === "farmvista_grain_ticket_ocr";

  if (isDocumentOcr) {
    if (!result.grainTicket || typeof result.grainTicket !== "object") result.grainTicket = {};
    result.grainTicket.rawText = String(result.documentText || result.grainTicket.rawText || "");
    result.grainTicket.ocrEngine = result.ocrEngine || "google_document_ai_document_ocr";
    if (Array.isArray(result.pages)) result.grainTicket.ocrPages = result.pages;
  } else {
    normalizeLegacyGrades(result);
  }

  const dispatch = applyGrainTicketTemplate(result);

  if (dispatch?.matched === true && dispatch?.complete === true) {
    syncScannerFields(result);

    result.scanValid = true;
    result.scanErrors = [];

    if (result.grainTicket && typeof result.grainTicket === "object") {
      result.grainTicket.scanValid = true;
      result.grainTicket.scanErrors = [];
    }

    result.templateValidation = {
      source: "github_template",
      template: dispatch.template,
      repairedGenericValidation: true
    };

    console.log("[Grain Ticket] Template verified repaired OCR ticket:", result.templateValidation);
  }

  return result;
}
