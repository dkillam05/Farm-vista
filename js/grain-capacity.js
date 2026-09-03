/* FarmVista — grain-capacity.js v1.0.0
   Shared helpers for converting storage capacity between crops.

   DESIGN:
   - All “rated capacity” on setup screens is stored as CORN bushels.
   - This helper converts that corn capacity into effective bushels for
     other crops (soybeans, wheat, oats, etc.) using multipliers.
   - Centralized here so you can tweak factors or add crops in ONE place.

   USAGE (in any page after this file is loaded):
     const cornBu = 60000;

     // Soybean capacity for a 60k corn-bin
     const sbBu = FVGrainCapacity.capacityForCrop(cornBu, 'soybeans');  // 55800

     // Corn bu equivalent for 55,800 bu of beans
     const cornEq = FVGrainCapacity.cornCapacityFromCrop(55800, 'soybeans'); // ~60000

     // Get factor for a crop (relative to corn)
     const f = FVGrainCapacity.getFactor('wheat'); // 1.07

   All APIs are attached to window.FVGrainCapacity.
*/
(function (root) {
  'use strict';

  // ---------- Internal tables ----------

  // Factors are *relative to corn*.
  // 1.00 = same as rated corn bu.
  // 0.93 = 100k corn bu bin ≈ 93k bu of that crop, etc.
  const FACTORS = {
    corn: 1.00,
    soybeans: 0.93,
    wheat: 1.07,
    milo: 1.02,
    oats: 0.78
  };

  // Nice labels for UI dropdowns, if needed.
  const LABELS = {
    corn: 'Corn (baseline)',
    soybeans: 'Soybeans',
    wheat: 'Wheat',
    milo: 'Milo / Grain Sorghum',
    oats: 'Oats'
  };

  // Aliases so users can pass “beans”, “sb”, etc.
  const ALIASES = {
    corn: 'corn',
    maize: 'corn',

    soybeans: 'soybeans',
    soybean: 'soybeans',
    beans: 'soybeans',
    sb: 'soybeans',

    wheat: 'wheat',
    hrw: 'wheat',
    srw: 'wheat',

    milo: 'milo',
    sorghum: 'milo',

    oats: 'oats'
  };

  function normalizeCropId(id) {
    if (!id) return 'corn';
    const key = String(id).trim().toLowerCase();
    return ALIASES[key] || key || 'corn';
  }

  function roundBushels(value, decimals) {
    if (typeof value !== 'number' || !isFinite(value)) return 0;
    if (decimals == null || decimals === false) return value;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  // ---------- Public API ----------

  const api = {
    /**
     * Returns the factor for a crop relative to corn.
     * - 1.00  = same as rated corn capacity
     * - 0.93  = holds 93% as many bushels as corn
     * - 1.07  = holds 7% more bushels than corn
     *
     * @param {string} cropId  Crop id or alias ("corn", "soybeans", "beans", etc.)
     * @returns {number} factor (defaults to 1.0 for unknown crops)
     */
    getFactor(cropId) {
      const id = normalizeCropId(cropId);
      return FACTORS[id] != null ? FACTORS[id] : 1.0;
    },

    /**
     * Convert a rated CORN capacity into effective bushels for a given crop.
     *
     * @param {number} cornBushels   Rated capacity in corn bushels.
     * @param {string} cropId        Target crop id or alias.
     * @param {object} [opts]
     * @param {boolean|number} [opts.round=false]
     *        - false / undefined → no rounding
     *        - true              → round to whole bushels
     *        - number            → number of decimal places
     * @returns {number}
     */
    capacityForCrop(cornBushels, cropId, opts) {
      const factor = api.getFactor(cropId);
      const raw = (Number(cornBushels) || 0) * factor;
      const decimals = opts && opts.round === true ? 0 : opts && typeof opts.round === 'number' ? opts.round : false;
      return roundBushels(raw, decimals);
    },

    /**
     * Given bushels of a specific crop, return the equivalent rated corn capacity.
     * Useful when you only know “beans” but want to back into the corn-bu rating.
     *
     * @param {number} cropBushels   Bushels of the given crop.
     * @param {string} cropId        Crop id or alias.
     * @param {object} [opts]
     * @param {boolean|number} [opts.round=false]  Same behavior as capacityForCrop.
     * @returns {number}
     */
    cornCapacityFromCrop(cropBushels, cropId, opts) {
      const factor = api.getFactor(cropId) || 1.0;
      const raw = factor ? (Number(cropBushels) || 0) / factor : 0;
      const decimals = opts && opts.round === true ? 0 : opts && typeof opts.round === 'number' ? opts.round : false;
      return roundBushels(raw, decimals);
    },

    /**
     * Return an array of crop configs for UI dropdowns.
     * Each entry: { id, label, factor }
     */
    listCrops() {
      return Object.keys(FACTORS).map(id => ({
        id,
        label: LABELS[id] || id,
        factor: FACTORS[id]
      }));
    },

    /**
     * Override or add a factor for a crop.
     * Example:
     *   FVGrainCapacity.setFactor('sunflowers', 0.85);
     */
    setFactor(cropId, factor) {
      const id = normalizeCropId(cropId);
      if (!id) return;
      FACTORS[id] = Number(factor) || 0;
      if (!LABELS[id]) LABELS[id] = id.charAt(0).toUpperCase() + id.slice(1);
    },

    /**
     * Expose raw tables (read-only copies) for debugging or advanced UI.
     */
    getAllFactors() {
      return Object.assign({}, FACTORS);
    },
    getAllLabels() {
      return Object.assign({}, LABELS);
    }
  };

  // Attach to global
  const g = (typeof root !== 'undefined') ? root : (typeof window !== 'undefined' ? window : this);
  g.FVGrainCapacity = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);


/* ============================================================
   GRAIN LOAD-OUT EDIT / VOID ENHANCEMENTS

   grain-ticket.html already loads this shared helper before its load-out
   module. Keep this block strictly page-scoped so the existing capacity
   API remains unchanged everywhere else.

   Goals:
     • Clicking a load-out continues to open the existing Edit Load modal.
     • Save Changes automatically resends the driver's load-out text.
     • Void Load keeps the Firestore document for audit history but removes
       it from the active dispatch board.
     • Voided loads remain hidden after reload.
============================================================ */
(function installGrainLoadoutEditEnhancements() {
  'use strict';

  if (
    typeof window === 'undefined' ||
    !window.location.pathname.endsWith('/pages/grain/grain-ticket.html')
  ) {
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('grain-loadout-table-body');
    const backdrop = document.getElementById('loadout-modal-backdrop');
    const form = document.getElementById('loadout-form');
    const saveBtn = document.getElementById('loadout-save-btn');
    const resendBtn = document.getElementById('loadout-resend-btn');
    const cancelBtn = document.getElementById('loadout-cancel-btn');
    const closeBtn = document.getElementById('loadout-modal-x');
    const message = document.getElementById('loadout-form-message');
    const actions = message?.nextElementSibling;

    if (!tbody || !backdrop || !form || !saveBtn || !message || !actions) {
      return;
    }

    let activeLoadId = '';
    let pendingEditResend = false;
    let resendTriggered = false;
    const voidedLoadIds = new Set();

    /*
      The existing load-out table uses data-load-id on clickable rows.
      Remember the row's ID before the page's normal click handler opens
      the edit modal.
    */
    tbody.addEventListener(
      'click',
      event => {
        const row = event.target.closest('tr[data-load-id]');
        if (!row) return;

        activeLoadId = String(row.dataset.loadId || '').trim();
        pendingEditResend = false;
        resendTriggered = false;
      },
      true
    );

    function removeVoidedRows() {
      voidedLoadIds.forEach(loadId => {
        const row = tbody.querySelector(
          `tr[data-load-id="${CSS.escape(loadId)}"]`
        );

        row?.remove();
      });
    }

    /*
      The page's current load-out renderer predates the void flag. Remove
      voided records after every render so they stay out of the active board
      while remaining in Firestore.
    */
    const tableObserver = new MutationObserver(removeVoidedRows);
    tableObserver.observe(tbody, { childList:true, subtree:false });

    async function loadVoidedLoadIds() {
      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;

        const db = firebase.getFirestore();
        const snapshot = await firebase.getDocs(
          firebase.collection(db, 'grain_loadouts')
        );

        snapshot.docs.forEach(docSnapshot => {
          const data = docSnapshot.data() || {};
          const status = String(data.status || '').trim().toLowerCase();

          if (data.voided === true || status === 'voided' || status === 'void') {
            voidedLoadIds.add(docSnapshot.id);
          }
        });

        removeVoidedRows();
      }
      catch (error) {
        console.warn('[grain loadout] could not load voided load IDs:', error);
      }
    }

    loadVoidedLoadIds();

    /*
      Add a destructive-looking but non-deleting action to the existing
      edit modal. It is shown only while editing an existing load.
    */
    const voidBtn = document.createElement('button');
    voidBtn.id = 'loadout-void-btn';
    voidBtn.type = 'button';
    voidBtn.className = 'loadout-btn';
    voidBtn.textContent = 'Void Load';
    voidBtn.style.display = 'none';
    voidBtn.style.marginRight = 'auto';
    voidBtn.style.borderColor = '#C9444D';
    voidBtn.style.color = '#C9444D';
    voidBtn.style.fontWeight = '900';

    actions.insertBefore(voidBtn, actions.firstChild);

    function syncVoidButton() {
      const editing =
        !!activeLoadId &&
        backdrop.classList.contains('open') &&
        /save changes/i.test(saveBtn.textContent || '');

      voidBtn.style.display = editing ? '' : 'none';
    }

    const modalObserver = new MutationObserver(syncVoidButton);
    modalObserver.observe(backdrop, {
      attributes:true,
      attributeFilter:['class'],
      subtree:true,
      childList:true
    });

    tbody.addEventListener('click', () => {
      setTimeout(syncVoidButton, 0);
    });

    /*
      When Save Changes succeeds, the existing page writes the updated load
      and displays "Load ... updated.". At that exact success point, invoke
      its existing Resend Text action once. This preserves the established
      SMS function and all current SMS status logging.
    */
    form.addEventListener(
      'submit',
      () => {
        const editing =
          !!activeLoadId &&
          /save changes/i.test(saveBtn.textContent || '');

        pendingEditResend = editing;
        resendTriggered = false;
      },
      true
    );

    const messageObserver = new MutationObserver(() => {
      const text = String(message.textContent || '').trim();

      if (
        pendingEditResend &&
        !resendTriggered &&
        /load\s+.+\s+updated\.?$/i.test(text)
      ) {
        pendingEditResend = false;
        resendTriggered = true;

        setTimeout(() => {
          if (
            activeLoadId &&
            resendBtn &&
            !resendBtn.disabled &&
            resendBtn.style.display !== 'none'
          ) {
            resendBtn.click();
          }
        }, 0);
      }
    });

    messageObserver.observe(message, {
      childList:true,
      characterData:true,
      subtree:true
    });

    function resetEditTracking() {
      pendingEditResend = false;
      resendTriggered = false;
      activeLoadId = '';
      voidBtn.style.display = 'none';
    }

    cancelBtn?.addEventListener('click', resetEditTracking);
    closeBtn?.addEventListener('click', resetEditTracking);

    voidBtn.addEventListener('click', async () => {
      if (!activeLoadId) {
        return;
      }

      const loadNumber =
        String(document.getElementById('loadout-load-number')?.value || '')
          .trim();

      const approved = window.confirm(
        `Void load ${loadNumber || activeLoadId}?\n\nIt will disappear from the active load-out board but remain in Firestore history.`
      );

      if (!approved) {
        return;
      }

      const originalText = voidBtn.textContent;
      voidBtn.disabled = true;
      voidBtn.textContent = 'Voiding…';

      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;

        const db = firebase.getFirestore();
        const auth = firebase.getAuth();
        const user = auth.currentUser;

        await firebase.updateDoc(
          firebase.doc(db, 'grain_loadouts', activeLoadId),
          {
            voided:true,
            status:'voided',
            voidedAt:firebase.serverTimestamp(),
            voidedByUid:user?.uid || null,
            voidedByName:
              user?.displayName ||
              user?.email ||
              'FarmVista User',
            voidReason:'office_voided_loadout',
            updatedAt:firebase.serverTimestamp()
          }
        );

        voidedLoadIds.add(activeLoadId);
        removeVoidedRows();

        backdrop.classList.remove('open');
        document.body.style.overflow = '';

        console.log('[grain loadout] load voided:', {
          loadId:activeLoadId,
          loadNumber
        });

        resetEditTracking();
      }
      catch (error) {
        console.error('[grain loadout] void failed:', error);

        message.textContent =
          `Load could not be voided: ${error?.message || 'Firestore update failed.'}`;
        message.className = 'loadout-form-message show error';
      }
      finally {
        voidBtn.disabled = false;
        voidBtn.textContent = originalText;
      }
    });
  }, { once:true });
})();
