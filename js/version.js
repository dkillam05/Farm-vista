/* =====================================================================
   FarmVista — version.js
   Single Source of Truth (SSOT) for version + tagline
   HARD-SAFE to load multiple times (no redeclaration errors)
===================================================================== */

(function () {
  'use strict';

  // Keep version setup hard-safe if this file is ever loaded twice.
  if (!window.FV_VERSION || !window.FV_VERSION.number) {
    // ---- EDIT THESE FOR RELEASES ONLY ----
    window.FV_VERSION = {
      number:  "08.18.01",
      date:    "2026-08-18",
      tagline: "Farm Data - Simplified"
    };
    // -------------------------------------

    // Legacy shims (keep these stable)
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
     SEPT 3, 2026 — GRAIN UI HOTFIXES

     1. Grain ticket detail:
        Field-assigned Active Harvest tickets already retain their
        grainSourceFieldId / grainSourceFieldName.  The detail page was
        displaying the generic grainSourceName ("Active Field Harvest")
        instead of the specific field.  Resolve the ticket and keep the
        picker label on the saved field name.

     2. Grain inventory dark mode:
        The Active Harvest drill-down used light fallback surfaces inside
        a dark page, leaving near-white text on white cards/table headers.
        Apply explicit dark-theme surfaces only to this grain inventory UI.
  =================================================================== */

  if (window.__FV_GRAIN_UI_HOTFIX_20260903) return;
  window.__FV_GRAIN_UI_HOTFIX_20260903 = true;

  const path = String(window.location.pathname || '').toLowerCase();

  function installGrainInventoryDarkModeFix() {
    if (!path.endsWith('/pages/grain/index.html') &&
        path !== '/pages/grain/' &&
        path !== '/pages/grain') {
      return;
    }

    const style = document.createElement('style');
    style.id = 'fv-grain-inventory-dark-hotfix';
    style.textContent = `
      html[data-theme="dark"] .inventory-card,
      html[data-theme="dark"] .modal {
        background: var(--surface, #111a14) !important;
        color: var(--text, #eef4ef) !important;
      }

      html[data-theme="dark"] .detail-box,
      html[data-theme="dark"] .mini-kpi,
      html[data-theme="dark"] .loads-pill {
        background: #18231b !important;
        color: #eef4ef !important;
        border-color: var(--border, #314137) !important;
      }

      html[data-theme="dark"] .inventory-table th,
      html[data-theme="dark"] .harvest-drill-table th {
        background: #1b271e !important;
        color: #eef4ef !important;
        border-color: var(--border, #314137) !important;
      }

      html[data-theme="dark"] .inventory-table td,
      html[data-theme="dark"] .harvest-drill-table td {
        color: var(--text, #eef4ef) !important;
        border-color: var(--border, #314137) !important;
      }

      html[data-theme="dark"] .detail-label,
      html[data-theme="dark"] .inventory-sub,
      html[data-theme="dark"] .inventory-foot,
      html[data-theme="dark"] .muted {
        color: var(--muted, #a9b5ad) !important;
        opacity: 1 !important;
      }

      html[data-theme="dark"] .detail-value,
      html[data-theme="dark"] .inventory-title,
      html[data-theme="dark"] .modal-title,
      html[data-theme="dark"] .mini-kpi-value {
        color: var(--text, #eef4ef) !important;
      }

      html[data-theme="dark"] .drill-back,
      html[data-theme="dark"] .modal-close,
      html[data-theme="dark"] .btn:not(.primary) {
        background: #233027 !important;
        color: #eef4ef !important;
        border-color: var(--border, #3a4a3f) !important;
      }

      html[data-theme="dark"] .table-wrap {
        border-color: var(--border, #314137) !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  async function installFieldSourceDisplayFix() {
    if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const ticketId = String(params.get('id') || '').trim();
    if (!ticketId) return;

    let fieldName = '';

    try {
      const firebase = await import('/js/firebase-init.js');
      await firebase.ready;

      const db = firebase.getFirestore();
      const snap = await firebase.getDoc(
        firebase.doc(db, 'grain_tickets', ticketId)
      );

      if (!snap.exists()) return;

      const ticket = snap.data() || {};
      const scope = String(ticket.grainSourceScope || '').trim().toLowerCase();
      const type = String(ticket.grainSourceType || '').trim().toLowerCase();

      fieldName = String(
        ticket.grainSourceFieldName ||
        ((scope === 'field') ? ticket.grainSourceSiteName : '') ||
        ''
      ).trim();

      const isFieldHarvest = Boolean(fieldName) && (
        scope === 'field' ||
        type === 'active_field_harvest' ||
        type === 'active field harvest'
      );

      if (!isFieldHarvest) return;
    }
    catch (error) {
      console.warn('[FarmVista] Field source display hotfix could not read ticket:', error);
      return;
    }

    const applyFieldName = () => {
      const label = document.getElementById('grainSourceButtonText');
      if (!label || !fieldName) return;

      const current = String(label.textContent || '').trim().toLowerCase();

      // Preserve prompts while the page is still initializing.  Once the
      // saved source is rendered as the generic Active Harvest label,
      // replace it with the actual field saved on the ticket.
      if (current === 'active field harvest' || current === fieldName.toLowerCase()) {
        label.textContent = fieldName;
      }
    };

    // The detail page loads its Firestore data asynchronously and can
    // repaint the custom picker after version.js executes, so observe the
    // page and re-apply the field label whenever that picker changes.
    const observer = new MutationObserver(applyFieldName);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    applyFieldName();

    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  installGrainInventoryDarkModeFix();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installFieldSourceDisplayFix();
    }, { once: true });
  }
  else {
    installFieldSourceDisplayFix();
  }
})();
