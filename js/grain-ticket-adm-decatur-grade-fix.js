/* =====================================================================
   FarmVista — Elevator OCR Template Safety
   ADM Decatur + Bartlett Jacksonville remain here.
   Scoular Waverly lives in its own elevator template file.
===================================================================== */
(function () {
  'use strict';
  const pagePath = String(window.location.pathname || '').toLowerCase();
  if (!pagePath.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_ELEVATOR_GRADE_FIX_20260916_4) return;
  window.__FV_ELEVATOR_GRADE_FIX_20260916_4 = true;

  /* ===================================================================
     PHONE OCR IMAGE QUALITY

     The desktop diagnostic sends the original high-resolution photograph to
     fvOcr. The production phone scanner was taking a video frame, converting
     it to JPEG, then prepareImage() resized it to 2200px and JPEG-encoded it
     a second time. Fine ticket print was being lost between those steps.

     On the grain-ticket scanner only:
       1. preserve the source image's full pixel dimensions when prepareImage
          attempts to downscale an HTMLImageElement;
       2. use maximum JPEG quality for scanner canvas exports;
       3. when ImageCapture.takePhoto is supported, use the camera's actual
          still-photo capture instead of a video-preview frame. If the browser
          cannot do that, FarmVista falls straight back to its existing burst
          capture without blocking the driver.
  =================================================================== */
  if (!window.__FV_GRAIN_TICKET_FULL_RES_CAPTURE_20260916) {
    window.__FV_GRAIN_TICKET_FULL_RES_CAPTURE_20260916 = true;

    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      try {
        if (
          source instanceof HTMLImageElement &&
          args.length === 4 &&
          source.naturalWidth > 0 &&
          source.naturalHeight > 0 &&
          (source.naturalWidth > this.canvas.width || source.naturalHeight > this.canvas.height) &&
          Math.max(this.canvas.width, this.canvas.height) <= 2200
        ) {
          this.canvas.width = source.naturalWidth;
          this.canvas.height = source.naturalHeight;
          return originalDrawImage.call(
            this,
            source,
            0,
            0,
            source.naturalWidth,
            source.naturalHeight
          );
        }
      } catch (_) {}
      return originalDrawImage.call(this, source, ...args);
    };

    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      const mime = String(type || '').toLowerCase();
      if (mime === 'image/jpeg' || mime === 'image/jpg') {
        return originalToBlob.call(this, callback, type, 1.0);
      }
      return originalToBlob.call(this, callback, type, quality);
    };

    const installStillCapture = () => {
      const button = document.getElementById('captureBtn');
      const video = document.getElementById('cameraVideo');
      const input = document.getElementById('fileInput');
      if (!button || !video || !input || button.dataset.fvFullResCapture === '1') return;
      button.dataset.fvFullResCapture = '1';
      let fallbackClick = false;

      button.addEventListener('click', async event => {
        if (fallbackClick) return;
        const stream = video.srcObject;
        const track = stream?.getVideoTracks?.()[0] || null;
        if (!track || typeof window.ImageCapture !== 'function') return;

        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          const imageCapture = new ImageCapture(track);
          const blob = await imageCapture.takePhoto();
          if (!blob || blob.size < 10000) throw new Error('Still photo capture returned no usable image.');

          const file = new File(
            [blob],
            `grain-ticket-${Date.now()}.${blob.type === 'image/png' ? 'png' : 'jpg'}`,
            { type: blob.type || 'image/jpeg' }
          );
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;

          console.log('[Grain Ticket] Full-resolution still captured for OCR:', {
            bytes: file.size,
            type: file.type,
            trackSettings: track.getSettings ? track.getSettings() : null
          });

          input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (error) {
          console.warn('[Grain Ticket] Full-resolution still unavailable; using existing burst capture.', error);
          fallbackClick = true;
          try {
            button.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window }));
          } finally {
            fallbackClick = false;
          }
        }
      }, true);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', installStillCapture, { once:true });
    } else {
      installStillCapture();
    }
  }

  /* Load the elevator-specific Scoular template before any OCR response is
     interpreted. Keeping this dependency here makes the template available
     even if version.js and this helper arrive from different PWA cache ages. */
  const scoularTemplateReady = (() => {
    if (window.FVGrainTicketTemplates?.scoularWaverly) return Promise.resolve(true);
    return new Promise(resolve => {
      const existing = document.querySelector('script[data-fv-scoular-waverly-template]');
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once:true });
        existing.addEventListener('error', () => resolve(false), { once:true });
        return;
      }
      const script = document.createElement('script');
      script.src = '/js/grain-ticket-templates/scoular-waverly.js?v=20260916-2';
      script.dataset.fvScoularWaverlyTemplate = '1';
      script.onload = () => resolve(true);
      script.onerror = () => { console.warn('[Grain Ticket] Scoular Waverly template failed to load.'); resolve(false); };
      document.head.appendChild(script);
    });
  })();

  const originalFetch = window.fetch.bind(window);
  const clean = v => String(v == null ? '' : v).trim();
  const compact = v => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  function responseRoot(data) { if (data?.grainTicket) return data; if (data?.result?.grainTicket) return data.result; if (data?.ocrResult?.grainTicket) return data.ocrResult; return null; }
  function documentText(data,root) { return clean(root?.document?.text || data?.document?.text || data?.documentText || data?.result?.document?.text || data?.ocrResult?.document?.text || root?.grainTicket?.rawText || ''); }
  function isAdmDecatur(root,text) { const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,text].filter(Boolean).join(' '));return(e.includes('admprocessing')||e.includes('archerdanielsmidland'))&&e.includes('decatur')&&(e.includes('4666fairiesparkway')||e.includes('fairiesparkway')); }
  function isBartlettJacksonville(root,text) { const t=root?.grainTicket||{};const e=compact([t.elevatorName,t.deliveryStreet,t.deliveryCity,t.deliveryState,t.deliveryZip,text].filter(Boolean).join(' '));return e.includes('bartlett')&&e.includes('jacksonville')&&(e.includes('2350southmain')||e.includes('southmain')||e.includes('unitedstateswarehouseact')); }
  function valueBeforeAnchor(text,anchor) { const m=String(text||'').match(new RegExp('(?:^|\\n)\\s*([0-9]{1,3}(?:\\.[0-9]+)?)\\s+'+anchor+'\\b','im'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null; }
  function patchField(root,name,value) { if(!Number.isFinite(value))return false;root.grainTicket||={};root.fields||={};root.grainTicket[name]=value;root.fields[name]=value;return true; }
  function patchAdm(data) { const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);if(!isAdmDecatur(root,text))return false;let changed=false;changed=patchField(root,'testWeight',valueBeforeAnchor(text,'AC'))||changed;changed=patchField(root,'moisture',valueBeforeAnchor(text,'GN'))||changed;changed=patchField(root,'damage',valueBeforeAnchor(text,'OP'))||changed;changed=patchField(root,'foreignMaterial',valueBeforeAnchor(text,'CO'))||changed;return changed; }
  function bartlettGradeBlock(text) { const source=String(text||'').replace(/\r/g,'\n');const start=source.search(/GRADE\s*FACTOR/i);if(start<0)return null;let block=source.slice(start,start+700);const stop=block.search(/(?:\bINSPECTOR\b|\bGROSS\s+BU\b|\bNET\s+BU\b|\bSHRINK\s+BU\b)/i);if(stop>0)block=block.slice(0,stop);const read=label=>{const m=block.match(new RegExp('(?:^|\\n|\\s)'+label+'\\s*[:=-]?\\s*([0-9]{1,3}(?:\\.[0-9]{1,2})?)\\b','i'));const n=m?Number(m[1]):NaN;return Number.isFinite(n)?n:null;};return{testWeight:read('TW'),moisture:read('MT'),damage:read('DM'),foreignMaterial:read('BCFM')}; }
  function labeledNumber(text,label,requireLb=false) { const suffix=requireLb?'\\s*(?:lb|lbs)\\b':'\\b';const m=String(text||'').match(new RegExp('\\b'+label+'\\s*:?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)'+suffix,'i'));if(!m)return null;const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?n:null; }
  function patchBartlett(data) { const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);if(!isBartlettJacksonville(root,text))return false;const ticket=root.grainTicket;const grades=bartlettGradeBlock(text)||{};let changed=false;changed=patchField(root,'testWeight',grades.testWeight)||changed;changed=patchField(root,'moisture',grades.moisture)||changed;changed=patchField(root,'damage',grades.damage)||changed;changed=patchField(root,'foreignMaterial',grades.foreignMaterial)||changed;const gross=labeledNumber(text,'GROSS',true),tare=labeledNumber(text,'TARE',true),net=labeledNumber(text,'NET',true),shrink=labeledNumber(text,'SHRINK\\s+BU');if(Number.isFinite(gross)){ticket.grossWeight=gross;changed=true;}if(Number.isFinite(tare)){ticket.tareWeight=tare;changed=true;}if(Number.isFinite(net)){ticket.netWeight=net;changed=true;}if(Number.isFinite(shrink)){ticket.shrinkBushels=shrink;changed=true;}const cropMatch=text.match(/Kind\s+of\s+Grain\s*:\s*([^\n\r]+)/i);if(cropMatch){if(/corn/i.test(cropMatch[1]))ticket.crop='Corn';else if(/soy/i.test(cropMatch[1]))ticket.crop='Soybeans';else if(/wheat/i.test(cropMatch[1]))ticket.crop='Wheat';}const ticketMatch=text.match(/\bTicket\s*No\.?\s*[:#]?\s*([A-Z0-9-]{3,})\b/i);if(ticketMatch)ticket.ticketNumber=clean(ticketMatch[1]);if(ticket.shrinkBushels===0&&Number.isFinite(ticket.netWeight)){const divisor=ticket.crop==='Soybeans'?60:ticket.crop==='Corn'?56:null;if(divisor){const bu=Number((ticket.netWeight/divisor).toFixed(2));ticket.grossBushels=bu;ticket.netBushels=bu;changed=true;}}ticket.elevatorName='Bartlett Grain';ticket.deliveryStreet='2350 South Main';ticket.deliveryCity='Jacksonville';ticket.deliveryState='IL';ticket.deliveryZip='62650';return changed; }
  function patchScoular(data) { const root=responseRoot(data);if(!root?.grainTicket)return false;const text=documentText(data,root);const template=window.FVGrainTicketTemplates?.scoularWaverly;if(!template)return false;const result=template.apply(root.grainTicket,text);if(!result.matched)return false;if(result.changed){root.fields=root.fields||{};for(const name of ['testWeight','moisture','damage','foreignMaterial']){if(Number.isFinite(root.grainTicket[name]))root.fields[name]=root.grainTicket[name];}}console.log('[Grain Ticket] Scoular Waverly template result:',result);return result.changed; }

  window.fetch=async(...args)=>{const response=await originalFetch(...args);try{const type=clean(response.headers.get('content-type')).toLowerCase();if(!type.includes('application/json'))return response;const data=await response.clone().json();await scoularTemplateReady;const changed=patchAdm(data)||patchBartlett(data)||patchScoular(data);if(!changed)return response;const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});}catch(error){console.warn('[Grain Ticket] Elevator layout template skipped:',error);return response;}};
})();