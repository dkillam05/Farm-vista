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
  Signed-in, in-app grain ticket scan helper.

  IMPORTANT:
  - Never block the scanner waiting on this helper.
  - The scanner's built-in duplicate guard remains authoritative.
  - This helper only improves UX when an early duplicate answer is available.
  - Grain Storage is crop-aware: show it only when that crop has inventory.
  - Guest/load-out scans remain untouched.

  SEPT 4, 2026 FIELD-PICKER SAFETY:
  Do NOT programmatically click/open the Field or Grain Storage dropdown after
  the driver chooses the source type. On iPhone that transition can happen
  inside the same tap sequence and allow the original tap to fall through to
  the newly rendered controls, which can resolve Driver Assist before the
  driver actually chooses a field/site. Keep the second picker closed until
  the driver deliberately taps it. Also remove Skip on that second picker:
  choosing "Field" means the driver must choose a field or use Back.
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

  let duplicateCheckPromise = null;
  let duplicateTicket = null;
  let duplicateHandled = false;

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

        binSites = binSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        grainBagEvents = bagSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        inventoryLoaded = true;
      } catch (error) {
        console.warn('[Grain Ticket Source Flow] Storage pre-check failed:', error);
      }
    })();

    return inventoryPromise;
  }

  function binSiteHasCrop(site, crop) {
    const status = clean(site?.status || 'active').toLowerCase();
    if (status && status !== 'active') return false;

    const wanted = normalizeCrop(crop);
    const bins = Array.isArray(site?.bins) ? site.bins : [];

    return bins.some(bin => {
      const onHand = Number(bin?.onHand || 0);
      const binCrop = normalizeCrop(bin?.lastCropType || bin?.crop || bin?.cropType);
      return Number.isFinite(onHand) && onHand > 0 && binCrop === wanted;
    });
  }

  function bagEventHasCrop(event, crop) {
    const type = clean(event?.type).toLowerCase().replace(/\s+/g, '');
    if (type !== 'putdown') return false;

    const status = clean(event?.status).toLowerCase().replace(/\s+/g, '');
    if (status === 'pickedup') return false;

    if (normalizeCrop(event?.cropType || event?.crop) !== normalizeCrop(crop)) {
      return false;
    }

    const counts = event?.counts || {};
    const full = Math.max(0, Number(counts.full || 0) || 0);
    const partial = Math.max(0, Number(counts.partial || 0) || 0);
    const feetValues = Array.isArray(event?.partialFeet)
      ? event.partialFeet
      : Array.isArray(counts.partialFeet)
        ? counts.partialFeet
        : [];
    const partialFeet = feetValues.reduce(
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

  async function checkDuplicateFromOcr(grainTicket) {
    const ticketNumber = clean(grainTicket?.ticketNumber);
    const elevatorName = norm(grainTicket?.elevatorName);
    if (!ticketNumber || !elevatorName) return null;

    try {
      await ready;
      const db = getFirestore();
      const snap = await getDocs(
        query(collection(db, 'grain_tickets'), where('ticketNumber', '==', ticketNumber))
      );

      const match = snap.docs.find(docSnapshot => {
        const data = docSnapshot.data() || {};
        const existingElevator = norm(
          data.ocrElevatorName || data.buyerName || data.deliveryLocationName || ''
        );
        return existingElevator && existingElevator === elevatorName;
      });

      return match ? { id: match.id, ...match.data() } : null;
    } catch (error) {
      console.warn('[Grain Ticket Source Flow] Early duplicate check failed:', error);
      return null;
    }
  }

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
            duplicateHandled = false;
            duplicateTicket = null;
            duplicateCheckPromise = checkDuplicateFromOcr(grainTicket).then(match => {
              duplicateTicket = match;
              return match;
            });
          }
        }).catch(() => {});
      }
    } catch (_) {}

    return response;
  };

  function showAlreadyScanned() {
    if (duplicateHandled) return;
    duplicateHandled = true;

    document.getElementById('assistScreen')?.classList.remove('show');
    document.getElementById('processingScreen')?.classList.remove('show');

    const errorScreen = document.getElementById('errorScreen');
    const errorTitle = errorScreen?.querySelector('.error-title');
    const errorText = document.getElementById('errorText');

    if (errorTitle) errorTitle.textContent = 'Already Scanned';
    if (errorText) {
      errorText.textContent =
        'This grain ticket is already in FarmVista. No information needs to be entered again.';
    }
    errorScreen?.classList.add('show');

    // Let the scanner's existing flow finish and reach its own duplicate guard.
    document.getElementById('assistSkipBtn')?.click();
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

  function promptCrop(title) {
    const match = clean(title).match(/load of\s+(.+?)\s+come from\?/i);
    return match ? clean(match[1]) : '';
  }

  async function improveSourcePrompt(title, textEl) {
    const crop = promptCrop(title);
    if (!crop) return;

    const activeButton = buttonByText('Active Field Harvest');
    const storageButton = buttonByText('Grain Storage');

    if (activeButton && clean(activeButton.textContent) !== 'Active Harvest') {
      activeButton.textContent = 'Active Harvest';
    }
    if (textEl && clean(textEl.textContent) !== 'Choose where this grain came from.') {
      textEl.textContent = 'Choose where this grain came from.';
    }

    if (storageButton) storageButton.style.display = 'none';
    await loadStorageInventory();

    if (storageButton && document.body.contains(storageButton)) {
      storageButton.style.display =
        inventoryLoaded && hasAvailableStorage(crop) ? '' : 'none';
    }
  }

  function stabilizeChoiceList(title, textEl) {
    const isField = /^which field did this .+ come from\?$/i.test(clean(title));
    const isStorage = /^which grain storage site did this .+ come from\?$/i.test(clean(title));
    const skipBtn = document.getElementById('assistSkipBtn');

    if (!isField && !isStorage) {
      return;
    }

    if (textEl) {
      const wantedText = isField
        ? 'Choose the field this grain came from.'
        : 'Choose the bin site or grain bag site.';

      if (clean(textEl.textContent) !== wantedText) {
        textEl.textContent = wantedText;
      }
    }

    /*
      The second-level source picker must require a real selection.
      Back remains available if the driver chose Field/Storage by mistake.
    */
    if (skipBtn) {
      skipBtn.style.display = 'none';
      skipBtn.disabled = true;
    }

    /*
      Field and Grain Storage now render their searchable choices directly
      in the scanner. Do not auto-click or synthesize another touch here.
      This keeps one physical tap equal to one FarmVista action on iPhone.
    */
  }

  function restoreSkipButtonForOtherPrompts(title) {
    const isField = /^which field did this .+ come from\?$/i.test(clean(title));
    const isStorage = /^which grain storage site did this .+ come from\?$/i.test(clean(title));
    if (isField || isStorage) return;

    const skipBtn = document.getElementById('assistSkipBtn');
    if (!skipBtn) return;

    skipBtn.disabled = false;
  }

  let assistGeneration = 0;

  async function applyPromptEnhancements() {
    const screen = document.getElementById('assistScreen');
    if (!screen?.classList.contains('show')) return;

    const generation = ++assistGeneration;
    const titleEl = document.getElementById('assistTitle');
    const textEl = document.getElementById('assistText');
    const title = clean(titleEl?.textContent);
    if (!title) return;

    /*
      Only hold Driver Assist when an early duplicate lookup ALREADY exists.
      Never wait for a promise to appear: that was the freeze seen on iPhone.
    */
    const pendingDuplicate = duplicateCheckPromise;
    if (pendingDuplicate) {
      screen.classList.remove('show');
      const processingScreen = document.getElementById('processingScreen');
      const processingText = document.getElementById('processingText');
      if (processingText) processingText.textContent = 'Checking for duplicate ticket…';
      processingScreen?.classList.add('show');

      const duplicate = await Promise.race([
        pendingDuplicate,
        new Promise(resolve => setTimeout(() => resolve(null), 900))
      ]);

      if (generation !== assistGeneration) return;

      if (duplicate || duplicateTicket) {
        showAlreadyScanned();
        return;
      }

      processingScreen?.classList.remove('show');
      screen.classList.add('show');
    }

    if (duplicateTicket) {
      showAlreadyScanned();
      return;
    }

    restoreSkipButtonForOtherPrompts(title);

    if (/^where did this load of .+ come from\?$/i.test(title)) {
      await improveSourcePrompt(title, textEl);
      return;
    }

    stabilizeChoiceList(title, textEl);
  }

  function startObserver() {
    const assistScreen = document.getElementById('assistScreen');
    if (!assistScreen) {
      setTimeout(startObserver, 100);
      return;
    }

    /*
      Extra capture-phase protection: while the specific Field/Storage picker
      is active, a stale/ghost click can never activate Skip even if the
      inline scanner temporarily changes its styles during a rerender.
    */
    document.addEventListener(
      'click',
      event => {
        const skipBtn = document.getElementById('assistSkipBtn');
        if (!skipBtn || event.target !== skipBtn) return;

        const title = clean(document.getElementById('assistTitle')?.textContent);
        const isField = /^which field did this .+ come from\?$/i.test(title);
        const isStorage = /^which grain storage site did this .+ come from\?$/i.test(title);

        if (isField || isStorage) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );

    let enhancementFrame = 0;

    const scheduleEnhancements = () => {
      if (enhancementFrame) return;
      enhancementFrame = requestAnimationFrame(() => {
        enhancementFrame = 0;
        applyPromptEnhancements();
      });
    };

    /*
      PERFORMANCE / iPHONE SAFETY

      Do NOT observe the whole assist popup subtree. Search typing rebuilds the
      result list on every keystroke; watching that subtree caused the helper to
      rerun continuously while the driver typed and could make Safari appear to
      freeze or drop the page.

      We only need to know when a new Driver Assist question is shown. Watch
      the question title and the screen visibility class, not search results.
    */
    const titleEl = document.getElementById('assistTitle');
    const titleObserver = new MutationObserver(scheduleEnhancements);
    if (titleEl) {
      titleObserver.observe(titleEl, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    const screenObserver = new MutationObserver(scheduleEnhancements);
    screenObserver.observe(assistScreen, {
      attributes: true,
      attributeFilter: ['class']
    });

    scheduleEnhancements();
    loadStorageInventory();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}
