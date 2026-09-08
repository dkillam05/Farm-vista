// FarmVista — Hauling Jobs page compatibility helpers
// Sept. 8, 2026
//
// Keeps the Hauling Jobs table clean, preserves the page-specific dark-theme
// fixes, and keeps the Hauling Job buyer picker synchronized with Firestore.
// The picker also exposes "+ Add New Buyer" and saves buyers using the same
// grain_buyers collection/fields used by the Grain Contract add form.

(() => {
  'use strict';

  const TABLE_BODY_ID = 'hauling-jobs-table-body';
  const BUYER_SELECT_ID = 'hauling-job-buyer';
  const JOB_MODAL_ID = 'hauling-job-modal';
  const ADD_BUYER_VALUE = '__fv_add_new_buyer__';
  const ADD_BUYER_MODAL_ID = 'fv-hauling-add-buyer-modal';

  let firebaseContextPromise = null;
  let tableObserver = null;
  let jobModalObserver = null;
  let buyerSelectWired = false;
  let buyerSyncToken = 0;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function clean(value) {
    return String(value ?? '').trim();
  }

  function normalizeBuyerName(value) {
    return clean(value).replace(/\s+/g, ' ');
  }

  async function getFirebaseContext() {
    if (!firebaseContextPromise) {
      firebaseContextPromise = import('/js/firebase-init.js').then(async firebase => {
        await firebase.ready;
        return {
          firebase,
          db: firebase.getFirestore()
        };
      });
    }

    return firebaseContextPromise;
  }

  async function loadLiveBuyers() {
    const { firebase, db } = await getFirebaseContext();
    const snapshot = await firebase.getDocs(
      firebase.collection(db, 'grain_buyers')
    );

    return snapshot.docs
      .map(docSnapshot => ({
        id: docSnapshot.id,
        name: normalizeBuyerName(docSnapshot.data()?.name)
      }))
      .filter(buyer => buyer.name)
      .sort((a, b) => a.name.localeCompare(
        b.name,
        undefined,
        { numeric: true, sensitivity: 'base' }
      ));
  }

  function requestCoreHaulingRefresh() {
    const refreshButton = document.getElementById('refresh-hauling-link-btn');
    refreshButton?.click();
  }

  function appendAddBuyerOption(select) {
    if (!select) return;

    const existing = Array.from(select.options).find(
      option => option.value === ADD_BUYER_VALUE
    );

    if (existing) {
      existing.textContent = '+ Add New Buyer';
      return;
    }

    const option = document.createElement('option');
    option.value = ADD_BUYER_VALUE;
    option.textContent = '+ Add New Buyer';
    select.appendChild(option);
  }

  async function syncBuyerSelect(preferredId = '') {
    const select = document.getElementById(BUYER_SELECT_ID);
    if (!select) return;

    const token = ++buyerSyncToken;
    const previousValue =
      preferredId ||
      (select.value !== ADD_BUYER_VALUE ? clean(select.value) : '');

    try {
      select.disabled = true;
      select.setAttribute('aria-busy', 'true');

      // The original hauling module keeps a private state.buyers snapshot.
      // Refresh it first so saveJob() and matchingBuyer() know about buyers
      // created after this page was initially loaded (including bfcache cases).
      requestCoreHaulingRefresh();

      const buyers = await loadLiveBuyers();

      // Let the original refresh finish loading its six Firestore collections
      // before the user can submit the hauling-job form.
      await delay(700);

      if (token !== buyerSyncToken || !select.isConnected) return;

      select.innerHTML = '<option value="">Select buyer</option>';

      buyers.forEach(buyer => {
        const option = document.createElement('option');
        option.value = buyer.id;
        option.textContent = buyer.name;
        select.appendChild(option);
      });

      appendAddBuyerOption(select);

      if (
        previousValue &&
        Array.from(select.options).some(option => option.value === previousValue)
      ) {
        select.value = previousValue;
      } else {
        select.value = '';
      }

      select.dataset.fvPreviousBuyer = select.value;
    } catch (error) {
      console.warn('[Hauling Jobs] live buyer refresh failed:', error);
      appendAddBuyerOption(select);
    } finally {
      if (token === buyerSyncToken && select.isConnected) {
        select.disabled = false;
        select.removeAttribute('aria-busy');
      }
    }
  }

  function installAddBuyerModal() {
    if (document.getElementById(ADD_BUYER_MODAL_ID)) return;

    const modal = document.createElement('div');
    modal.className = 'fv-modal';
    modal.id = ADD_BUYER_MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'fv-hauling-add-buyer-title');

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <div class="modal-title" id="fv-hauling-add-buyer-title">
              Add Buyer / Elevator
            </div>
            <div class="modal-sub">
              Enter the buyer or elevator name.
            </div>
          </div>
          <button
            type="button"
            class="modal-close"
            id="fv-close-hauling-add-buyer"
            aria-label="Close add buyer"
          >×</button>
        </div>

        <div class="modal-body">
          <div class="field">
            <label for="fv-hauling-new-buyer-name">
              Buyer / Elevator <span class="required">*</span>
            </label>
            <input
              id="fv-hauling-new-buyer-name"
              type="text"
              autocomplete="organization"
              placeholder="Buyer or elevator name"
            />
          </div>
          <div
            id="fv-hauling-add-buyer-message"
            class="hauling-form-message"
          ></div>
        </div>

        <div class="modal-actions">
          <button
            type="button"
            class="btn btn-secondary"
            id="fv-cancel-hauling-add-buyer"
          >Cancel</button>
          <button
            type="button"
            class="btn btn-hauling"
            id="fv-save-hauling-add-buyer"
          >Add Buyer</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      const input = document.getElementById('fv-hauling-new-buyer-name');
      const message = document.getElementById('fv-hauling-add-buyer-message');
      if (input) input.value = '';
      if (message) {
        message.textContent = '';
        message.className = 'hauling-form-message';
      }
    };

    document.getElementById('fv-close-hauling-add-buyer')
      ?.addEventListener('click', close);

    document.getElementById('fv-cancel-hauling-add-buyer')
      ?.addEventListener('click', close);

    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });

    document.getElementById('fv-hauling-new-buyer-name')
      ?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          document.getElementById('fv-save-hauling-add-buyer')?.click();
        }
      });

    document.getElementById('fv-save-hauling-add-buyer')
      ?.addEventListener('click', saveNewBuyerFromHauling);
  }

  function openAddBuyerModal() {
    installAddBuyerModal();

    const modal = document.getElementById(ADD_BUYER_MODAL_ID);
    const input = document.getElementById('fv-hauling-new-buyer-name');
    const message = document.getElementById('fv-hauling-add-buyer-message');

    if (message) {
      message.textContent = '';
      message.className = 'hauling-form-message';
    }

    modal?.classList.add('open');

    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 0);
  }

  function showAddBuyerMessage(message, type = 'error') {
    const element = document.getElementById('fv-hauling-add-buyer-message');
    if (!element) return;

    element.textContent = message || '';
    element.className = `hauling-form-message${message ? ` show ${type}` : ''}`;
  }

  async function saveNewBuyerFromHauling() {
    const input = document.getElementById('fv-hauling-new-buyer-name');
    const saveButton = document.getElementById('fv-save-hauling-add-buyer');
    const name = normalizeBuyerName(input?.value);

    if (!name) {
      showAddBuyerMessage('Enter the buyer or elevator name.');
      input?.focus();
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'Adding...';
    }

    try {
      const buyers = await loadLiveBuyers();
      const duplicate = buyers.find(
        buyer => buyer.name.toLowerCase() === name.toLowerCase()
      );

      let buyerId = duplicate?.id || '';

      if (!buyerId) {
        const { firebase, db } = await getFirebaseContext();
        const ref = await firebase.addDoc(
          firebase.collection(db, 'grain_buyers'),
          {
            name,
            createdAt: firebase.serverTimestamp(),
            updatedAt: firebase.serverTimestamp()
          }
        );
        buyerId = ref.id;
      }

      // Refresh the original hauling module's private buyer state, then rebuild
      // the visible picker from Firestore and select the new buyer.
      requestCoreHaulingRefresh();
      await delay(900);
      await syncBuyerSelect(buyerId);

      const select = document.getElementById(BUYER_SELECT_ID);
      if (select && buyerId) {
        select.value = buyerId;
        select.dataset.fvPreviousBuyer = buyerId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      document.getElementById(ADD_BUYER_MODAL_ID)?.classList.remove('open');
    } catch (error) {
      console.error('[Hauling Jobs] add buyer failed:', error);
      showAddBuyerMessage(
        error?.message || 'FarmVista could not add that buyer. Please try again.'
      );
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Add Buyer';
      }
    }
  }

  function wireBuyerSelect() {
    const select = document.getElementById(BUYER_SELECT_ID);
    if (!select) return false;

    appendAddBuyerOption(select);

    if (buyerSelectWired) return true;
    buyerSelectWired = true;

    // Capture phase prevents the original hauling-job change handler from
    // treating the synthetic Add New option as a real buyer id.
    select.addEventListener('change', event => {
      if (event.target.value === ADD_BUYER_VALUE) {
        event.preventDefault();
        event.stopImmediatePropagation();

        event.target.value = clean(event.target.dataset.fvPreviousBuyer);
        openAddBuyerModal();
        return;
      }

      event.target.dataset.fvPreviousBuyer = event.target.value;
    }, true);

    return true;
  }

  function watchHaulingJobModal() {
    const modal = document.getElementById(JOB_MODAL_ID);
    if (!modal) return false;

    wireBuyerSelect();

    if (jobModalObserver) jobModalObserver.disconnect();

    jobModalObserver = new MutationObserver(() => {
      if (!modal.classList.contains('open')) return;

      // Every open gets a live Firestore read. This fixes the case where a
      // buyer was added from the contract form and the browser restored the
      // contracts page from its old in-memory snapshot.
      syncBuyerSelect();
    });

    jobModalObserver.observe(modal, {
      attributes: true,
      attributeFilter: ['class']
    });

    return true;
  }

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

      html.dark .hauling-job-drop-card button,
      html[data-theme="dark"] .hauling-job-drop-card button,
      html.dark .hauling-job-drop-card a,
      html[data-theme="dark"] .hauling-job-drop-card a,
      html.dark .hauling-job-drop-card [role="button"],
      html[data-theme="dark"] .hauling-job-drop-card [role="button"],
      html.dark .hauling-job-drop-card [style*="background"],
      html[data-theme="dark"] .hauling-job-drop-card [style*="background"] {
        background:#18231b !important;
        background-color:#18231b !important;
        color:#eef4ef !important;
        -webkit-text-fill-color:#eef4ef !important;
        border-color:#314137 !important;
      }

      html.dark .hauling-job-drop-card button:hover,
      html[data-theme="dark"] .hauling-job-drop-card button:hover,
      html.dark .hauling-job-drop-card a:hover,
      html[data-theme="dark"] .hauling-job-drop-card a:hover,
      html.dark .hauling-job-drop-card [role="button"]:hover,
      html[data-theme="dark"] .hauling-job-drop-card [role="button"]:hover {
        background:#223128 !important;
        background-color:#223128 !important;
        color:#fff !important;
        -webkit-text-fill-color:#fff !important;
      }

      html.dark .hauling-dnd-message.ready,
      html[data-theme="dark"] .hauling-dnd-message.ready,
      html.dark .reconcile-filter-message.ready,
      html[data-theme="dark"] .reconcile-filter-message.ready {
        background:#182c1d !important;
        color:#dff0e3 !important;
      }

      html.dark #${ADD_BUYER_MODAL_ID} .modal-card,
      html[data-theme="dark"] #${ADD_BUYER_MODAL_ID} .modal-card {
        background:#111a14 !important;
        color:#eef4ef !important;
        border-color:#314137 !important;
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
      if (cells.length < 5) return;
      cleanSoldUnderCell(cells[4]);
    });
  }

  function attachToTable() {
    const body = document.getElementById(TABLE_BODY_ID);
    if (!body) return false;

    cleanTable();

    if (tableObserver) tableObserver.disconnect();

    tableObserver = new MutationObserver(cleanTable);
    tableObserver.observe(body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return true;
  }

  function boot() {
    installContractsDarkThemeFix();
    installAddBuyerModal();
    wireBuyerSelect();
    watchHaulingJobModal();

    if (!attachToTable()) {
      const pageObserver = new MutationObserver(() => {
        wireBuyerSelect();
        watchHaulingJobModal();

        if (attachToTable()) {
          pageObserver.disconnect();
        }
      });

      pageObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
