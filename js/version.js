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

  const path = String(window.location.pathname || '').toLowerCase();

  /* ===================================================================
     SEPT 3, 2026 — GRAIN TICKET FIELD DISPLAY

     Field-assigned Active Harvest tickets save both the generic source
     name ("Active Field Harvest") and the specific field name. The grain
     inventory correctly groups by the specific field, but the detail
     picker can still render the generic source label. Read the saved
     ticket once after the page has finished loading, then replace only the
     visible picker label. No MutationObserver and no changes to page state.
  =================================================================== */

  const isGrainTicketDetail =
    path.endsWith('/pages/grain/grain-ticket-detail.html');

  if (isGrainTicketDetail && !window.__FV_GRAIN_FIELD_LABEL_FIX_20260903) {
    window.__FV_GRAIN_FIELD_LABEL_FIX_20260903 = true;

    const applySavedFieldLabel = async () => {
      const ticketId = String(
        new URLSearchParams(window.location.search).get('id') || ''
      ).trim();

      if (!ticketId) return;

      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;

        const db = firebase.getFirestore();
        const snap = await firebase.getDoc(
          firebase.doc(db, 'grain_tickets', ticketId)
        );

        if (!snap.exists()) return;

        const ticket = snap.data() || {};
        const fieldName = String(
          ticket.grainSourceFieldName ||
          ticket.fieldName ||
          ''
        ).trim();

        if (!fieldName) return;

        const scope = String(ticket.grainSourceScope || '').trim().toLowerCase();
        const type = String(ticket.grainSourceType || '').trim().toLowerCase();
        const genericName = String(ticket.grainSourceName || '').trim().toLowerCase();

        const isFieldTicket =
          scope === 'field' ||
          type === 'active_field_harvest' ||
          type === 'active field harvest' ||
          genericName === 'active field harvest';

        if (!isFieldTicket) return;

        let attempts = 0;
        const timer = window.setInterval(() => {
          attempts += 1;

          const label = document.getElementById('grainSourceButtonText');
          if (label) {
            const current = String(label.textContent || '').trim().toLowerCase();

            if (
              current === 'active field harvest' ||
              current === fieldName.toLowerCase()
            ) {
              label.textContent = fieldName;
              window.clearInterval(timer);
              return;
            }
          }

          if (attempts >= 40) {
            window.clearInterval(timer);
          }
        }, 250);
      }
      catch (error) {
        console.warn('[FarmVista] Could not apply saved grain field label:', error);
      }
    };

    if (document.readyState === 'complete') {
      applySavedFieldLabel();
    }
    else {
      window.addEventListener('load', applySavedFieldLabel, { once:true });
    }
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
