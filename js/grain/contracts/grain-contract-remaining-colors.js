/* FarmVista — Contract Remaining Bushel Color Cues
   Sept. 12, 2026

   Remaining % of original contract:
   >= 35%       green
   5% to < 35%  orange
   < 5%         red

   Applies to the main Grain Contracts table and compact contract DND cards.
*/
(() => {
  'use strict';

  if (window.__FV_CONTRACT_REMAINING_COLORS_20260912) return;
  window.__FV_CONTRACT_REMAINING_COLORS_20260912 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  const numberValue = value => {
    const parsed = Number(String(value ?? '').replace(/,/g,'').replace(/[^0-9.-]/g,''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  function classForPercent(percent) {
    if (percent < 5) return 'fv-contract-remaining-red';
    if (percent < 35) return 'fv-contract-remaining-orange';
    return 'fv-contract-remaining-green';
  }

  function clearClasses(element) {
    element?.classList.remove(
      'fv-contract-remaining-green',
      'fv-contract-remaining-orange',
      'fv-contract-remaining-red'
    );
  }

  function installStyles() {
    if (document.getElementById('fv-contract-remaining-colors-style')) return;
    const style = document.createElement('style');
    style.id = 'fv-contract-remaining-colors-style';
    style.textContent = `
      #contracts-table-body td.fv-contract-remaining-green,
      .compact-contract-number strong.fv-contract-remaining-green{
        background:rgba(59,126,70,.15)!important;
        color:#2d6937!important;
        font-weight:900!important;
      }
      #contracts-table-body td.fv-contract-remaining-orange,
      .compact-contract-number strong.fv-contract-remaining-orange{
        background:rgba(230,126,34,.17)!important;
        color:#a65300!important;
        font-weight:900!important;
      }
      #contracts-table-body td.fv-contract-remaining-red,
      .compact-contract-number strong.fv-contract-remaining-red{
        background:rgba(179,38,30,.14)!important;
        color:#9d241e!important;
        font-weight:900!important;
      }
      #contracts-table-body td.fv-contract-remaining-green,
      #contracts-table-body td.fv-contract-remaining-orange,
      #contracts-table-body td.fv-contract-remaining-red{
        box-shadow:inset 0 0 0 1px rgba(0,0,0,.035);
      }
      .compact-contract-number strong.fv-contract-remaining-green,
      .compact-contract-number strong.fv-contract-remaining-orange,
      .compact-contract-number strong.fv-contract-remaining-red{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:72px;
        padding:3px 7px;
        border-radius:7px;
      }
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-green,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-green{color:#b9e4bf!important}
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-orange,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-orange{color:#f4bb78!important}
      [data-theme="dark"] #contracts-table-body td.fv-contract-remaining-red,
      [data-theme="dark"] .compact-contract-number strong.fv-contract-remaining-red{color:#ffaaa4!important}
    `;
    document.head.appendChild(style);
  }

  function tableIndexes(table) {
    const headers = Array.from(table?.querySelectorAll('thead th') || []);
    const indexFor = wanted => headers.findIndex(header =>
      String(header.textContent || '').trim().toLowerCase().replace(/\s+/g,' ') === wanted
    );
    return {
      contract:indexFor('contract bu.'),
      remaining:indexFor('remaining')
    };
  }

  function decorateMainTable() {
    const body = document.getElementById('contracts-table-body');
    const table = body?.closest('table');
    if (!body || !table) return;

    const indexes = tableIndexes(table);
    if (indexes.contract < 0 || indexes.remaining < 0) return;

    Array.from(body.querySelectorAll('tr')).forEach(row => {
      const contractCell = row.cells[indexes.contract];
      const remainingCell = row.cells[indexes.remaining];
      if (!contractCell || !remainingCell) return;

      clearClasses(remainingCell);
      remainingCell.removeAttribute('title');

      const contract = numberValue(contractCell.textContent);
      const remaining = numberValue(remainingCell.textContent);
      if (!(contract > 0) || remaining === null) return;

      const percent = Math.max(0,(remaining / contract) * 100);
      remainingCell.classList.add(classForPercent(percent));
      remainingCell.title = `${percent.toFixed(1)}% of contract bushels remaining`;
    });
  }

  function labeledCompactNumber(card,label) {
    return Array.from(card.querySelectorAll('.compact-contract-number')).find(item =>
      String(item.querySelector('span')?.textContent || '').trim().toLowerCase() === label
    ) || null;
  }

  function decorateCompactCards() {
    document.querySelectorAll('.contract-drop-card').forEach(card => {
      const contractBox = labeledCompactNumber(card,'contract');
      const remainingBox = labeledCompactNumber(card,'remaining');
      const remainingStrong = remainingBox?.querySelector('strong');
      if (!contractBox || !remainingStrong) return;

      clearClasses(remainingStrong);
      remainingStrong.removeAttribute('title');

      const contract = numberValue(contractBox.querySelector('strong')?.textContent);
      const remaining = numberValue(remainingStrong.textContent);
      if (!(contract > 0) || remaining === null) return;

      const percent = Math.max(0,(remaining / contract) * 100);
      remainingStrong.classList.add(classForPercent(percent));
      remainingStrong.title = `${percent.toFixed(1)}% remaining`;
    });
  }

  let queued = false;
  function run() {
    queued = false;
    installStyles();
    decorateMainTable();
    decorateCompactCards();
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  }

  new MutationObserver(queue).observe(document.documentElement,{ childList:true,subtree:true });
  queue();
})();