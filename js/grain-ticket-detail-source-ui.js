import {
  ready,
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs
} from '/js/firebase-init.js';

const path = String(location.pathname || '').toLowerCase();
if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) {
  // This module is only for the grain ticket detail page.
} else {
  const params = new URLSearchParams(location.search);
  const ticketId = String(params.get('id') || '').trim();

  const clean = value => String(value == null ? '' : value).trim();
  const norm = value => clean(value).toLowerCase();

  let desiredFieldName = '';
  let fieldChoices = [];
  let menuObserver = null;
  let labelObserver = null;
  let applyingLabel = false;
  let fieldsById = new Map();

  const sourceButtonText = () => document.getElementById('grainSourceButtonText');
  const sourceMenu = () => document.getElementById('grainSourceMenu');

  function parseFieldIdFromValue(value) {
    const parts = clean(value).split(':').map(clean);
    return (
      norm(parts[0]) === 'active_field_harvest' &&
      norm(parts[1]) === 'field' &&
      parts[2]
    ) ? parts[2] : '';
  }

  async function loadFieldIndex() {
    try {
      await ready;
      const db = getFirestore();
      const snap = await getDocs(collection(db, 'fields'));
      fieldsById = new Map();
      snap.forEach(ds => {
        const data = ds.data() || {};
        const name = clean(data.name);
        if (name) fieldsById.set(ds.id, name);
      });
    } catch (error) {
      console.warn('[FarmVista] Could not load field names for ticket detail:', error);
    }
  }

  function moveHaulingJobUnderLoadNumber() {
    const loadNumberSelect = document.getElementById('loadNumberSelect');
    const haulingJobSelect = document.getElementById('contractSelect');

    const loadField = loadNumberSelect?.closest('.field');
    const haulingJobField = haulingJobSelect?.closest('.field');

    if (!loadField || !haulingJobField || loadField === haulingJobField) return;

    if (loadField.nextElementSibling !== haulingJobField) {
      loadField.insertAdjacentElement('afterend', haulingJobField);
    }
  }

  function setDisplayedFieldName() {
    const label = sourceButtonText();
    if (!label || applyingLabel) return;

    const current = clean(label.textContent);

    if (desiredFieldName) {
      if (current === desiredFieldName) return;
      applyingLabel = true;
      label.textContent = desiredFieldName;
      applyingLabel = false;
      return;
    }

    if (norm(current) === 'active field harvest') {
      applyingLabel = true;
      label.textContent = 'Active Harvest';
      applyingLabel = false;
    }
  }

  function stopShowingSavedField() {
    desiredFieldName = '';
    requestAnimationFrame(setDisplayedFieldName);
  }

  function closeFieldModal() {
    document.getElementById('ticket-field-source-backdrop')?.remove();
  }

  function openFieldModal() {
    closeFieldModal();

    const backdrop = document.createElement('div');
    backdrop.id = 'ticket-field-source-backdrop';
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '15050',
      background: 'rgba(0,0,0,.58)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      width: 'min(620px,100%)',
      maxHeight: '82vh',
      overflow: 'hidden',
      borderRadius: '16px',
      background: 'var(--surface,#fff)',
      color: 'var(--text,#1f2521)',
      border: '1px solid var(--border,#d7ddd8)',
      boxShadow: '0 22px 60px rgba(0,0,0,.34)',
      display: 'flex',
      flexDirection: 'column'
    });

    const head = document.createElement('div');
    Object.assign(head.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '16px',
      borderBottom: '1px solid var(--border,#d7ddd8)'
    });

    const title = document.createElement('div');
    title.innerHTML = '<div style="font-size:18px;font-weight:900;">Fields</div><div style="font-size:12px;color:var(--muted,#87908a);margin-top:3px;">Choose the field this ticket came from.</div>';

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    Object.assign(close.style, {
      width: '40px',
      height: '40px',
      border: '0',
      borderRadius: '10px',
      background: 'var(--surface-2,#eef1ee)',
      color: 'inherit',
      fontSize: '24px',
      lineHeight: '1',
      cursor: 'pointer'
    });
    close.addEventListener('click', closeFieldModal);

    head.append(title, close);

    const searchWrap = document.createElement('div');
    Object.assign(searchWrap.style, {
      padding: '12px 14px',
      borderBottom: '1px solid var(--border,#d7ddd8)'
    });

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search field name or number…';
    input.autocomplete = 'off';
    Object.assign(input.style, {
      width: '100%',
      minHeight: '46px',
      boxSizing: 'border-box',
      border: '1px solid var(--border,#c8c8c8)',
      borderRadius: '10px',
      background: 'var(--surface,#fff)',
      color: 'inherit',
      padding: '10px 12px',
      font: 'inherit'
    });
    searchWrap.appendChild(input);

    const list = document.createElement('div');
    Object.assign(list.style, {
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: '4px 0',
      minHeight: '120px'
    });

    function renderList() {
      const search = norm(input.value);
      const filtered = fieldChoices.filter(item =>
        !search || norm(`${item.label} ${item.searchText || ''}`).includes(search)
      );

      list.innerHTML = '';

      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.textContent = search ? 'No matching fields.' : 'No active fields found.';
        Object.assign(empty.style, {
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--muted,#87908a)',
          fontWeight: '700'
        });
        list.appendChild(empty);
        return;
      }

      filtered.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        Object.assign(button.style, {
          width: '100%',
          border: '0',
          borderBottom: '1px solid var(--border,#e1e1e1)',
          background: 'var(--surface,#fff)',
          color: 'inherit',
          padding: '14px 16px',
          font: 'inherit',
          fontWeight: '750',
          textAlign: 'left',
          cursor: 'pointer'
        });

        button.addEventListener('click', () => {
          desiredFieldName = item.label;
          closeFieldModal();
          item.originalButton.click();
          requestAnimationFrame(setDisplayedFieldName);
          setTimeout(setDisplayedFieldName, 0);
          setTimeout(setDisplayedFieldName, 100);
        });

        list.appendChild(button);
      });
    }

    input.addEventListener('input', renderList);

    modal.append(head, searchWrap, list);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeFieldModal();
    });

    renderList();
    requestAnimationFrame(() => input.focus());
  }

  function compactSourceMenu() {
    const menu = sourceMenu();
    if (!menu) return;

    const allButtons = Array.from(menu.querySelectorAll('.load-picker-choice'));
    if (!allButtons.length) return;

    /* One visible name everywhere: Active Harvest. */
    allButtons.forEach(button => {
      const value = clean(button.dataset.sourceValue);
      if (
        value.startsWith('active_field_harvest') &&
        !value.startsWith('active_field_harvest:field:') &&
        norm(button.textContent) === 'active field harvest'
      ) {
        button.textContent = 'Active Harvest';
      }
    });

    const freshFieldChoices = allButtons
      .filter(button => clean(button.dataset.sourceValue).startsWith('active_field_harvest:field:'))
      .map(button => {
        const value = clean(button.dataset.sourceValue);
        const fieldId = parseFieldIdFromValue(value);
        const canonicalName = fieldsById.get(fieldId);
        if (canonicalName) button.textContent = canonicalName;

        return {
          value,
          label: canonicalName || clean(button.textContent),
          searchText: canonicalName || clean(button.textContent),
          originalButton: button
        };
      })
      .filter(item => item.label);

    if (freshFieldChoices.length) {
      fieldChoices = freshFieldChoices;

      freshFieldChoices.forEach(item => {
        item.originalButton.style.display = 'none';
      });

      let fieldsButton = menu.querySelector('[data-fv-fields-drill="1"]');
      if (!fieldsButton) {
        fieldsButton = document.createElement('button');
        fieldsButton.type = 'button';
        fieldsButton.className = 'load-picker-choice';
        fieldsButton.dataset.fvFieldsDrill = '1';
        fieldsButton.textContent = 'Fields';
        fieldsButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          menu.classList.remove('open');
          document.getElementById('grainSourceButton')?.setAttribute('aria-expanded', 'false');
          openFieldModal();
        });

        const genericHarvest = allButtons.find(button => {
          const value = clean(button.dataset.sourceValue);
          return value.startsWith('active_field_harvest') && !value.startsWith('active_field_harvest:field:');
        });

        if (genericHarvest?.nextSibling) {
          menu.insertBefore(fieldsButton, genericHarvest.nextSibling);
        } else if (genericHarvest) {
          genericHarvest.parentNode?.appendChild(fieldsButton);
        } else {
          const searchWrap = menu.querySelector('.load-picker-search-wrap');
          if (searchWrap?.nextSibling) menu.insertBefore(fieldsButton, searchWrap.nextSibling);
          else menu.appendChild(fieldsButton);
        }
      }
    }

    allButtons.forEach(button => {
      if (button.dataset.fvClearFieldBound === '1') return;
      const value = clean(button.dataset.sourceValue);
      if (!value || value.startsWith('active_field_harvest:field:')) return;
      button.dataset.fvClearFieldBound = '1';
      button.addEventListener('click', stopShowingSavedField, { capture: true });
    });

    setDisplayedFieldName();
  }

  async function loadSavedFieldName() {
    if (!ticketId) return;

    try {
      await ready;
      const db = getFirestore();
      const snap = await getDoc(doc(db, 'grain_tickets', ticketId));
      if (!snap.exists()) return;

      const ticket = snap.data() || {};
      const sourceValue = clean(ticket.grainSourceValue || ticket.grainSource?.value);
      const fieldId = clean(
        ticket.grainSourceFieldId ||
        ticket.fieldId ||
        ticket.grainSource?.fieldId ||
        parseFieldIdFromValue(sourceValue)
      );

      /*
        Only show a saved Field when it resolves to a real /fields document.
        Never turn generic labels such as "Active Field Harvest" into a field.
      */
      desiredFieldName = fieldId ? clean(fieldsById.get(fieldId)) : '';

      setDisplayedFieldName();
    } catch (error) {
      console.warn('[FarmVista] Could not resolve saved grain ticket field label:', error);
    }
  }

  function startObservers() {
    const label = sourceButtonText();
    const menu = sourceMenu();

    if (label && !labelObserver) {
      labelObserver = new MutationObserver(() => {
        if (!applyingLabel) setDisplayedFieldName();
      });
      labelObserver.observe(label, { childList: true, characterData: true, subtree: true });
    }

    if (menu && !menuObserver) {
      menuObserver = new MutationObserver(() => compactSourceMenu());
      menuObserver.observe(menu, { childList: true, subtree: true });
      compactSourceMenu();
    }
  }

  async function boot() {
    moveHaulingJobUnderLoadNumber();
    await loadFieldIndex();
    startObservers();
    await loadSavedFieldName();
    setTimeout(moveHaulingJobUnderLoadNumber, 250);
    setTimeout(startObservers, 250);
    setTimeout(startObservers, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('pagehide', () => {
    labelObserver?.disconnect();
    menuObserver?.disconnect();
    closeFieldModal();
  }, { once: true });
}
