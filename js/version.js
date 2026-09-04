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
     SEPT 4, 2026 — IN-APP GRAIN TICKET SOURCE FLOW
  =================================================================== */

  if (isGrainTicketScan && !window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_20260904) {
    window.__FV_GRAIN_TICKET_SCAN_SOURCE_FLOW_20260904 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-ticket-scan-source-flow.js';
    script.dataset.fvGrainTicketScanSourceFlow = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 3, 2026 — GRAIN INVENTORY DARK MODE
  =================================================================== */

  if (!isGrainInventory || window.__FV_GRAIN_DARK_FIX_20260903) return;
  window.__FV_GRAIN_DARK_FIX_20260903 = true;

  const style = document.createElement('style');
  style.id = 'fv-grain-inventory-dark-fix';
  style.textContent = `
    html.dark .detail-box,
    html[data-theme="dark"] .detail-box,
    html.dark .mini-kpi,
    html[data-theme="dark"] .mini-kpi,
    html.dark .loads-pill,
    html[data-theme="dark"] .loads-pill {
      background:#18231b !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .inventory-table th,
    html[data-theme="dark"] .inventory-table th,
    html.dark .harvest-drill-table th,
    html[data-theme="dark"] .harvest-drill-table th {
      background:#1b271e !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .inventory-table td,
    html[data-theme="dark"] .inventory-table td,
    html.dark .harvest-drill-table td,
    html[data-theme="dark"] .harvest-drill-table td {
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .modal,
    html[data-theme="dark"] .modal,
    html.dark .inventory-card,
    html[data-theme="dark"] .inventory-card {
      background:#111a14 !important;
      color:#eef4ef !important;
      border-color:#314137 !important;
    }

    html.dark .detail-label,
    html[data-theme="dark"] .detail-label,
    html.dark .inventory-sub,
    html[data-theme="dark"] .inventory-sub,
    html.dark .inventory-foot,
    html[data-theme="dark"] .inventory-foot,
    html.dark .muted,
    html[data-theme="dark"] .muted {
      color:#a9b5ad !important;
      opacity:1 !important;
    }

    html.dark .detail-value,
    html[data-theme="dark"] .detail-value,
    html.dark .inventory-title,
    html[data-theme="dark"] .inventory-title,
    html.dark .modal-title,
    html[data-theme="dark"] .modal-title,
    html.dark .mini-kpi-value,
    html[data-theme="dark"] .mini-kpi-value {
      color:#eef4ef !important;
    }

    html.dark .drill-back,
    html[data-theme="dark"] .drill-back,
    html.dark .modal-close,
    html[data-theme="dark"] .modal-close,
    html.dark .btn:not(.primary),
    html[data-theme="dark"] .btn:not(.primary) {
      background:#233027 !important;
      color:#eef4ef !important;
      border-color:#3a4a3f !important;
    }

    html.dark .table-wrap,
    html[data-theme="dark"] .table-wrap {
      border-color:#314137 !important;
    }

    html.dark .modal-backdrop,
    html[data-theme="dark"] .modal-backdrop {
      background:rgba(0,0,0,.72) !important;
    }
  `;

  (document.head || document.documentElement).appendChild(style);
})();