// FarmVista — Hauling Jobs Sold Under display cleanup
// Sept. 4, 2026
//
// Display-only cleanup for the Hauling Jobs table:
//   • If linked contract customers exist, hide the "Unknown" placeholder.
//   • If "Unknown" is the only value, display a simple hyphen.
//
// This intentionally does not change the underlying hauling-job / contract
// data or the Unknown option used by load-out workflows.

(() => {
  'use strict';

  const TABLE_BODY_ID = 'hauling-jobs-table-body';

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
