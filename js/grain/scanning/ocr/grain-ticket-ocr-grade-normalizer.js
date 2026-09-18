/* FarmVista Beta — Grain Ticket OCR compatibility entry point
   The active scanner still references this historical module path.
   OCR implementation lives under /core. */

import { installTemplateGuidedRegionalReread } from "./core/regional-reread.js?v=20260917-3";
export { normalizeGrainTicketGrades } from "./core/grade-normalizer.js?v=20260917-3";

/* Historical function name retained for compatibility. It now installs the
   Beta-only transport to the dedicated full-ticket Document OCR service.
   No regional crop rereads are performed. */
installTemplateGuidedRegionalReread();
