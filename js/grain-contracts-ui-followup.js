import "/js/fv-combo.js";

/* FarmVista — Grain Contracts UI follow-up — Sept. 12, 2026 */
(() => {
  'use strict';
  if (window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260912_V5) return;
  window.__FV_GRAIN_CONTRACTS_UI_FOLLOWUP_20260912_V5 = true;

  const clean = v => String(v ?? '').trim();
  const norm = v => clean(v).toLowerCase();
  const haulingSort = { column:-1, direction:'asc' };
  const popupSort = new WeakMap();

  function findBlock(title) {
    const wanted = norm(title);
    return [...document.querySelectorAll('.workflow-block')].find(block =>
      norm(block.querySelector('.workflow-block-title')?.textContent) === wanted
    ) || null;
  }

  function upgradeSelect(select) {
    if (!select) return;
    select.setAttribute('data-fv-combo', '');
    select.setAttribute('data-fv-search', 'false');
  }

  function upgradeCombos() {
    findBlock('Assign Grain Tickets to Hauling Jobs')?.querySelectorAll('select').forEach(upgradeSelect);
    [
      'hauling-link-buyer','hauling-link-customer','hauling-link-crop',
      'reconcile-buyer','reconcile-customer'
    ].forEach(id => upgradeSelect(document.getElementById(id)));
    window.FVCombo?.upgrade?.(document);
  }

  function installStyles() {
    if (!document.getElementById('fv-simple-hauling-popup-style')) {
      const style = document.createElement('style');
      style.id = 'fv-simple-hauling-popup-style';
      style.textContent = `
        .fv-simple-only-job-group{border:0!important;border-radius:0!important;overflow:visible!important;background:transparent!important}
        .fv-simple-only-job-group>.fv-job-contract-toggle{display:none!important}
        .fv-simple-only-job-group>.fv-job-contract-body{background:transparent!important}
      `;
      document.head.appendChild(style);
    }

    if (!document.getElementById('fv-grain-sort-header-style')) {
      const style = document.createElement('style');
      style.id = 'fv-grain-sort-header-style';
      style.textContent = `
        .data-table th.sortable,.fv-job-contract-table th.sortable{cursor:pointer;user-select:none}
        .data-table th.sortable::after,.data-table th.sortable.sort-asc::after,.data-table th.sortable.sort-desc::after,
        .fv-job-contract-table th.sortable::after,.fv-job-contract-table th.sortable.sort-asc::after,.fv-job-contract-table th.sortable.sort-desc::after{
          content:""!important;display:inline-block!important;width:15px;height:14px;margin-left:6px;vertical-align:-2px;
          background:currentColor;opacity:.38;
          -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
          mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat
        }
        .data-table th.sortable.sort-asc,.data-table th.sortable.sort-desc,
        .fv-job-contract-table th.sortable.sort-asc,.fv-job-contract-table th.sortable.sort-desc{
          text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px
        }
        .data-table th.sortable.sort-asc::after,.data-table th.sortable.sort-desc::after,
        .fv-job-contract-table th.sortable.sort-asc::after,.fv-job-contract-table th.sortable.sort-desc::after{opacity:.78}
      `;
      document.head.appendChild(style);
    }
  }

  function numberValue(v) {
    const n = Number(clean(v).replace(/,/g,'').replace(/[^\d.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }

  function dateValue(v) {
    const ts = Date.parse(clean(v).split(/[–—]/)[0]?.trim());
    return Number.isFinite(ts) ? ts : 0;
  }

  function statusValue(v) {
    return ({'past due':1,active:2,upcoming:3,completed:4,closed:5,voided:6})[norm(v)] ?? 99;
  }

  function compare(a,b,type) {
    if (type === 'number') return numberValue(a)-numberValue(b);
    if (type === 'date') return dateValue(a)-dateValue(b);
    if (type === 'status') return statusValue(a)-statusValue(b);
    return clean(a).localeCompare(clean(b),undefined,{numeric:true,sensitivity:'base'});
  }

  function setHeaderState(headers,state) {
    headers.forEach((header,index) => {
      header.classList.remove('sort-asc','sort-desc');
      header.removeAttribute('aria-sort');
      if (index !== state.column) return;
      header.classList.add(state.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      header.setAttribute('aria-sort',state.direction === 'asc' ? 'ascending' : 'descending');
    });
  }

  function sortRows(table,state) {
    const headers = [...table.querySelectorAll('thead th')];
    const tbody = table.querySelector('tbody');
    if (!tbody || state.column < 0 || state.column >= headers.length) return;
    const rows = [...tbody.querySelectorAll(':scope > tr')].filter(row => row.cells.length === headers.length);
    const type = headers[state.column]?.dataset.sortType || 'text';
    rows.sort((a,b) => {
      const result = compare(a.cells[state.column]?.textContent,b.cells[state.column]?.textContent,type);
      return state.direction === 'asc' ? result : -result;
    });
    rows.forEach(row => tbody.appendChild(row));
  }

  function decorateHaulingTable() {
    const tbody = document.getElementById('hauling-jobs-table-body');
    const table = tbody?.closest('table');
    const thead = table?.querySelector('thead');
    const headers = [...(thead?.querySelectorAll('th') || [])];
    if (!thead || headers.length !== 11) return;

    const types = ['status','natural','text','text','text','text','number','number','number','number','date'];
    headers.forEach((header,index) => {
      header.classList.add('sortable');
      header.dataset.sortType = types[index] || 'text';
      header.title = 'Sort by this column';
    });
    setHeaderState(headers,haulingSort);
    if (haulingSort.column >= 0) sortRows(table,haulingSort);

    if (thead.dataset.fvHaulingSortReady === '1') return;
    thead.dataset.fvHaulingSortReady = '1';
    thead.addEventListener('click',event => {
      const header = event.target.closest('th.sortable');
      if (!header || !thead.contains(header)) return;
      const current = [...thead.querySelectorAll('th')];
      const column = current.indexOf(header);
      if (column < 0) return;
      if (haulingSort.column === column) haulingSort.direction = haulingSort.direction === 'asc' ? 'desc' : 'asc';
      else { haulingSort.column = column; haulingSort.direction = 'asc'; }
      setHeaderState(current,haulingSort);
      sortRows(table,haulingSort);
    });
  }

  function popupType(header) {
    const label = norm(header.textContent);
    if (label === 'date') return 'date';
    if (label.includes('bu.') || ['mo','fm','damage'].includes(label)) return 'number';
    if (label.includes('ticket')) return 'natural';
    return 'text';
  }

  function decoratePopupTables() {
    document.querySelectorAll('.fv-job-contract-table').forEach(table => {
      const thead = table.querySelector('thead');
      const headers = [...(thead?.querySelectorAll('th') || [])];
      if (!thead || !headers.length) return;

      headers.forEach(header => {
        header.classList.add('sortable');
        header.dataset.sortType = popupType(header);
        header.title = 'Sort by this column';
      });

      if (!popupSort.has(table)) popupSort.set(table,{column:-1,direction:'asc'});
      const state = popupSort.get(table);
      setHeaderState(headers,state);

      if (thead.dataset.fvPopupSortReady === '1') return;
      thead.dataset.fvPopupSortReady = '1';
      thead.addEventListener('click',event => {
        const header = event.target.closest('th.sortable');
        if (!header || !thead.contains(header)) return;
        const current = [...thead.querySelectorAll('th')];
        const column = current.indexOf(header);
        if (column < 0) return;
        const s = popupSort.get(table);
        if (s.column === column) s.direction = s.direction === 'asc' ? 'desc' : 'asc';
        else { s.column = column; s.direction = 'asc'; }
        setHeaderState(current,s);
        sortRows(table,s);
      });
    });
  }

  function normalizeSimplePopup() {
    const modal = document.getElementById('fv-contract-hauling-overview');
    if (!modal?.classList.contains('open')) return;
    const list = modal.querySelector('#fv-contract-job-ticket-list');
    if (!list) return;
    const titles = [...list.querySelectorAll('.fv-job-contract-title')];
    const spot = titles.find(node => /uncontracted\s*\/\s*spot\s*tickets/i.test(clean(node.textContent)));
    if (!spot || titles.some(node => /^contract\b/i.test(clean(node.textContent)))) return;
    spot.closest('.fv-job-contract-group')?.classList.add('fv-simple-only-job-group');
    const heading = modal.querySelector('#fv-contract-job-ticket-heading,.fv-contract-job-ticket-heading');
    if (heading) heading.textContent = 'Assigned Tickets';
  }

  function run() {
    upgradeCombos();
    decorateHaulingTable();
    decoratePopupTables();
    normalizeSimplePopup();
  }

  function start() {
    installStyles();
    run();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; run(); });
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','disabled']});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();