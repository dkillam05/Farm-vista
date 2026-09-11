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
  Signed-in in-app grain ticket scan helper.
  Guest/load-out token scans intentionally remain untouched here.
*/
if (
  !path.endsWith('/pages/grain/grain-ticket-scan.html') ||
  params.has('t') ||
  params.has('token')
) {
  // no-op
} else {
  const clean = value => String(value == null ? '' : value).trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  const words = value =>
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  let duplicateCheckPromise = null;
  let duplicateTicket = null;
  let duplicateHandled = false;
  let lastOcrGrainTicket = null;

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
    const elevatorName = norm(grainTicket?.elevatorName || grainTicket?.ocrElevatorName);
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

          if (grainTicket) {
            lastOcrGrainTicket = grainTicket;
          }

          if (
            grainTicket?.ticketNumber &&
            (grainTicket?.elevatorName || grainTicket?.ocrElevatorName)
          ) {
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

  /*
    Resolve the Destination Driver Assist question from OCR before the driver
    ever has to answer it.

    Priority:
      1. exactly one city/state match -> use it
      2. if city/state has several matches, narrow by elevator/buyer wording
      3. otherwise leave the normal question visible rather than guessing

    This intentionally does NOT require ZIP to match because several elevator
    printers use a mailing ZIP that differs from FarmVista's physical-address
    ZIP for the same destination.
  */
  function destinationMatchesFromOcr() {
    const ticket = lastOcrGrainTicket;
    if (!ticket) return [];

    const elevator = clean(
      ticket.elevatorName ||
      ticket.ocrElevatorName ||
      ticket.buyerName
    );
    const city = clean(
      ticket.deliveryCity ||
      ticket.ocrDeliveryCity
    );
    const state = clean(
      ticket.deliveryState ||
      ticket.ocrDeliveryState
    );

    if (!city) return [];

    const cityWords = words(city);
    const stateWords = words(state);
    if (!cityWords.length) return [];

    const options = Array.from(
      document.querySelectorAll('#assistBody .assist-dropdown-option')
    );

    const cityStateMatches = options.filter(option => {
      const optionWords = new Set(words(option.textContent));
      const cityMatches = cityWords.every(word => optionWords.has(word));
      const stateMatches = !stateWords.length || stateWords.every(word => optionWords.has(word));
      return cityMatches && stateMatches;
    });

    if (cityStateMatches.length <= 1) {
      return cityStateMatches;
    }

    const ignoredElevatorWords = new Set([
      'processing', 'grain', 'grains', 'company', 'co', 'inc', 'llc',
      'elevator', 'terminal', 'terminals', 'facility', 'plant', 'the'
    ]);

    const elevatorWords = words(elevator)
      .filter(word => word.length >= 3 && !ignoredElevatorWords.has(word));

    if (!elevatorWords.length) return [];

    return cityStateMatches.filter(option => {
      const optionWords = new Set(words(option.textContent));
      return elevatorWords.some(word => optionWords.has(word));
    });
  }

  function resolveDestinationPromptFromOcr() {
    const title = clean(document.getElementById('assistTitle')?.textContent);
    if (!/^where was this load delivered\?$/i.test(title)) return false;

    const matches = destinationMatchesFromOcr();
    if (matches.length !== 1) return false;

    console.log(
      '[Grain Ticket Source Flow] Destination resolved from OCR; Driver Assist skipped:',
      clean(matches[0].textContent)
    );

    matches[0].click();
    return true;
  }

  function resolveDestinationBeforeShowingPrompt(generation) {
    const screen = document.getElementById('assistScreen');
    if (!screen) return;

    const title = clean(document.getElementById('assistTitle')?.textContent);
    if (!/^where was this load delivered\?$/i.test(title) || !lastOcrGrainTicket) {
      return;
    }

    /* Hide only this destination prompt while FarmVista resolves known OCR. */
    screen.classList.remove('show');

    const processingScreen = document.getElementById('processingScreen');
    const processingText = document.getElementById('processingText');
    if (processingText) processingText.textContent = 'Matching destination…';
    processingScreen?.classList.add('show');

    const attempts = [0, 60, 160, 320];

    attempts.forEach((delay, index) => {
      setTimeout(() => {
        if (generation !== assistGeneration) return;

        const currentTitle = clean(document.getElementById('assistTitle')?.textContent);
        if (!/^where was this load delivered\?$/i.test(currentTitle)) return;

        if (resolveDestinationPromptFromOcr()) {
          processingScreen?.classList.remove('show');
          return;
        }

        if (index === attempts.length - 1) {
          processingScreen?.classList.remove('show');
          screen.classList.add('show');
        }
      }, delay);
    });
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

    if (!isField && !isStorage) return;

    if (textEl) {
      const wantedText = isField
        ? 'Choose the field this grain came from.'
        : 'Choose the bin site or grain bag site.';

      if (clean(textEl.textContent) !== wantedText) {
        textEl.textContent = wantedText;
      }
    }

    if (skipBtn) {
      skipBtn.style.display = 'none';
      skipBtn.disabled = true;
    }
  }

  function restoreSkipButtonForOtherPrompts(title) {
    const isField = /^which field did this .+ come from\?$/i.test(clean(title));
    const isStorage = /^which grain storage site did this .+ come from\?$/i.test(clean(title));
    if (isField || isStorage) return;

    const skipBtn = document.getElementById('assistSkipBtn');
    if (!skipBtn) return;

    skipBtn.style.display = '';
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

    if (/^where was this load delivered\?$/i.test(title)) {
      resolveDestinationBeforeShowingPrompt(generation);
      return;
    }

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
