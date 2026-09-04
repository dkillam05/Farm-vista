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

  Harvest source choices:
    1. Active Harvest
    2. Field

  Also hold Driver Assist until FarmVista has checked whether the OCR ticket
  already exists. Duplicate tickets should go straight to Already Scanned
  without asking the driver any source questions.

  Guest/load-out scans remain predefined and untouched.
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

  function sourceButtons() {
    return Array.from(document.querySelectorAll('#assistBody .assist-choice'));
  }

  function buttonByText(text) {
    const wanted = clean(text).toLowerCase();
    return sourceButtons().find(
      button => clean(button.textContent).toLowerCase() === wanted
    ) || null;
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
    Capture the parsed OCR ticket as soon as the OCR response comes back.
    The scanner's normal duplicate protection still remains in place later;
    this is only an early UX gate so drivers never answer questions for a
    ticket FarmVista already has.
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
      Resolve any hidden Driver Assist promise so the scanner can reach its
      existing duplicate guard. The driver never sees or answers the prompt.
    */
    const skip = document.getElementById('assistSkipBtn');
    if (skip) skip.click();
  }

  function improveMainSourcePrompt(textEl) {
    const activeButton = buttonByText('Active Field Harvest');
    const storageButton = buttonByText('Grain Storage');

    if (activeButton) activeButton.textContent = 'Active Harvest';
    if (storageButton) storageButton.remove();

    if (textEl) {
      textEl.textContent = 'Choose Active Harvest or the field this grain came from.';
    }
  }

  function autoOpenFieldList(title, textEl) {
    const isFieldPrompt = /^which field did this .+ come from\?$/i.test(clean(title));
    if (!isFieldPrompt) return;

    if (textEl) {
      textEl.textContent =
        'Tap the field this grain came from. FarmVista will continue automatically after you choose it.';
    }

    const dropdown = document.querySelector('#assistBody .assist-dropdown');
    const trigger = document.querySelector('#assistBody .assist-dropdown-trigger');

    if (dropdown && trigger && !dropdown.classList.contains('open')) {
      trigger.click();
    }
  }

  async function applyPromptEnhancements() {
    const screen = document.getElementById('assistScreen');
    if (!screen?.classList.contains('show')) return;

    if (duplicateCheckPromise) {
      screen.classList.remove('show');
      const processingScreen = document.getElementById('processingScreen');
      const processingText = document.getElementById('processingText');
      if (processingText) processingText.textContent = 'Checking for duplicate ticket…';
      processingScreen?.classList.add('show');

      await duplicateCheckPromise;
      duplicateCheckPromise = null;

      if (duplicateTicket) {
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

    const titleEl = document.getElementById('assistTitle');
    const textEl = document.getElementById('assistText');
    const title = clean(titleEl?.textContent);
    if (!title) return;

    const key = `${title}|${document.getElementById('assistBody')?.textContent || ''}`;
    if (key === lastPromptKey) return;
    lastPromptKey = key;

    if (/^where did this load of .+ come from\?$/i.test(title)) {
      improveMainSourcePrompt(textEl);
      return;
    }

    autoOpenFieldList(title, textEl);
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

    applyPromptEnhancements();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
}
