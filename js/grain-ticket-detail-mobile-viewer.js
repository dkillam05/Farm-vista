/* =====================================================================
   FarmVista — Grain Ticket Detail Mobile Viewer + OCR Tools
   Sept 5, 2026

   Ticket Details only:
     - keep the ticket centered in portrait after layout/orientation changes
     - preserve pinch zoom and add one-finger pan on touch devices
     - allow left form and right ticket column to scroll independently in
       phone landscape
     - add OCR Copy All and an easier-to-read organized OCR view while
       preserving the exact raw OCR text for copying / troubleshooting
===================================================================== */

(function () {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_GRAIN_TICKET_DETAIL_MOBILE_VIEWER_20260905) return;
  window.__FV_GRAIN_TICKET_DETAIL_MOBILE_VIEWER_20260905 = true;

  const $ = id => document.getElementById(id);

  function addStyles() {
    if ($('fv-ticket-detail-mobile-viewer-style')) return;

    const style = document.createElement('style');
    style.id = 'fv-ticket-detail-mobile-viewer-style';
    style.textContent = `
      /* Touch viewer should behave like a photo/map, not a scrolling pane. */
      #ticketImageWrap {
        touch-action:none !important;
        overscroll-behavior:contain !important;
        -webkit-overflow-scrolling:touch;
      }

      #ticketImageWrap.fv-touch-panning {
        cursor:grabbing !important;
        user-select:none !important;
        -webkit-user-select:none !important;
      }

      .fv-ocr-toolbar {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin:0 0 9px;
        flex-wrap:wrap;
      }

      .fv-ocr-toolbar-left,
      .fv-ocr-toolbar-right {
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      }

      .fv-ocr-tool-btn {
        min-height:38px;
        padding:7px 11px;
        border:1px solid var(--border,#d7ddd8);
        border-radius:9px;
        background:var(--surface,#fff);
        color:var(--text,#1f2521);
        font:inherit;
        font-size:12px;
        font-weight:850;
        cursor:pointer;
      }

      .fv-ocr-tool-btn.primary {
        background:#3B7E46;
        border-color:#3B7E46;
        color:#fff;
      }

      .fv-ocr-tool-btn[aria-pressed="true"] {
        box-shadow:inset 0 0 0 2px rgba(59,126,70,.28);
        border-color:#3B7E46;
      }

      .fv-ocr-copy-status {
        min-height:18px;
        margin:0 0 7px;
        color:var(--muted,#68716c);
        font-size:11px;
        font-weight:750;
      }

      /* Portrait phone: make the viewer clearly visible and centered. */
      @media (max-width:700px) and (orientation:portrait) {
        .layout > aside {
          width:100% !important;
          min-width:0 !important;
        }

        .image-card {
          width:100% !important;
          margin-left:auto !important;
          margin-right:auto !important;
        }

        #ticketImageWrap {
          width:100% !important;
          height:min(68dvh,680px) !important;
          min-height:360px !important;
          margin-left:auto !important;
          margin-right:auto !important;
        }

        .image-actions {
          gap:8px !important;
        }

        .image-actions .btn {
          flex:1 1 0 !important;
          min-width:0 !important;
          padding-left:8px !important;
          padding-right:8px !important;
        }
      }

      /*
        Phone landscape: each side becomes its own vertical scroller.
        This lets the form stay at one vertical position while the ticket card
        is independently moved to its top/bottom (and vice versa).
      */
      @media (orientation:landscape) and (max-height:700px) and (min-width:701px) {
        .layout {
          align-items:start !important;
        }

        .layout > div,
        .layout > aside {
          height:calc(100dvh - 150px) !important;
          min-height:260px !important;
          max-height:calc(100dvh - 150px) !important;
          overflow-y:auto !important;
          overscroll-behavior:contain !important;
          scrollbar-width:none !important;
          -ms-overflow-style:none !important;
        }

        .layout > div::-webkit-scrollbar,
        .layout > aside::-webkit-scrollbar {
          display:none !important;
          width:0 !important;
          height:0 !important;
        }

        .layout > aside {
          position:sticky !important;
          top:96px !important;
          align-self:start !important;
        }

        #ticketImageWrap {
          height:calc(100dvh - 290px) !important;
          min-height:240px !important;
        }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function centerTicket() {
    const wrap = $('ticketImageWrap');
    const stage = $('ticketImageStage');
    const image = $('ticketImage');
    if (!wrap || !stage || !image || image.hidden) return;

    requestAnimationFrame(() => {
      wrap.scrollLeft = Math.max(0, (stage.scrollWidth - wrap.clientWidth) / 2);
      wrap.scrollTop = Math.max(0, (stage.scrollHeight - wrap.clientHeight) / 2);
    });
  }

  function setupTouchPan() {
    const wrap = $('ticketImageWrap');
    const image = $('ticketImage');
    if (!wrap || !image || wrap.dataset.fvOneFingerPan === '1') return;
    wrap.dataset.fvOneFingerPan = '1';

    let panning = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    wrap.addEventListener('touchstart', event => {
      if (image.hidden || event.touches.length !== 1) {
        panning = false;
        wrap.classList.remove('fv-touch-panning');
        return;
      }

      const touch = event.touches[0];
      panning = true;
      startX = touch.clientX;
      startY = touch.clientY;
      startLeft = wrap.scrollLeft;
      startTop = wrap.scrollTop;
      wrap.classList.add('fv-touch-panning');
    }, { capture:true, passive:true });

    wrap.addEventListener('touchmove', event => {
      if (!panning || event.touches.length !== 1) return;

      const stage = $('ticketImageStage');
      const canPanX = stage && stage.scrollWidth > wrap.clientWidth + 1;
      const canPanY = stage && stage.scrollHeight > wrap.clientHeight + 1;
      if (!canPanX && !canPanY) return;

      event.preventDefault();
      const touch = event.touches[0];
      if (canPanX) wrap.scrollLeft = startLeft - (touch.clientX - startX);
      if (canPanY) wrap.scrollTop = startTop - (touch.clientY - startY);
    }, { capture:true, passive:false });

    const stop = event => {
      if (event?.touches?.length === 1) {
        /* A pinch ended with one finger still down. Start a fresh pan anchor. */
        const touch = event.touches[0];
        panning = true;
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = wrap.scrollLeft;
        startTop = wrap.scrollTop;
        wrap.classList.add('fv-touch-panning');
        return;
      }

      panning = false;
      wrap.classList.remove('fv-touch-panning');
    };

    wrap.addEventListener('touchend', stop, { capture:true, passive:true });
    wrap.addEventListener('touchcancel', stop, { capture:true, passive:true });

    /* Existing page code handles the two-finger pinch. Recenter only on load,
       orientation/layout changes, and rotation button presses—not while zooming. */
    if (image.complete && image.naturalWidth) {
      setTimeout(centerTicket, 60);
    }

    const imageObserver = new MutationObserver(() => {
      if (!image.hidden && image.naturalWidth) setTimeout(centerTicket, 60);
    });
    imageObserver.observe(image, { attributes:true, attributeFilter:['hidden','src','style'] });

    ['rotateLeftBtn','rotateRightBtn'].forEach(id => {
      $(id)?.addEventListener('click', () => setTimeout(centerTicket, 80));
    });

    let resizeTimer = 0;
    const recenterAfterLayout = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(centerTicket, 180);
    };

    window.addEventListener('resize', recenterAfterLayout, { passive:true });
    window.addEventListener('orientationchange', recenterAfterLayout, { passive:true });
  }

  function cleanLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t]+$/g, ''))
      .filter(line => line.trim());
  }

  function organizedOcr(text) {
    const lines = cleanLines(text);
    if (!lines.length) return '';

    const sections = {
      header: [],
      ticket: [],
      customer: [],
      grade: [],
      weights: [],
      other: []
    };

    let mode = 'header';

    const gradeRx = /\b(moist|test\s*weight|damage|foreign|\bfm\b|bcfm|dockage|protein|oil|starch|vomitoxin|aflatoxin)\b/i;
    const weightRx = /\b(gross|tare|net\s*(weight|wt|bushel|bu)|shrink|bushel|lbs?\b|pounds?)\b/i;
    const customerRx = /\b(customer|cust\b|sold\s*under|contract|apply\s+to|farm\b|producer|shipper)\b/i;
    const ticketRx = /\b(ticket|inbound|outbound|date\b|time\b|driver|truck|trailer|vehicle|commodity|yellow\s+corn|soybean|corn\b|load\s*#|f\\?l\s*#)\b/i;

    lines.forEach(line => {
      const value = line.trim();

      if (gradeRx.test(value)) mode = 'grade';
      else if (weightRx.test(value)) mode = 'weights';
      else if (customerRx.test(value) && mode !== 'grade' && mode !== 'weights') mode = 'customer';
      else if (ticketRx.test(value) && mode === 'header') mode = 'ticket';

      sections[mode].push(value);
    });

    const parts = [];
    const push = (label, values) => {
      if (!values.length) return;
      if (parts.length) parts.push('');
      parts.push(`── ${label} ──`);
      parts.push(...values);
    };

    push('ELEVATOR / HEADER', sections.header);
    push('TICKET / LOAD', sections.ticket);
    push('CUSTOMER / CONTRACT', sections.customer);
    push('GRADE FACTORS', sections.grade);
    push('WEIGHTS / BUSHELS', sections.weights);
    push('OTHER OCR TEXT', sections.other);

    return parts.join('\n');
  }

  function setupOcrTools() {
    const pre = $('ocrRawText');
    if (!pre || pre.dataset.fvOcrTools === '1') return;
    pre.dataset.fvOcrTools = '1';

    const section = pre.closest('.card');
    if (!section) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'fv-ocr-toolbar';

    const left = document.createElement('div');
    left.className = 'fv-ocr-toolbar-left';

    const organizedBtn = document.createElement('button');
    organizedBtn.type = 'button';
    organizedBtn.className = 'fv-ocr-tool-btn';
    organizedBtn.textContent = 'Organized';
    organizedBtn.setAttribute('aria-pressed', 'true');

    const rawBtn = document.createElement('button');
    rawBtn.type = 'button';
    rawBtn.className = 'fv-ocr-tool-btn';
    rawBtn.textContent = 'Raw OCR';
    rawBtn.setAttribute('aria-pressed', 'false');

    const right = document.createElement('div');
    right.className = 'fv-ocr-toolbar-right';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'fv-ocr-tool-btn primary';
    copyBtn.textContent = 'Copy All';

    const status = document.createElement('div');
    status.className = 'fv-ocr-copy-status';
    status.setAttribute('aria-live', 'polite');

    left.append(organizedBtn, rawBtn);
    right.append(copyBtn);
    toolbar.append(left, right);
    pre.before(toolbar, status);

    let rawText = '';
    let view = 'organized';
    let applying = false;

    function render() {
      if (applying) return;
      applying = true;
      const visible = view === 'organized' ? organizedOcr(rawText) : rawText;
      if (pre.textContent !== visible) pre.textContent = visible;
      organizedBtn.setAttribute('aria-pressed', String(view === 'organized'));
      rawBtn.setAttribute('aria-pressed', String(view === 'raw'));
      applying = false;
    }

    function captureOriginalFromPage() {
      if (applying) return;
      const current = String(pre.textContent || '');
      if (!current) return;

      /* The page writes exact OCR into this PRE. Capture that source once and
         keep it untouched even though the default visual view is organized. */
      if (!rawText || (view === 'raw' && current !== rawText)) {
        rawText = current;
        render();
      }
    }

    organizedBtn.addEventListener('click', () => {
      view = 'organized';
      render();
    });

    rawBtn.addEventListener('click', () => {
      view = 'raw';
      render();
    });

    copyBtn.addEventListener('click', async () => {
      const text = rawText || String(pre.textContent || '');
      if (!text.trim()) {
        status.textContent = 'No OCR text to copy.';
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Copied all original OCR text.';
      } catch (error) {
        const selection = window.getSelection();
        const range = document.createRange();
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
        selection?.removeAllRanges();
        status.textContent = 'Copied all original OCR text.';
      }

      setTimeout(() => {
        if (status.textContent.startsWith('Copied')) status.textContent = '';
      }, 2200);
    });

    const observer = new MutationObserver(captureOriginalFromPage);
    observer.observe(pre, { childList:true, characterData:true, subtree:true });

    captureOriginalFromPage();
  }

  function updateHelpText() {
    const card = $('ticketImageWrap')?.closest('.image-card');
    const help = card?.querySelector('.card-sub');
    if (!help) return;

    help.textContent = matchMedia('(pointer:coarse)').matches
      ? 'Pinch to zoom. Drag the zoomed ticket with one finger.'
      : 'Use the mouse wheel to zoom. Click and drag to move around the ticket.';
  }

  function boot() {
    addStyles();
    setupTouchPan();
    setupOcrTools();
    updateHelpText();
    setTimeout(centerTicket, 250);
    setTimeout(centerTicket, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
