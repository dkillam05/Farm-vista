/* FarmVista — saved grain ticket image download/share
   Rev 2026-09-11h
   Uniform support for Ticket Detail, Grain Inventory drill-down,
   and Grain Contract Report ticket popup.

   Sept 11, 2026:
   Ticket Detail must never use a document-wide MutationObserver for this
   helper. The old observer called enhance() for every subtree mutation while
   enhance() itself added/removed DOM, which could keep the main thread busy
   during Ticket Detail startup. Ticket Detail now watches only ticketImage src.
*/
(() => {
  'use strict';
  if (window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260911H) return;
  window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260911H = true;

  const style = document.createElement('style');
  style.id = 'fv-ticket-image-download-style';
  style.textContent = `
    .fv-ticket-download-btn{min-height:42px;padding:9px 15px;border:1px solid #3B7E46!important;border-radius:10px;background:#3B7E46!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font:inherit;font-weight:850;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;text-decoration:none}
    .fv-ticket-download-btn:hover,.fv-ticket-download-btn:focus{background:#326d3c!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-btn:disabled{opacity:.65;cursor:wait;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-row{display:flex;justify-content:flex-start;gap:8px;padding:10px 0 12px;width:100%}
    @media(max-width:560px){.fv-ticket-download-row .fv-ticket-download-btn{width:100%}}
  `;
  if (!document.getElementById(style.id)) document.head.appendChild(style);

  const clean = value => String(value || '').trim();
  const prepared = new WeakMap();
  const isAppleMobile = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isMobileShareDevice = () => isAppleMobile() || /Android/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches;
  const readyLabel = () => isAppleMobile() ? 'Save Image' : 'Download Image';

  function extensionFrom(blob,url){
    const type=clean(blob?.type).toLowerCase();
    if(type.includes('png')) return 'png';
    if(type.includes('webp')) return 'webp';
    if(type.includes('heic')||type.includes('heif')) return 'heic';
    if(type.includes('jpeg')||type.includes('jpg')) return 'jpg';
    const match=clean(url).match(/\.(jpe?g|png|webp|heic|heif)(?:[?#]|$)/i);
    return match?match[1].toLowerCase().replace('jpeg','jpg'):'jpg';
  }

  function mimeFor(ext,blob){
    const type=clean(blob?.type).toLowerCase();
    if(type.startsWith('image/')) return type;
    if(ext==='png') return 'image/png';
    if(ext==='webp') return 'image/webp';
    if(ext==='heic'||ext==='heif') return 'image/heic';
    return 'image/jpeg';
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
    if(!blob.size) throw new Error('Ticket image was empty.');
    const ext=extensionFrom(blob,url);
    const type=mimeFor(ext,blob);
    return new File([blob],`${ticketName()}.${ext}`,{type});
  }

  function setButton(button,{ready=false,error=false}={}){
    if(!button?.isConnected) return;
    if(error){
      button.disabled=false;
      button.textContent=isAppleMobile()?'Retry Save Image':'Retry Download';
      button.title='FarmVista could not prepare the actual image file. Tap to try again.';
      return;
    }
    if(ready){
      button.disabled=false;
      button.textContent=readyLabel();
      button.title=isAppleMobile()?'Save the actual grain ticket image to your iPhone Photos.':'';
      return;
    }
    button.disabled=true;
    button.textContent=isAppleMobile()?'Preparing Image…':'Preparing…';
    button.title='Preparing the saved grain ticket image.';
  }

  function prepareForShare(image,button,{force=false}={}){
    if(!isMobileShareDevice()||!navigator.share){
      setButton(button,{ready:true});
      return;
    }
    const url=clean(image?.currentSrc||image?.src);
    if(!url){
      button.disabled=true;
      return;
    }
    const existing=prepared.get(image);
    if(!force&&existing?.url===url){
      if(existing.file){setButton(button,{ready:true});return;}
      if(existing.error){setButton(button,{error:true});return;}
      if(existing.promise){setButton(button);return;}
    }
    const state={url,file:null,promise:null,error:null};
    prepared.set(image,state);
    setButton(button);
    state.promise=buildFile(image).then(file=>{
      state.file=file;
      state.error=null;
      setButton(button,{ready:true});
      return file;
    }).catch(error=>{
      state.error=error;
      console.warn('[FarmVista] Ticket image file preparation failed:',error);
      setButton(button,{error:true});
      return null;
    });
  }

  function sharePreparedFile(image,button){
    const state=prepared.get(image);
    const file=state?.file;
    if(!file){
      if(state?.error){prepareForShare(image,button,{force:true});return;}
      prepareForShare(image,button);return;
    }
    if(navigator.canShare && !navigator.canShare({files:[file]})){
      alert('This device cannot save this ticket image as a file from the share sheet.');
      return;
    }
    navigator.share({files:[file],title:'Grain Ticket Image'}).catch(error=>{
      if(error?.name==='AbortError') return;
      console.warn('[FarmVista] Native ticket-image file share failed:',error);
      alert('FarmVista could not open this grain ticket as an image file. Please try again.');
    });
  }

  async function downloadDesktop(image,button){
    const old=button.textContent;
    button.disabled=true;
    button.textContent='Preparing…';
    try{
      const file=await buildFile(image);
      const blobUrl=URL.createObjectURL(file);
      const a=document.createElement('a');
      a.href=blobUrl;
      a.download=file.name;
      a.style.display='none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(blobUrl),30000);
    }catch(error){
      console.warn('[FarmVista] Ticket image download failed:',error);
      alert('FarmVista could not prepare this ticket image for download. Please try again.');
    }finally{
      button.disabled=false;
      button.textContent=old;
    }
  }

  function activateImage(image,button){
    if(isMobileShareDevice()&&navigator.share){sharePreparedFile(image,button);return;}
    downloadDesktop(image,button);
  }

  function makeButton(image,key){
    const button=document.createElement('button');
    button.type='button';
    button.className='fv-ticket-download-btn';
    button.textContent=readyLabel();
    button.dataset.fvTicketDownload=key;
    button.setAttribute('aria-label',isAppleMobile()?'Save grain ticket image to Photos':'Download saved grain ticket image');
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      activateImage(image,button);
    });
    prepareForShare(image,button);
    return button;
  }

  function makeRow(image,key){
    const row=document.createElement('div');
    row.className='fv-ticket-download-row';
    row.dataset.fvTicketDownloadRow=key;
    row.hidden=!clean(image?.currentSrc||image?.getAttribute('src')||image?.src);
    row.appendChild(makeButton(image,key));
    return row;
  }

  function refreshPreparation(image,button){
    if(!image||!button)return;
    const url=clean(image.currentSrc||image.getAttribute('src')||image.src);
    const row=button.closest('.fv-ticket-download-row');
    if(row)row.hidden=!url;
    if(!url)return;
    const state=prepared.get(image);
    if(state?.url!==url)prepareForShare(image,button);
  }

  function enhanceDetail(){
    const image=document.getElementById('ticketImage');
    if(!image)return;
    const card=image.closest('.image-card')||image.closest('.card');
    const wrap=document.getElementById('ticketImageWrap')||image.parentElement;
    if(!card||!wrap)return;

    // Remove only an old legacy button once. Never repeatedly mutate the page.
    const legacy=card.querySelector('.image-actions [data-fv-ticket-download]');
    if(legacy) legacy.remove();

    let row=card.querySelector('[data-fv-ticket-download-row="detail"]');
    if(!row){
      row=makeRow(image,'detail');
      const helper=card.querySelector('.card-sub');
      if(helper)helper.insertAdjacentElement('afterend',row);else wrap.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  function enhanceInventory(){
    const image=document.querySelector('.fv-ticket-image-body img')||document.getElementById('ticket-image-modal-img');
    if(!image)return;
    const body=image.closest('.fv-ticket-image-body')||image.parentElement;
    if(!body)return;
    const dialog=image.closest('.fv-ticket-image-dialog')||image.closest('.modal-card')||body.parentElement;
    let row=dialog?.querySelector('[data-fv-ticket-download-row="inventory"]');
    if(!row){
      row=makeRow(image,'inventory');
      body.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  function enhanceContractReport(){
    const image=document.getElementById('ticketPopupImage');
    const wrap=image?.closest('.ticket-image-wrap');
    if(!image||!wrap)return;
    const parent=wrap.parentElement;
    let row=parent?.querySelector(':scope > [data-fv-ticket-download-row="contract"]');
    if(!row){
      row=makeRow(image,'contract');
      wrap.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  const path=String(location.pathname||'').toLowerCase();
  const isDetail=path.endsWith('/pages/grain/grain-ticket-detail.html');

  if(isDetail){
    enhanceDetail();

    const image=document.getElementById('ticketImage');
    if(image){
      const observer=new MutationObserver(()=>enhanceDetail());
      observer.observe(image,{attributes:true,attributeFilter:['src']});
      image.addEventListener('load',enhanceDetail,{passive:true});
      window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }
    return;
  }

  // Inventory/report dialogs are created dynamically. Keep a bounded,
  // throttled child-list observer there, but never observe attributes or run
  // synchronously for every mutation.
  let timer=0;
  const runDynamicEnhance=()=>{
    timer=0;
    enhanceInventory();
    enhanceContractReport();
  };
  const scheduleDynamicEnhance=()=>{
    if(timer)return;
    timer=window.setTimeout(runDynamicEnhance,100);
  };

  runDynamicEnhance();
  const observer=new MutationObserver(scheduleDynamicEnhance);
  observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
})();
