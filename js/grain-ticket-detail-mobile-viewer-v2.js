/* FarmVista — Ticket Details mobile viewer + OCR tools, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_MOBILE_VIEWER_V3_20260905) return;
  window.__FV_TICKET_DETAIL_MOBILE_VIEWER_V3_20260905 = true;

  const $ = id => document.getElementById(id);
  const isPhoneLayout = () => matchMedia('(pointer:coarse)').matches || innerWidth <= 900;

  function installStyles() {
    document.getElementById('fv-ticket-detail-mobile-v3-style')?.remove();
    const style = document.createElement('style');
    style.id = 'fv-ticket-detail-mobile-v3-style';
    style.textContent = `
      .fv-mobile-ticket-photo{
        position:absolute;
        left:50%;
        top:50%;
        display:none;
        max-width:none;
        max-height:none;
        user-select:none;
        -webkit-user-select:none;
        -webkit-user-drag:none;
        pointer-events:none;
        transform-origin:center center;
        will-change:transform;
      }

      #ticketImageWrap.fv-phone-viewer{
        overflow:hidden !important;
        touch-action:none !important;
        overscroll-behavior:contain !important;
        cursor:grab !important;
      }

      #ticketImageWrap.fv-phone-viewer #ticketImageStage{
        width:100% !important;
        height:100% !important;
        min-width:100% !important;
        min-height:100% !important;
      }

      #ticketImageWrap.fv-phone-viewer #ticketImage{
        visibility:hidden !important;
        pointer-events:none !important;
      }

      #ticketImageWrap.fv-phone-viewer .fv-mobile-ticket-photo{
        display:block;
      }

      #ticketImageWrap.fv-touch-panning{
        cursor:grabbing !important;
        user-select:none !important;
        -webkit-user-select:none !important;
      }

      .fv-ocr-toolbar{
        display:flex;align-items:center;justify-content:space-between;
        gap:8px;flex-wrap:wrap;margin:0 0 9px;
      }
      .fv-ocr-toolbar > div{display:flex;gap:8px;flex-wrap:wrap}
      .fv-ocr-btn{
        min-height:38px;padding:7px 11px;border:1px solid var(--border,#d7ddd8);
        border-radius:9px;background:var(--surface,#fff);color:var(--text,#1f2521);
        font:inherit;font-size:12px;font-weight:850;cursor:pointer;
      }
      .fv-ocr-btn.primary{background:#3B7E46;border-color:#3B7E46;color:#fff}
      .fv-ocr-btn[aria-pressed="true"]{border-color:#3B7E46;box-shadow:inset 0 0 0 2px rgba(59,126,70,.25)}
      .fv-ocr-status{min-height:18px;margin:0 0 7px;color:var(--muted,#68716c);font-size:11px;font-weight:750}

      @media (max-width:700px) and (orientation:portrait){
        .layout > aside,.image-card{width:100% !important;min-width:0 !important}
        .image-card{margin-left:auto !important;margin-right:auto !important}
        #ticketImageWrap{
          width:100% !important;
          height:72dvh !important;
          min-height:430px !important;
          max-height:760px !important;
          margin-left:auto !important;
          margin-right:auto !important;
        }
        .image-actions{gap:8px !important}
        .image-actions .btn{flex:1 1 0 !important;min-width:0 !important;padding-left:8px !important;padding-right:8px !important}
      }

      @media (orientation:landscape) and (max-height:700px) and (min-width:701px){
        html,body{overflow-x:hidden !important}
        .page{max-width:none !important;width:100% !important;padding-left:12px !important;padding-right:12px !important}
        .layout{
          grid-template-columns:minmax(0,1fr) minmax(420px,.92fr) !important;
          align-items:start !important;
          gap:14px !important;
          width:100% !important;
          overflow:hidden !important;
        }
        .layout > div,
        .layout > aside{
          min-width:0 !important;
          width:100% !important;
          max-width:100% !important;
          height:calc(100dvh - 132px) !important;
          min-height:360px !important;
          max-height:calc(100dvh - 132px) !important;
          overflow-y:auto !important;
          overflow-x:hidden !important;
          overscroll-behavior-y:contain !important;
          overscroll-behavior-x:none !important;
          scrollbar-width:none !important;
          -ms-overflow-style:none !important;
          position:static !important;
          top:auto !important;
        }
        .layout > div::-webkit-scrollbar,
        .layout > aside::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}
        .layout > div > form,
        .layout > aside > .image-card{
          min-width:0 !important;
          max-width:100% !important;
          overflow-x:hidden !important;
        }
        .image-card{margin:0 !important}
        #ticketImageWrap{
          width:100% !important;
          height:calc(100dvh - 225px) !important;
          min-height:360px !important;
          max-height:none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function setupPhoneViewer() {
    const wrap = $('ticketImageWrap');
    const stage = $('ticketImageStage');
    const source = $('ticketImage');
    if (!wrap || !stage || !source) return;

    let photo = wrap.querySelector('.fv-mobile-ticket-photo');
    if (!photo) {
      photo = document.createElement('img');
      photo.className = 'fv-mobile-ticket-photo';
      photo.alt = 'Scanned grain ticket';
      photo.draggable = false;
      stage.appendChild(photo);
    }

    let scale = 1;
    let rotation = 0;
    let x = 0;
    let y = 0;
    let baseWidth = 0;
    let baseHeight = 0;
    let panning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    const clampScale = value => Math.min(6, Math.max(1, value));

    function fitPhoto(resetPan = true) {
      if (!isPhoneLayout() || !photo.naturalWidth || !photo.naturalHeight) return;

      wrap.classList.add('fv-phone-viewer');

      const sideways = Math.abs(rotation % 180) === 90;
      const sourceW = sideways ? photo.naturalHeight : photo.naturalWidth;
      const sourceH = sideways ? photo.naturalWidth : photo.naturalHeight;
      const availW = Math.max(1, wrap.clientWidth - 18);
      const availH = Math.max(1, wrap.clientHeight - 18);
      const fit = Math.min(availW / sourceW, availH / sourceH);

      baseWidth = photo.naturalWidth * fit;
      baseHeight = photo.naturalHeight * fit;
      photo.style.width = `${baseWidth}px`;
      photo.style.height = `${baseHeight}px`;

      if (resetPan) {
        scale = 1;
        x = 0;
        y = 0;
      }
      applyTransform();
    }

    function panBounds() {
      const sideways = Math.abs(rotation % 180) === 90;
      const visualW = (sideways ? baseHeight : baseWidth) * scale;
      const visualH = (sideways ? baseWidth : baseHeight) * scale;
      return {
        x: Math.max(0, (visualW - wrap.clientWidth) / 2),
        y: Math.max(0, (visualH - wrap.clientHeight) / 2)
      };
    }

    function clampPan() {
      const bounds = panBounds();
      x = Math.max(-bounds.x, Math.min(bounds.x, x));
      y = Math.max(-bounds.y, Math.min(bounds.y, y));
    }

    function applyTransform() {
      clampPan();
      photo.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
    }

    function syncSource() {
      const src = source.currentSrc || source.src || '';
      if (!src) return;
      if (photo.src !== src) photo.src = src;
      if (!source.hidden) wrap.classList.add('fv-phone-viewer');
    }

    photo.addEventListener('load', () => setTimeout(() => fitPhoto(true), 0));

    const sourceObserver = new MutationObserver(syncSource);
    sourceObserver.observe(source, {attributes:true,attributeFilter:['src','hidden']});
    syncSource();

    function distance(touches) {
      if (!touches || touches.length < 2) return 0;
      return Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY
      );
    }

    wrap.addEventListener('touchstart', event => {
      if (!isPhoneLayout() || source.hidden || !photo.naturalWidth) return;

      if (event.touches.length === 2) {
        event.preventDefault();
        panning = false;
        wrap.classList.remove('fv-touch-panning');
        pinchStartDistance = distance(event.touches);
        pinchStartScale = scale;
        return;
      }

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        panning = true;
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panOriginX = x;
        panOriginY = y;
        wrap.classList.add('fv-touch-panning');
      }
    }, {capture:true,passive:false});

    wrap.addEventListener('touchmove', event => {
      if (!isPhoneLayout() || source.hidden || !photo.naturalWidth) return;

      if (event.touches.length === 2 && pinchStartDistance) {
        event.preventDefault();
        const next = pinchStartScale * (distance(event.touches) / pinchStartDistance);
        scale = clampScale(next);
        applyTransform();
        return;
      }

      if (event.touches.length === 1 && panning) {
        event.preventDefault();
        const touch = event.touches[0];
        x = panOriginX + (touch.clientX - panStartX);
        y = panOriginY + (touch.clientY - panStartY);
        applyTransform();
      }
    }, {capture:true,passive:false});

    wrap.addEventListener('touchend', event => {
      if (event.touches.length < 2) pinchStartDistance = 0;
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        panning = true;
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panOriginX = x;
        panOriginY = y;
        return;
      }
      panning = false;
      wrap.classList.remove('fv-touch-panning');
    }, {capture:true,passive:true});

    wrap.addEventListener('touchcancel', () => {
      panning = false;
      pinchStartDistance = 0;
      wrap.classList.remove('fv-touch-panning');
    }, {capture:true,passive:true});

    $('rotateLeftBtn')?.addEventListener('click', () => {
      if (!isPhoneLayout()) return;
      rotation -= 90;
      setTimeout(() => fitPhoto(true), 0);
    });

    $('rotateRightBtn')?.addEventListener('click', () => {
      if (!isPhoneLayout()) return;
      rotation += 90;
      setTimeout(() => fitPhoto(true), 0);
    });

    let resizeTimer = 0;
    const refit = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitPhoto(true), 180);
    };
    window.addEventListener('resize', refit, {passive:true});
    window.addEventListener('orientationchange', refit, {passive:true});

    setTimeout(syncSource, 250);
    setTimeout(() => fitPhoto(true), 500);
    setTimeout(() => fitPhoto(true), 1200);
  }

  function organize(text) {
    const lines = String(text || '').replace(/\r\n?/g,'\n').split('\n').map(v => v.trimEnd()).filter(v => v.trim());
    if (!lines.length) return '';

    const groups = {header:[],ticket:[],customer:[],grade:[],weights:[]};
    let group = 'header';
    const grade = /\b(moist|test\s*weight|damage|foreign|fm\b|bcfm|dockage|protein|oil|starch|vomitoxin|aflatoxin)\b/i;
    const weights = /\b(gross|tare|net\s*(weight|wt|bushel|bu)|shrink|bushel|lbs?\b|pounds?)\b/i;
    const customer = /\b(customer|cust\b|sold\s*under|contract|apply\s+to|farm\b|producer|shipper)\b/i;
    const ticket = /\b(ticket|inbound|outbound|date\b|time\b|driver|truck|trailer|vehicle|commodity|yellow\s+corn|soybean|corn\b|load\s*#|f\/l\s*#)\b/i;

    for (const line of lines) {
      if (grade.test(line)) group = 'grade';
      else if (weights.test(line)) group = 'weights';
      else if (customer.test(line) && group !== 'grade' && group !== 'weights') group = 'customer';
      else if (ticket.test(line) && group === 'header') group = 'ticket';
      groups[group].push(line.trim());
    }

    const out = [];
    const add = (label, values) => {
      if (!values.length) return;
      if (out.length) out.push('');
      out.push(`── ${label} ──`, ...values);
    };
    add('ELEVATOR / HEADER', groups.header);
    add('TICKET / LOAD', groups.ticket);
    add('CUSTOMER / CONTRACT', groups.customer);
    add('GRADE FACTORS', groups.grade);
    add('WEIGHTS / BUSHELS', groups.weights);
    return out.join('\n');
  }

  function bindOcr() {
    const pre = $('ocrRawText');
    if (!pre || pre.dataset.fvOcrV3 === '1') return;
    pre.dataset.fvOcrV3 = '1';

    const toolbar = document.createElement('div');
    toolbar.className = 'fv-ocr-toolbar';
    const left = document.createElement('div');
    const right = document.createElement('div');
    const organized = document.createElement('button');
    const raw = document.createElement('button');
    const copy = document.createElement('button');
    const status = document.createElement('div');

    organized.type = raw.type = copy.type = 'button';
    organized.className = raw.className = 'fv-ocr-btn';
    copy.className = 'fv-ocr-btn primary';
    organized.textContent = 'Organized';
    raw.textContent = 'Raw OCR';
    copy.textContent = 'Copy All';
    organized.setAttribute('aria-pressed','true');
    raw.setAttribute('aria-pressed','false');
    status.className = 'fv-ocr-status';
    status.setAttribute('aria-live','polite');

    left.append(organized,raw);
    right.append(copy);
    toolbar.append(left,right);
    pre.before(toolbar,status);

    let original = '';
    let mode = 'organized';
    let writing = false;

    const render = () => {
      writing = true;
      pre.textContent = mode === 'organized' ? organize(original) : original;
      organized.setAttribute('aria-pressed', String(mode === 'organized'));
      raw.setAttribute('aria-pressed', String(mode === 'raw'));
      writing = false;
    };

    const capture = () => {
      if (writing) return;
      const current = String(pre.textContent || '');
      if (!current.trim()) return;
      if (!original) {
        original = current;
        render();
      } else if (mode === 'raw' && current !== original) {
        original = current;
        render();
      }
    };

    organized.addEventListener('click', () => { mode = 'organized'; render(); });
    raw.addEventListener('click', () => { mode = 'raw'; render(); });
    copy.addEventListener('click', async () => {
      const text = original || String(pre.textContent || '');
      if (!text.trim()) { status.textContent = 'No OCR text to copy.'; return; }
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      status.textContent = 'Copied all original OCR text.';
      setTimeout(() => { if (status.textContent.startsWith('Copied')) status.textContent = ''; }, 2200);
    });

    new MutationObserver(capture).observe(pre,{childList:true,characterData:true,subtree:true});
    capture();
  }

  function updateHelp() {
    const help = $('ticketImageWrap')?.closest('.image-card')?.querySelector('.card-sub');
    if (!help) return;
    help.textContent = matchMedia('(pointer:coarse)').matches
      ? 'Pinch to zoom. Drag the zoomed ticket with one finger.'
      : 'Use the mouse wheel to zoom. Click and drag to move around the ticket.';
  }

  function boot() {
    installStyles();
    setupPhoneViewer();
    bindOcr();
    updateHelp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
