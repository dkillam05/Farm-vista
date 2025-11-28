/* =======================================================================
/Farm-vista/js/fv-dictation.js
Rev: 2025-11-28

Shared dictation (microphone) helper for FarmVista textareas.

Usage on a page:

  <!-- Include once, near the top or bottom -->
  <script src="/Farm-vista/js/fv-dictation.js"></script>

  <!-- Then, after your textarea + button exist in the DOM -->
  <script>
    wireDictation('mic-notes', 'notes');              // button id, textarea id
    wireDictation('mic-priority', 'priorityReason');
  </script>

This version:
  • Injects a standard SVG microphone icon into the button (if missing)
  • Styles it as your square rounded-corner button:
        .mic-btn  / .mic-active / .mic-svg
  • Hides the button if dictation is not supported
======================================================================= */

(function () {
  'use strict';

  let _micStylesInjected = false;

  function injectMicStyles() {
    if (_micStylesInjected) return;
    _micStylesInjected = true;

    const css = `
      .mic-btn{
        position:absolute;
        right:10px;
        bottom:10px;
        width:36px;
        height:36px;
        border-radius:10px;
        border:1px solid var(--border);
        background:var(--surface);
        display:grid;
        place-items:center;
        cursor:pointer;
      }
      .mic-btn[disabled]{
        opacity:.6;
        cursor:not-allowed;
      }
      .mic-btn.mic-active{
        background:#2F6C3C;
        color:#fff;
        border-color:#2F6C3C;
      }
      .mic-svg{
        width:18px;
        height:18px;
        display:block;
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
    btn.classList.add('mic-btn');

    // If there's already our SVG, don't overwrite it
    if (!btn.querySelector('svg.mic-svg')) {
      btn.innerHTML = `
        <svg class="mic-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.93V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.07A7 7 0 0 0 19 11a1 1 0 1 0-2 0z"/>
        </svg>
      `;
    }
  }

  function wireDictation(buttonId, textareaId) {
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
        } catch (err) {
          // ignore errors from double-start etc.
          console.warn('Dictation start error:', err);
        }
      } else {
        // Stop listening
        try {
          rec.stop();
          rec.abort();
        } catch (err) {
          console.warn('Dictation stop error:', err);
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

  // Expose globally for non-module usage
  window.wireDictation = wireDictation;
})();
