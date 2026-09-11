// FarmVista — Grain Contracts hauling-job compatibility helpers
// Sept. 11, 2026
//
// Keeps hauling-job Buyer / Location / Sold Under controls current, provides
// inline Add New flows, preserves modal layout fixes, contract-card cleanup,
// voided-status filtering, and dark-theme compatibility.

(() => {
  'use strict';

  const TABLE_BODY_ID = 'hauling-jobs-table-body';
  const BUYER_SELECT_ID = 'hauling-job-buyer';
  const LOCATION_SELECT_ID = 'hauling-job-destination';
  const CUSTOMER_SELECT_ID = 'hauling-job-customer';
  const JOB_MODAL_ID = 'hauling-job-modal';

  const ADD_BUYER_VALUE = '__fv_add_new_buyer__';
  const ADD_LOCATION_VALUE = '__fv_add_new_location__';
  const ADD_CUSTOMER_VALUE = '__fv_add_new_customer__';

  const ADD_BUYER_MODAL_ID = 'fv-hauling-add-buyer-modal';
  const ADD_LOCATION_MODAL_ID = 'fv-hauling-add-location-modal';
  const ADD_CUSTOMER_MODAL_ID = 'fv-hauling-add-customer-modal';

  let firebaseContextPromise = null;
  let tableObserver = null;
  let jobModalObserver = null;
  let locationObserver = null;
  let customerObserver = null;
  let buyerSelectWired = false;
  let locationSelectWired = false;
  let customerSelectWired = false;
  let addJobResetWired = false;
  let contractStatusVoidedWired = false;
  let buyerSyncToken = 0;

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clean = value => String(value ?? '').trim();
  const normalizeName = value => clean(value).replace(/\s+/g, ' ');

  function titleCaseName(value) {
    const normalized = normalizeName(value);
    if (!normalized) return '';
    return normalized
      .split(' ')
      .map(word => {
        if (/^[A-Z0-9]{2,}$/.test(word)) return word;
        return word.toLowerCase().replace(/(^|[-'/])([a-z])/g, (_, prefix, letter) => (
          prefix + letter.toUpperCase()
        ));
      })
      .join(' ');
  }

  async function getFirebaseContext() {
    if (!firebaseContextPromise) {
      firebaseContextPromise = import('/js/firebase-init.js').then(async firebase => {
        await firebase.ready;
        return { firebase, db: firebase.getFirestore() };
      });
    }
    return firebaseContextPromise;
  }

  async function loadLiveBuyers() {
    const { firebase, db } = await getFirebaseContext();
    const snapshot = await firebase.getDocs(firebase.collection(db, 'grain_buyers'));
    return snapshot.docs
      .map(docSnapshot => ({ id: docSnapshot.id, name: normalizeName(docSnapshot.data()?.name) }))
      .filter(item => item.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  async function loadLiveCustomers() {
    const { firebase, db } = await getFirebaseContext();
    const snapshot = await firebase.getDocs(firebase.collection(db, 'grain_customers'));
    return snapshot.docs
      .map(docSnapshot => ({ id: docSnapshot.id, name: normalizeName(docSnapshot.data()?.name) }))
      .filter(item => item.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }

  async function loadLiveLocations(buyerId = '') {
    const { firebase, db } = await getFirebaseContext();
    const snapshot = await firebase.getDocs(firebase.collection(db, 'grain_delivery_locations'));
    return snapshot.docs
      .map(docSnapshot => {
        const data = docSnapshot.data() || {};
        return {
          id: docSnapshot.id,
          buyerId: clean(data.buyerId),
          buyerName: normalizeName(data.buyerName),
          locationName: normalizeName(data.locationName),
          street: normalizeName(data.street),
          city: normalizeName(data.city),
          state: clean(data.state).toUpperCase(),
          zip: clean(data.zip)
        };
      })
      .filter(location => location.buyerId && location.locationName)
      .filter(location => !buyerId || location.buyerId === buyerId)
      .sort((a, b) => a.locationName.localeCompare(b.locationName, undefined, {
        numeric: true,
        sensitivity: 'base'
      }));
  }

  function requestCoreHaulingRefresh() {
    document.getElementById('refresh-hauling-link-btn')?.click();
  }

  function makeAddOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function putAddBuyerAtTop(select) {
    if (!select) return;
    Array.from(select.options)
      .filter(option => option.value === ADD_BUYER_VALUE)
      .forEach(option => option.remove());
    const addOption = makeAddOption(ADD_BUYER_VALUE, '+ Add New Buyer');
    select.insertBefore(addOption, select.options[1] || null);
  }

  function putAddLocationAtTop(select) {
    if (!select) return;
    const buyerId = clean(document.getElementById(BUYER_SELECT_ID)?.value);
    Array.from(select.options)
      .filter(option => option.value === ADD_LOCATION_VALUE)
      .forEach(option => option.remove());
    if (!buyerId || buyerId === ADD_BUYER_VALUE) return;
    const addOption = makeAddOption(ADD_LOCATION_VALUE, '+ Add New Location');
    select.insertBefore(addOption, select.options[1] || null);
  }

  function putAddCustomerAtTop(select) {
    if (!select) return;
    Array.from(select.options)
      .filter(option => option.value === ADD_CUSTOMER_VALUE)
      .forEach(option => option.remove());
    const addOption = makeAddOption(ADD_CUSTOMER_VALUE, '+ Add New Sold Under');
    select.insertBefore(addOption, select.options[1] || null);
  }

  function syncComboButton(select) {
    if (!select) return;
    const combo = select.closest('.fv-combo');
    const button = combo?.querySelector('.fv-buttonish');
    const option = select.options?.[select.selectedIndex];
    if (button) button.textContent = option?.textContent || option?.text || '— Select —';
  }

  function upgradeCustomerCombo() {
    const select = document.getElementById(CUSTOMER_SELECT_ID);
    if (!select) return false;
    putAddCustomerAtTop(select);
    select.setAttribute('data-fv-combo', '');
    select.setAttribute('data-fv-search', 'false');
    window.FVCombo?.upgradeSelect?.(select);
    return !!select._fvUpgraded;
  }

  function ensureAddSoldUnderRowInOpenCombo() {
    const select = document.getElementById(CUSTOMER_SELECT_ID);
    const combo = select?.closest('.fv-combo');
    const button = combo?.querySelector('.fv-buttonish');
    if (!select || !combo || !button) return;

    putAddCustomerAtTop(select);

    const panel = document.querySelector('#fv-portal-root .fv-panel.show') ||
      combo.querySelector('.fv-panel.show') ||
      document.querySelector('.fv-panel.show');
    const list = panel?.querySelector('.fv-list');
    if (!list) return;

    const existing = Array.from(list.querySelectorAll('.fv-item')).find(item =>
      clean(item.textContent) === '+ Add New Sold Under'
    );
    if (existing) return;

    const row = document.createElement('div');
    row.className = 'fv-item fv-add-sold-under-row';
    row.textContent = '+ Add New Sold Under';
    row.setAttribute('role', 'option');
    row.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      window.FVCombo?.closeAll?.();
      openAddCustomerModal();
    });

    const firstItem = list.querySelector('.fv-item');
    if (firstItem && /select customer/i.test(clean(firstItem.textContent))) {
      firstItem.insertAdjacentElement('afterend', row);
    } else {
      list.prepend(row);
    }
  }

  function wireCustomerComboOpenGuard() {
    const select = document.getElementById(CUSTOMER_SELECT_ID);
    const button = select?.closest('.fv-combo')?.querySelector('.fv-buttonish');
    if (!select || !button || button.dataset.fvSoldUnderAddGuard === '1') return;
    button.dataset.fvSoldUnderAddGuard = '1';
    button.addEventListener('click', () => {
      putAddCustomerAtTop(select);
      setTimeout(ensureAddSoldUnderRowInOpenCombo, 0);
      setTimeout(ensureAddSoldUnderRowInOpenCombo, 40);
    }, true);
  }

  async function syncBuyerSelect(preferredId = '') {
    const select = document.getElementById(BUYER_SELECT_ID);
    if (!select) return;
    const token = ++buyerSyncToken;
    const previousValue = preferredId || (select.value !== ADD_BUYER_VALUE ? clean(select.value) : '');

    try {
      select.disabled = true;
      select.setAttribute('aria-busy', 'true');
      const buyers = await loadLiveBuyers();
      await delay(500);
      if (token !== buyerSyncToken || !select.isConnected) return;

      select.innerHTML = '<option value="">Select buyer</option>';
      select.appendChild(makeAddOption(ADD_BUYER_VALUE, '+ Add New Buyer'));
      buyers.forEach(buyer => {
        const option = document.createElement('option');
        option.value = buyer.id;
        option.textContent = buyer.name;
        select.appendChild(option);
      });
      select.value = buyers.some(buyer => buyer.id === previousValue) ? previousValue : '';
      select.dataset.fvPreviousBuyer = select.value;
      syncComboButton(select);
    } catch (error) {
      console.warn('[Hauling Jobs] live buyer refresh failed:', error);
      putAddBuyerAtTop(select);
    } finally {
      if (token === buyerSyncToken && select.isConnected) {
        select.disabled = false;
        select.removeAttribute('aria-busy');
      }
    }
  }

  function modalShell(id, titleId, title, subtitle, body, saveId, saveLabel, closeId, cancelId) {
    const modal = document.createElement('div');
    modal.className = 'fv-modal';
    modal.id = id;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div>
            <div class="modal-title" id="${titleId}">${title}</div>
            <div class="modal-sub">${subtitle}</div>
          </div>
          <button type="button" class="modal-close" id="${closeId}" aria-label="Close">×</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="${cancelId}">Cancel</button>
          <button type="button" class="btn btn-hauling" id="${saveId}">${saveLabel}</button>
        </div>
      </div>`;
    return modal;
  }

  function installAddBuyerModal() {
    if (document.getElementById(ADD_BUYER_MODAL_ID)) return;
    const modal = modalShell(
      ADD_BUYER_MODAL_ID,
      'fv-hauling-add-buyer-title',
      'Add Buyer / Elevator',
      'Enter the buyer or elevator name.',
      `<div class="field">
        <label for="fv-hauling-new-buyer-name">Buyer / Elevator <span class="required">*</span></label>
        <input id="fv-hauling-new-buyer-name" type="text" autocomplete="organization" placeholder="Buyer or elevator name" />
      </div>
      <div id="fv-hauling-add-buyer-message" class="hauling-form-message"></div>`,
      'fv-save-hauling-add-buyer', 'Add Buyer', 'fv-close-hauling-add-buyer', 'fv-cancel-hauling-add-buyer'
    );
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      const input = document.getElementById('fv-hauling-new-buyer-name');
      if (input) input.value = '';
      showBuyerMessage('');
    };

    document.getElementById('fv-close-hauling-add-buyer')?.addEventListener('click', close);
    document.getElementById('fv-cancel-hauling-add-buyer')?.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.getElementById('fv-hauling-new-buyer-name')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('fv-save-hauling-add-buyer')?.click();
      }
    });
    document.getElementById('fv-save-hauling-add-buyer')?.addEventListener('click', saveNewBuyerFromHauling);
  }

  function openAddBuyerModal() {
    installAddBuyerModal();
    showBuyerMessage('');
    document.getElementById(ADD_BUYER_MODAL_ID)?.classList.add('open');
    setTimeout(() => document.getElementById('fv-hauling-new-buyer-name')?.focus(), 0);
  }

  function showBuyerMessage(message) {
    const element = document.getElementById('fv-hauling-add-buyer-message');
    if (!element) return;
    element.textContent = message || '';
    element.className = `hauling-form-message${message ? ' show error' : ''}`;
  }

  async function saveNewBuyerFromHauling() {
    const input = document.getElementById('fv-hauling-new-buyer-name');
    const saveButton = document.getElementById('fv-save-hauling-add-buyer');
    const name = titleCaseName(input?.value);
    if (!name) {
      showBuyerMessage('Enter the buyer or elevator name.');
      input?.focus();
      return;
    }

    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Adding...'; }
    try {
      const buyers = await loadLiveBuyers();
      const duplicate = buyers.find(buyer => buyer.name.toLowerCase() === name.toLowerCase());
      let buyerId = duplicate?.id || '';
      if (!buyerId) {
        const { firebase, db } = await getFirebaseContext();
        buyerId = (await firebase.addDoc(firebase.collection(db, 'grain_buyers'), {
          name,
          createdAt: firebase.serverTimestamp(),
          updatedAt: firebase.serverTimestamp()
        })).id;
      }
      requestCoreHaulingRefresh();
      await delay(800);
      await syncBuyerSelect(buyerId);
      const select = document.getElementById(BUYER_SELECT_ID);
      if (select) {
        select.value = buyerId;
        select.dataset.fvPreviousBuyer = buyerId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncComboButton(select);
      }
      document.getElementById(ADD_BUYER_MODAL_ID)?.classList.remove('open');
    } catch (error) {
      console.error('[Hauling Jobs] add buyer failed:', error);
      showBuyerMessage(error?.message || 'FarmVista could not add that buyer. Please try again.');
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Add Buyer'; }
    }
  }

  function installAddCustomerModal() {
    if (document.getElementById(ADD_CUSTOMER_MODAL_ID)) return;
    const modal = modalShell(
      ADD_CUSTOMER_MODAL_ID,
      'fv-hauling-add-customer-title',
      'Add Sold Under',
      'Add a customer / sold-under name and use it on this hauling job.',
      `<div class="field">
        <label for="fv-hauling-new-customer-name">Sold Under <span class="required">*</span></label>
        <input id="fv-hauling-new-customer-name" type="text" autocomplete="organization" placeholder="Customer or sold-under name" />
      </div>
      <div id="fv-hauling-add-customer-message" class="hauling-form-message"></div>`,
      'fv-save-hauling-add-customer', 'Add Sold Under', 'fv-close-hauling-add-customer', 'fv-cancel-hauling-add-customer'
    );
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      const input = document.getElementById('fv-hauling-new-customer-name');
      if (input) input.value = '';
      showCustomerMessage('');
    };

    document.getElementById('fv-close-hauling-add-customer')?.addEventListener('click', close);
    document.getElementById('fv-cancel-hauling-add-customer')?.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.getElementById('fv-hauling-new-customer-name')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('fv-save-hauling-add-customer')?.click();
      }
    });
    document.getElementById('fv-save-hauling-add-customer')?.addEventListener('click', saveNewCustomerFromHauling);
  }

  function openAddCustomerModal() {
    installAddCustomerModal();
    showCustomerMessage('');
    window.FVCombo?.closeAll?.();
    document.getElementById(ADD_CUSTOMER_MODAL_ID)?.classList.add('open');
    setTimeout(() => document.getElementById('fv-hauling-new-customer-name')?.focus(), 0);
  }

  function showCustomerMessage(message) {
    const element = document.getElementById('fv-hauling-add-customer-message');
    if (!element) return;
    element.textContent = message || '';
    element.className = `hauling-form-message${message ? ' show error' : ''}`;
  }

  async function saveNewCustomerFromHauling() {
    const input = document.getElementById('fv-hauling-new-customer-name');
    const saveButton = document.getElementById('fv-save-hauling-add-customer');
    const name = titleCaseName(input?.value);
    if (!name) {
      showCustomerMessage('Enter the Sold Under / customer name.');
      input?.focus();
      return;
    }

    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Adding...'; }
    try {
      const customers = await loadLiveCustomers();
      const duplicate = customers.find(customer => customer.name.toLowerCase() === name.toLowerCase());
      let customerId = duplicate?.id || '';

      if (!customerId) {
        const { firebase, db } = await getFirebaseContext();
        customerId = (await firebase.addDoc(firebase.collection(db, 'grain_customers'), {
          name,
          createdAt: firebase.serverTimestamp(),
          updatedAt: firebase.serverTimestamp()
        })).id;
      }

      requestCoreHaulingRefresh();
      await delay(900);

      const select = document.getElementById(CUSTOMER_SELECT_ID);
      if (select) {
        putAddCustomerAtTop(select);
        let option = Array.from(select.options).find(item => item.value === customerId);
        if (!option) {
          option = document.createElement('option');
          option.value = customerId;
          option.textContent = name;
          select.appendChild(option);
        }
        select.value = customerId;
        select.dataset.fvPreviousCustomer = customerId;
        window.FVCombo?.upgradeSelect?.(select);
        syncComboButton(select);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      document.getElementById(ADD_CUSTOMER_MODAL_ID)?.classList.remove('open');
    } catch (error) {
      console.error('[Hauling Jobs] add Sold Under failed:', error);
      showCustomerMessage(error?.message || 'FarmVista could not add that Sold Under. Please try again.');
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Add Sold Under'; }
    }
  }

  function installAddLocationModal() {
    if (document.getElementById(ADD_LOCATION_MODAL_ID)) return;
    const modal = modalShell(
      ADD_LOCATION_MODAL_ID,
      'fv-hauling-add-location-title',
      'Add Delivery Location',
      '<span id="fv-hauling-location-buyer-label">Add a delivery location for the selected buyer.</span>',
      `<div class="field">
        <label for="fv-hauling-location-name">Location Name <span class="required">*</span></label>
        <input id="fv-hauling-location-name" type="text" placeholder="Location name" />
      </div>
      <div class="field">
        <label for="fv-hauling-location-street">Street Address <span class="required">*</span></label>
        <input id="fv-hauling-location-street" type="text" autocomplete="street-address" placeholder="Street address" />
      </div>
      <div class="form-grid">
        <div class="field"><label for="fv-hauling-location-zip">ZIP <span class="required">*</span></label><input id="fv-hauling-location-zip" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="ZIP" /></div>
        <div class="field"><label for="fv-hauling-location-city">City <span class="required">*</span></label><input id="fv-hauling-location-city" type="text" autocomplete="address-level2" placeholder="City" /></div>
        <div class="field"><label for="fv-hauling-location-state">State <span class="required">*</span></label><input id="fv-hauling-location-state" type="text" autocomplete="address-level1" maxlength="2" placeholder="IL" /></div>
      </div>
      <div id="fv-hauling-add-location-message" class="hauling-form-message"></div>`,
      'fv-save-hauling-add-location', 'Add Location', 'fv-close-hauling-add-location', 'fv-cancel-hauling-add-location'
    );
    document.body.appendChild(modal);

    const close = () => {
      modal.classList.remove('open');
      ['name', 'street', 'zip', 'city', 'state'].forEach(field => {
        const input = document.getElementById(`fv-hauling-location-${field}`);
        if (input) input.value = '';
      });
      showLocationMessage('');
    };

    document.getElementById('fv-close-hauling-add-location')?.addEventListener('click', close);
    document.getElementById('fv-cancel-hauling-add-location')?.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.getElementById('fv-hauling-location-state')?.addEventListener('input', event => {
      event.target.value = event.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
    });
    document.getElementById('fv-hauling-location-zip')?.addEventListener('input', async event => {
      const input = event.target;
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
      if (input.value.length !== 5) return;
      try {
        const response = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(input.value)}`);
        if (!response.ok) return;
        const data = await response.json();
        const place = data?.places?.[0];
        if (!place) return;
        const city = document.getElementById('fv-hauling-location-city');
        const state = document.getElementById('fv-hauling-location-state');
        if (city) city.value = place['place name'] || '';
        if (state) state.value = place['state abbreviation'] || '';
      } catch (error) {
        console.warn('[Hauling Jobs] ZIP lookup failed:', error);
      }
    });
    document.getElementById('fv-save-hauling-add-location')?.addEventListener('click', saveNewLocationFromHauling);
  }

  function openAddLocationModal() {
    const buyerSelect = document.getElementById(BUYER_SELECT_ID);
    const buyerId = clean(buyerSelect?.value);
    const buyerName = clean(buyerSelect?.selectedOptions?.[0]?.textContent);
    if (!buyerId || buyerId === ADD_BUYER_VALUE) return;
    installAddLocationModal();
    const label = document.getElementById('fv-hauling-location-buyer-label');
    if (label) label.textContent = `Add a delivery location for ${buyerName}.`;
    showLocationMessage('');
    document.getElementById(ADD_LOCATION_MODAL_ID)?.classList.add('open');
    setTimeout(() => document.getElementById('fv-hauling-location-name')?.focus(), 0);
  }

  function showLocationMessage(message) {
    const element = document.getElementById('fv-hauling-add-location-message');
    if (!element) return;
    element.textContent = message || '';
    element.className = `hauling-form-message${message ? ' show error' : ''}`;
  }

  async function saveNewLocationFromHauling() {
    const buyerSelect = document.getElementById(BUYER_SELECT_ID);
    const buyerId = clean(buyerSelect?.value);
    const buyerName = clean(buyerSelect?.selectedOptions?.[0]?.textContent);
    const saveButton = document.getElementById('fv-save-hauling-add-location');
    const locationName = titleCaseName(document.getElementById('fv-hauling-location-name')?.value);
    const street = titleCaseName(document.getElementById('fv-hauling-location-street')?.value);
    const zip = clean(document.getElementById('fv-hauling-location-zip')?.value);
    const city = titleCaseName(document.getElementById('fv-hauling-location-city')?.value);
    const state = clean(document.getElementById('fv-hauling-location-state')?.value).toUpperCase();

    if (!buyerId || buyerId === ADD_BUYER_VALUE) { showLocationMessage('Select Buyer / Elevator first.'); return; }
    if (!locationName || !street || !zip || !city || !state) { showLocationMessage('Complete all delivery location fields.'); return; }
    if (!/^\d{5}$/.test(zip)) { showLocationMessage('ZIP Code must contain 5 numbers.'); return; }
    if (!/^[A-Z]{2}$/.test(state)) { showLocationMessage('State must contain a 2-letter abbreviation.'); return; }

    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Adding...'; }
    try {
      const locations = await loadLiveLocations(buyerId);
      const duplicate = locations.find(location => location.locationName.toLowerCase() === locationName.toLowerCase());
      let locationId = duplicate?.id || '';
      if (!locationId) {
        const { firebase, db } = await getFirebaseContext();
        locationId = (await firebase.addDoc(firebase.collection(db, 'grain_delivery_locations'), {
          buyerId, buyerName, locationName, street, city, state, zip,
          createdAt: firebase.serverTimestamp(), updatedAt: firebase.serverTimestamp()
        })).id;
      }

      requestCoreHaulingRefresh();
      await delay(900);
      const currentBuyer = document.getElementById(BUYER_SELECT_ID);
      if (currentBuyer && currentBuyer.value !== buyerId) {
        currentBuyer.value = buyerId;
        currentBuyer.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(250);
      }
      const locationSelect = document.getElementById(LOCATION_SELECT_ID);
      if (locationSelect) {
        putAddLocationAtTop(locationSelect);
        if (Array.from(locationSelect.options).some(option => option.value === locationId)) {
          locationSelect.value = locationId;
          locationSelect.dataset.fvPreviousLocation = locationId;
          locationSelect.dispatchEvent(new Event('change', { bubbles: true }));
          syncComboButton(locationSelect);
        }
      }
      document.getElementById(ADD_LOCATION_MODAL_ID)?.classList.remove('open');
    } catch (error) {
      console.error('[Hauling Jobs] add delivery location failed:', error);
      showLocationMessage(error?.message || 'FarmVista could not add that location. Please try again.');
    } finally {
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Add Location'; }
    }
  }

  function wireBuyerSelect() {
    const select = document.getElementById(BUYER_SELECT_ID);
    if (!select) return false;
    putAddBuyerAtTop(select);
    if (!buyerSelectWired) {
      buyerSelectWired = true;
      select.addEventListener('change', event => {
        if (event.target.value === ADD_BUYER_VALUE) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.target.value = clean(event.target.dataset.fvPreviousBuyer);
          syncComboButton(event.target);
          openAddBuyerModal();
          return;
        }
        event.target.dataset.fvPreviousBuyer = event.target.value;
        setTimeout(() => putAddLocationAtTop(document.getElementById(LOCATION_SELECT_ID)), 0);
      }, true);
    }
    return true;
  }

  function wireLocationSelect() {
    const select = document.getElementById(LOCATION_SELECT_ID);
    if (!select) return false;
    putAddLocationAtTop(select);
    if (!locationSelectWired) {
      locationSelectWired = true;
      select.addEventListener('change', event => {
        if (event.target.value === ADD_LOCATION_VALUE) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.target.value = clean(event.target.dataset.fvPreviousLocation);
          syncComboButton(event.target);
          openAddLocationModal();
          return;
        }
        event.target.dataset.fvPreviousLocation = event.target.value;
      }, true);
    }

    if (locationObserver) locationObserver.disconnect();
    locationObserver = new MutationObserver(() => {
      locationObserver.disconnect();
      try { putAddLocationAtTop(select); }
      finally { if (select.isConnected) locationObserver.observe(select, { childList: true }); }
    });
    locationObserver.observe(select, { childList: true });
    return true;
  }

  function wireCustomerSelect() {
    const select = document.getElementById(CUSTOMER_SELECT_ID);
    if (!select) return false;
    putAddCustomerAtTop(select);
    upgradeCustomerCombo();
    wireCustomerComboOpenGuard();

    if (!customerSelectWired) {
      customerSelectWired = true;
      select.addEventListener('change', event => {
        if (event.target.value === ADD_CUSTOMER_VALUE) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.target.value = clean(event.target.dataset.fvPreviousCustomer);
          syncComboButton(event.target);
          openAddCustomerModal();
          return;
        }
        event.target.dataset.fvPreviousCustomer = event.target.value;
      }, true);
    }

    if (customerObserver) customerObserver.disconnect();
    customerObserver = new MutationObserver(() => {
      customerObserver.disconnect();
      try {
        putAddCustomerAtTop(select);
        window.FVCombo?.upgradeSelect?.(select);
        wireCustomerComboOpenGuard();
        setTimeout(ensureAddSoldUnderRowInOpenCombo, 0);
      } finally {
        if (select.isConnected) customerObserver.observe(select, { childList: true });
      }
    });
    customerObserver.observe(select, { childList: true });
    return true;
  }

  function resetAddHaulingJobForm() {
    const form = document.getElementById('hauling-job-form');
    if (!form) return;
    form.reset();

    const editId = document.getElementById('hauling-job-edit-id');
    const buyer = document.getElementById(BUYER_SELECT_ID);
    const location = document.getElementById(LOCATION_SELECT_ID);
    const customer = document.getElementById(CUSTOMER_SELECT_ID);
    const crop = document.getElementById('hauling-job-crop');
    const bushels = document.getElementById('hauling-job-bushels');
    const start = document.getElementById('hauling-job-start-date');
    const end = document.getElementById('hauling-job-end-date');
    const message = document.getElementById('hauling-job-form-message');

    if (editId) editId.value = '';
    if (buyer) { buyer.value = ''; buyer.dataset.fvPreviousBuyer = ''; syncComboButton(buyer); }
    if (location) {
      location.innerHTML = '<option value="">Select buyer first</option>';
      location.value = '';
      location.disabled = true;
      location.dataset.fvPreviousLocation = '';
      syncComboButton(location);
    }
    if (customer) {
      customer.value = '';
      customer.dataset.fvPreviousCustomer = '';
      putAddCustomerAtTop(customer);
      syncComboButton(customer);
    }
    if (crop) { crop.value = ''; syncComboButton(crop); }
    if (bushels) bushels.value = '';
    if (start) start.value = '';
    if (end) end.value = '';
    if (message) { message.textContent = ''; message.className = 'hauling-form-message'; }
    window.FVCombo?.closeAll?.();
  }

  function wireFreshAddJobReset() {
    const button = document.getElementById('add-hauling-job-btn');
    if (!button || addJobResetWired) return false;
    addJobResetWired = true;
    button.addEventListener('click', resetAddHaulingJobForm, true);
    return true;
  }

  function layoutHaulingJobModal() {
    const bushelsField = document.getElementById('hauling-job-bushels')?.closest('.field');
    if (bushelsField) bushelsField.classList.add('span-2');
  }

  function moveContractActionsIntoCard() {
    const group = document.querySelector('.workflow-group.grain-ticket-group');
    const actions = group?.querySelector(':scope > .workflow-group-head .page-heading-actions');
    const firstBlock = group?.querySelector(':scope > .workflow-block');
    const firstBlockHead = firstBlock?.querySelector(':scope > .workflow-block-head');
    if (!actions || !firstBlock || !firstBlockHead) return false;
    actions.classList.add('fv-contract-card-actions');
    firstBlockHead.insertAdjacentElement('afterend', actions);
    return true;
  }

  function wireVoidedIntoStatusFilter() {
    const status = document.getElementById('status-filter');
    const checkbox = document.getElementById('show-voided-checkbox');
    if (!status || !checkbox) return false;

    if (!Array.from(status.options).some(option => option.value === 'voided')) {
      const option = document.createElement('option');
      option.value = 'voided';
      option.textContent = 'Voided';
      status.appendChild(option);
    }

    const oldToggle = checkbox.closest('.show-voided-toggle');
    if (oldToggle) { oldToggle.style.display = 'none'; oldToggle.setAttribute('aria-hidden', 'true'); }

    const syncVoidedState = () => {
      const wantsVoided = status.value === 'voided';
      if (checkbox.checked === wantsVoided) return;
      checkbox.checked = wantsVoided;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (!contractStatusVoidedWired) {
      contractStatusVoidedWired = true;
      status.addEventListener('change', syncVoidedState);
    }
    syncVoidedState();
    return true;
  }

  function watchHaulingJobModal() {
    const modal = document.getElementById(JOB_MODAL_ID);
    if (!modal) return false;

    wireBuyerSelect();
    wireLocationSelect();
    wireCustomerSelect();
    layoutHaulingJobModal();

    if (jobModalObserver) jobModalObserver.disconnect();
    jobModalObserver = new MutationObserver(() => {
      if (!modal.classList.contains('open')) return;
      wireCustomerSelect();
      layoutHaulingJobModal();
      syncBuyerSelect();
      setTimeout(() => {
        putAddLocationAtTop(document.getElementById(LOCATION_SELECT_ID));
        wireCustomerSelect();
        layoutHaulingJobModal();
      }, 700);
    });
    jobModalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
    return true;
  }

  function installContractsDarkThemeFix() {
    if (document.getElementById('fv-grain-contracts-dark-theme-fix')) return;
    const style = document.createElement('style');
    style.id = 'fv-grain-contracts-dark-theme-fix';
    style.textContent = `
      #${JOB_MODAL_ID} .modal-card,
      #${JOB_MODAL_ID} .modal-body,
      #${JOB_MODAL_ID} .form-grid,
      #${JOB_MODAL_ID} .field {
        overflow:visible !important;
      }
      #${JOB_MODAL_ID} .fv-panel {
        z-index:10050 !important;
      }
      #${JOB_MODAL_ID} .fv-panel .fv-list,
      #fv-portal-root .fv-panel .fv-list {
        max-height:min(360px,52vh) !important;
        overflow-y:auto !important;
        overflow-x:hidden !important;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        scrollbar-gutter:stable;
      }
      .grain-ticket-group .workflow-block > .fv-contract-card-actions {
        margin:0 0 12px;
        justify-content:flex-end;
      }
      html.dark .compact-summary, html[data-theme="dark"] .compact-summary,
      html.dark .hauling-dnd-message, html[data-theme="dark"] .hauling-dnd-message,
      html.dark .dnd-toolbar, html[data-theme="dark"] .dnd-toolbar,
      html.dark .reconcile-filter-message, html[data-theme="dark"] .reconcile-filter-message,
      html.dark .contract-stat, html[data-theme="dark"] .contract-stat,
      html.dark .contract-average-block, html[data-theme="dark"] .contract-average-block,
      html.dark .modal-summary-item, html[data-theme="dark"] .modal-summary-item,
      html.dark .ticket-detail-item, html[data-theme="dark"] .ticket-detail-item,
      html.dark .edit-pricing-box, html[data-theme="dark"] .edit-pricing-box,
      html.dark .assigned-ticket-item, html[data-theme="dark"] .assigned-ticket-item {
        background:#18231b !important; color:#eef4ef !important; border-color:#314137 !important;
      }
      html.dark .dnd-column, html[data-theme="dark"] .dnd-column,
      html.dark .hauling-dnd-column, html[data-theme="dark"] .hauling-dnd-column,
      html.dark .workflow-group, html[data-theme="dark"] .workflow-group {
        background:#111a14 !important; color:#eef4ef !important; border-color:#314137 !important;
      }
      html.dark .dnd-column-head, html[data-theme="dark"] .dnd-column-head,
      html.dark .hauling-dnd-column-head, html[data-theme="dark"] .hauling-dnd-column-head {
        background:#1b271e !important; color:#eef4ef !important; border-color:#314137 !important;
      }
      html.dark .dnd-column-title, html[data-theme="dark"] .dnd-column-title,
      html.dark .dnd-column-count, html[data-theme="dark"] .dnd-column-count,
      html.dark .hauling-dnd-column-title, html[data-theme="dark"] .hauling-dnd-column-title,
      html.dark .hauling-dnd-column-count, html[data-theme="dark"] .hauling-dnd-column-count,
      html.dark .compact-summary-label, html[data-theme="dark"] .compact-summary-label,
      html.dark .compact-summary-value, html[data-theme="dark"] .compact-summary-value {
        color:#eef4ef !important;
      }
      html.dark .hauling-contract-card, html[data-theme="dark"] .hauling-contract-card,
      html.dark .hauling-job-drop-card, html[data-theme="dark"] .hauling-job-drop-card,
      html.dark .contract-drop-card, html[data-theme="dark"] .contract-drop-card,
      html.dark .ticket-card, html[data-theme="dark"] .ticket-card {
        background:#111a14 !important; color:#eef4ef !important; border-color:#314137 !important;
      }
      html.dark #${ADD_BUYER_MODAL_ID} .modal-card,
      html[data-theme="dark"] #${ADD_BUYER_MODAL_ID} .modal-card,
      html.dark #${ADD_LOCATION_MODAL_ID} .modal-card,
      html[data-theme="dark"] #${ADD_LOCATION_MODAL_ID} .modal-card,
      html.dark #${ADD_CUSTOMER_MODAL_ID} .modal-card,
      html[data-theme="dark"] #${ADD_CUSTOMER_MODAL_ID} .modal-card {
        background:#111a14 !important; color:#eef4ef !important; border-color:#314137 !important;
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
    const linkedCustomers = parts.filter(value => value.toLowerCase() !== 'unknown');
    const nextText = linkedCustomers.length ? linkedCustomers.join(' / ') : '-';
    if (String(cell.textContent || '').trim() !== nextText) cell.textContent = nextText;
  }

  function cleanTable() {
    const body = document.getElementById(TABLE_BODY_ID);
    if (!body) return;
    body.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll(':scope > td');
      if (cells.length >= 5) cleanSoldUnderCell(cells[4]);
    });
  }

  function attachToTable() {
    const body = document.getElementById(TABLE_BODY_ID);
    if (!body) return false;
    cleanTable();
    if (tableObserver) tableObserver.disconnect();
    tableObserver = new MutationObserver(cleanTable);
    tableObserver.observe(body, { childList: true, subtree: true, characterData: true });
    return true;
  }

  function boot() {
    installContractsDarkThemeFix();
    installAddBuyerModal();
    installAddLocationModal();
    installAddCustomerModal();
    wireBuyerSelect();
    wireLocationSelect();
    wireCustomerSelect();
    wireFreshAddJobReset();
    layoutHaulingJobModal();
    moveContractActionsIntoCard();
    wireVoidedIntoStatusFilter();
    watchHaulingJobModal();

    if (!attachToTable()) {
      const pageObserver = new MutationObserver(() => {
        wireBuyerSelect();
        wireLocationSelect();
        wireCustomerSelect();
        wireFreshAddJobReset();
        layoutHaulingJobModal();
        moveContractActionsIntoCard();
        wireVoidedIntoStatusFilter();
        watchHaulingJobModal();
        if (attachToTable()) pageObserver.disconnect();
      });
      pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();