/* FarmVista — saved grain ticket image download/share
   Rev 2026-09-09
   Uniform support for Ticket Detail, Grain Inventory drill-down,
   and Grain Contract Report ticket popup.
*/
(() => {
  'use strict';
  if (window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260909) return;
  window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260909 = true;

  const style = document.createElement('style');
  style.id = 'fv-ticket-image-download-style';
  style.textContent = `
    .fv-ticket-download-btn{
      min-height:40px;padding:8px 12px;border:1px solid #3B7E46;border-radius:9px;
      background:#3B7E46;color:#fff;font:inherit;font-weight:850;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;
    }
    .fv-ticket-download-btn:disabled{opacity:.5;cursor:not-allowed}
    .fv-ticket-download-row{display:flex;justify-content:flex-end;gap:8px;padding:10px 0 0}
    .fv-ticket-image-head-download{margin-left:auto}
    @media(max-width:560px){
      .fv-ticket-download-row .fv-ticket-download-btn{width:100%}
      .fv-ticket-image-head-download{min-height:38px;padding:7px 9px;font-size:12px}
    }
  `;
  document.head.appendChild(style);

  const clean = value => String(value || '').trim();

  function extensionFrom(blob, url){
    const type = clean(blob?.type).toLowerCase();
    if(type.includes('png')) return 'png';
    if(type.includes('webp')) return 'webp';
    if(type.includes('heic') || type.includes('heif')) return 'heic';
    if(type.includes('pdf')) return 'pdf';
    if(type.includes('jpeg') || type.includes('jpg')) return 'jpg';
    const match = clean(url).match(/\.(jpe?g|png|webp|heic|heif|pdf)(?:[?#]|$)/i);
    return match ? match[1].toLowerCase().replace('jpeg','jpg') : 'jpg';
  }

  function ticketName(image){
    const detailTicket = clean(document.querySelector('#ticketNumber')?.value || document.querySelector('[data-ticket-number]')?.dataset?.ticketNumber);
    const popupTitle = clean(document.querySelector('#ticketPopupTitle')?.textContent || document.querySelector('#ticket-image-modal-title')?.textContent || document.querySelector('#fv-ticket-image-title')?.textContent);
    const source = detailTicket || popupTitle.match(/(?:ticket\s*)?#?([A-Za-z0-9-]{3,})/i)?.[1] || new URLSearchParams(location.search).get('id') || 'image';
    return `grain-ticket-${String(source).replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'') || 'image'}`;
  }

  async function saveImage(image, button){
    const url = clean(image?.currentSrc || image?.src);
    if(!url) return;

    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing…';

    try{
      const response = await fetch(url, {mode:'cors', credentials:'omit'});
      if(!response.ok) throw new Error(`Image request failed (${response.status})`);
      const blob = await response.blob();
      const ext = extensionFrom(blob, url);
      const filename = `${ticketName(image)}.${ext}`;
      const file = new File([blob], filename, {type: blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`});
      const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches;

      if(mobile && navigator.share && navigator.canShare?.({files:[file]})){
        await navigator.share({files:[file], title:'Grain Ticket Image'});
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    } catch(error){
      console.warn('[FarmVista] Ticket image download fallback:', error);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ticketName(image)}.jpg`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function makeButton(image, extraClass=''){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fv-ticket-download-btn ${extraClass}`.trim();
    button.textContent = 'Download Image';
    button.setAttribute('aria-label','Download saved grain ticket image');
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      saveImage(image, button);
    });
    return button;
  }

  function enhanceDetail(){
    const image = document.getElementById('ticketImage');
    const actions = document.querySelector('.image-actions');
    if(!image || !actions || actions.querySelector('[data-fv-ticket-download="detail"]')) return;
    const button = makeButton(image);
    button.dataset.fvTicketDownload = 'detail';
    actions.appendChild(button);
  }

  function enhanceInventory(){
    const image = document.querySelector('.fv-ticket-image-body img') || document.getElementById('ticket-image-modal-img');
    if(!image) return;
    const head = image.closest('.fv-ticket-image-dialog')?.querySelector('.fv-ticket-image-head') || document.querySelector('#ticket-image-modal-backdrop .modal-head');
    if(!head || head.querySelector('[data-fv-ticket-download="inventory"]')) return;
    const button = makeButton(image, 'fv-ticket-image-head-download');
    button.dataset.fvTicketDownload = 'inventory';
    const close = head.querySelector('.fv-ticket-image-close,.modal-close');
    if(close) head.insertBefore(button, close); else head.appendChild(button);
  }

  function enhanceContractReport(){
    const image = document.getElementById('ticketPopupImage');
    const wrap = image?.closest('.ticket-image-wrap');
    if(!image || !wrap || wrap.parentElement?.querySelector(':scope > [data-fv-ticket-download-row="contract"]')) return;
    const row = document.createElement('div');
    row.className = 'fv-ticket-download-row';
    row.dataset.fvTicketDownloadRow = 'contract';
    const button = makeButton(image);
    button.dataset.fvTicketDownload = 'contract';
    row.appendChild(button);
    wrap.insertAdjacentElement('afterend', row);
  }

  function enhance(){
    enhanceDetail();
    enhanceInventory();
    enhanceContractReport();
  }

  enhance();
  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
