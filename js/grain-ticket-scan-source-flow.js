const path = String(window.location.pathname || '').toLowerCase();
const params = new URLSearchParams(window.location.search);

/*
  Signed-in, in-app grain ticket scan only.

  During harvest the driver source question is intentionally simple:
    1. Active Harvest
    2. Field

  Grain Storage is removed from this Driver Assist question entirely.
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
  let lastPromptKey = '';

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

  function improveMainSourcePrompt(textEl) {
    const activeButton = buttonByText('Active Field Harvest');
    const storageButton = buttonByText('Grain Storage');

    if (activeButton) {
      activeButton.textContent = 'Active Harvest';
    }

    /*
      Storage is deliberately not part of the harvest scan decision.
      The driver should only decide between generic Active Harvest
      and a specific Field.
    */
    if (storageButton) {
      storageButton.remove();
    }

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
      requestAnimationFrame(applyPromptEnhancements);
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
