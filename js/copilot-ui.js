/* /Farm-vista/js/copilot-ui.js  (FULL FILE)
   Rev: 2026-01-03-copilot-ui3-continuation

   CHANGE:
   ✅ Stores meta.continuation per threadId and sends it back each request.
   This makes "show all / more" work across Cloud Run instances.
*/

'use strict';

import { ready, getAuth } from '/Farm-vista/js/firebase-init.js';

export const FVCopilotUI = (() => {
  const DEFAULTS = {
    copilotEndpoint: (window.FV_COPILOT_ENDPOINT || 'https://farmvista-copilot-300398089669.us-central1.run.app/chat').toString(),
    reportEndpoint:  (window.FV_COPILOT_REPORT_ENDPOINT || 'https://farmvista-copilot-300398089669.us-central1.run.app/report').toString(),

    sectionSel: '#ai-section',
    logSel: '#ai-chat-log',
    formSel: '#ai-chat-form',
    inputSel: '#ai-input',
    micSel: '#ai-mic',
    sendSel: '#ai-send',
    statusSel: '#ai-status',

    storageKey: 'fv_copilot_chat_v1',
    threadKey:  'fv_copilot_threadId_v2',
    contKey:    'fv_copilot_continuation_v1',   // ✅ NEW
    lastKey:    'fv_copilot_lastChatAt_v1',

    ttlHours: 12,
    maxKeep: 80,

    desktopMinWidth: 900,
    pdfTitle: 'Report PDF',
    pdfButtonLabel: 'View PDF',

    debug: false
  };

  const PDF_MARKER = '[[FV_PDF]]:';

  function safeHtml(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function nowMs(){ return Date.now(); }

  function isDesktop(minWidth){
    try { return window.matchMedia && window.matchMedia(`(min-width: ${minWidth}px)`).matches; }
    catch { return false; }
  }

  function getEl(sel){ return document.querySelector(sel); }

  function buildReportUrl(reportEndpoint, threadId, mode){
    const qs = new URLSearchParams();
    if (threadId) qs.set('threadId', threadId);
    qs.set('mode', (mode || 'recent').toString().trim() || 'recent');
    return `${reportEndpoint}?${qs.toString()}`;
  }

  function loadJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  }

  function saveJson(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch{}
  }

  function setLS(key, val){
    try{ localStorage.setItem(key, String(val)); }catch{}
  }

  function getLS(key){
    try{ return (localStorage.getItem(key) || '').toString(); }catch{ return ''; }
  }

  function removeLS(key){
    try{ localStorage.removeItem(key); }catch{}
  }

  async function getAuthToken(){
    try{
      await ready;
      const auth = getAuth();
      const user = auth?.currentUser || null;
      if (!user) return '';
      const tok = await user.getIdToken();
      return (tok || '').toString();
    }catch{
      return '';
    }
  }

  function enforceTtl(opts){
    try{
      const lastRaw = getLS(opts.lastKey);
      const last = lastRaw ? Number(lastRaw) : 0;
      if (!Number.isFinite(last) || last <= 0) return;

      const ttlMs = (Number(opts.ttlHours) || 12) * 60 * 60 * 1000;
      if ((nowMs() - last) > ttlMs){
        removeLS(opts.storageKey);
        removeLS(opts.threadKey);
        removeLS(opts.contKey);
        removeLS(opts.lastKey);
      }
    }catch{}
  }

  function makePdfModal(opts){
    const modal = document.createElement('div');
    modal.className = 'fv-pdf-modal';
    modal.innerHTML = `
      <div class="fv-pdf-backdrop"></div>
      <div class="fv-pdf-sheet" role="dialog" aria-modal="true" aria-label="${safeHtml(opts.pdfTitle)}">
        <div class="fv-pdf-top">
          <div class="fv-pdf-title">${safeHtml(opts.pdfTitle)}</div>
          <button type="button" class="fv-pdf-close">Close</button>
        </div>
        <iframe class="fv-pdf-frame" title="${safeHtml(opts.pdfTitle)}"></iframe>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      .fv-pdf-modal{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:100000; padding:16px; }
      .fv-pdf-modal.show{ display:flex; }
      .fv-pdf-backdrop{ position:absolute; inset:0; background:rgba(0,0,0,.55); }
      .fv-pdf-sheet{
        position:relative;
        width:min(1100px, 96vw);
        height:min(86vh, 860px);
        background:var(--surface, #fff);
        border:1px solid var(--border, #D1D5DB);
        border-radius:14px;
        box-shadow:0 20px 40px rgba(0,0,0,.35);
        overflow:hidden;
        display:flex;
        flex-direction:column;
        z-index:1;
      }
      .fv-pdf-top{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 12px;
        border-bottom:1px solid var(--border, #D1D5DB);
        background:linear-gradient(90deg, rgba(47,108,60,.12), transparent);
      }
      .fv-pdf-title{ font-weight:900; letter-spacing:.06em; text-transform:uppercase; font-size:12px; color:var(--text, #111827); }
      .fv-pdf-close{
        border:none;
        border-radius:999px;
        padding:6px 12px;
        font-size:0.85rem;
        cursor:pointer;
        background:color-mix(in srgb, var(--surface, #fff) 70%, var(--border, #D1D5DB) 30%);
        color:var(--text, #111827);
        font-weight:800;
      }
      .fv-pdf-frame{ flex:1; width:100%; height:100%; border:0; background:#fff; }
      .ai-pdf-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        padding:10px 12px;
        border-radius:12px;
        border:1px solid var(--border,#D1D5DB);
        font-weight:900;
        letter-spacing:.02em;
        cursor:pointer;
        background:var(--card-surface, var(--surface, #fff));
        color:var(--text,#111827);
        gap:8px;
        user-select:none;
      }
      .ai-pdf-btn:active{ transform:scale(.995); }
    `;

    document.head.appendChild(style);
    document.body.appendChild(modal);

    const backdrop = modal.querySelector('.fv-pdf-backdrop');
    const closeBtn = modal.querySelector('.fv-pdf-close');
    const frame = modal.querySelector('.fv-pdf-frame');

    function open(url){
      if (!url) return;
      frame.src = url;
      modal.classList.add('show');
    }
    function close(){
      modal.classList.remove('show');
    }

    backdrop.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape' && modal.classList.contains('show')) close();
    });

    return { open, close };
  }

  function init(userOpts = {}){
    const opts = { ...DEFAULTS, ...(userOpts || {}) };

    const sectionEl = getEl(opts.sectionSel);
    const logEl     = getEl(opts.logSel);
    const formEl    = getEl(opts.formSel);
    const inputEl   = getEl(opts.inputSel);
    const micEl     = getEl(opts.micSel);
    const sendEl    = getEl(opts.sendSel);
    const statusEl  = getEl(opts.statusSel);

    if (!sectionEl || !logEl || !formEl || !inputEl || !micEl || !sendEl) {
      if (opts.debug) console.warn('[FVCopilotUI] missing DOM elements, not initializing.');
      return { ok:false, reason:'missing_dom' };
    }

    window.__FV_COPILOT_WIRED = false;

    const desktop = isDesktop(opts.desktopMinWidth);
    if (desktop){
      micEl.style.display = 'none';
      micEl.disabled = true;
    }

    enforceTtl(opts);

    let history = loadJson(opts.storageKey, []);
    if (!Array.isArray(history)) history = [];

    function touch(){ setLS(opts.lastKey, String(nowMs())); }

    function saveHistory(){
      const trimmed = history.slice(-Math.max(10, Number(opts.maxKeep) || 80));
      saveJson(opts.storageKey, trimmed);
      touch();
    }

    function getThreadId(){ return getLS(opts.threadKey).trim(); }
    function setThreadId(id){
      const v = (id || '').toString().trim();
      if (!v) return;
      setLS(opts.threadKey, v);
      touch();
    }

    function getContinuation(){
      const tid = getThreadId();
      if (!tid) return null;
      const bag = loadJson(opts.contKey, {});
      return bag && typeof bag === "object" ? (bag[tid] || null) : null;
    }

    function setContinuationForThread(cont){
      const tid = getThreadId();
      if (!tid) return;
      const bag = loadJson(opts.contKey, {});
      const next = (bag && typeof bag === "object") ? bag : {};
      if (cont) next[tid] = cont;
      else delete next[tid];
      saveJson(opts.contKey, next);
      touch();
    }

    function setStatus(msg){
      if (statusEl) statusEl.textContent = msg || '';
    }

    function setThinking(on){
      const t = !!on;
      sendEl.disabled = t;
      inputEl.disabled = t;
      if (!desktop) micEl.disabled = t;
      setStatus(t ? 'Thinking…' : '');
    }

    function clearEmptyState(){
      const empty = logEl.querySelector('.ai-empty');
      if (empty) empty.remove();
    }

    const pdfModal = makePdfModal({ pdfTitle: opts.pdfTitle });

    function renderMessage(role, text){
      clearEmptyState();

      const who = role === 'user' ? 'You' : 'Copilot';

      const wrap = document.createElement('div');
      wrap.className = 'ai-msg-wrap';

      const bubble = document.createElement('div');
      bubble.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant');

      const meta = document.createElement('div');
      meta.className = 'ai-msg-meta ' + (role === 'user' ? 'user' : 'assistant');
      meta.textContent = who;

      if (role === 'assistant' && typeof text === 'string' && text.startsWith(PDF_MARKER)) {
        const url = text.slice(PDF_MARKER.length).trim();
        bubble.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ai-pdf-btn';
        btn.textContent = opts.pdfButtonLabel || 'View PDF';
        btn.addEventListener('click', () => pdfModal.open(url));
        bubble.appendChild(btn);
      } else {
        bubble.innerHTML = safeHtml(String(text || ''));
      }

      wrap.appendChild(bubble);
      wrap.appendChild(meta);

      logEl.appendChild(wrap);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function append(role, text){
      renderMessage(role, text);
      history.push({ role, text: String(text || ''), ts: nowMs() });
      saveHistory();
    }

    for (const m of history){
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      renderMessage(m.role, m.text);
    }

    async function callAssistant(prompt){
      const payload = { question: String(prompt || '') };

      const tid = getThreadId();
      if (tid) payload.threadId = tid;

      const cont = getContinuation();
      if (cont) payload.continuation = cont; // ✅ NEW: send paging state each call

      const idToken = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(opts.copilotEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('API error ' + res.status);

      const data = await res.json();

      if (data?.meta?.threadId) setThreadId(String(data.meta.threadId));

      // ✅ NEW: store continuation returned by backend (both normal and followup responses)
      if (Object.prototype.hasOwnProperty.call(data?.meta || {}, "continuation")) {
        setContinuationForThread(data.meta.continuation || null);
      }

      if (data && data.action === 'report') {
        const tid2 = data?.meta?.threadId ? String(data.meta.threadId) : getThreadId();
        const mode = data?.meta?.reportMode ? String(data.meta.reportMode) : 'recent';
        const url = buildReportUrl(opts.reportEndpoint, tid2, mode);
        pdfModal.open(url);
        return PDF_MARKER + url;
      }

      return (data && data.answer) ? String(data.answer) : '(No response)';
    }

    formEl.addEventListener('submit', async (evt)=>{
      evt.preventDefault();
      evt.stopPropagation();

      if (sendEl.disabled) return;
      if (sectionEl.classList.contains('perm-hidden') || sectionEl.getAttribute('aria-hidden') === 'true') return;

      const text = (inputEl.value || '').trim();
      if (!text) return;

      append('user', text);
      inputEl.value = '';
      inputEl.style.height = 'auto';

      setThinking(true);
      try{
        const reply = await callAssistant(text);
        append('assistant', reply || '(No response)');
      }catch(e){
        if (opts.debug) console.warn('[FVCopilotUI] error:', e);
        append('assistant', "Sorry, I couldn't process that request right now.");
      }finally{
        setThinking(false);
      }
    }, true);

    inputEl.addEventListener('input', ()=>{
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 96) + 'px';
    });

    inputEl.addEventListener('keydown', (evt)=>{
      if (evt.key === 'Enter' && !evt.shiftKey){
        evt.preventDefault();
        if (!sendEl.disabled){
          if (typeof formEl.requestSubmit === 'function') formEl.requestSubmit();
          else formEl.dispatchEvent(new Event('submit', { cancelable:true, bubbles:true }));
        }
      }
    });

    if (!desktop){
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      let recognition = null;
      let isRecording = false;

      if (SpeechRecognition){
        recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.addEventListener('start', ()=>{
          isRecording = true;
          micEl.classList.add('recording');
          setStatus('Listening…');
        });

        recognition.addEventListener('end', ()=>{
          isRecording = false;
          micEl.classList.remove('recording');
          if (!sendEl.disabled) setStatus('');
        });

        recognition.addEventListener('result', (event)=>{
          const result = event.results && event.results[0] && event.results[0][0];
          const t = result ? result.transcript : '';
          if (t){
            const existing = inputEl.value.trim();
            inputEl.value = existing ? (existing + ' ' + t) : t;
            inputEl.dispatchEvent(new Event('input'));
            inputEl.focus();
          }
        });

        micEl.addEventListener('click', ()=>{
          if (sendEl.disabled) return;
          if (isRecording){
            recognition.stop();
            return;
          }
          try{ recognition.start(); }catch(e){ if (opts.debug) console.warn('[FVCopilotUI] recognition error:', e); }
        });
      } else {
        micEl.disabled = true;
      }
    }

    window.__FV_COPILOT_WIRED = true;
    return { ok:true };
  }

  return { init };
})();