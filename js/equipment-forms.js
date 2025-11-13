// =====================================================================
// /Farm-vista/js/equipment-forms.js
// Shared equipment field + layout engine for Add / Edit / View / Hub
// Rev: 2025-11-13b
//
// Ordering rules (DANE RULE):
//  1–4 always on top:  Make, Model, Year, Serial
//  5–7 always at end: Notes, Photos, QR
//  All type-specific extras fall in the middle.
// =====================================================================
(function (window) {
  'use strict';

  // ------------------------------------------------------------
  // Field library: define each possible field ONCE
  // ------------------------------------------------------------
  const EQUIP_FIELDS = {
    // Core common fields
    make: {
      id: 'make',
      label: 'Make',
      type: 'text',
      required: true
    },
    model: {
      id: 'model',
      label: 'Model',
      type: 'text',
      required: true
    },
    year: {
      id: 'year',
      label: 'Year',
      type: 'number'
    },
    serial: {
      id: 'serial',
      label: 'Serial #',
      type: 'text'
    },
    notes: {
      id: 'notes',
      label: 'Notes',
      type: 'textarea'
    },

    // Special rows that your current layout already handles
    photos: {
      id: 'photos',
      label: 'Photos',
      type: 'file-multi',
      special: true // handled by existing UI
    },
    qr: {
      id: 'qr',
      label: 'QR Code',
      type: 'qr',
      special: true // handled by existing UI
    },

    // Service / usage metrics
    engineHours: {
      id: 'engineHours',
      label: 'Engine Hours',
      type: 'number'
    },
    sepHours: {
      id: 'sepHours',
      label: 'Separator Hours',
      type: 'number'
    },
    miles: {
      id: 'miles',
      label: 'Miles',
      type: 'number'
    },
    serviceDate: {
      id: 'serviceDate',
      label: 'Date of Service',
      type: 'date'
    },
    acres: {
      id: 'acres',
      label: 'Acres',
      type: 'number'
    },

    // Implement "Type" (hard-coded dropdown)
    implType: {
      id: 'implType',
      label: 'Type',
      type: 'select',
      options: [
        'Planter',
        'Tillage',
        'Grain Cart',
        'Header',
        'Auger / Conveyor',
        'Other'
      ],
      required: true
    }

    // Future: add more here (DEF level, GPS receiver, PTO hours, etc.)
  };

  // Top + bottom anchors for ALL equipment
  const CORE_TOP = ['make', 'model', 'year', 'serial'];
  const CORE_BOTTOM = ['notes', 'photos', 'qr'];

  // ------------------------------------------------------------
  // Layouts: define extras; system will assemble full field order
  //   Final order for Add/Edit:
  //     [make, model, year, serial, ...extras..., notes, photos, qr]
  //   Final order for View:
  //     [make, model, year, serial, ...extras..., notes]
  // ------------------------------------------------------------
  const EQUIP_LAYOUTS = {
    tractor: {
      label: 'Tractor',
      slug: 'tractor',
      extras: ['engineHours'], // middle
      hubBadges: ['engineHours'],
      hubActions: ['updateHours']
    },

    combine: {
      label: 'Combine',
      slug: 'combine',
      extras: ['engineHours', 'sepHours'],
      hubBadges: ['engineHours', 'sepHours'],
      hubActions: ['updateHours']
    },

    sprayer: {
      label: 'Sprayer',
      slug: 'sprayer',
      extras: ['engineHours', 'acres'],
      hubBadges: ['engineHours', 'acres'],
      hubActions: ['updateHours', 'updateAcres']
    },

    truck: {
      label: 'Truck',
      slug: 'truck',
      extras: ['miles'],
      hubBadges: ['miles'],
      hubActions: ['updateMiles']
    },

    implement: {
      label: 'Implement',
      slug: 'implement',
      extras: ['implType'],
      hubBadges: ['implType'],
      hubActions: []
    }

    // Future: add 'trailer', 'construction', 'rtkBase', etc. here.
  };

  // Build addFields/editFields/viewFields for each layout
  Object.keys(EQUIP_LAYOUTS).forEach(key => {
    const layout = EQUIP_LAYOUTS[key];
    const extras = layout.extras || [];

    // 1–4 top, extras middle, 5–7 bottom (for add/edit)
    layout.addFields = [...CORE_TOP, ...extras, ...CORE_BOTTOM];
    layout.editFields = [...CORE_TOP, ...extras, ...CORE_BOTTOM];

    // View: same rule, but we only need up through Notes
    // (photos & QR are special and not rendered for view)
    layout.viewFields = [...CORE_TOP, ...extras, 'notes'];
  });

  // ------------------------------------------------------------
  // Helpers: type detection, query param parsing, etc.
  // ------------------------------------------------------------
  function getQueryParam(name) {
    if (typeof window === 'undefined' || !window.location) return null;
    const params = new URLSearchParams(window.location.search || '');
    return params.get(name);
  }

  /**
   * Get equipment type from page:
   *  • Prefer data-equip-type on a root element (like #equip-form-root)
   *  • Fallback to ?type= in the URL
   *  • Fallback to 'tractor'
   */
  function detectEquipType(rootSelector) {
    rootSelector = rootSelector || '#equip-form-root';
    const root = document.querySelector(rootSelector);
    const fromAttr = root && root.dataset && root.dataset.equipType;
    const fromQuery = getQueryParam('type');
    const candidate = (fromAttr || fromQuery || 'tractor').toLowerCase();
    return EQUIP_LAYOUTS[candidate] ? candidate : 'tractor';
  }

  function getLayout(equipType) {
    return EQUIP_LAYOUTS[equipType] || null;
  }

  function getField(fieldId) {
    return EQUIP_FIELDS[fieldId] || null;
  }

  // ------------------------------------------------------------
  // DOM builders: form fields + hub card
  // ------------------------------------------------------------
  function buildFieldRow(def, mode, doc) {
    const isView = mode === 'view';
    const value = doc && Object.prototype.hasOwnProperty.call(doc, def.id)
      ? doc[def.id]
      : '';

    const row = document.createElement('div');
    row.className = 'fv-field-row';
    row.dataset.fieldId = def.id;

    const label = document.createElement('label');
    label.className = 'fv-field-label';
    label.setAttribute('for', def.id);
    label.textContent = def.label;
    row.appendChild(label);

    let inputEl;

    if (isView) {
      // Simple read-only value
      const span = document.createElement('div');
      span.className = 'fv-field-value';
      span.textContent = value == null || value === '' ? '—' : String(value);
      row.appendChild(span);
      return row;
    }

    // Editable (add/edit)
    switch (def.type) {
      case 'text':
      case 'number':
      case 'date': {
        const input = document.createElement('input');
        input.className = 'fv-field-input';
        input.type = def.type;
        input.id = def.id;
        input.name = def.id;
        if (value != null && value !== '') input.value = value;
        if (def.required) input.required = true;
        inputEl = input;
        break;
      }

      case 'textarea': {
        const ta = document.createElement('textarea');
        ta.className = 'fv-field-input fv-field-textarea';
        ta.id = def.id;
        ta.name = def.id;
        if (value != null && value !== '') ta.value = value;
        if (def.required) ta.required = true;
        inputEl = ta;
        break;
      }

      case 'select': {
        const sel = document.createElement('select');
        sel.className = 'fv-field-input fv-field-select';
        sel.id = def.id;
        sel.name = def.id;
        if (def.required) sel.required = true;

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select...';
        sel.appendChild(placeholder);

        (def.options || []).forEach(optVal => {
          const opt = document.createElement('option');
          opt.value = optVal;
          opt.textContent = optVal;
          if (String(value) === String(optVal)) {
            opt.selected = true;
          }
          sel.appendChild(opt);
        });

        inputEl = sel;
        break;
      }

      case 'file-multi':
      case 'qr':
        // Special fields (photos/qr) are currently handled elsewhere.
        // We skip auto-building these to avoid clashing with your existing
        // Tractor layout. This row can be used later if needed.
        return null;

      default:
        // Unknown type – skip
        return null;
    }

    if (inputEl) {
      row.appendChild(inputEl);
    }
    return row;
  }

  /**
   * Render form fields into a container for a given mode:
   *  • mode: 'add' | 'edit' | 'view'
   *  • equipType: 'tractor' | 'combine' | 'sprayer' | 'truck' | 'implement' | ...
   *  • container: element that will hold the rows
   *  • doc: optional object with existing values (for edit/view)
   */
  function renderForm(options) {
    const mode = options.mode || 'add';
    const equipType = options.equipType || detectEquipType(options.rootSelector);
    const container = options.container;
    const doc = options.doc || null;

    if (!container) {
      console.warn('[FVEquipForms] renderForm: container is required');
      return;
    }

    const layout = getLayout(equipType);
    if (!layout) {
      console.warn('[FVEquipForms] No layout for type:', equipType);
      return;
    }

    const fieldList =
      mode === 'edit' ? layout.editFields :
      mode === 'view' ? layout.viewFields :
      layout.addFields;

    container.innerHTML = '';

    fieldList.forEach(fieldId => {
      const def = getField(fieldId);
      if (!def) return;

      // Skip special fields (photos, qr) – handled by existing UI
      if (def.special) return;

      const row = buildFieldRow(def, mode, doc);
      if (row) {
        container.appendChild(row);
      }
    });
  }

  // ------------------------------------------------------------
  // Payload builder – for Add/Edit saves
  // ------------------------------------------------------------
  function buildPayload(equipType, formEl) {
    const layout = getLayout(equipType);
    if (!layout || !formEl) return {};

    const doc = {
      type: equipType
    };

    const allFieldIds = new Set([
      ...layout.addFields,
      ...layout.editFields
    ]);

    allFieldIds.forEach(fieldId => {
      const def = getField(fieldId);
      if (!def) return;

      // Special fields (photos/qr) are handled elsewhere
      if (def.type === 'file-multi' || def.type === 'qr' || def.special) {
        return;
      }

      const input = formEl.querySelector(`[name="${def.id}"]`);
      if (!input) return;

      let val = input.value;
      if (def.type === 'number') {
        val = val === '' ? null : Number(val);
      }
      doc[def.id] = val === '' ? null : val;
    });

    return doc;
  }

  // ------------------------------------------------------------
  // Hub card builder – returns a DOM element
  // ------------------------------------------------------------
  function hubActionLabel(actionId) {
    switch (actionId) {
      case 'updateHours': return 'Update Hours';
      case 'updateMiles': return 'Update Miles';
      case 'updateAcres': return 'Update Acres';
      default: return actionId;
    }
  }

  /**
   * Build a hub card DOM node for a given equipment doc.
   *  • equipType: used to decide which badges/actions to show
   *  • doc: Firestore document data (must include make/model/year/etc.)
   *  • options:
   *      - onAction(actionId, doc): click handler for hub buttons
   */
  function buildHubCard(equipType, doc, options) {
    const layout = getLayout(equipType);
    if (!layout) return null;

    const onAction = options && options.onAction;

    const card = document.createElement('article');
    card.className = 'equip-card';

    // Title: "Year Make Model"
    const title = document.createElement('h3');
    title.className = 'equip-card-title';
    const year = doc.year || '';
    const make = doc.make || '';
    const model = doc.model || '';
    const titleParts = [year, make, model].filter(Boolean);
    title.textContent = titleParts.join(' ') || (doc.displayName || 'Unnamed Equipment');
    card.appendChild(title);

    // Subtitle / serial
    if (doc.serial) {
      const sub = document.createElement('div');
      sub.className = 'equip-card-subtitle';
      sub.textContent = `Serial: ${doc.serial}`;
      card.appendChild(sub);
    }

    // Badges row
    if (layout.hubBadges && layout.hubBadges.length) {
      const badgesRow = document.createElement('div');
      badgesRow.className = 'equip-badges-row';

      layout.hubBadges.forEach(fieldId => {
        const def = getField(fieldId);
        if (!def) return;
        const val = doc[fieldId];
        if (val === null || val === undefined || val === '') return;

        const badge = document.createElement('span');
        badge.className = 'equip-badge';
        badge.textContent = `${def.label}: ${val}`;
        badgesRow.appendChild(badge);
      });

      card.appendChild(badgesRow);
    }

    // Actions row
    if (layout.hubActions && layout.hubActions.length) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'equip-hub-actions';

      layout.hubActions.forEach(actionId => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'equip-hub-btn';
        btn.textContent = hubActionLabel(actionId);

        if (typeof onAction === 'function') {
          btn.addEventListener('click', () => {
            onAction(actionId, doc);
          });
        }

        actionsRow.appendChild(btn);
      });

      card.appendChild(actionsRow);
    }

    return card;
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  const FVEquipForms = {
    // Raw configs
    EQUIP_FIELDS,
    EQUIP_LAYOUTS,

    // Helpers
    detectEquipType,
    getLayout,
    getField,

    // Form rendering
    renderForm,

    // Data helpers
    buildPayload,

    // Hub helpers
    buildHubCard
  };

  // Attach to window (merge if already present)
  if (!window.FVEquipForms) {
    window.FVEquipForms = FVEquipForms;
  } else {
    Object.assign(window.FVEquipForms, FVEquipForms);
  }

})(window);