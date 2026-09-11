import {
  ready,
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs
} from '/js/firebase-init.js';

const path = String(location.pathname || '').toLowerCase();

if (path.endsWith('/pages/grain/grain-ticket-detail.html')) {
  const params = new URLSearchParams(location.search);
  const ticketId = String(params.get('id') || '').trim();

  const clean = value => String(value == null ? '' : value).trim();
  const norm = value => clean(value).toLowerCase();

  let desiredFieldName = '';
  let fieldChoices = [];
  let fieldsById = new Map();

  let menuObserver = null;
  let labelObserver = null;
  let menuRaf = 0;
  let disposed = false;

  const sourceButtonText = () => document.getElementById('grainSourceButtonText');
  const sourceMenu = () => document.getElementById('grainSourceMenu');
  const sourceValueInput = () => document.getElementById('grainSourceValue');
  const cropSelect = () => document.getElementById('ticketCrop');

  function cropKey() {
    return norm(cropSelect()?.value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /*
    SEPT 11, 2026 — ACTIVE HARVEST CANONICAL VALUE

    Load-outs created by the dispatch flow can store the generic source value
    as exactly "active_field_harvest" while Ticket Detail's live Harvest item
    is crop-qualified (for example active_field_harvest:soybeans).

    The old Ticket Detail fallback treated an unmatched saved value as a grain
    bag. That produced a bogus "Grain Bags -> Active Harvest" choice and sent
    Save through grain-bag inventory validation.

    Normalize only the generic Active Harvest value. Real field, bin and bag
    values are left completely untouched.
  */
  function normalizeGenericActiveHarvestValue() {
    const input = sourceValueInput();
    const crop = cropKey();
    if (!input || !crop) return false;

    const current = clean(input.value);
    const currentNorm = norm(current).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    if (currentNorm !== 'active_field_harvest') return false;

    const canonical = `active_field_harvest:${crop}`;
    if (input.value !== canonical) input.value = canonical;

    writeDisplayedLabel('Active Harvest');
    return true;
  }

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

  function observeLabel() {
    if (disposed || !labelObserver) return;
    const label = sourceButtonText();
    if (!label) return;

    labelObserver.observe(label, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function writeDisplayedLabel(text) {
    const label = sourceButtonText();
    if (!label || clean(label.textContent) === text) return;

    labelObserver?.disconnect();
    label.textContent = text;
    observeLabel();
  }

  function setDisplayedFieldName() {
    const label = sourceButtonText();
    if (!label) return;

    const current = clean(label.textContent);

    if (desiredFieldName) {
      writeDisplayedLabel(desiredFieldName);
      return;
    }

    if (
      norm(current) === 'active field harvest' ||
      norm(current) === 'active harvest'
    ) {
      writeDisplayedLabel('Active Harvest');
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

  function observeMenu() {
    if (disposed || !menuObserver) return;
    const menu = sourceMenu();
    if (!menu) return;

    menuObserver.observe(menu, {
      childList: true,
      subtree: true
    });
  }

  function compactSourceMenu() {
    const menu = sourceMenu();
    if (!menu || disposed) return;

    menuObserver?.disconnect();

    try {
      normalizeGenericActiveHarvestValue();

      const allButtons = Array.from(menu.querySelectorAll('.load-picker-choice'));
      if (!allButtons.length) return;

      const canonicalHarvestValue = `active_field_harvest:${cropKey()}`;

      allButtons.forEach(button => {
        const value = clean(button.dataset.sourceValue);

        /* Remove the stale historical fallback that used to land in Grain Bags. */
        if (value === 'active_field_harvest') {
          button.style.display = 'none';
          return;
        }

        if (
          value === canonicalHarvestValue &&
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

          if (canonicalName && clean(button.textContent) !== canonicalName) {
            button.textContent = canonicalName;
          }

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
          if (item.originalButton.style.display !== 'none') {
            item.originalButton.style.display = 'none';
          }
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
            return value.startsWith('active_field_harvest') && !value.startsWith('active_field_harvest:field:') && value !== 'active_field_harvest';
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
    } finally {
      observeMenu();
    }
  }

  function scheduleCompactSourceMenu() {
    if (disposed || menuRaf) return;

    menuRaf = requestAnimationFrame(() => {
      menuRaf = 0;
      compactSourceMenu();
    });
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
        if (disposed) return;
        requestAnimationFrame(() => {
          normalizeGenericActiveHarvestValue();
          setDisplayedFieldName();
        });
      });
      observeLabel();
    }

    if (menu && !menuObserver) {
      menuObserver = new MutationObserver(scheduleCompactSourceMenu);
      observeMenu();
      scheduleCompactSourceMenu();
    }
  }

  async function boot() {
    moveHaulingJobUnderLoadNumber();
    await loadFieldIndex();
    normalizeGenericActiveHarvestValue();
    startObservers();
    await loadSavedFieldName();

    /* Bounded retries only; no polling loop. */
    setTimeout(() => {
      normalizeGenericActiveHarvestValue();
      moveHaulingJobUnderLoadNumber();
      scheduleCompactSourceMenu();
    }, 250);
    setTimeout(() => {
      normalizeGenericActiveHarvestValue();
      startObservers();
      scheduleCompactSourceMenu();
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('pagehide', () => {
    disposed = true;
    if (menuRaf) cancelAnimationFrame(menuRaf);
    labelObserver?.disconnect();
    menuObserver?.disconnect();
    closeFieldModal();
  }, { once: true });
}
