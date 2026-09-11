/* FarmVista — Hauling Job compact ticket cards + inventory edit handoff
   Sept. 11, 2026

   Grain Contracts:
   - Hauling Job cards stay compact when they already have assigned tickets.
   - Assigned tickets can still be expanded when the user needs to drag/unassign them.
   - Supports ?editHaulingJob=<id> so other FarmVista views can open the existing
     Hauling Job edit modal without duplicating edit/save logic.

   Grain Inventory:
   - Adds Edit Hauling Job to the existing Active Hauling Jobs detail popup.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_UX_20260911) return;
  window.__FV_HAULING_JOB_UX_20260911 = true;

  const clean = value => String(value ?? '').trim();
  const path = String(location.pathname || '').toLowerCase();
  const isContracts = path.endsWith('/pages/grain/grain-contracts.html');
  const isInventory = path.endsWith('/pages/grain/index.html');

  function ensureStyle() {
    if (document.getElementById('fv-hauling-job-ux-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-hauling-job-ux-style';
    style.textContent = `
      .fv-job-ticket-collapse-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        margin-top:9px;
        padding-top:8px;
        border-top:1px solid var(--border,#ddd);
      }
      .fv-job-ticket-collapse-btn{
        width:100%;
        min-height:34px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:6px 8px;
        border:0;
        border-radius:8px;
        background:var(--surface-2,rgba(0,0,0,.04));
        color:var(--text,#111);
        font:inherit;
        font-size:.76rem;
        font-weight:850;
        text-align:left;
        cursor:pointer;
      }
      .fv-job-ticket-collapse-btn:hover,
      .fv-job-ticket-collapse-btn:focus{
        outline:none;
        background:rgba(59,126,70,.10);
      }
      .fv-job-ticket-collapse-chevron{
        flex:0 0 auto;
        font-size:1rem;
        transition:transform .15s ease;
      }
      .fv-job-ticket-collapse-btn[aria-expanded="true"] .fv-job-ticket-collapse-chevron{
        transform:rotate(90deg);
      }
      .fv-ticket-job-linked[data-fv-job-tickets-collapsed="1"]{
        display:none!important;
      }
      #fv-ahj-edit-job-btn{
        border-color:#3B7E46;
        background:#3B7E46;
        color:#fff;
      }
      #fv-ahj-edit-job-btn:hover,
      #fv-ahj-edit-job-btn:focus{
        background:#326d3c;
        color:#fff;
      }
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
     GRAIN CONTRACTS — COMPACT HAULING JOB CARDS
  ============================================================ */

  function assignedTickets(linked) {
    if (!linked) return [];
    return Array.from(
      linked.querySelectorAll('.fv-hauling-ticket-card[data-ticket-id]')
    );
  }

  function syncJobTicketCollapse(card) {
    if (!card) return;

    const linked = card.querySelector(':scope > .fv-ticket-job-linked');
    if (!linked) {
      card.querySelector(':scope > .fv-job-ticket-collapse-row')?.remove();
      return;
    }

    const tickets = assignedTickets(linked);
    if (!tickets.length) {
      linked.removeAttribute('data-fv-job-tickets-collapsed');
      card.querySelector(':scope > .fv-job-ticket-collapse-row')?.remove();
      return;
    }

    let row = card.querySelector(':scope > .fv-job-ticket-collapse-row');
    let button = row?.querySelector('.fv-job-ticket-collapse-btn');

    if (!row) {
      row = document.createElement('div');
      row.className = 'fv-job-ticket-collapse-row';

      button = document.createElement('button');
      button.type = 'button';
      button.className = 'fv-job-ticket-collapse-btn';
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = `
        <span class="fv-job-ticket-collapse-label"></span>
        <span class="fv-job-ticket-collapse-chevron" aria-hidden="true">›</span>
      `;

      button.addEventListener('pointerdown', event => {
        event.stopPropagation();
      });

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const expanded = button.getAttribute('aria-expanded') === 'true';
        const next = !expanded;

        button.setAttribute('aria-expanded', next ? 'true' : 'false');
        linked.dataset.fvJobTicketsCollapsed = next ? '0' : '1';
      });

      row.appendChild(button);
      linked.insertAdjacentElement('beforebegin', row);
    }

    const label = button.querySelector('.fv-job-ticket-collapse-label');
    if (label) {
      label.textContent = `${tickets.length.toLocaleString('en-US')} assigned ${tickets.length === 1 ? 'ticket' : 'tickets'} — ${button.getAttribute('aria-expanded') === 'true' ? 'Hide' : 'View'}`;
    }

    if (!button.dataset.fvInitialized) {
      button.dataset.fvInitialized = '1';
      button.setAttribute('aria-expanded', 'false');
      linked.dataset.fvJobTicketsCollapsed = '1';
    }
  }

  function syncAllContractJobCards() {
    document
      .querySelectorAll('.fv-ticket-job-card[data-fv-ticket-job-id]')
      .forEach(syncJobTicketCollapse);
  }

  function installContractCollapse() {
    if (!isContracts) return;

    ensureStyle();
    syncAllContractJobCards();

    const observer = new MutationObserver(() => {
      requestAnimationFrame(syncAllContractJobCards);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /* ============================================================
     GRAIN INVENTORY — EDIT BUTTON IN ACTIVE HAULING JOB POPUP
  ============================================================ */

  let currentInventoryJobId = '';

  function inventoryEditUrl(jobId) {
    const url = new URL('/pages/grain/grain-contracts.html', location.origin);
    url.searchParams.set('editHaulingJob', clean(jobId));
    return url.pathname + url.search;
  }

  function ensureInventoryEditButton() {
    if (!isInventory) return;

    const modal = document.getElementById('fv-ahj-modal-backdrop');
    const actions = modal?.querySelector('.modal-actions');
    const closeButton = modal?.querySelector('#fv-ahj-modal-done');
    if (!modal || !actions || !closeButton) return;

    let button = modal.querySelector('#fv-ahj-edit-job-btn');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.id = 'fv-ahj-edit-job-btn';
      button.textContent = 'Edit Hauling Job';

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const jobId = clean(modal.dataset.fvHaulingJobId || currentInventoryJobId);
        if (!jobId) return;

        location.href = inventoryEditUrl(jobId);
      });

      actions.insertBefore(button, closeButton);
    }

    const jobId = clean(modal.dataset.fvHaulingJobId || currentInventoryJobId);
    button.disabled = !jobId;
  }

  function installInventoryEdit() {
    if (!isInventory) return;

    ensureStyle();

    document.addEventListener('click', event => {
      const row = event.target.closest('#fv-ahj-tbody [data-job-id]');
      if (!row) return;

      currentInventoryJobId = clean(row.dataset.jobId);

      const modal = document.getElementById('fv-ahj-modal-backdrop');
      if (modal) modal.dataset.fvHaulingJobId = currentInventoryJobId;

      setTimeout(ensureInventoryEditButton, 0);
    }, true);

    const observer = new MutationObserver(() => {
      ensureInventoryEditButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-hidden']
    });

    ensureInventoryEditButton();
  }

  /* ============================================================
     GRAIN CONTRACTS — OPEN EXISTING EDIT MODAL FROM URL
  ============================================================ */

  function openRequestedHaulingJobEdit() {
    if (!isContracts) return;

    const params = new URLSearchParams(location.search);
    const jobId = clean(params.get('editHaulingJob'));
    if (!jobId) return;

    let attempts = 0;
    const maxAttempts = 120;

    const tryOpen = () => {
      attempts += 1;

      const escaped = window.CSS?.escape
        ? CSS.escape(jobId)
        : jobId.replace(/(["\\])/g, '\\$1');

      const row = document.querySelector(`tr.hauling-row[data-hauling-job-id="${escaped}"]`);

      if (row) {
        row.click();

        params.delete('editHaulingJob');
        const next = `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash || ''}`;
        history.replaceState(history.state, '', next);
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryOpen, 100);
      }
    };

    tryOpen();
  }

  function start() {
    installContractCollapse();
    installInventoryEdit();
    openRequestedHaulingJobEdit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
