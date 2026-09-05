/* =====================================================================
   FarmVista — version.js
   Single Source of Truth (SSOT) for version + tagline
   HARD-SAFE to load multiple times (no redeclaration errors)
===================================================================== */

(function () {
  'use strict';

  // Preserve the original FarmVista version initialization behavior.
  if (!window.FV_VERSION || !window.FV_VERSION.number) {
    window.FV_VERSION = {
      number:  "08.18.01",
      date:    "2026-08-18",
      tagline: "Farm Data - Simplified"
    };

    window.FarmVistaVersion = window.FV_VERSION.number;
    window.FV_BUILD = window.FV_VERSION.number;

    window.App = window.App || {};
    window.App.getVersion = () => ({
      number: window.FV_VERSION.number,
      date: window.FV_VERSION.date,
      tagline: window.FV_VERSION.tagline
    });
  }

  const path = String(window.location.pathname || '').toLowerCase();

  const isGrainTicketDetail =
    path.endsWith('/pages/grain/grain-ticket-detail.html');

  const isGrainTicketPage =
    path.endsWith('/pages/grain/grain-ticket.html');

  const isGrainTicketAdd =
    path.endsWith('/pages/grain/grain-ticket-add.html');

  const isGrainTicketScan =
    path.endsWith('/pages/grain/grain-ticket-scan.html');

  const isGrainContracts =
    path.endsWith('/pages/grain/grain-contracts.html');

  const isGrainSection =
    path.includes('/pages/grain/');

  const isGrainInventory =
    path.endsWith('/pages/grain/index.html') ||
    path === '/pages/grain/' ||
    path === '/pages/grain';

  /* ===================================================================
     SEPT 4, 2026 — CANONICAL GRAIN SOURCE REPAIR

     IMPORTANT:
     This is a bulk repair/migration pass. It must NOT run in the critical
     path of opening Ticket Details, Manual Add, or Load Out. Those pages
     should remain lightweight and load immediately.

     Run the repair from Grain Inventory only. It reads existing
     grain_tickets, grain_loadouts, and fields and normalizes old/current
     harvest source records before the inventory rollup refreshes.
  =================================================================== */

  if (
    isGrainInventory &&
    !window.__FV_GRAIN_SOURCE_CANONICAL_20260904_V2
  ) {
    window.__FV_GRAIN_SOURCE_CANONICAL_20260904_V2 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-ticket-source-normalizer.js?v=20260904-3';
    script.dataset.fvGrainSourceCanonical = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — GRAIN SOURCE WORDING CONSISTENCY

     Keep this helper off Ticket Details. The Ticket Details-specific source
     helper already handles its source labels and field UI. This avoids extra
     observers touching the detail page while it is rendering.
  =================================================================== */

  if (
    (isGrainTicketPage || isGrainTicketAdd) &&
    !window.__FV_GRAIN_SOURCE_UI_CONSISTENCY_20260904
  ) {
    window.__FV_GRAIN_SOURCE_UI_CONSISTENCY_20260904 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-source-ui-consistency.js?v=20260904-1';
    script.dataset.fvGrainSourceUiConsistency = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 3, 2026 — GRAIN TICKET FIELD SOURCE UI

     Ticket Details gets only its lightweight page-specific helper:
       - displays only real field names from /fields;
       - replaces hundreds of field rows with one Fields drill-in;
       - shows generic harvest as Active Harvest;
       - moves Hauling Job directly below FarmVista Load Number.
  =================================================================== */

  if (isGrainTicketDetail && !window.__FV_GRAIN_TICKET_SOURCE_UI_20260903) {
    window.__FV_GRAIN_TICKET_SOURCE_UI_20260903 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-ticket-detail-source-ui.js?v=20260904-3';
    script.dataset.fvGrainTicketSourceUi = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — TICKET DETAIL SOURCE EDIT PRESERVATION

     Editing only Grain Source / Field on an existing ticket must not clear
     Destination, Sold Under, Hauling Job, Load Number, Crop, or Driver.
     The detail page's original wizard logic clears downstream fields when
     source changes; this helper restores the existing load selections through
     the page's own controls so both UI and private state remain synchronized.
  =================================================================== */

  if (
    isGrainTicketDetail &&
    !window.__FV_GRAIN_TICKET_DETAIL_PRESERVE_LOAD_20260904
  ) {
    window.__FV_GRAIN_TICKET_DETAIL_PRESERVE_LOAD_20260904 = true;

    const script = document.createElement('script');
    script.src = '/js/grain-ticket-detail-preserve-load.js?v=20260904-1';
    script.dataset.fvGrainTicketDetailPreserveLoad = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 3, 2026 — LOAD OUT REPEAT-RUN DEFAULTS

     Use ONE ordered module for repeat-run autofill.

     Order matters because changing Hauling Job intentionally rebuilds and
     clears dependent controls on grain-ticket.html:
       1. Driver
       2. Hauling Job
       3. Sold Under / Customer
       4. Grain Source LAST
  =================================================================== */

  if (isGrainTicketPage && !window.__FV_GRAIN_LOADOUT_REPEAT_ORDER_FIX_20260903) {
    window.__FV_GRAIN_LOADOUT_REPEAT_ORDER_FIX_20260903 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-loadout-repeat-order-fix.js';
    script.dataset.fvGrainLoadoutRepeatOrderFix = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — LOAD OUT DRIVER HAULING-JOB RESET
  =================================================================== */

  if (isGrainTicketPage && !window.__FV_GRAIN_LOADOUT_DRIVER_JOB_RESET_LOADER_20260904) {
    window.__FV_GRAIN_LOADOUT_DRIVER_JOB_RESET_LOADER_20260904 = true;

    const script = document.createElement('script');
    script.src = '/js/grain-loadout-driver-job-reset.js';
    script.dataset.fvGrainLoadoutDriverJobReset = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — ADM DECATUR GRADE FACTOR SAFETY

     The current ADM Processing Decatur printer clips the left-side grade
     labels. Use the stable right-side row codes on that exact ticket layout:
       AC=TW, GN=MO, OP=DM, IF=HD, CO=FM, SR=SP.
     FarmVista records TW/MO/DM/FM now and leaves HD/SP available for later.
  =================================================================== */

  if (isGrainTicketScan && !window.__FV_ADM_DECATUR_GRADE_FIX_LOADER_20260904) {
    window.__FV_ADM_DECATUR_GRADE_FIX_LOADER_20260904 = true;

    const script = document.createElement('script');
    script.src = '/js/grain-ticket-adm-decatur-grade-fix.js?v=20260904-1';
    script.dataset.fvAdmDecaturGradeFix = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — IN-APP GRAIN TICKET SOURCE FLOW
  =================================================================== */

  if (isGrainTicketScan && !window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_20260904) {
    window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_20260904 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-ticket-scan-source-flow.js?v=20260904-2';
    script.dataset.fvGrainTicketScanSourceFlow = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — HAULING JOBS SOLD UNDER DISPLAY CLEANUP

     The hauling-jobs table should show only customers from linked contracts.
     Hide the visual Unknown placeholder whenever linked customers exist, and
     show a hyphen when Unknown is the only displayed value. This is display
     only; load-out/customer selection behavior remains unchanged.
  =================================================================== */

  if (
    isGrainContracts &&
    !window.__FV_HAULING_SOLD_UNDER_DISPLAY_20260904
  ) {
    window.__FV_HAULING_SOLD_UNDER_DISPLAY_20260904 = true;

    const script = document.createElement('script');
    script.src = '/js/grain-hauling-jobs-sold-under-display.js?v=20260904-1';
    script.dataset.fvHaulingSoldUnderDisplay = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 5, 2026 — GRAIN INVENTORY TICKET IMAGE ZOOM + PAN

     The Grain Inventory harvest drill-in opens saved tickets inside its own
     image modal. Add photo-viewer controls there only: mouse-wheel zoom and
     click-drag on desktop; pinch zoom and touch-drag on phones/tablets.
  =================================================================== */

  if (
    isGrainInventory &&
    !window.__FV_GRAIN_INVENTORY_TICKET_ZOOM_LOADER_20260905
  ) {
    window.__FV_GRAIN_INVENTORY_TICKET_ZOOM_LOADER_20260905 = true;

    const script = document.createElement('script');
    script.src = '/js/grain-inventory-ticket-zoom.js?v=20260905-1';
    script.dataset.fvGrainInventoryTicketZoom = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 4, 2026 — GRAIN SECTION DARK MODE

     Apply a single dark-theme compatibility layer across every page under
     /pages/grain/. Several older grain pages still contain light-mode surface
     and table colors in page-local CSS. These rules intentionally win only
     while dark theme is active, so light mode is untouched.
  =================================================================== */

  if (!isGrainSection || window.__FV_GRAIN_DARK_FIX_20260904) return;
  window.__FV_GRAIN_DARK_FIX_20260904 = true;

  const style = document.createElement('style');
  style.id = 'fv-grain-section-dark-fix';
  style.textContent = `
    html.dark body,
    html[data-theme="dark"] body {
      color:#eef4ef !important;
    }

    html.dark .card,
    html[data-theme="dark"] .card,
    html.dark .workspace-card,
    html[data-theme="dark"] .workspace-card,
    html.dark .summary-card,
    html[data-theme="dark"] .summary-card,
    html.dark .panel,
    html[data-theme="dark"] .panel,
    html.dark .inventory-card,
    html[data-theme="dark"] .inventory-card,
    html.dark .ticket-card,
    html[data-theme="dark"] .ticket-card,
    html.dark .contract-card,
    html[data-theme="dark"] .contract-card,
    html.dark .detail-box,
    html[data-theme="dark"] .detail-box,
    html.dark .mini-kpi,
    html[data-theme="dark"] .mini-kpi,
    html.dark .loads-pill,
    html[data-theme="dark"] .loads-pill,
    html.dark .modal,
    html[data-theme="dark"] .modal,
    html.dark .modal-card,
    html[data-theme="dark"] .modal-card,
    html.dark .dialog,
    html[data-theme="dark"] .dialog,
    html.dark .sheet,
    html[data-theme="dark"] .sheet {
      background:#111a14 !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .summary-row,
    html[data-theme="dark"] .summary-row {
      color:#eef4ef !important;
    }

    html.dark .section-header,
    html[data-theme="dark"] .section-header,
    html.dark .section-body,
    html[data-theme="dark"] .section-body {
      border-color:#314137 !important;
      color:#eef4ef !important;
    }

    html.dark input,
    html[data-theme="dark"] input,
    html.dark select,
    html[data-theme="dark"] select,
    html.dark textarea,
    html[data-theme="dark"] textarea,
    html.dark .input,
    html[data-theme="dark"] .input,
    html.dark .select,
    html[data-theme="dark"] .select,
    html.dark .filter-field input,
    html[data-theme="dark"] .filter-field input,
    html.dark .filter-field select,
    html[data-theme="dark"] .filter-field select {
      background:#18231b !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark input::placeholder,
    html[data-theme="dark"] input::placeholder,
    html.dark textarea::placeholder,
    html[data-theme="dark"] textarea::placeholder {
      color:#a9b5ad !important;
      opacity:1 !important;
    }

    html.dark .table-wrap,
    html[data-theme="dark"] .table-wrap,
    html.dark table,
    html[data-theme="dark"] table {
      border-color:#314137 !important;
    }

    html.dark .data-table,
    html[data-theme="dark"] .data-table,
    html.dark .inventory-table,
    html[data-theme="dark"] .inventory-table,
    html.dark .harvest-drill-table,
    html[data-theme="dark"] .harvest-drill-table {
      background:#111a14 !important;
      color:#eef4ef !important;
    }

    html.dark .data-table th,
    html[data-theme="dark"] .data-table th,
    html.dark .inventory-table th,
    html[data-theme="dark"] .inventory-table th,
    html.dark .harvest-drill-table th,
    html[data-theme="dark"] .harvest-drill-table th,
    html.dark table thead th,
    html[data-theme="dark"] table thead th {
      background:#1b271e !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .data-table td,
    html[data-theme="dark"] .data-table td,
    html.dark .inventory-table td,
    html[data-theme="dark"] .inventory-table td,
    html.dark .harvest-drill-table td,
    html[data-theme="dark"] .harvest-drill-table td,
    html.dark table tbody td,
    html[data-theme="dark"] table tbody td {
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .data-table tbody tr,
    html[data-theme="dark"] .data-table tbody tr,
    html.dark table tbody tr,
    html[data-theme="dark"] table tbody tr {
      background:#111a14 !important;
    }

    html.dark .data-table tbody tr:hover,
    html[data-theme="dark"] .data-table tbody tr:hover,
    html.dark table tbody tr:hover,
    html[data-theme="dark"] table tbody tr:hover {
      background:#18231b !important;
    }

    html.dark .page-title,
    html[data-theme="dark"] .page-title,
    html.dark .section-title,
    html[data-theme="dark"] .section-title,
    html.dark .inventory-title,
    html[data-theme="dark"] .inventory-title,
    html.dark .modal-title,
    html[data-theme="dark"] .modal-title,
    html.dark .summary-value,
    html[data-theme="dark"] .summary-value,
    html.dark .detail-value,
    html[data-theme="dark"] .detail-value,
    html.dark .mini-kpi-value,
    html[data-theme="dark"] .mini-kpi-value,
    html.dark label,
    html[data-theme="dark"] label {
      color:#eef4ef !important;
    }

    html.dark .page-sub,
    html[data-theme="dark"] .page-sub,
    html.dark .section-sub,
    html[data-theme="dark"] .section-sub,
    html.dark .summary-label,
    html[data-theme="dark"] .summary-label,
    html.dark .detail-label,
    html[data-theme="dark"] .detail-label,
    html.dark .inventory-sub,
    html[data-theme="dark"] .inventory-sub,
    html.dark .inventory-foot,
    html[data-theme="dark"] .inventory-foot,
    html.dark .muted,
    html[data-theme="dark"] .muted,
    html.dark .help-text,
    html[data-theme="dark"] .help-text,
    html.dark .hint,
    html[data-theme="dark"] .hint {
      color:#a9b5ad !important;
      opacity:1 !important;
    }

    html.dark .btn-secondary,
    html[data-theme="dark"] .btn-secondary,
    html.dark .btn:not(.btn-primary):not(.btn-danger):not(.primary):not(.danger),
    html[data-theme="dark"] .btn:not(.btn-primary):not(.btn-danger):not(.primary):not(.danger),
    html.dark .drill-back,
    html[data-theme="dark"] .drill-back,
    html.dark .modal-close,
    html[data-theme="dark"] .modal-close,
    html.dark .show-voided-toggle,
    html[data-theme="dark"] .show-voided-toggle {
      background:#233027 !important;
      color:#eef4ef !important;
      border-color:#3a4a3f !important;
    }

    html.dark .modal-backdrop,
    html[data-theme="dark"] .modal-backdrop {
      background:rgba(0,0,0,.72) !important;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
})();