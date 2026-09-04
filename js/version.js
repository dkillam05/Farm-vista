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

  /* ===================================================================
     SEPT 3, 2026 — GRAIN TICKET FIELD SOURCE UI

     Keep the ticket-detail behavior in its own module. The module:
       - always displays the saved field name on field-assigned tickets;
       - keeps Active Field Harvest as the generic choice;
       - replaces hundreds of field rows in the main source dropdown with
         a single Fields choice;
       - opens a searchable field popup when Fields is chosen.
  =================================================================== */

  const isGrainTicketDetail =
    path.endsWith('/pages/grain/grain-ticket-detail.html');

  if (isGrainTicketDetail && !window.__FV_GRAIN_TICKET_SOURCE_UI_20260903) {
    window.__FV_GRAIN_TICKET_SOURCE_UI_20260903 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-ticket-detail-source-ui.js';
    script.dataset.fvGrainTicketSourceUi = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 3, 2026 — LOAD OUT REPEAT-RUN DEFAULTS

     On a new Load Out, once a driver (and subcontractor driver when
     applicable) is selected, reuse that driver's most recent operational
     setup when it is still valid:
       - Hauling Job
       - Sold Under / Customer
       - Grain Source

     This intentionally works across calendar days. Load number, load time,
     preload date, and ETA remain new/current for every load.
  =================================================================== */

  const isGrainTicketPage =
    path.endsWith('/pages/grain/grain-ticket.html');

  if (isGrainTicketPage && !window.__FV_GRAIN_LOADOUT_REPEAT_DEFAULTS_20260903) {
    window.__FV_GRAIN_LOADOUT_REPEAT_DEFAULTS_20260903 = true;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/js/grain-loadout-repeat-defaults.js';
    script.dataset.fvGrainLoadoutRepeatDefaults = '1';
    document.head.appendChild(script);
  }

  /* ===================================================================
     SEPT 3, 2026 — GRAIN INVENTORY DARK MODE
  =================================================================== */

  const isGrainInventory =
    path.endsWith('/pages/grain/index.html') ||
    path === '/pages/grain/' ||
    path === '/pages/grain';

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
