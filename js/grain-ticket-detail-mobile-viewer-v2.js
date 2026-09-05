/* FarmVista — Ticket Details mobile viewer + OCR tools, Sept 5 2026 */
(() => {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-detail.html')) return;
  if (window.__FV_TICKET_DETAIL_MOBILE_VIEWER_V2_20260905) return;
  window.__FV_TICKET_DETAIL_MOBILE_VIEWER_V2_20260905 = true;

  const $ = id => document.getElementById(id);

  function installStyles() {
    const style = document.createElement('style');
    style.id = 'fv-ticket-detail-mobile-v2-style';
    style.textContent = `
      #ticketImageWrap{
        touch-action:none !important;
        overscroll-behavior:contain !important;
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
          width:100% !important;height:min(68dvh,680px) !important;
          min-height:360px !important;margin-left:auto !important;margin-right:auto !important;
        }
        .image-actions{gap:8px !important}
        .image-actions .btn{flex:1 1 0 !important;min-width:0 !important;padding-left:8px !important;padding-right:8px !important}
      }

      @media (orientation:landscape) and (max-height:700px) and (min-width:701px){
        .layout{align-items:start !important}
        .layout > div,.layout > aside{
          height:calc(100dvh - 150px) !important;
          min-height:260px !important;
          max-height:calc(100dvh - 150px) !important;
          overflow-y:auto !important;
          overscroll-behavior:contain !important;
          scrollbar-width:none !important;
          -ms-overflow-style:none !important;
        }
        .layout > div::-webkit-scrollbar,.layout > aside::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}
        .layout > aside{position:sticky !important;top:96px !important;align-self:start !important}
        #ticketImageWrap{height:calc(100dvh - 290px) !important;min-height:240px !important}
      }
    `;
    document.head.appendChild(style);
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

  function bindTouchPan() {
    const wrap = $('ticketImageWrap');
    const image = $('ticketImage');
    if (!wrap || !image) return;

    let active = false;
    let sx = 0, sy = 0, sl = 0, st = 0;

    const anchor = touch => {
      active = true;
      sx = touch.clientX;
      sy = touch.clientY;
      sl = wrap.scrollLeft;
      st = wrap.scrollTop;
      wrap.classList.add('fv-touch-panning');
    };

    wrap.addEventListener('touchstart', event => {
      if (image.hidden || event.touches.length !== 1) {
        active = false;
        wrap.classList.remove('fv-touch-panning');
        return;
      }
      anchor(event.touches[0]);
    }, {capture:true,passive:true});

    wrap.addEventListener('touchmove', event => {
      if (!active || event.touches.length !== 1) return;
      const stage = $('ticketImageStage');
      if (!stage) return;
      const panX = stage.scrollWidth > wrap.clientWidth + 1;
      const panY = stage.scrollHeight > wrap.clientHeight + 1;
      if (!panX && !panY) return;

      event.preventDefault();
      const touch = event.touches[0];
      if (panX) wrap.scrollLeft = sl - (touch.clientX - sx);
      if (panY) wrap.scrollTop = st - (touch.clientY - sy);
    }, {capture:true,passive:false});

    const finish = event => {
      if (event.touches?.length === 1) {
        anchor(event.touches[0]);
        return;
      }
      active = false;
      wrap.classList.remove('fv-touch-panning');
    };
    wrap.addEventListener('touchend', finish, {capture:true,passive:true});
    wrap.addEventListener('touchcancel', finish, {capture:true,passive:true});

    /* Only watch source/visibility. Do NOT observe style because the native
       pinch zoom changes transform continuously and must never be re-centered
       while the user is pinching. */
    const observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.attributeName === 'src' || m.attributeName === 'hidden')) {
        setTimeout(centerTicket, 80);
      }
    });
    observer.observe(image, {attributes:true,attributeFilter:['src','hidden']});

    ['rotateLeftBtn','rotateRightBtn'].forEach(id => {
      $(id)?.addEventListener('click', () => setTimeout(centerTicket, 90));
    });

    let timer = 0;
    const afterLayout = () => {
      clearTimeout(timer);
      timer = setTimeout(centerTicket, 200);
    };
    window.addEventListener('resize', afterLayout, {passive:true});
    window.addEventListener('orientationchange', afterLayout, {passive:true});

    if (image.complete && image.naturalWidth) setTimeout(centerTicket, 80);
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
    if (!pre) return;

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
    bindTouchPan();
    bindOcr();
    updateHelp();
    setTimeout(centerTicket,250);
    setTimeout(centerTicket,900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
