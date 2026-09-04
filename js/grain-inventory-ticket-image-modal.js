/* FarmVista Grain Inventory — harvest ticket image modal
   Rev 2026-09-04
   Keeps ticket image viewing inside the current FarmVista page on PWA,
   mobile browser, and desktop browser. No window.open / new tab.
*/
(() => {
  if (window.__FV_GRAIN_INVENTORY_TICKET_IMAGE_MODAL_20260904) return;
  window.__FV_GRAIN_INVENTORY_TICKET_IMAGE_MODAL_20260904 = true;

  const style = document.createElement('style');
  style.textContent = `
    .fv-ticket-image-backdrop{position:fixed;z-index:13050;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.72)}
    .fv-ticket-image-backdrop.open{display:flex}
    .fv-ticket-image-dialog{position:relative;width:min(920px,100%);max-height:calc(100vh - 36px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;background:var(--surface,#fff);color:var(--text,#111);box-shadow:0 20px 65px rgba(0,0,0,.42)}
    .fv-ticket-image-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border,#ddd)}
    .fv-ticket-image-title{font-size:1rem;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fv-ticket-image-close{flex:0 0 auto;width:42px;height:42px;border:0;border-radius:10px;background:var(--surface-2,#eee);color:inherit;font:inherit;font-size:1.35rem;cursor:pointer}
    .fv-ticket-image-body{min-height:0;overflow:auto;padding:12px;text-align:center;background:var(--surface-2,#f4f4f4)}
    .fv-ticket-image-body img{display:block;max-width:100%;height:auto;max-height:calc(100vh - 120px);margin:0 auto;object-fit:contain}
    .fv-ticket-image-empty{padding:40px 18px;font-weight:700}
    .fv-harvest-ticket-number{appearance:none;-webkit-appearance:none;border:0;padding:0;background:none;color:var(--fv-green,#3B7E46);font:inherit;font-weight:800;text-decoration:none;cursor:pointer}
    .fv-harvest-ticket-number:hover,.fv-harvest-ticket-number:focus{text-decoration:underline}
    @media(max-width:560px){.fv-ticket-image-backdrop{padding:0}.fv-ticket-image-dialog{width:100%;height:100%;max-height:none;border-radius:0}.fv-ticket-image-body img{max-height:calc(100vh - 82px)}}
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'fv-ticket-image-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <div class="fv-ticket-image-dialog" role="dialog" aria-modal="true" aria-labelledby="fv-ticket-image-title">
      <div class="fv-ticket-image-head">
        <div class="fv-ticket-image-title" id="fv-ticket-image-title">Grain Ticket</div>
        <button type="button" class="fv-ticket-image-close" aria-label="Close ticket image">×</button>
      </div>
      <div class="fv-ticket-image-body"><div class="fv-ticket-image-empty">Loading ticket image…</div></div>
    </div>`;
  document.body.appendChild(backdrop);

  const title = backdrop.querySelector('.fv-ticket-image-title');
  const body = backdrop.querySelector('.fv-ticket-image-body');
  const closeButton = backdrop.querySelector('.fv-ticket-image-close');
  let previousOverflow = '';

  function close(){
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden','true');
    body.innerHTML = '';
    document.body.style.overflow = previousOverflow;
  }

  function open(url, ticketNumber){
    if(!url) return;
    title.textContent = ticketNumber ? `Grain Ticket ${ticketNumber}` : 'Grain Ticket';
    body.innerHTML = '';
    const img = document.createElement('img');
    img.alt = ticketNumber ? `Saved image for grain ticket ${ticketNumber}` : 'Saved grain ticket image';
    img.src = url;
    img.addEventListener('error', () => {
      body.innerHTML = '<div class="fv-ticket-image-empty">Unable to load the saved ticket image.</div>';
    }, {once:true});
    body.appendChild(img);
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden','false');
  }

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', event => { if(event.target === backdrop) close(); });
  document.addEventListener('keydown', event => { if(event.key === 'Escape' && backdrop.classList.contains('open')) close(); });

  /*
    The Inventory page currently renders a View button with the ticket id.
    Convert that existing control into the ticket number itself so no extra
    column/button remains. MutationObserver handles every drill-down render.
  */
  function enhanceHarvestTicketTable(){
    const content = document.getElementById('harvest-modal-content');
    if(!content) return;
    const table = content.querySelector('.harvest-drill-table');
    if(!table) return;

    const headers = [...table.querySelectorAll('thead th')];
    const viewIndex = headers.findIndex(th => th.textContent.trim().toLowerCase() === 'view');
    if(viewIndex < 0) return;

    const rows = [...table.querySelectorAll('tbody tr')];
    rows.forEach(row => {
      const cells = [...row.children];
      const viewCell = cells[viewIndex];
      const firstCell = cells[0];
      const oldButton = viewCell?.querySelector('[data-ticket-image]');
      if(!viewCell || !firstCell || !oldButton) return;

      const ticketId = oldButton.dataset.ticketImage || '';
      const oldLink = firstCell.querySelector('a.ticket-link');
      const ticketNumber = (oldLink?.textContent || firstCell.textContent || '').trim();
      const disabled = oldButton.disabled;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fv-harvest-ticket-number';
      button.textContent = ticketNumber;
      button.dataset.ticketImage = ticketId;
      if(disabled) button.disabled = true;
      firstCell.replaceChildren(button);

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if(button.disabled) return;
        const ticket = window.__fvInventoryTicketsById?.get?.(ticketId);
        const url = ticket?.ticketImageUrl || ticket?.imageUrl || ticket?.photoUrl || oldButton.dataset.imageUrl || '';
        if(url) open(url, ticketNumber);
      });
    });

    headers[viewIndex]?.remove();
    rows.forEach(row => row.children[viewIndex]?.remove());
  }

  /* Expose a tiny bridge for the page's existing ticket map and direct opener. */
  window.FVHarvestTicketImageModal = { open, close, enhance: enhanceHarvestTicketTable };

  const observer = new MutationObserver(() => enhanceHarvestTicketTable());
  const harvestContent = document.getElementById('harvest-modal-content');
  if(harvestContent) observer.observe(harvestContent,{childList:true,subtree:false});
  enhanceHarvestTicketTable();
})();
