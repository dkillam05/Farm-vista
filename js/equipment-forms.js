/* =======================================================================
/Farm-vista/js/equipment-forms.js  (FULL FILE)
Rev: 2025-11-13d + Planter acres/hours

Purpose:
  Shared "extras" engine for equipment forms.

  • Top of form (in HTML):  Make / Model / Year / Serial#/VIN
  • Middle of form (here):  Per-category extra fields
  • Bottom of form (in HTML):  Notes / Photos / QR

Usage (from any page):
  const extras = window.FVEquipForms.initExtras({
    equipType: 'tractor',       // or from ?type=
    container: document.getElementById('equipExtras'),
    document
  });

  // Later, when saving:
  const extraData = extras.read();  // { engineHours: 1234.5, ... }

  // When resetting:
  extras.reset();

  // Optional validation:
  const v = extras.validate();
  if (!v.ok) { alert(v.message); return; }

======================================================================= */
(function(global){
  'use strict';

  /** ------------------------------------------------------------------
   * Field configuration helpers
   * -------------------------------------------------------------------*/

  function numField(id, label, opts){
    return Object.assign({
      id,
      label,
      kind: 'number',
      step: '1',
      inputmode: 'decimal',
      placeholder: '',
      required: false
    }, opts || {});
  }

  function textField(id, label, opts){
    return Object.assign({
      id,
      label,
      kind: 'text',
      placeholder: '',
      required: false
    }, opts || {});
  }

  function selectField(id, label, options, opts){
    return Object.assign({
      id,
      label,
      kind: 'select',
      options: options || [],
      required: false
    }, opts || {});
  }

  function dateField(id, label, opts){
    return Object.assign({
      id,
      label,
      kind: 'date',
      required: false
    }, opts || {});
  }

  // New: toggle "slider pill" helper
  function toggleField(id, label, opts){
    return Object.assign({
      id,
      label,
      kind: 'toggle',
      onLabel: 'Yes',
      offLabel: 'No',
      required: false
    }, opts || {});
  }

  /** ------------------------------------------------------------------
   * Per-category field config
   * -------------------------------------------------------------------*/

  const CONFIG = {
    /* 1) TRACTORS ----------------------------------------------------- */
    tractor: [
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 1250.5'
      }),
      toggleField('starfireCapable', 'StarFire GPS Capable?')
    ],

    /* 2) COMBINES ----------------------------------------------------- */
    combine: [
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 2100.5'
      }),
      numField('separatorHours', 'Separator Hours', {
        step: '0.1',
        placeholder: 'e.g. 1550.0'
      }),
      toggleField('starfireCapable', 'StarFire GPS Capable?')
    ],

    /* 3) SPRAYERS ----------------------------------------------------- */
    sprayer: [
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 1800.0'
      }),
      numField('boomWidthFt', 'Boom Width (ft)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 120'
      }),
      numField('tankSizeGal', 'Tank Size (gal)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 1000'
      }),
      // New: StarFire-capable pill, right after tank size
      toggleField('starfireCapable', 'StarFire GPS Capable?')
    ],

    /* 4) IMPLEMENTS --------------------------------------------------- */
    implement: [
      // Type picker drives which extra fields show
      selectField(
        'implementType',
        'Type',
        [
          { value: 'planter',      label: 'Planter' },
          { value: 'tillage',      label: 'Tillage' },
          { value: 'grain-cart',   label: 'Grain Cart' },
          { value: 'corn-head',    label: 'Corn Head' },
          { value: 'draper-head',  label: 'Draper Head' },
          { value: 'auger',        label: 'Auger' },
          { value: 'conveyor',     label: 'Conveyor' },
          { value: 'other',        label: 'Other' }
        ],
        { required: true }
      ),

      // Working width is important for planters, tillage, and heads
      numField('workingWidthFt', 'Working Width (ft)', {
        step: '0.1',
        inputmode: 'decimal',
        placeholder: 'e.g. 40',
        // Planter, tillage, corn head, draper head
        visibleForTypes: ['planter', 'tillage', 'corn-head', 'draper-head']
      }),

      // Row count for planters and corn heads
      numField('numRows', 'Number of Rows', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 24',
        visibleForTypes: ['planter', 'corn-head']
      }),

      // Row spacing (inches) for planters / corn heads
      numField('rowSpacingIn', 'Row Spacing (in)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 30',
        visibleForTypes: ['planter', 'corn-head']
      }),
      
      // NEW: Planter lifetime acres (monitor)
      numField('totalAcres', 'Total Acres', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'Lifetime acres from monitor',
        visibleForTypes: ['planter']
      }),

      // NEW: Planter lifetime hours (monitor)
      numField('totalHours', 'Total Hours', {
        step: '0.1',
        inputmode: 'decimal',
        placeholder: 'Lifetime hours from monitor',
        visibleForTypes: ['planter']
      }),

      // StarFire-capable pill for "some implements"
      toggleField('starfireCapable', 'StarFire GPS Capable?', {
        visibleForTypes: ['planter', 'grain-cart', 'corn-head', 'draper-head', 'other']
      }),

      // Capacity for grain carts (no working width / rows required)
      numField('bushelCapacityBu', 'Capacity (bu)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 1100',
        visibleForTypes: ['grain-cart']
      }),

      // Auger-specific fields: diameter + length
      numField('augerDiameterIn', 'Auger Diameter (in)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 10',
        visibleForTypes: ['auger']
      }),

      numField('augerLengthFt', 'Auger Length (ft)', {
        step: '0.1',
        inputmode: 'decimal',
        placeholder: 'e.g. 72',
        visibleForTypes: ['auger']
      })
    ],

    /* 5) FERTILIZER EQUIPMENT ---------------------------------------- */
    fertilizer: [
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 1200.0'
      }),
      selectField(
        'applicationType',
        'Application Type',
        [
          { value: 'dry',        label: 'Dry' },
          { value: 'liquid',     label: 'Liquid' },
          { value: 'anhydrous',  label: 'Anhydrous' },
          { value: 'manure',     label: 'Manure' },
          { value: 'other',      label: 'Other' }
        ],
        { required: false }
      ),
      // New: StarFire-capable pill (spreaders, etc.)
      toggleField('starfireCapable', 'StarFire GPS Capable?')
    ],

    /* 6) TRUCKS ------------------------------------------------------- */
    truck: [
      numField('odometerMiles', 'Odometer (miles)', {
        step: '1',
        inputmode: 'numeric',
        placeholder: 'e.g. 256000'
      }),
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 5400.5'
      }),
      textField('licensePlate', 'License Plate #', {
        placeholder: 'e.g. ABC 1234'
      }),
      dateField('licensePlateExp', 'License Plate Expiration'),
      dateField('insuranceExp', 'Insurance Expiration'),
      textField('tireSizes', 'Tire Sizes', {
        placeholder: 'e.g. 295/75R22.5'
      }),
      // DOT toggle + expiration; date required only if DOT is on
      selectField(
        'dotRequired',
        'DOT Inspection',
        [
          { value: 'no',  label: 'No' },
          { value: 'yes', label: 'Yes' }
        ],
        { required: false }
      ),
      dateField('dotExpiration', 'DOT Expiration Date', {
        requiredWhen(controls){
          const v = (controls.get('dotRequired')?.value || '').toLowerCase();
          return v === 'yes';
        }
      })
    ],

    /* 7) TRAILERS ----------------------------------------------------- */
    trailer: [
      selectField(
        'trailerType',
        'Trailer Type',
        [
          { value: 'grain',   label: 'Grain' },
          { value: 'flatbed', label: 'Flatbed' },
          { value: 'tanker',  label: 'Tanker' },
          { value: 'lowboy',  label: 'Lowboy' },
          { value: 'utility', label: 'Utility' },
          { value: 'other',   label: 'Other' }
        ],
        { required: false }
      ),
      textField('trailerPlate', 'Plate Number', {
        placeholder: 'e.g. 123 456T'
      }),
      dateField('trailerPlateExp', 'Plate Expiration'),
      // DOT toggle + expiration; date required only if DOT is on
      selectField(
        'trailerDotRequired',
        'DOT Inspection',
        [
          { value: 'no',  label: 'No' },
          { value: 'yes', label: 'Yes' }
        ],
        { required: false }
      ),
      dateField('lastDotInspection', 'DOT Expiration Date', {
        requiredWhen(controls){
          const v = (controls.get('trailerDotRequired')?.value || '').toLowerCase();
          return v === 'yes';
        }
      }),
      numField('gvwrLb', 'GVWR (lb)', {
        step: '100',
        inputmode: 'numeric',
        placeholder: 'e.g. 80000'
      })
    ],

    /* 8) CONSTRUCTION ------------------------------------------------- */
    construction: [
      // Machine vs Attachment/Implement
      selectField(
        'constructionType',
        'Construction Type',
        [
          { value: 'machine',    label: 'Machine' },
          { value: 'attachment', label: 'Attachment / Implement' }
        ],
        { required: true }
      ),

      // Engine hours only matter for machines
      numField('engineHours', 'Engine Hours', {
        step: '0.1',
        placeholder: 'e.g. 3200.0',
        visibleForTypes: ['machine']
      }),

      // Attachment / Implement dropdown for attachments only
      selectField(
        'attachmentType',
        'Attachment / Implement',
        [
          // Skid steer attachments
          { value: 'skid-bucket',          label: 'Skid Steer — Bucket' },
          { value: 'skid-forks',           label: 'Skid Steer — Forks' },
          { value: 'skid-grapple',         label: 'Skid Steer — Grapple' },
          { value: 'skid-brush-cutter',    label: 'Skid Steer — Brush Cutter' },
          { value: 'skid-stump-grinder',   label: 'Skid Steer — Stump Grinder' },
          { value: 'skid-tree-shear',      label: 'Skid Steer — Tree Shear' },
          { value: 'skid-trencher',        label: 'Skid Steer — Trencher' },
          { value: 'skid-post-hole',       label: 'Skid Steer — Post Hole Digger' },
          { value: 'skid-broom',           label: 'Skid Steer — Broom' },

          // Dirt-moving / grading
          { value: 'dirt-scraper',         label: 'Dirt Scraper' },
          { value: 'box-blade',            label: 'Box Blade' },
          { value: 'dozer-blade',          label: 'Dozer Blade' },
          { value: 'snow-blade',           label: 'Snow Blade' },
          { value: 'backhoe-3pt',          label: 'Backhoe (3-pt)' },

          // Catch-all
          { value: 'other',                label: 'Other' }
        ],
        {
          required: true,
          visibleForTypes: ['attachment']
        }
      )
    ],

    /* 9) STARFIRE / TECHNOLOGY ---------------------------------------- */
    starfire: [
      // Serial/VIN is handled in the top form; no extra serial here.
      selectField(
        'activationLevel',
        'Activation Level',
        [
          { value: 'rtk',   label: 'RTK' },
          { value: 'sfrtk',   label: 'SF-RTK' },
          { value: 'sf3',   label: 'SF3' },
          { value: 'sf2',   label: 'SF2' },
          { value: 'sf1',   label: 'SF1' },
          { value: 'waas',  label: 'WAAS' },
          { value: 'none',  label: 'None' },
          { value: 'other', label: 'Other' }
        ],
        { required: false }
      ),
      textField('firmwareVersion', 'Firmware Version', {
        placeholder: 'e.g. 23-2.0'
      })
    ]
  };

  /** ------------------------------------------------------------------
   * Render helpers
   * -------------------------------------------------------------------*/

  function createFieldElement(doc, field){
    const wrap = doc.createElement('div');
    wrap.className = 'field';
    wrap.dataset.fieldId = field.id;

    if (field.visibleForTypes && Array.isArray(field.visibleForTypes)){
      wrap.dataset.visibleForTypes = field.visibleForTypes.join(',');
    }

    const label = doc.createElement('label');
    label.textContent = field.label || field.id;
    if (field.required){
      label.classList.add('req');
    }

    const id = 'extra-' + field.id;
    label.setAttribute('for', id);

    let input;

    if (field.kind === 'number'){
      input = doc.createElement('input');
      input.type = 'number';
      input.className = 'input';
      if (field.step) input.step = String(field.step);
      if (field.inputmode) input.inputMode = field.inputmode;
      if (field.placeholder) input.placeholder = field.placeholder;

    }else if (field.kind === 'text'){
      input = doc.createElement('input');
      input.type = 'text';
      input.className = 'input';
      if (field.placeholder) input.placeholder = field.placeholder;

    }else if (field.kind === 'select'){
      input = doc.createElement('select');
      input.className = 'select';

      // Placeholder option
      const opt0 = doc.createElement('option');
      opt0.value = '';
      opt0.textContent = '— Select —';
      input.appendChild(opt0);

      (field.options || []).forEach(o=>{
        const opt = doc.createElement('option');
        opt.value = String(o.value);
        opt.textContent = String(o.label);
        input.appendChild(opt);
      });

    }else if (field.kind === 'date'){
      input = doc.createElement('input');
      input.type = 'date';
      input.className = 'input';

    }else if (field.kind === 'toggle'){
      // Slider-pill style toggle using a button; CSS can style .pill-toggle and .pill-toggle.on
      input = doc.createElement('button');
      input.type = 'button';
      input.className = 'pill-toggle';
      input.dataset.state = 'off';
      input.textContent = field.offLabel || 'No';

      input.addEventListener('click', ()=>{
        const isOn = input.dataset.state === 'on';
        if (isOn){
          input.dataset.state = 'off';
          input.classList.remove('on');
          input.textContent = field.offLabel || 'No';
        }else{
          input.dataset.state = 'on';
          input.classList.add('on');
          input.textContent = field.onLabel || 'Yes';
        }
      });

    }else{
      // Fallback to simple text input
      input = doc.createElement('input');
      input.type = 'text';
      input.className = 'input';
    }

    input.id = id;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return { wrap, input };
  }

  function buildRows(doc, container, fields){
    container.innerHTML = '';
    const controls = new Map();

    if (!fields || !fields.length){
      return controls; // empty map
    }

    // Group fields 2 per row to match existing layout
    for (let i = 0; i < fields.length; i += 2){
      const row = doc.createElement('div');
      row.className = 'row';

      const f1 = fields[i];
      const el1 = createFieldElement(doc, f1);
      row.appendChild(el1.wrap);
      controls.set(f1.id, el1.input);

      const f2 = fields[i + 1];
      if (f2){
        const el2 = createFieldElement(doc, f2);
        row.appendChild(el2.wrap);
        controls.set(f2.id, el2.input);
      }

      container.appendChild(row);
    }

    return controls;
  }

  /** ------------------------------------------------------------------
   * Normalization & validation
   * -------------------------------------------------------------------*/

  function normalizeExtras(fields, controls){
    const out = {};

    // One-of controller for conditional fields (implement OR construction)
    const typeEl =
      controls.get('implementType') ||
      controls.get('constructionType') ||
      null;
    const currentType = typeEl ? (typeEl.value || '').toLowerCase() : null;

    for (const field of fields){
      // Skip non-applicable conditional fields (implements + construction)
      if (
        field.id !== 'implementType' &&
        field.id !== 'constructionType' &&
        field.visibleForTypes &&
        Array.isArray(field.visibleForTypes)
      ){
        const list = field.visibleForTypes.map(v => String(v).toLowerCase());
        if (!currentType || !list.includes(currentType)){
          out[field.id] = null;
          continue;
        }
      }

      const el = controls.get(field.id);
      if (!el) continue;

      // Toggle fields normalize to boolean
      if (field.kind === 'toggle'){
        const state = (el.dataset.state || 'off').toLowerCase();
        out[field.id] = (state === 'on');
        continue;
      }

      let raw = (el.value ?? '').trim();

      if (raw === ''){
        out[field.id] = null;
        continue;
      }

      if (field.kind === 'number'){
        const num = Number(raw);
        out[field.id] = Number.isFinite(num) ? num : null;
      }else if (field.kind === 'select'){
        out[field.id] = raw || null;
      }else if (field.kind === 'date'){
        out[field.id] = raw || null; // ISO yyyy-mm-dd
      }else{
        out[field.id] = raw;
      }
    }

    return out;
  }

  function resetExtras(fields, controls){
    for (const field of fields){
      const el = controls.get(field.id);
      if (!el) continue;

      if (field.kind === 'toggle'){
        el.dataset.state = 'off';
        el.classList.remove('on');
        el.textContent = field.offLabel || 'No';
      }else{
        el.value = '';
      }
    }
  }

  function validateExtras(fields, controls){
    // Same controller logic as normalize for visibleForTypes
    const typeEl =
      controls.get('implementType') ||
      controls.get('constructionType') ||
      null;
    const currentType = typeEl ? (typeEl.value || '').toLowerCase() : null;

    for (const field of fields){
      // Skip required check if field is conditional but not visible
      if (
        field.id !== 'implementType' &&
        field.id !== 'constructionType' &&
        field.visibleForTypes &&
        Array.isArray(field.visibleForTypes)
      ){
        const list = field.visibleForTypes.map(v => String(v).toLowerCase());
        if (!currentType || !list.includes(currentType)){
          continue;
        }
      }

      const hasConditionalReq =
        typeof field.requiredWhen === 'function' &&
        field.requiredWhen(controls);

      const isRequired = field.required || hasConditionalReq;
      if (!isRequired) continue;

      const el = controls.get(field.id);
      if (!el) continue;

      if (field.kind === 'toggle'){
        const state = (el.dataset.state || 'off').toLowerCase();
        if (state !== 'on'){
          return {
            ok: false,
            message: `${field.label || field.id} is required.`
          };
        }
        continue;
      }

      const raw = (el.value ?? '').trim();
      if (raw === ''){
        return {
          ok: false,
          message: `${field.label || field.id} is required.`
        };
      }
    }
    return { ok: true, message: null };
  }

  /** ------------------------------------------------------------------
   * Shared dynamic visibility helper
   * -------------------------------------------------------------------*/

  function setupDynamic(typeFieldId, fields, controls, container){
    const typeEl = controls.get(typeFieldId);
    if (!typeEl) return;

    function updateVisibility(){
      const currentType = (typeEl.value || '').toLowerCase();

      fields.forEach(field => {
        if (field.id === typeFieldId) return; // controller always visible

        const wrap = container.querySelector('[data-field-id="' + field.id + '"]');
        if (!wrap) return;

        const list = field.visibleForTypes && Array.isArray(field.visibleForTypes)
          ? field.visibleForTypes.map(v => String(v).toLowerCase())
          : null;

        if (!list || !list.length){
          // No visibility rules: always show
          wrap.style.display = '';
          return;
        }

        if (!currentType || !list.includes(currentType)){
          // Hide and clear value when not applicable
          const input = controls.get(field.id);
          if (input){
            if (field.kind === 'toggle'){
              input.dataset.state = 'off';
              input.classList.remove('on');
              input.textContent = field.offLabel || 'No';
            }else{
              input.value = '';
            }
          }
          wrap.style.display = 'none';
        }else{
          wrap.style.display = '';
        }
      });
    }

    typeEl.addEventListener('change', updateVisibility);
    // Initial state (hide conditional stuff until a type is chosen)
    updateVisibility();
  }

  /** ------------------------------------------------------------------
   * Public API
   * -------------------------------------------------------------------*/

  const FVEquipForms = {
    /**
     * Initialize extra fields for a given equipment type.
     *
     * @param {Object} opts
     * @param {string} opts.equipType   e.g. 'tractor', 'sprayer'
     * @param {HTMLElement} opts.container  The element where fields should render
     * @param {Document} opts.document  The document object (usually window.document)
     */
    initExtras(opts){
      const equipType = (opts && opts.equipType || '').toLowerCase();
      const container = opts && opts.container;
      const doc = opts && opts.document || global.document;

      if (!container || !doc){
        // Return no-op API so callers don't explode if mis-wired
        return {
          read(){ return {}; },
          reset(){},
          validate(){ return { ok: true, message: null }; }
        };
      }

      const fields = CONFIG[equipType] || [];
      const controls = buildRows(doc, container, fields);

      // Implement-specific dynamic behavior
      if (equipType === 'implement'){
        setupDynamic('implementType', fields, controls, container);
      }

      // Construction-specific dynamic behavior
      if (equipType === 'construction'){
        setupDynamic('constructionType', fields, controls, container);
      }

      return {
        /** Read current values as a plain object */
        read(){
          return normalizeExtras(fields, controls);
        },

        /** Clear extra fields back to blank */
        reset(){
          resetExtras(fields, controls);
        },

        /**
         * Validate required extras.
         * Returns { ok: boolean, message: string|null }
         */
        validate(){
          return validateExtras(fields, controls);
        }
      };
    }
  };

  // Attach to global
  global.FVEquipForms = FVEquipForms;

})(window);
