/* FarmVista — Grain Index table sorting + alert-linked grade colors
   Sept. 12, 2026

   - Adds the same compact three-line sort icon used on Grain Contracts.
   - Underlines the active sort header instead of swapping arrow icons.
   - Applies to Grain Index main tables, Active Hauling Jobs, and Active Harvest drill-down tables.
   - Matches Grain Contracts remaining-bushel color cues and hover percentage helper text.
   - Reads settings/grainTicketAlerts so MO/FM/Damage colors follow the
     company's saved Corn/Soybean alert thresholds instead of hard-coded values.
   - V4 preserves the V3 MutationObserver guard while adding remaining-bushel cues.
*/
(() => {
  'use strict';

  if (window.__FV_GRAIN_INDEX_TABLE_UI_20260912_V4) return;
  window.__FV_GRAIN_INDEX_TABLE_UI_20260912_V4 = true;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();

  const sortState = new Map();
  let alertSettings = null;
  let firebaseApi = null;
  let refreshTimer = null;
  let mutationQueued = false;
  let applyingUi = false;

  function cropKey(value) {
    const key = norm(value).replace(/[^a-z]/g, '');
    if (['corn', 'yellowcorn', 'maize'].includes(key)) return 'corn';
    if (['soy', 'soybean', 'soybeans', 'bean', 'beans', 'yellowsoybeans'].includes(key)) return 'soybeans';
    return key;
  }

  function installStyles() {
    if (document.getElementById('fv-grain-index-table-ui-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-grain-index-table-ui-style';
    style.textContent = `
      .inventory-table th.fv-sortable,
      .harvest-drill-table th.fv-sortable,
      .fv-ahj-table th.fv-sortable{
        cursor:pointer;
        user-select:none;
      }

      .inventory-table th.fv-sortable::after,
      .harvest-drill-table th.fv-sortable::after,
      .fv-ahj-table th.fv-sortable::after{
        content:"";
        display:inline-block;
        width:15px;
        height:14px;
        margin-left:6px;
        vertical-align:-2px;
        background:currentColor;
        opacity:.38;
        -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
        mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 14'%3E%3Cpath d='M1.5 2.5h13M1.5 7h9M1.5 11.5h5' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
      }

      .inventory-table th.fv-sortable.fv-sort-active,
      .harvest-drill-table th.fv-sortable.fv-sort-active,
      .fv-ahj-table th.fv-sortable.fv-sort-active{
        text-decoration:underline;
        text-decoration-thickness:2px;
        text-underline-offset:4px;
      }

      .inventory-table th.fv-sortable.fv-sort-active::after,
      .harvest-drill-table th.fv-sortable.fv-sort-active::after,
      .fv-ahj-table th.fv-sortable.fv-sort-active::after{
        opacity:.8;
      }

      .fv-grade-alert{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:48px;
        min-height:26px;
        padding:4px 7px;
        border-radius:999px;
        font-weight:850;
        line-height:1;
        white-space:nowrap;
      }

      .fv-grade-alert.warn{
        background:rgba(230,126,34,.13);
        box-shadow:inset 0 0 0 1px rgba(230,126,34,.45);
        color:#a65300;
      }

      .fv-grade-alert.severe{
        background:rgba(179,38,30,.12);
        box-shadow:inset 0 0 0 1px rgba(179,38,30,.38);
        color:#9d241e;
      }

      .inventory-table td.fv-grain-remaining-green,
      .fv-ahj-table td.fv-grain-remaining-green{
        background:rgba(59,126,70,.15)!important;
        color:#2d6937!important;
        font-weight:900!important;
      }

      .inventory-table td.fv-grain-remaining-orange,
      .fv-ahj-table td.fv-grain-remaining-orange{
        background:rgba(230,126,34,.17)!important;
        color:#a65300!important;
        font-weight:900!important;
      }

      .inventory-table td.fv-grain-remaining-red,
      .fv-ahj-table td.fv-grain-remaining-red{
        background:rgba(179,38,30,.14)!important;
        color:#9d241e!important;
        font-weight:900!important;
      }

      .inventory-table td.fv-grain-remaining-green,
      .inventory-table td.fv-grain-remaining-orange,
      .inventory-table td.fv-grain-remaining-red,
      .fv-ahj-table td.fv-grain-remaining-green,
      .fv-ahj-table td.fv-grain-remaining-orange,
      .fv-ahj-table td.fv-grain-remaining-red{
        box-shadow:inset 0 0 0 1px rgba(0,0,0,.035);
      }

      [data-theme="dark"] .fv-grade-alert.warn{color:#f4bb78}
      [data-theme="dark"] .fv-grade-alert.severe{color:#ffaaa4}
      [data-theme="dark"] .inventory-table td.fv-grain-remaining-green,
      [data-theme="dark"] .fv-ahj-table td.fv-grain-remaining-green{color:#b9e4bf!important}
      [data-theme="dark"] .inventory-table td.fv-grain-remaining-orange,
      [data-theme="dark"] .fv-ahj-table td.fv-grain-remaining-orange{color:#f4bb78!important}
      [data-theme="dark"] .inventory-table td.fv-grain-remaining-red,
      [data-theme="dark"] .fv-ahj-table td.fv-grain-remaining-red{color:#ffaaa4!important}
    `;
    document.head.appendChild(style);
  }

  function tableKey(table) {
    const bodyId = table.querySelector('tbody')?.id;
    if (bodyId) return bodyId;

    const sectionId = table.closest('[id]')?.id || 'grain-index';
    const headers = Array.from(table.querySelectorAll('thead th'))
      .map(th => norm(th.textContent))
      .join('|');
    return `${sectionId}:${headers}`;
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
    const timestamp = Date.parse(clean(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function sortTypeForHeader(header) {
    const text = norm(header.textContent);
    if (/date/.test(text)) return 'date';
    if (/bushel|loads?|bags?|moisture|\bfm\b|foreign|damage|on hand|starting|ticketed|remaining|avg mo|avg fm/.test(text)) return 'number';
    return 'text';
  }

  function compareValues(a, b, type) {
    if (type === 'number') return numberValue(a) - numberValue(b);
    if (type === 'date') return dateValue(a) - dateValue(b);

    return clean(a).localeCompare(clean(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function syncSortHeaderState(table) {
    const key = tableKey(table);
    const current = sortState.get(key);
    const headers = Array.from(table.querySelectorAll('thead th'));

    headers.forEach((header, index) => {
      header.classList.toggle('fv-sort-active', !!current && current.column === index);
      header.removeAttribute('aria-sort');

      if (current?.column === index) {
        header.setAttribute(
          'aria-sort',
          current.direction === 'asc' ? 'ascending' : 'descending'
        );
      }
    });
  }

  function sortRows(rows, column, type, direction) {
    return [...rows].sort((rowA, rowB) => {
      const valueA = rowA.cells[column]?.textContent || '';
      const valueB = rowB.cells[column]?.textContent || '';
      const result = compareValues(valueA, valueB, type);
      return direction === 'asc' ? result : -result;
    });
  }

  function applyHaulingJobSort(table, tbody, headers, current) {
    const allRows = Array.from(tbody.children).filter(row => row.tagName === 'TR');
    const type = sortTypeForHeader(headers[current.column]);
    const rebuilt = [];
    let segment = [];

    const flush = () => {
      if (!segment.length) return;
      rebuilt.push(...sortRows(segment, current.column, type, current.direction));
      segment = [];
    };

    allRows.forEach(row => {
      const isDataRow = row.cells.length === headers.length && !row.querySelector('.fv-ahj-empty');
      if (isDataRow) {
        segment.push(row);
      }
      else {
        flush();
        rebuilt.push(row);
      }
    });
    flush();

    const unchanged = rebuilt.length === allRows.length && rebuilt.every((row, index) => row === allRows[index]);
    if (unchanged) return;

    rebuilt.forEach(row => tbody.appendChild(row));
  }

  function applySort(table) {
    const key = tableKey(table);
    const current = sortState.get(key);
    if (!current) return;

    const headers = Array.from(table.querySelectorAll('thead th'));
    const tbody = table.querySelector('tbody');
    if (!tbody || current.column < 0 || current.column >= headers.length) return;

    if (table.classList.contains('fv-ahj-table')) {
      applyHaulingJobSort(table, tbody, headers, current);
      return;
    }

    const rows = Array.from(tbody.children).filter(row =>
      row.tagName === 'TR' &&
      row.cells.length === headers.length &&
      !row.querySelector('.empty-row')
    );

    if (rows.length < 2) return;

    const type = sortTypeForHeader(headers[current.column]);
    const sorted = sortRows(rows, current.column, type, current.direction);

    const alreadySorted = sorted.every((row, index) => row === rows[index]);
    if (alreadySorted) return;

    sorted.forEach(row => tbody.appendChild(row));
  }

  function decorateSortTable(table) {
    if (!table) return;

    const thead = table.querySelector('thead');
    const headers = Array.from(thead?.querySelectorAll('th') || []);
    if (!thead || !headers.length) return;

    headers.forEach(header => {
      header.classList.add('fv-sortable');
      header.title = 'Sort by this column';
    });

    syncSortHeaderState(table);
    applySort(table);

    if (thead.dataset.fvGrainIndexSortReady === '1') return;
    thead.dataset.fvGrainIndexSortReady = '1';

    thead.addEventListener('click', event => {
      const header = event.target.closest('th.fv-sortable');
      if (!header || !thead.contains(header)) return;

      const currentHeaders = Array.from(thead.querySelectorAll('th'));
      const column = currentHeaders.indexOf(header);
      if (column < 0) return;

      const key = tableKey(table);
      const existing = sortState.get(key);
      const direction =
        existing?.column === column && existing.direction === 'asc'
          ? 'desc'
          : 'asc';

      sortState.set(key, { column, direction });
      syncSortHeaderState(table);
      applySort(table);
    });
  }

  function metricFromHeader(text) {
    const key = norm(text);
    if (key.includes('moisture') || key.includes('avg mo')) return 'moisture';
    if (key === 'fm' || key.includes('avg fm') || key.includes('foreign')) return 'foreignMaterial';
    if (key.includes('damage')) return 'damage';
    return '';
  }

  function valueFromText(value) {
    const match = clean(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
  }

  function remainingClassForPercent(percent) {
    if (percent < 5) return 'fv-grain-remaining-red';
    if (percent < 35) return 'fv-grain-remaining-orange';
    return 'fv-grain-remaining-green';
  }

  function clearRemainingClasses(cell) {
    cell?.classList.remove(
      'fv-grain-remaining-green',
      'fv-grain-remaining-orange',
      'fv-grain-remaining-red'
    );
  }

  function remainingTotalIndex(headers, remainingIndex) {
    const labels = headers.map(header => norm(header.textContent).replace(/\s+/g, ' '));

    const preferred = labels.findIndex((label, index) =>
      index !== remainingIndex &&
      /(starting|job|contract|total)/.test(label) &&
      /(bushel|\bbu\b)/.test(label)
    );
    if (preferred >= 0) return preferred;

    return labels.findIndex((label, index) =>
      index !== remainingIndex &&
      /^(bushels?|bu\.?|bushels? total|total bu\.?)$/.test(label)
    );
  }

  function decorateRemainingBushels(table) {
    if (!table) return;

    const headers = Array.from(table.querySelectorAll('thead th'));
    if (!headers.length) return;

    const remainingColumns = headers
      .map((header, index) => ({ index, label: norm(header.textContent) }))
      .filter(item => item.label.includes('remaining'));

    if (!remainingColumns.length) return;

    remainingColumns.forEach(({ index: remainingIndex }) => {
      const totalIndex = remainingTotalIndex(headers, remainingIndex);
      if (totalIndex < 0) return;

      Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
        if (row.cells.length !== headers.length) return;

        const remainingCell = row.cells[remainingIndex];
        const totalCell = row.cells[totalIndex];
        if (!remainingCell || !totalCell) return;

        clearRemainingClasses(remainingCell);
        remainingCell.removeAttribute('title');

        const total = valueFromText(totalCell.textContent);
        const remaining = valueFromText(remainingCell.textContent);
        if (!(total > 0) || remaining === null) return;

        const percent = Math.max(0, (remaining / total) * 100);
        remainingCell.classList.add(remainingClassForPercent(percent));
        remainingCell.title = `${percent.toFixed(1)}% of bushels remaining`;
      });
    });
  }

  function cropFromTableRow(table, row) {
    const headers = Array.from(table.querySelectorAll('thead th'));
    const cropIndex = headers.findIndex(header => norm(header.textContent) === 'crop');
    if (cropIndex >= 0) return cropKey(row.cells[cropIndex]?.textContent);

    const modal = table.closest('.modal');
    if (modal) {
      const title = clean(modal.querySelector('.modal-title')?.textContent);
      const subtitle = clean(modal.querySelector('.inventory-sub')?.textContent);
      const fromModal = cropKey(`${title} ${subtitle}`.match(/\b(Corn|Soybeans?|Beans?)\b/i)?.[0]);
      if (fromModal) return fromModal;
    }

    return '';
  }

  function cropFromDetailContainer(container) {
    const boxes = Array.from(container.querySelectorAll('.detail-box'));
    const cropBox = boxes.find(box => norm(box.querySelector('.detail-label')?.textContent) === 'crop');
    const direct = cropKey(cropBox?.querySelector('.detail-value')?.textContent);
    if (direct) return direct;

    const modal = container.closest('.modal');
    const text = `${clean(modal?.querySelector('.modal-title')?.textContent)} ${clean(modal?.querySelector('.inventory-sub')?.textContent)}`;
    return cropKey(text.match(/\b(Corn|Soybeans?|Beans?)\b/i)?.[0]);
  }

  function gradeLevel(crop, metric, value) {
    if (!alertSettings || alertSettings.alertsEnabled === false) return '';
    if (!crop || !metric || value === null) return '';

    const rules = alertSettings?.crops?.[crop]?.[metric];
    if (!rules) return '';

    const severeThreshold = Number(rules?.severe?.threshold);
    if (
      rules?.severe?.enabled !== false &&
      Number.isFinite(severeThreshold) &&
      value >= severeThreshold
    ) {
      return 'severe';
    }

    const trendThreshold = Number(rules?.trend?.threshold);
    if (
      rules?.trend?.enabled !== false &&
      Number.isFinite(trendThreshold) &&
      value >= trendThreshold
    ) {
      return 'warn';
    }

    return '';
  }

  function styleGradeCell(cell, crop, metric) {
    if (!cell) return;

    const value = valueFromText(cell.textContent);
    let pill = cell.querySelector(':scope > .fv-grade-alert');

    if (value === null) {
      if (pill) pill.replaceWith(document.createTextNode(clean(pill.textContent)));
      return;
    }

    const level = gradeLevel(crop, metric, value);

    // Critical: normal values stay as plain text. The older helper briefly
    // wrapped every normal value in a pill and immediately unwrapped it.
    // Its MutationObserver saw those DOM changes and repeated forever,
    // which could leave Grain Inventory stuck on the loading screen.
    if (!level) {
      if (pill) {
        const text = pill.textContent;
        pill.replaceWith(document.createTextNode(text));
      }
      return;
    }

    if (!pill) {
      const text = clean(cell.textContent);
      cell.textContent = '';
      pill = document.createElement('span');
      pill.className = 'fv-grade-alert';
      pill.textContent = text;
      cell.appendChild(pill);
    }

    pill.classList.toggle('warn', level === 'warn');
    pill.classList.toggle('severe', level === 'severe');
  }

  function colorTableGrades(table) {
    if (!table || !alertSettings) return;

    const headers = Array.from(table.querySelectorAll('thead th'));
    const gradeColumns = headers
      .map((header, index) => ({ index, metric: metricFromHeader(header.textContent) }))
      .filter(item => item.metric);

    if (!gradeColumns.length) return;

    Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
      if (row.cells.length !== headers.length) return;
      const crop = cropFromTableRow(table, row);
      if (!crop) return;

      gradeColumns.forEach(({ index, metric }) => {
        styleGradeCell(row.cells[index], crop, metric);
      });
    });
  }

  function colorDetailGrades(container) {
    if (!container || !alertSettings) return;
    const crop = cropFromDetailContainer(container);
    if (!crop) return;

    container.querySelectorAll('.detail-box').forEach(box => {
      const label = clean(box.querySelector('.detail-label')?.textContent);
      const metric = metricFromHeader(label);
      if (!metric) return;
      styleGradeCell(box.querySelector('.detail-value'), crop, metric);
    });
  }

  function applyUi() {
    if (applyingUi) return;
    applyingUi = true;

    try {
      document.querySelectorAll('table.inventory-table, table.harvest-drill-table, table.fv-ahj-table')
        .forEach(table => {
          decorateSortTable(table);
          decorateRemainingBushels(table);
          colorTableGrades(table);
        });

      colorDetailGrades(document.getElementById('harvest-modal-summary'));
      colorDetailGrades(document.querySelector('#edit-modal-backdrop .detail-grid'));
    }
    finally {
      applyingUi = false;
    }
  }

  async function loadSettings() {
    try {
      if (!firebaseApi) {
        firebaseApi = await import('/js/firebase-init.js');
        await firebaseApi.ready;
      }

      const db = firebaseApi.getFirestore();
      const snap = await firebaseApi.getDoc(
        firebaseApi.doc(db, 'settings', 'grainTicketAlerts')
      );

      alertSettings = snap.exists() ? (snap.data() || {}) : null;
      applyUi();
    }
    catch (error) {
      console.warn('[Grain Index] Could not load Grain Ticket Alert settings:', error);
      alertSettings = null;
    }
  }

  function queueApply() {
    if (applyingUi || mutationQueued) return;
    mutationQueued = true;
    requestAnimationFrame(() => {
      mutationQueued = false;
      applyUi();
    });
  }

  function start() {
    installStyles();
    applyUi();
    loadSettings();

    new MutationObserver(queueApply).observe(document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('focus', () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(loadSettings, 250);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
  else {
    start();
  }
})();