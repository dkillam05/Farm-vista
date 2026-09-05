// FarmVista — Hauling Jobs Sold Under display cleanup
// Sept. 4, 2026
//
// Display-only cleanup for the Hauling Jobs table:
//   • If linked contract customers exist, hide the "Unknown" placeholder.
//   • If "Unknown" is the only value, display a simple hyphen.
//
// Also applies the page-specific dark-theme overrides for the Grain Contracts
// hauling workspace. Several headers/messages in this page use local
// --surface / --surface-2 fallbacks that can stay light while dark text rules
// are active, producing unreadable near-white text on white cards.
//
// This intentionally does not change the underlying hauling-job / contract
// data or the Unknown option used by load-out workflows.

(() => {
  'use strict';

  const TABLE_BODY_ID = 'hauling-jobs-table-body';

  function installContractsDarkThemeFix() {
    if (document.getElementById('fv-grain-contracts-dark-theme-fix')) return;

    const style = document.createElement('style');
    style.id = 'fv-grain-contracts-dark-theme-fix';
    style.textContent = `
      html.dark .compact-summary,
      html[data-theme="dark"] .compact-summary,
      html.dark .hauling-dnd-message,
      html[data-theme="dark"] .hauling-dnd-message,
      html.dark .dnd-toolbar,
      html[data-theme="dark"] .dnd-toolbar,
      html.dark .reconcile-filter-message,
      html[data-theme="dark"] .reconcile-filter-message,
      html.dark .contract-stat,
      html[data-theme="dark"] .contract-stat,
      html.dark .contract-average-block,
      html[data-theme="dark"] .contract-average-block,
      html.dark .modal-summary-item,
      html[data-theme="dark"] .modal-summary-item,
      html.dark .ticket-detail-item,
      html[data-theme="dark"] .ticket-detail-item,
      html.dark .edit-pricing-box,
      html[data-theme="dark"] .edit-pricing-box,
      html.dark .assigned-ticket-item,
      html[data-theme="dark"] .assigned-ticket-item {
        background:#18231b !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
      }

      html.dark .dnd-column,
      html[data-theme="dark"] .dnd-column,
      html.dark .hauling-dnd-column,
      html[data-theme="dark"] .hauling-dnd-column,
      html.dark .workflow-group,
      html[data-theme="dark"] .workflow-group {
        background:#111a14 !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
      }

      html.dark .dnd-column-head,
      html[data-theme="dark"] .dnd-column-head,
      html.dark .hauling-dnd-column-head,
      html[data-theme="dark"] .hauling-dnd-column-head {
        background:#1b271e !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
      }

      html.dark .dnd-column-title,
      html[data-theme="dark"] .dnd-column-title,
      html.dark .dnd-column-count,
      html[data-theme="dark"] .dnd-column-count,
      html.dark .hauling-dnd-column-title,
      html[data-theme="dark"] .hauling-dnd-column-title,
      html.dark .hauling-dnd-column-count,
      html[data-theme="dark"] .hauling-dnd-column-count,
      html.dark .compact-summary-label,
      html[data-theme="dark"] .compact-summary-label,
      html.dark .compact-summary-value,
      html[data-theme="dark"] .compact-summary-value {
        color:#eef4ef !important;
      }

      html.dark .hauling-contract-card,
      html[data-theme="dark"] .hauling-contract-card,
      html.dark .hauling-job-drop-card,
      html[data-theme="dark"] .hauling-job-drop-card,
      html.dark .contract-drop-card,
      html[data-theme="dark"] .contract-drop-card,
      html.dark .ticket-card,
      html[data-theme="dark"] .ticket-card {
        background:#111a14 !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
      }

      html.dark .hauling-dnd-message.ready,
      html[data-theme="dark"] .hauling-dnd-message.ready,
      html.dark .reconcile-filter-message.ready,
      html[data-theme="dark"] .reconcile-filter-message.ready {
        background:#182c1d !important;
        color:#dff0e3 !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function cleanSoldUnderCell(cell) {
    if (!cell) return;

    const parts = String(cell.textContent || '')
      .split(/\s*\/\s*/)
      .map(value => value.trim())
      .filter(Boolean);

    const linkedCustomers = parts.filter(
      value => value.toLowerCase() !== 'unknown'
    );

    const nextText = linkedCustomers.length
      ? linkedCustomers.join(' / ')
      : '-';

    if (String(cell.textContent || '').trim() !== nextText) {
      cell.textContent = nextText;
    }
  }

  function cleanTable() {
    const body = document.getElementById(TABLE_BODY_ID);
    if (!body) return;

    body.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll(':scope > td');

      // Empty-state rows have one colspan cell. Normal hauling-job rows
      // have Sold Under in the fifth column.
      if (cells.length < 5) return;

      cleanSoldUnderCell(cells[4]);
    });
  }

  let tableObserver = null;

  function attachToTable() {
    const body = document.getElementById(TABLE_BODY_ID);
    if (!body) return false;

    cleanTable();

    if (tableObserver) {
      tableObserver.disconnect();
    }

    tableObserver = new MutationObserver(cleanTable);
    tableObserver.observe(body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return true;
  }

  installContractsDarkThemeFix();

  if (!attachToTable()) {
    const pageObserver = new MutationObserver(() => {
      if (attachToTable()) {
        pageObserver.disconnect();
      }
    });

    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
