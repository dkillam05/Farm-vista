import {
  ready,
  getFirestore,
  collection,
  getDocs
} from '/js/firebase-init.js';

const path = String(window.location.pathname || '').toLowerCase();
const params = new URLSearchParams(window.location.search);

/*
  This helper is only for the signed-in, in-app grain ticket scan flow.
  Guest/load-out scans are predefined and must not receive Driver Assist UI.
*/
if (
  !path.endsWith('/pages/grain/grain-ticket-scan.html') ||
  params.has('t') ||
  params.has('token')
) {
  // Intentionally no-op.
} else {
  const clean = value => String(value == null ? '' : value).trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

  let binSites = [];
  let grainBagEvents = [];
  let inventoryLoaded = false;
  let inventoryPromise = null;
  let lastPromptKey = '';

  function normalizeCrop(value) {
    const valueNorm = norm(value);

    if (valueNorm.includes('soy')) return 'soybeans';
    if (valueNorm.includes('corn')) return 'corn';
    if (valueNorm.includes('wheat')) return 'wheat';

    return valueNorm;
  }

  async function loadStorageInventory() {
    if (inventoryLoaded) return;
    if (inventoryPromise) return inventoryPromise;

    inventoryPromise = (async () => {
      try {
        await ready;
        const db = getFirestore();

        const [binSnap, bagSnap] = await Promise.all([
          getDocs(collection(db, 'binSites')),
          getDocs(collection(db, 'grain_bag_events'))
        ]);

        binSites = binSnap.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        }));

        grainBagEvents = bagSnap.docs.map(docSnapshot => ({
          id: docSnapshot.id,
          ...docSnapshot.data()
        }));

        inventoryLoaded = true;
      } catch (error) {
        console.warn('[Grain Ticket Source Flow] Could not pre-check storage inventory:', error);
      }
    })();

    return inventoryPromise;
  }

  function binSiteHasCrop(site, crop) {
    const status = clean(site?.status || 'active').toLowerCase();
    if (status && status !== 'active') return false;

    const wantedCrop = normalizeCrop(crop);
    const bins = Array.isArray(site?.bins) ? site.bins : [];

    return bins.some(bin => {
      const onHand = Number(bin?.onHand || 0);
      const binCrop = normalizeCrop(
        bin?.lastCropType ||
        bin?.crop ||
        bin?.cropType
      );

      return Number.isFinite(onHand) && onHand > 0 && binCrop === wantedCrop;
    });
  }

  function bagEventHasCrop(event, crop) {
    const type = clean(event?.type).toLowerCase().replace(/\s+/g, '');
    if (type !== 'putdown') return false;

    const status = clean(event?.status).toLowerCase().replace(/\s+/g, '');
    if (status === 'pickedup') return false;

    if (
      normalizeCrop(event?.cropType || event?.crop) !==
      normalizeCrop(crop)
    ) {
      return false;
    }

    const counts = event?.counts || {};
    const full = Math.max(0, Number(counts.full || 0) || 0);
    const partial = Math.max(0, Number(counts.partial || 0) || 0);

    const partialFeetValues = Array.isArray(event?.partialFeet)
      ? event.partialFeet
      : Array.isArray(counts.partialFeet)
        ? counts.partialFeet
        : [];

    const partialFeet = partialFeetValues.reduce(
      (total, value) => total + Math.max(0, Number(value) || 0),
      0
    );

    return full > 0 || partial > 0 || partialFeet > 0;
  }

  function hasAvailableStorage(crop) {
    return (
      binSites.some(site => binSiteHasCrop(site, crop)) ||
      grainBagEvents.some(event => bagEventHasCrop(event, crop))
    );
  }

  function promptCrop(title) {
    const match = clean(title).match(/load of\s+(.+?)\s+come from\?/i);
    return match ? clean(match[1]) : '';
  }

  function sourceButtons() {
    return Array.from(
      document.querySelectorAll('#assistBody .assist-choice')
    );
  }

  function buttonByText(text) {
    const wanted = clean(text).toLowerCase();
    return sourceButtons().find(
      button => clean(button.textContent).toLowerCase() === wanted
    ) || null;
  }

  async function improveMainSourcePrompt(title, textEl) {
    const crop = promptCrop(title);
    if (!crop) return;

    const activeButton = buttonByText('Active Field Harvest');
    const storageButton = buttonByText('Grain Storage');

    if (activeButton) {
      activeButton.textContent = 'Active Harvest / Not in FarmVista Storage';
    }

    if (textEl) {
      textEl.textContent =
        'Choose where the grain came from. If it came from a bin or pile that is not tracked in FarmVista inventory, choose Active Harvest / Not in FarmVista Storage.';
    }

    /*
      Hide Grain Storage immediately while FarmVista checks inventory.
      It is only restored when this crop has positive bin or bag inventory.
    */
    if (storageButton) storageButton.style.display = 'none';

    await loadStorageInventory();

    if (
      storageButton &&
      document.body.contains(storageButton) &&
      inventoryLoaded &&
      hasAvailableStorage(crop)
    ) {
      storageButton.style.display = '';
    }
  }

  function autoOpenChoiceList(title, textEl) {
    const isFieldPrompt = /^which field did this .+ come from\?$/i.test(clean(title));
    const isStoragePrompt = /^which grain storage site did this .+ come from\?$/i.test(clean(title));

    if (!isFieldPrompt && !isStoragePrompt) return;

    if (textEl) {
      textEl.textContent = isFieldPrompt
        ? 'Tap the field this grain came from. FarmVista will continue automatically after you choose it.'
        : 'Tap the bin site or grain bag site. FarmVista will continue automatically after you choose it.';
    }

    const dropdown = document.querySelector('#assistBody .assist-dropdown');
    const trigger = document.querySelector('#assistBody .assist-dropdown-trigger');

    if (dropdown && trigger && !dropdown.classList.contains('open')) {
      trigger.click();
    }
  }

  function applyPromptEnhancements() {
    const screen = document.getElementById('assistScreen');
    if (!screen?.classList.contains('show')) return;

    const titleEl = document.getElementById('assistTitle');
    const textEl = document.getElementById('assistText');
    const title = clean(titleEl?.textContent);
    if (!title) return;

    const key = `${title}|${document.getElementById('assistBody')?.textContent || ''}`;
    if (key === lastPromptKey) return;
    lastPromptKey = key;

    if (/^where did this load of .+ come from\?$/i.test(title)) {
      improveMainSourcePrompt(title, textEl);
      return;
    }

    autoOpenChoiceList(title, textEl);
  }

  function startObserver() {
    const assistScreen = document.getElementById('assistScreen');
    if (!assistScreen) {
      setTimeout(startObserver, 100);
      return;
    }

    const observer = new MutationObserver(() => {
      requestAnimationFrame(applyPromptEnhancements);
    });

    observer.observe(assistScreen, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });

    loadStorageInventory();
    applyPromptEnhancements();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}
