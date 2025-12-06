/* =======================================================================
/Farm-vista/js/fv-dictation.js
Rev: 2025-11-25b

Shared dictation (microphone) helper for FarmVista textareas.

Usage on a page:

  <script type="module">
    import { wireDictation } from '/Farm-vista/js/fv-dictation.js';

    wireDictation('mic-notes', 'notes');        // button id, textarea id
    wireDictation('mic-priority', 'priorityReason');
  </script>

This version:
  • Injects a standard SVG microphone icon into the button
  • Styles it as: grey idle / green active (no blue)
  • Hides the button if dictation is not supported
======================================================================= */

let _micStylesInjected = false;

function injectMicStyles() {
  if (_micStylesInjected) return;
  _micStylesInjected = true;

  const css = `
    .fv-mic-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 999px;
      border: 1px solid #d1d5db; /* neutral grey */
      background: #f9fafb;
      padding: 0;
      margin: 0;
      cursor: pointer;
      transition:
        background-color 0.18s ease-out,
        border-color 0.18s ease-out,
        box-shadow 0.18s ease-out;
    }

    .fv-mic-btn:focus-visible {
      outline: 2px solid #15803d; /* green focus ring */
      outline-offset: 2px;
    }

    .fv-mic-btn .fv-mic-icon {
      width: 1.25rem;
      height: 1.25rem;
      fill: #6b7280; /* grey idle */
      transition: fill 0.18s ease-out;
    }

    .fv-mic-btn.mic-active {
      background: #ecfdf3;   /* soft green */
      border-color: #15803d; /* strong green border */
      box-shadow: 0 0 0 1px rgba(21, 128, 61, 0.2);
    }

    .fv-mic-btn.mic-active .fv-mic-icon {
      fill: #166534; /* green active */
    }

    /* make sure the button doesn't shrink weirdly inside flex layouts */
    .fv-mic-btn {
      flex: 0 0 auto;
    }
  `;

  const style = document.createElement('style');
  style.setAttribute('data-fv-mic-style', '1');
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureButtonMarkup(btn) {
  injectMicStyles();

  // Prevent form submit when used inside <form>
  if (!btn.getAttribute('type')) {
    btn.setAttribute('type', 'button');
  }

  // Base class for consistent styling
  btn.classList.add('fv-mic-btn');

  // If there's already our SVG, don't overwrite it
  if (!btn.querySelector('svg.fv-mic-icon')) {
    btn.innerHTML = `
      <svg class="fv-mic-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z"/>
      </svg>
    `;
  }
}

export function wireDictation(buttonId, textareaId) {
  const btn = document.getElementById(buttonId);
  const ta  = document.getElementById(textareaId);
  if (!btn || !ta) return;

  // Check browser support
  const ok =
    'webkitSpeechRecognition' in window ||
    'SpeechRecognition' in window;

  if (!ok) {
    // Hide mic if dictation is not supported
    btn.style.display = 'none';
    return;
  }

  // Ensure consistent icon + styling
  ensureButtonMarkup(btn);

  const Rec =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;

  let active   = false;
  let baseText = '';

  function setMic(on) {
    btn.classList.toggle('mic-active', on);
    btn.setAttribute(
      'aria-label',
      on ? 'Stop dictation' : 'Start dictation'
    );
  }

  btn.addEventListener('click', () => {
    if (!active) {
      // Start listening and remember current text
      baseText = ta.value ? ta.value + ' ' : '';
      try {
        rec.start();
        active = true;
        setMic(true);
      } catch {
        // ignore errors from double-start
      }
    } else {
      // Stop listening
      try {
        rec.stop();
        rec.abort();
      } catch {
        // ignore
      }
      active = false;
      setMic(false);
    }
  });

  rec.onresult = (ev) => {
    let txt = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      txt += ev.results[i][0].transcript;
    }
    ta.value = baseText + txt;
  };

  rec.onend = () => {
    active = false;
    setMic(false);
  };

  rec.onerror = () => {
    active = false;
    setMic(false);
  };
}
