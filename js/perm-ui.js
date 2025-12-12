/* =========================================================
   FarmVista — Permission UI Controller (GLOBAL)
   Purpose:
   - Enforce permissions visually + behaviorally
   - VIEW users see everything
   - ADD / EDIT / DELETE get disabled (not hidden)
   - No per-page JS required
   ========================================================= */

(function () {
  'use strict';

  /* ---------- Config ---------- */

  const DISABLED_CLASS = 'fv-perm-disabled';
  const TOOLTIP_TEXT  = 'You do not have permission to perform this action.';

  // Elements considered interactive
  const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'select',
    'textarea',
    '[role="button"]'
  ].join(',');

  /* ---------- Permission check ---------- */

  function can(permission) {
    try {
      if (window.FV && typeof window.FV.can === 'function') {
        return !!window.FV.can(permission);
      }
    } catch (e) {}
    return true; // fail-open in dev/stub
  }

  /* ---------- Disable helpers ---------- */

  function disableElement(el, reason) {
    if (!el || el.classList.contains(DISABLED_CLASS)) return;

    el.classList.add(DISABLED_CLASS);
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', reason || TOOLTIP_TEXT);

    // Native form controls
    if ('disabled' in el) {
      el.disabled = true;
    }

    // Prevent navigation / clicks
    el.addEventListener('click', blockEvent, true);
    el.addEventListener('keydown', blockEvent, true);
  }

  function blockEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  /* ---------- Core evaluator ---------- */

  function applyPermissions(root = document) {
    const nodes = root.querySelectorAll('[data-perm]');

    nodes.forEach(el => {
      const perm = el.getAttribute('data-perm');
      if (!perm) return;

      // If allowed → leave alone
      if (can(perm)) return;

      // If container (not interactive), just dim it
      if (!el.matches(INTERACTIVE_SELECTOR)) {
        el.classList.add(DISABLED_CLASS);
        el.setAttribute('title', TOOLTIP_TEXT);
        return;
      }

      // Interactive element → disable
      disableElement(el, TOOLTIP_TEXT);
    });
  }

  /* ---------- Observe dynamic DOM changes ---------- */

  function watchDOM() {
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            applyPermissions(n);
          }
        });
      });
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /* ---------- Boot ---------- */

  function boot() {
    applyPermissions(document);
    watchDOM();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})();
