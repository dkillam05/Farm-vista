import "/js/fv-combo.js";

/* FarmVista — Grain Contracts UI follow-up
   Sept. 12, 2026

   - Keep the Grain Tickets -> Hauling Jobs filters on FarmVista custom combos.
   - Restore the contract-assignment filters to the same custom combo behavior.
   - In simple hauling mode, hide the misleading Uncontracted / Spot Tickets
     heading when there are no actual linked-contract groups.
   - Use the compact three-line sort icon on sortable table headers.
   - Underline the active sort column instead of swapping to arrow icons.
   - Add the same sortable-header behavior to the Hauling Jobs table.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260912_V4) return;
  window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260912_V4 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();

  const haulingSort = {
    column: -1,
    direction: 'asc'
  };

  function findWorkflowBlock(title) {
    const wanted = norm(title);
    return Array.from(document.querySelectorAll('.workflow-block')).find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === wanted
    ) || null;
  }

  function upgradeSelect(select) {
    if (!select) return;
    select.setAttribute('data-fv-combo', '');
    select.setAttribute('data-fv-search', 'false');
  }

  function upgradeAssignmentFilters() {
    // SIMPLE MODE: Assign Grain Tickets to Hauling Jobs.
    const haulingTicketBlock = findWorkflowBlock('Assign Grain Tickets to Hauling Jobs');
    haulingTicketBlock?.querySelectorAll('select').forEach(upgradeSelect);

    // DETAILED MODE: Assign Contracts to Hauling Jobs.
    [
      document.getElementById('hauling-link-buyer'),
      document.getElementById('hauling-link-customer'),
      document.getElementById('hauling-link-crop')
    ].forEach(upgradeSelect);

    // DETAILED MODE: Assign Grain Tickets to Contracts.
    [
      document.getElementById('reconcile-buyer'),
      document.getElementById('reconcile-customer')
    ].forEach(upgradeSelect);

    // Upgrade only after all attributes are in place. FVCombo preserves the
    // native selects/change events, so the existing filtering logic continues
    // to work while the visible control uses the rounded FarmVista dropdown.
    window.FVCombo?.upgrade?.(document);
  }

  function installSimplePopupStyles() {
    if (document.getElementById('fv-simple-hauling-popup-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-simple-hauling-popup-style';
    style.textContent = `
      .fv-simple-only-job-group{
        border:0 !important;
        border-radius:0 !important;
        overflow:visible !important;
        background:transparent !important;
      }
      .fv-simple-only-job-group > .fv-job-contract-toggle{
        display:none !important;
      }
      .fv-simple-only-job-group > .fv-job-contract-body{
        background:transparent !important;
      }
    `;
    document.head.appendChild(style);
  }

  function installSortHeaderStyles() {
    if (document.getElementById('fv-grain-sort-header-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-grain-sort-header-style';
    style.textContent = `
      .data-table th.sortable{
        cursor:pointer;
        user-select:none;
      }

      .data-table th.sortable::after,
      .data-table th.sortable.sort-asc::after,
      .data-table th.sortable.sort-desc::after{
        content:"" !important;
        display:inline-block !important;
        width:15px;
        height:14px;
        margin-left:6px;
        vertical-align:-2px;
        background:currentColor;
        opacity:.38;
        -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
        mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
      }

      .data-table th.sortable.sort-asc,
      .data-table th.sortable.sort-desc{
        text-decoration:underline;
        text-decoration-thickness:2px;
        text-underline-offset:4px;
      }

      .data-table th.sortable.sort-asc::after,
      .data-table th.sortable.sort-desc::after{
        opacity:.78;
      }
    `;
    document.head.appendChild(style);
  }

  function numberValue(value) {
    const number = Number(
      clean(value)
        .replace(/,/g, '')
        .replace(/[^\d.-]/g, '')
    );
    return Number.isFinite(number) ? number : 0;
  }

  function dateValue(value) {
    const firstDate = clean(value).split(/[–—]/)[0]?.trim();
    const timestamp = Date.parse(firstDate);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function haulingStatusValue(value) {
    const order = {
      'past due': 1,
      active: 2,
      upcoming: 3,
      completed: 4,
      closed: 5,
      voided: 6
    };
    return order[norm(value)] ?? 99;
  }

  function compareValues(a, b, type) {
    if (type === 'number') return numberValue(a) - numberValue(b);
    if (type === 'date') return dateValue(a) - dateValue(b);
    if (type === 'status') return haulingStatusValue(a) - haulingStatusValue(b);

    return clean(a).localeCompare(clean(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function syncSortHeaderState(headers) {
    headers.forEach((header, index) => {
      header.classList.remove('sort-asc', 'sort-desc');
      header.removeAttribute('aria-sort');

      if (index !== haulingSort.column) return;

      header.classList.add(
        haulingSort.direction === 'asc' ? 'sort-asc' : 'sort-desc'
      );
      header.setAttribute(
        'aria-sort',
        haulingSort.direction === 'asc' ? 'ascending' : 'descending'
      );
    });
  }

  function applyHaulingSort() {
    if (haulingSort.column < 0) return;

    const tbody = document.getElementById('hauling-jobs-table-body');
    const table = tbody?.closest('table');
    const headers = Array.from(table?.querySelectorAll('thead th') || []);
    if (!tbody || !headers.length || haulingSort.column >= headers.length) return;

    const rows = Array.from(tbody.querySelectorAll('tr')).filter(
      row => row.cells.length === headers.length
    );
    if (rows.length < 2) return;

    const type = headers[haulingSort.column]?.dataset.sortType || 'text';
    const sorted = [...rows].sort((rowA, rowB) => {
      const valueA = rowA.cells[haulingSort.column]?.textContent || '';
      const valueB = rowB.cells[haulingSort.column]?.textContent || '';
      const result = compareValues(valueA, valueB, type);
      return haulingSort.direction === 'asc' ? result : -result;
    });

    const alreadySorted = sorted.every((row, index) => row === rows[index]);
    if (alreadySorted) return;

    sorted.forEach(row => tbody.appendChild(row));
  }

  function decorateHaulingTableSort() {
    const tbody = document.getElementById('hauling-jobs-table-body');
    const table = tbody?.closest('table');
    const thead = table?.querySelector('thead');
    const headers = Array.from(thead?.querySelectorAll('th') || []);
    if (!thead || headers.length !== 11) return;

    const sortTypes = [
      'status',
      'natural',
      'text',
      'text',
      'text',
      'text',
      'number',
      'number',
      'number',
      'number',
      'date'
    ];

    headers.forEach((header, index) => {
      header.classList.add('sortable');
      header.dataset.sortType = sortTypes[index] || 'text';
      header.title = 'Sort by this column';
    });

    syncSortHeaderState(headers);

    if (thead.dataset.fvHaulingSortReady === '1') {
      applyHaulingSort();
      return;
    }

    thead.dataset.fvHaulingSortReady = '1';
    thead.addEventListener('click', event => {
      const header = event.target.closest('th.sortable');
      if (!header || !thead.contains(header)) return;

      const currentHeaders = Array.from(thead.querySelectorAll('th'));
      const column = currentHeaders.indexOf(header);
      if (column < 0) return;

      if (haulingSort.column === column) {
        haulingSort.direction = haulingSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        haulingSort.column = column;
        haulingSort.direction = 'asc';
      }

      syncSortHeaderState(currentHeaders);
      applyHaulingSort();
    });
  }

  function normalizeSimpleHaulingPopup() {
    const modal = document.getElementById('fv-contract-hauling-overview');
    if (!modal?.classList.contains('open')) return;

    const list = modal.querySelector('#fv-contract-job-ticket-list');
    if (!list) return;

    const titles = Array.from(list.querySelectorAll('.fv-job-contract-title'));
    const spotTitle = titles.find(node => /uncontracted\s*\/\s*spot\s*tickets/i.test(clean(node.textContent)));
    if (!spotTitle) return;

    const hasActualContractGroup = titles.some(node => /^contract\b/i.test(clean(node.textContent)));
    if (hasActualContractGroup) return;

    const group = spotTitle.closest('.fv-job-contract-group');
    if (!group) return;

    group.classList.add('fv-simple-only-job-group');

    const heading = modal.querySelector('#fv-contract-job-ticket-heading, .fv-contract-job-ticket-heading');
    if (heading && !/^assigned tickets/i.test(clean(heading.textContent))) {
      heading.textContent = 'Assigned Tickets';
    }
  }

  function runFixes() {
    upgradeAssignmentFilters();
    decorateHaulingTableSort();
    normalizeSimpleHaulingPopup();
  }

  function start() {
    installSimplePopupStyles();
    installSortHeaderStyles();
    runFixes();

    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        runFixes();
      });
    }).observe(document.body, {
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class', 'disabled']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
