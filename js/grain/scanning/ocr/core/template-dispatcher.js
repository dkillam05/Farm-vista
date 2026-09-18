/* FarmVista — Grain Ticket OCR Template Dispatcher
   Cloud OCR stays generic. GitHub templates interpret known elevator layouts. */

import "../templates/scoular.js?v=20260917-1";
import "../templates/adm.js?v=20260917-1";
import "../templates/cahokia-grain.js?v=20260917-1";
import "../templates/green-plains.js?v=20260917-1";
import "../templates/bartlett.js?v=20260917-1";
import "../templates/cargill.js?v=20260917-1";
import "../templates/cgb.js?v=20260918-1";

function rawTextFromResult(result) {
  return String(
    result?.documentText ||
    result?.document?.text ||
    result?.grainTicket?.rawText ||
    ""
  );
}

const TEMPLATE_ORDER = [
  "scoular",
  "adm",
  "cahokiaGrain",
  "greenPlains",
  "bartlett",
  "cargill",
  "cgb"
];

export function applyGrainTicketTemplate(result) {
  const ticket = result?.grainTicket;
  if (!ticket) return { matched: false, template: null };

  const text = rawTextFromResult(result);
  const registry = window.FVGrainTicketTemplates || {};

  for (const key of TEMPLATE_ORDER) {
    const template = registry[key];
    if (!template?.matches || !template?.apply) continue;

    let matched = false;
    try {
      matched = template.matches(ticket, text) === true;
    } catch (error) {
      console.warn(`[Grain Ticket] Template match failed (${key}):`, error);
      continue;
    }

    if (!matched) continue;

    try {
      const applied = template.apply(ticket, text) || {};
      result.templateDispatch = {
        matched: true,
        template: key,
        complete: applied.complete === true,
        changed: applied.changed === true
      };
      console.log("[Grain Ticket] GitHub OCR template applied:", result.templateDispatch);
      return result.templateDispatch;
    } catch (error) {
      console.error(`[Grain Ticket] Template apply failed (${key}):`, error);
      result.templateDispatch = { matched: true, template: key, error: String(error?.message || error) };
      return result.templateDispatch;
    }
  }

  result.templateDispatch = { matched: false, template: null };
  return result.templateDispatch;
}
