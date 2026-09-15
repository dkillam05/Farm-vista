/* FarmVista — Grain Contracts hauling-job collapse / DND guard
   Sept. 11, 2026

   Prevent the compact hauling-job ticket UI from hiding or rebuilding an
   assigned-ticket area while a drag is active. The existing Grain Contracts
   DND code remains the source of truth for assigning / unassigning tickets.
*/
(() => {
  'use strict';

  if (window.__FV_HAULING_JOB_DND_GUARD_20260911) return;
  window.__FV_HAULING_JOB_DND_GUARD_20260911 = true;

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-contracts.html')) return;

  const ACTIVE_CLASS = 'fv-hauling-ticket-dnd-active';
  let releaseTimer = 0;

  const style = document.createElement('style');
  style.id = 'fv-hauling-job-dnd-guard-style';
  style.textContent = `
    body.${ACTIVE_CLASS} .fv-ticket-job-linked[data-fv-job-tickets-collapsed="1"]{
      display:block!important;
    }
    body.${ACTIVE_CLASS} .fv-job-ticket-collapse-row{
      pointer-events:none!important;
      opacity:.55;
    }
  `;
  document.head.appendChild(style);

  function begin() {
    clearTimeout(releaseTimer);
    document.body?.classList.add(ACTIVE_CLASS);

    document.querySelectorAll(
      '.fv-ticket-job-card .fv-ticket-job-linked[data-fv-job-tickets-collapsed="1"]'
    ).forEach(linked => {
      linked.dataset.fvJobTicketsCollapsed = '0';

      const card = linked.closest('.fv-ticket-job-card');
      const button = card?.querySelector('.fv-job-ticket-collapse-btn');
      if (button) button.setAttribute('aria-expanded', 'true');
    });
  }

  function finish() {
    clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(() => {
      document.body?.classList.remove(ACTIVE_CLASS);
    }, 350);
  }

  document.addEventListener('dragstart', event => {
    if (event.target?.closest?.('.fv-hauling-ticket-card[data-ticket-id]')) begin();
  }, true);

  document.addEventListener('dragend', event => {
    if (event.target?.closest?.('.fv-hauling-ticket-card[data-ticket-id]')) finish();
  }, true);

  document.addEventListener('drop', event => {
    if (
      document.body?.classList.contains(ACTIVE_CLASS) ||
      event.target?.closest?.('#fv-unassigned-ticket-list,.fv-ticket-job-card')
    ) {
      finish();
    }
  }, true);

  /*
    Touch DND uses pointer events instead of the browser dragstart event.
    Mark the interaction active as soon as an assigned ticket is pressed;
    release shortly after pointerup/cancel unless the core DND keeps working.
  */
  document.addEventListener('pointerdown', event => {
    const ticket = event.target?.closest?.(
      '.fv-ticket-job-linked .fv-hauling-ticket-card[data-ticket-id]'
    );
    if (!ticket || event.pointerType === 'mouse') return;
    begin();
  }, true);

  ['pointerup','pointercancel','touchend','touchcancel'].forEach(type => {
    document.addEventListener(type, finish, true);
  });
})();
