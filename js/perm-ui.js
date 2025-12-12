/* =========================================================
   FarmVista — Permission UI Controller (GLOBAL, HYBRID)
   - Tiles/portals: HIDE when denied (clean UI)
   - Forms/modals: SHOW but DISABLE when denied (greyed out)
   - Containers with data-perm disable ALL interactive descendants
   - Re-applies when perms arrive (fv:user-ready)
   ========================================================= */

(function () {
  'use strict';

  // prevent double-load
  if (window.__FV_PERM_UI_LOADED__) return;
  window.__FV_PERM_UI_LOADED__ = true;

  const DISABLED_CLASS = 'fv-perm-disabled';
  const TOOLTIP_TEXT  = 'You do not have permission to perform this action.';

  const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[tabindex]'
  ].join(',');

  // These are considered "tiles" → hide when denied
  const TILE_SELECTOR = [
    'fv-form-button',
    '[data-fv-tile="true"]'
  ].join(',');

  function can(permission) {
    try {
      if (window.FV && typeof window.FV.can === 'function') {
        return !!window.FV.can(permission);
      }
    } catch (e) {}
    // fail-open until perms load (we'll re-apply on fv:user-ready)
    return true;
  }

  function blockEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  function hideOne(el) {
    if (!el) return;
    el.setAttribute('hidden', 'hidden');
  }

  function disableOne(el, reason) {
    if (!el || el.classList.contains(DISABLED_CLASS)) return;

    el.classList.add(DISABLED_CLASS);
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', reason || TOOLTIP_TEXT);

    if ('disabled' in el) el.disabled = true;

    // prevent clicks/navigation
    el.addEventListener('click', blockEvent, true);
    el.addEventListener('keydown', blockEvent, true);
  }

  function disableDescendants(container, reason) {
    const kids = container.querySelectorAll(INTERACTIVE_SELECTOR);
    kids.forEach(k => disableOne(k, reason));
  }

  // Heuristic: if a container holds tiles, treat it like a "portal area" → hide when denied
  function containerLooksLikePortal(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches('dialog, .modal, .dialog, .sheet')) return false;
    if (el.querySelector('fv-form-button')) return true;
    if (el.classList.contains('form-tiles')) return true;
    return false;
  }

  function applyPermissions(root = document) {
    const nodes = root.querySelectorAll('[data-perm]');
    nodes.forEach(el => {
      const perm = el.getAttribute('data-perm');
      if (!perm) return;

      if (can(perm)) return;

      // denied:
      // 1) Tile itself → hide
      if (el.matches(TILE_SELECTOR)) {
        hideOne(el);
        return;
      }

      // 2) Portal container → hide
      if (!el.matches(INTERACTIVE_SELECTOR) && containerLooksLikePortal(el)) {
        hideOne(el);
        return;
      }

      // 3) Interactive element → disable
      if (el.matches(INTERACTIVE_SELECTOR)) {
        disableOne(el, TOOLTIP_TEXT);
        return;
      }

      // 4) Normal container → show but disable all interactive children
      el.classList.add(DISABLED_CLASS);
      el.setAttribute('title', TOOLTIP_TEXT);
      disableDescendants(el, TOOLTIP_TEXT);
    });
  }

  function watchDOM() {
    const obs = new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) applyPermissions(n);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    applyPermissions(document);
    watchDOM();

    // Re-apply when perms are ready/updated (fixes “blank modal” + late perms)
    document.addEventListener('fv:user-ready', () => {
      try { applyPermissions(document); } catch {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
