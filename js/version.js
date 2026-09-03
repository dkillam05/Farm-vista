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
      number:  window.FV_VERSION.number,
      date:    window.FV_VERSION.date,
      tagline: window.FV_VERSION.tagline
    });
  }

  /* ===================================================================
     SEPT 3, 2026 — GRAIN INVENTORY DARK MODE

     Keep this fix UI-only. Do not import Firebase or touch ticket-detail
     state from this global version file.
  =================================================================== */

  if (window.__FV_GRAIN_DARK_FIX_20260903) return;
  window.__FV_GRAIN_DARK_FIX_20260903 = true;

  const path = String(window.location.pathname || '').toLowerCase();
  const isGrainInventory =
    path.endsWith('/pages/grain/index.html') ||
    path === '/pages/grain/' ||
    path === '/pages/grain';

  if (!isGrainInventory) return;

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
