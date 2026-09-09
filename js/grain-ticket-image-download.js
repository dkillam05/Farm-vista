/* FarmVista — saved grain ticket image download/share
   Rev 2026-09-09d
   Uniform support for Ticket Detail, Grain Inventory drill-down,
   and Grain Contract Report ticket popup.
*/
(() => {
  'use strict';
  if (window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260909D) return;
  window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260909D = true;

  const style = document.createElement('style');
  style.id = 'fv-ticket-image-download-style';
  style.textContent = `
    .fv-ticket-download-btn{min-height:42px;padding:9px 15px;border:1px solid #3B7E46!important;border-radius:10px;background:#3B7E46!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font:inherit;font-weight:850;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;text-decoration:none}
    .fv-ticket-download-btn:hover,.fv-ticket-download-btn:focus{background:#326d3c!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-btn:disabled{opacity:.65;cursor:wait;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-row{display:flex;justify-content:flex-start;gap:8px;padding:10px 0 12px;width:100%}
    @media(max-width:560px){.fv-ticket-download-row .fv-ticket-download-btn{width:100%}}
  `;
  document.head.appendChild(style);

  const clean = value => String(value || '').trim();
  const prepared = new WeakMap();
  const isMobileShareDevice = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches;

  function extensionFrom(blob,url){
    const type=clean(blob?.type).toLowerCase();
    if(type.includes('png')) return 'png';
    if(type.includes('webp')) return 'webp';
    if(type.includes('heic')||type.includes('heif')) return 'heic';
    if(type.includes('pdf')) return 'pdf';
    if(type.includes('jpeg')||type.includes('jpg')) return 'jpg';
    const match=clean(url).match(/\.(jpe?g|png|webp|heic|heif|pdf)(?:[?#]|$)/i);
    return match?match[1].toLowerCase().replace('jpeg','jpg'):'jpg';
  }

  function ticketName(){
    const detailTicket=clean(document.querySelector('#ticketNumber')?.value||document.querySelector('[data-ticket-number]')?.dataset?.ticketNumber);
    const popupTitle=clean(document.querySelector('#ticketPopupTitle')?.textContent||document.querySelector('#ticket-image-modal-title')?.textContent||document.querySelector('#fv-ticket-image-title')?.textContent);
    const source=detailTicket||popupTitle.match(/(?:ticket\s*)?#?([A-Za-z0-9-]{3,})/i)?.[1]||new URLSearchParams(location.search).get('id')||'image';
    return `grain-ticket-${String(source).replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'image'}`;
  }

  async function buildFile(image){
    const url=clean(image?.currentSrc||image?.src);
    if(!url) throw new Error('No ticket image URL available.');
    const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache'});
    if(!response.ok) throw new Error(`Image request failed (${response.status})`);
    const blob=await response.blob();
    const ext=extensionFrom(blob,url);
    return new File([blob],`${ticketName()}.${ext}`,{type:blob.type||`image/${ext==='jpg'?'jpeg':ext}`});
  }

  function setReady(button){
    if(!button?.isConnected) return;
    button.disabled=false;
    button.textContent='Download Image';
    button.title='';
  }

  function prepareForShare(image,button){
    if(!isMobileShareDevice()||!navigator.share) return;
    const url=clean(image?.currentSrc||image?.src);
    if(!url) return;
    const existing=prepared.get(image);
    if(existing?.url===url&&(existing.file||existing.promise)) return;
    const state={url,file:null,promise:null,error:null};
    prepared.set(image,state);
    setReady(button);
    state.promise=buildFile(image).then(file=>{state.file=file;state.error=null;setReady(button);return file;}).catch(error=>{state.error=error;console.warn('[FarmVista] Ticket image prefetch unavailable; will retry on tap:',error);setReady(button);return null;});
  }

  function shareUrlDirect(url){
    if(!url || !navigator.share) return false;
    navigator.share({title:'Grain Ticket Image',url}).catch(error=>{
      if(error?.name==='AbortError') return;
      console.warn('[FarmVista] Native ticket-image URL share failed:',error);
      alert('The iPhone share sheet could not open. Please try again.');
    });
    return true;
  }

  async function shareMobile(image,button){
    const url=clean(image?.currentSrc||image?.getAttribute('src')||image?.src);
    let state=prepared.get(image);
    let file=state?.file;

    // If prefetch already proved Firebase will not expose image bytes,
    // share the saved image URL directly from this user tap. This keeps
    // Safari on FarmVista and opens the native share sheet immediately.
    if(!file && state?.error && url){
      shareUrlDirect(url);
      return;
    }

    if(!file){
      const old=button.textContent;
      button.disabled=true;
      button.textContent='Preparing…';
      try{
        file=await buildFile(image);
        state={url,file,promise:Promise.resolve(file),error:null};
        prepared.set(image,state);
      }catch(error){
        console.warn('[FarmVista] Ticket image file share unavailable; using URL share:',error);
        if(url){
          shareUrlDirect(url);
          return;
        }
        alert('FarmVista could not access this ticket image. Please try again.');
        return;
      }finally{
        button.disabled=false;
        button.textContent=old;
      }
    }

    if(navigator.canShare&&!navigator.canShare({files:[file]})){
      if(url){shareUrlDirect(url);return;}
      alert('This device cannot share the saved ticket image.');
      return;
    }

    try{
      await navigator.share({files:[file],title:'Grain Ticket Image'});
    }catch(error){
      if(error?.name==='AbortError') return;
      console.warn('[FarmVista] Native ticket-image file share failed; trying URL share:',error);
      if(url){shareUrlDirect(url);return;}
      alert('The iPhone share sheet could not open. Please try again.');
    }
  }

  async function downloadDesktop(image,button){
    const old=button.textContent;button.disabled=true;button.textContent='Preparing…';
    try{
      const file=await buildFile(image);const blobUrl=URL.createObjectURL(file);const a=document.createElement('a');a.href=blobUrl;a.download=file.name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(blobUrl),30000);
    }catch(error){console.warn('[FarmVista] Ticket image download failed:',error);alert('FarmVista could not prepare this ticket image for download. Please try again.');}
    finally{button.disabled=false;button.textContent=old;}
  }

  function activateImage(image,button){
    if(isMobileShareDevice()&&navigator.share){shareMobile(image,button);return;}
    downloadDesktop(image,button);
  }

  function makeButton(image,key){
    const button=document.createElement('button');button.type='button';button.className='fv-ticket-download-btn';button.textContent='Download Image';button.dataset.fvTicketDownload=key;button.setAttribute('aria-label','Download or share saved grain ticket image');
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();activateImage(image,button);});
    prepareForShare(image,button);return button;
  }
  function makeRow(image,key){const row=document.createElement('div');row.className='fv-ticket-download-row';row.dataset.fvTicketDownloadRow=key;row.hidden=!clean(image?.currentSrc||image?.getAttribute('src')||image?.src);row.appendChild(makeButton(image,key));return row;}
  function refreshPreparation(image,button){if(!image||!button)return;const url=clean(image.currentSrc||image.getAttribute('src')||image.src);const row=button.closest('.fv-ticket-download-row');if(row)row.hidden=!url;if(!url)return;const state=prepared.get(image);if(state?.url!==url)prepareForShare(image,button);}

  function enhanceDetail(){
    const image=document.getElementById('ticketImage');if(!image)return;const card=image.closest('.image-card')||image.closest('.card');const wrap=document.getElementById('ticketImageWrap')||image.parentElement;if(!card||!wrap)return;
    let row=card.querySelector('[data-fv-ticket-download-row="detail"]');if(!row){row=makeRow(image,'detail');const helper=card.querySelector('.card-sub');if(helper)helper.insertAdjacentElement('afterend',row);else wrap.insertAdjacentElement('beforebegin',row);}refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }
  function enhanceInventory(){
    const image=document.querySelector('.fv-ticket-image-body img')||document.getElementById('ticket-image-modal-img');if(!image)return;const body=image.closest('.fv-ticket-image-body')||image.parentElement;if(!body)return;const dialog=image.closest('.fv-ticket-image-dialog')||image.closest('.modal-card')||body.parentElement;let row=dialog?.querySelector('[data-fv-ticket-download-row="inventory"]');if(!row){row=makeRow(image,'inventory');body.insertAdjacentElement('beforebegin',row);}refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }
  function enhanceContractReport(){
    const image=document.getElementById('ticketPopupImage');const wrap=image?.closest('.ticket-image-wrap');if(!image||!wrap)return;const parent=wrap.parentElement;let row=parent?.querySelector(':scope > [data-fv-ticket-download-row="contract"]');if(!row){row=makeRow(image,'contract');wrap.insertAdjacentElement('beforebegin',row);}refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }
  function removeOldDetailButton(){document.querySelectorAll('.image-actions [data-fv-ticket-download]').forEach(button=>button.remove());}
  function enhance(){removeOldDetailButton();enhanceDetail();enhanceInventory();enhanceContractReport();}
  enhance();
  const observer=new MutationObserver(enhance);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
})();
