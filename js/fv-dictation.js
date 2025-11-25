/* =======================================================================
/Farm-vista/js/fv-dictation.js
Rev: 2025-11-25a

Shared dictation (microphone) helper for FarmVista textareas.

Usage on a page:

  <script type="module">
    import { wireDictation } from '/Farm-vista/js/fv-dictation.js';

    wireDictation('mic-notes', 'notes'); // button id, textarea id
    wireDictation('mic-priority', 'priorityReason');
  </script>

The CSS + HTML pattern is shown below in the chat.
======================================================================= */

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
