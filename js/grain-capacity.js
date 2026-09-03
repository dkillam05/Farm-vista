/* FarmVista — grain-capacity.js v1.0.0
   Shared helpers for converting storage capacity between crops.

   DESIGN:
   - All “rated capacity” on setup screens is stored as CORN bushels.
   - This helper converts that corn capacity into effective bushels for
     other crops (soybeans, wheat, oats, etc.) using multipliers.
   - Centralized here so you can tweak factors or add crops in ONE place.
*/
(function (root) {
  'use strict';

  const FACTORS = {
    corn: 1.00,
    soybeans: 0.93,
    wheat: 1.07,
    milo: 1.02,
    oats: 0.78
  };

  const LABELS = {
    corn: 'Corn (baseline)',
    soybeans: 'Soybeans',
    wheat: 'Wheat',
    milo: 'Milo / Grain Sorghum',
    oats: 'Oats'
  };

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

  const api = {
    getFactor(cropId) {
      const id = normalizeCropId(cropId);
      return FACTORS[id] != null ? FACTORS[id] : 1.0;
    },

    capacityForCrop(cornBushels, cropId, opts) {
      const factor = api.getFactor(cropId);
      const raw = (Number(cornBushels) || 0) * factor;
      const decimals = opts && opts.round === true
        ? 0
        : opts && typeof opts.round === 'number'
          ? opts.round
          : false;
      return roundBushels(raw, decimals);
    },

    cornCapacityFromCrop(cropBushels, cropId, opts) {
      const factor = api.getFactor(cropId) || 1.0;
      const raw = factor ? (Number(cropBushels) || 0) / factor : 0;
      const decimals = opts && opts.round === true
        ? 0
        : opts && typeof opts.round === 'number'
          ? opts.round
          : false;
      return roundBushels(raw, decimals);
    },

    listCrops() {
      return Object.keys(FACTORS).map(id => ({
        id,
        label: LABELS[id] || id,
        factor: FACTORS[id]
      }));
    },

    setFactor(cropId, factor) {
      const id = normalizeCropId(cropId);
      if (!id) return;
      FACTORS[id] = Number(factor) || 0;
      if (!LABELS[id]) {
        LABELS[id] = id.charAt(0).toUpperCase() + id.slice(1);
      }
    },

    getAllFactors() {
      return Object.assign({}, FACTORS);
    },

    getAllLabels() {
      return Object.assign({}, LABELS);
    }
  };

  const g = typeof root !== 'undefined'
    ? root
    : typeof window !== 'undefined'
      ? window
      : this;

  g.FVGrainCapacity = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);


/* ============================================================
   LOAD-OUT EDIT COMPATIBILITY

   grain-ticket.html currently restores four values outside the block in
   which they were declared. On normal current load-outs that caused
   loOpenEditModal() to throw before the modal could open.

   These global bindings intentionally provide the missing outer-scope
   fallback. The page-specific helper below immediately replaces them with
   the real values from the edit controls after the normal row handler has
   populated the form and before its delayed restore runs.
============================================================ */
var destinationId = '';
var customerId = '';
var savedCrop = '';
var cropMatch = null;


/* ============================================================
   GRAIN LOAD-OUT EDIT / VOID ENHANCEMENTS
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
    const destination = document.getElementById('loadout-destination');
    const customer = document.getElementById('loadout-customer');
    const customerButtonText = document.getElementById('loadout-customer-button-text');
    const crop = document.getElementById('loadout-crop');
    const actions = message?.nextElementSibling;

    if (!tbody || !backdrop || !form || !saveBtn || !message || !actions) {
      return;
    }

    let activeLoadId = '';
    let pendingEditResend = false;
    let resendTriggered = false;
    const voidedLoadIds = new Set();

    function captureEditRestoreValues() {
      destinationId = String(destination?.value || '').trim();
      customerId = String(customer?.value || '').trim();
      savedCrop = String(crop?.value || '').trim();
      cropMatch = savedCrop ? { value:savedCrop } : null;
    }

    async function restoreSavedSoldUnder(loadId) {
      if (!loadId || !customer) return;

      try {
        const firebase = await import('/js/firebase-init.js');
        await firebase.ready;

        const db = firebase.getFirestore();
        const snapshot = await firebase.getDoc(
          firebase.doc(db, 'grain_loadouts', loadId)
        );

        if (!snapshot.exists()) return;

        const data = snapshot.data() || {};
        const savedCustomerId = String(
          data.customerId ||
          data.grainCustomerId ||
          data.soldUnderCustomerId ||
          data.soldUnderId ||
          ''
        ).trim();

        const savedCustomerName = String(
          data.customerName ||
          data.grainCustomerName ||
          data.soldUnderCustomerName ||
          data.soldUnderName ||
          ''
        ).trim();

        const isUnknown =
          !savedCustomerId &&
          (!savedCustomerName || savedCustomerName.toLowerCase() === 'unknown');

        if (isUnknown) {
          customer.value = '__unknown__';
          customerId = '__unknown__';
          if (customerButtonText) customerButtonText.textContent = 'Unknown';
          return;
        }

        if (!savedCustomerId) return;

        customer.value = savedCustomerId;
        customerId = savedCustomerId;

        if (customerButtonText) {
          customerButtonText.textContent = savedCustomerName || 'Sold Under';
        }

        /*
          Do not dispatch a synthetic change event here.
          The loadout page treats customer changes as a user selection and
          rebuilds dependent controls, including the Hauling Job selector.
          Edit restore is only restoring the saved snapshot, so updating the
          hidden value and visible label is sufficient and preserves the
          saved hauling-job selection.
        */
      }
      catch (error) {
        console.warn('[grain loadout] could not restore saved Sold Under:', error);
      }
    }

    function removeVoidedRows() {
      voidedLoadIds.forEach(loadId => {
        const escaped = window.CSS?.escape
          ? CSS.escape(loadId)
          : loadId.replace(/["\\]/g, '\\$&');

        tbody
          .querySelector(`tr[data-load-id="${escaped}"]`)
          ?.remove();
      });
    }

    /*
      Capture the load ID before the page's own bubble-phase row click.
      The zero-delay callback runs after that handler has filled the modal.

      IMPORTANT:
      The page defaults Sold Under to Unknown while applying the hauling job.
      For an existing load we must then restore the customer saved on the
      grain_loadouts document. Otherwise opening Edit can display/save
      Unknown even though the load originally went out under a real customer.
    */
    tbody.addEventListener(
      'click',
      event => {
        const row = event.target.closest('tr[data-load-id]');
        if (!row) return;

        activeLoadId = String(row.dataset.loadId || '').trim();
        pendingEditResend = false;
        resendTriggered = false;

        setTimeout(() => {
          captureEditRestoreValues();
          restoreSavedSoldUnder(activeLoadId);
          syncVoidButton();
        }, 0);
      },
      true
    );

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

          if (
            data.voided === true ||
            status === 'voided' ||
            status === 'void'
          ) {
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
      attributeFilter:['class']
    });

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
      if (!activeLoadId) return;

      const loadNumber = String(
        document.getElementById('loadout-load-number')?.value || ''
      ).trim();

      const approved = window.confirm(
        `Void load ${loadNumber || activeLoadId}?\n\nIt will disappear from the active load-out board but remain in Firestore history.`
      );

      if (!approved) return;

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
