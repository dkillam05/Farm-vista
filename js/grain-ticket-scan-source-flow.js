import {
  ready,
  getFirestore,
  collection,
  getDocs,
  query,
  where
} from '/js/firebase-init.js';

const path = String(window.location.pathname || '').toLowerCase();
const params = new URLSearchParams(window.location.search);

/*
  Signed-in, in-app grain ticket scan only.

  Goals:
    1. A duplicate ticket must stop BEFORE Driver Assist is shown.
    2. Grain Storage is shown only when the scanned crop actually has
       positive FarmVista bin or bag inventory.
    3. Active Harvest and Field remain available during harvest.
    4. Guest/load-out scans stay predefined and untouched.
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

  let lastPromptKey = '';

  let duplicateCheckPromise = null;
  let duplicateTicket = null;
  let duplicateHandled = false;
  let ocrSeenAt = 0;

  let binSites = [];
  let grainBagEvents = [];
  let inventoryLoaded = false;
  let inventoryPromise = null;

  function normalizeCrop(value) {
    const valueNorm = norm(value);

    if (valueNorm.includes('soy')) return 'soybeans';
    if (valueNorm.includes('corn')) return 'corn';
    if (valueNorm.includes('wheat')) return 'wheat';

    return valueNorm;
  }

  function sourceButtons() {
    return Array.from(document.querySelectorAll('#assistBody .assist-choice'));
  }

  function buttonByText(text) {
    const wanted = clean(text).toLowerCase();
    return sourceButtons().find(
      button => clean(button.textContent).toLowerCase() === wanted
    ) || null;
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  async function checkDuplicateFromOcr(grainTicket) {
    const ticketNumber = clean(grainTicket?.ticketNumber);
    const elevatorName = norm(grainTicket?.elevatorName);

    if (!ticketNumber || !elevatorName) return null;

    try {
      await ready;
      const db = getFirestore();
      const snap = await getDocs(
        query(
          collection(db, 'grain_tickets'),
          where('ticketNumber', '==', ticketNumber)
        )
      );

      const match = snap.docs.find(docSnapshot => {
        const data = docSnapshot.data() || {};
        const existingElevator = norm(
          data.ocrElevatorName ||
          data.buyerName ||
          data.deliveryLocationName ||
          ''
        );

        return existingElevator && existingElevator === elevatorName;
      });

      return match
        ? { id: match.id, ...match.data() }
        : null;
    } catch (error) {
      console.warn('[Grain Ticket Source Flow] Early duplicate check failed:', error);
      return null;
    }
  }

  /*
    Capture the OCR result as soon as it returns.

    IMPORTANT: Driver Assist can render almost immediately afterward, so the
    observer below deliberately waits for this duplicate lookup to appear and
    finish before allowing the first source prompt to become visible.
  */
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const clone = response.clone();
      const type = clean(clone.headers.get('content-type')).toLowerCase();

      if (type.includes('application/json')) {
        clone.json().then(data => {
          const grainTicket =
            data?.grainTicket ||
            data?.result?.grainTicket ||
            data?.ocrResult?.grainTicket ||
            null;

          if (grainTicket?.ticketNumber && grainTicket?.elevatorName) {
            ocrSeenAt = Date.now();
            duplicateHandled = false;
            duplicateTicket = null;

            duplicateCheckPromise = checkDuplicateFromOcr(grainTicket)
              .then(match => {
                duplicateTicket = match;
                return match;
              });
          }
        }).catch(() => {});
      }
    } catch (_) {
      // Never interfere with the scanner's real network response.
    }

    return response;
  };

  function showAlreadyScanned() {
    if (duplicateHandled) return;
    duplicateHandled = true;

    const assistScreen = document.getElementById('assistScreen');
    const processingScreen = document.getElementById('processingScreen');
    const errorScreen = document.getElementById('errorScreen');
    const errorTitle = errorScreen?.querySelector('.error-title');
    const errorText = document.getElementById('errorText');

    assistScreen?.classList.remove('show');
    processingScreen?.classList.remove('show');

    if (errorTitle) errorTitle.textContent = 'Already Scanned';
    if (errorText) {
      errorText.textContent =
        'This grain ticket is already in FarmVista. No information needs to be entered again.';
    }

    errorScreen?.classList.add('show');

    /*
      Resolve the hidden Driver Assist promise so the page's original
      duplicate protection can still run as a second safety check.
    */
    const skip = document.getElementById('assistSkipBtn');
    if (skip) skip.click();
  }

  async function waitForDuplicateGate() {
    /*
      There is a small race between:
        OCR response -> clone.json() -> duplicateCheckPromise
      and:
        main scan flow -> Driver Assist screen

      Give the OCR hook a brief opportunity to create the promise before
      deciding there is no early duplicate check to wait for.
    */
    const started = Date.now();

    while (!duplicateCheckPromise && Date.now() - started < 1200) {
      await wait(25);
    }

    if (!duplicateCheckPromise) return null;

    const result = await duplicateCheckPromise;
    duplicateCheckPromise = null;
    return result;
  }

  async function improveMainSourcePrompt(title, textEl) {
    const crop = promptCrop(title);
    if (!crop) return;

    const activeButton = buttonByText('Active Field Harvest');
    const storageButton = buttonByText('Grain Storage');

    if (activeButton) {
      activeButton.textContent = 'Active Harvest';
    }

    if (textEl) {
      textEl.textContent = 'Choose where this grain came from.';
    }

    /*
      Keep Grain Storage hidden only while inventory is being checked.
      Restore it when the scanned crop has positive bin/bag inventory.
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

  let applyingPrompt = false;

  async function applyPromptEnhancements() {
    if (applyingPrompt) return;

    const screen = document.getElementById('assistScreen');
    if (!screen?.classList.contains('show')) return;

    applyingPrompt = true;

    try {
      /*
        Hide Driver Assist immediately. The driver should never see or answer
        this prompt until the duplicate decision has completed.
      */
      screen.classList.remove('show');

      const processingScreen = document.getElementById('processingScreen');
      const processingText = document.getElementById('processingText');

      if (processingText) processingText.textContent = 'Checking for duplicate ticket…';
      processingScreen?.classList.add('show');

      const duplicate = await waitForDuplicateGate();

      if (duplicate || duplicateTicket) {
        showAlreadyScanned();
        return;
      }

      processingScreen?.classList.remove('show');
      screen.classList.add('show');

      const titleEl = document.getElementById('assistTitle');
      const textEl = document.getElementById('assistText');
      const title = clean(titleEl?.textContent);
      if (!title) return;

      const key = `${title}|${document.getElementById('assistBody')?.textContent || ''}`;
      if (key === lastPromptKey) return;
      lastPromptKey = key;

      if (/^where did this load of .+ come from\?$/i.test(title)) {
        await improveMainSourcePrompt(title, textEl);
        return;
      }

      autoOpenChoiceList(title, textEl);
    } finally {
      applyingPrompt = false;
    }
  }

  function startObserver() {
    const assistScreen = document.getElementById('assistScreen');
    if (!assistScreen) {
      setTimeout(startObserver, 100);
      return;
    }

    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        applyPromptEnhancements();
      });
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
