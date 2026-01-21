/* /Farm-vista/js/copilot-ui.js  (FULL FILE)
   Rev: 2026-01-20-copilot-ui14-better-errors-text-answer-ok

   CHANGE:
   ✅ Keep sending payload.text (NOT payload.question)
   ✅ Prefer reading response.text; fallback to response.answer
   ✅ If backend returns ok:false/error, show the error message to user
   ✅ If HTTP non-2xx, include status in error message
   ✅ Keep debugAI:true, threadId TTL, mic UX, AI proof footer, PDF flow

   Notes:
   - Backend may return:
     { ok:true, text:"...", meta:{...} }
     OR legacy-ish:
     { answer:"..." }
     OR error:
     { ok:false, error:"..." }
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
    threadKey:  'fv_copilot_threadId_client_v1',
    contKey:    'fv_copilot_continuation_v1',
    lastKey:    'fv_copilot_lastChatAt_v1',

    ttlHours: 12,
    maxKeep: 80,

    desktopMinWidth: 900,
    pdfTitle: 'Report PDF',
    pdfButtonLabel: 'View PDF',

    showDebugStatus: true,

    // ✅ request-controlled AI debug proof (backend may append meta)
    debugAI: true
  };

  const PDF_MARKER = '[[FV_PDF]]:';

  // In-memory (session) copies
  let MEM_TID = '';
  let MEM_CONT = null;

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

  function lsGet(key){
    try { return (localStorage.getItem(key) || '').toString(); } catch { return ''; }
  }
  function lsSet(key, val){
    try { localStorage.setItem(key, String(val)); return true; } catch { return false; }
  }
  function lsRemove(key){
    try { localStorage.removeItem(key); } catch {}
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
    try{ localStorage.setItem(key, JSON.stringify(val)); return true; }catch{ return false; }
  }

  function makeClientTid(){
    try{
      if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    }catch{}
    return 't_' + Math.random().toString(16).slice(2) + '_' + Date.now().toString(16);
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
      const lastRaw = lsGet(opts.lastKey);
      const last = lastRaw ? Number(lastRaw) : 0;
      if (!Number.isFinite(last) || last <= 0) return;

      const ttlMs = (Number(opts.ttlHours) || 12) * 60 * 60 * 1000;
      if ((nowMs() - last) > ttlMs){
        lsRemove(opts.storageKey);
        lsRemove(opts.threadKey);
        lsRemove(opts.contKey);
        lsRemove(opts.lastKey);
        MEM_TID = '';
        MEM_CONT = null;
      }
    }catch{}
  }

  function touch(opts){
    lsSet(opts.lastKey, String(nowMs()));
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

      /* Mic active (Bugs-style) — GREEN + CIRCULAR */
      #ai-mic.mic-active{
        background:#2F6C3C !important;
        color:#fff !important;
        border-color:#2F6C3C !important;
        border-radius:999px !important;
      }

      /* AI proof footer (under assistant messages) */
      .ai-proof{
        margin-top:8px;
        padding-top:6px;
        border-top:1px solid color-mix(in srgb, var(--border,#D1D5DB) 70%, transparent);
        font-size:11px;
        line-height:1.25;
        letter-spacing:.02em;
        color:color-mix(in srgb, var(--text,#111827) 65%, transparent);
        text-transform:uppercase;
        font-weight:900;
        user-select:none;
      }
      .ai-proof .dot{ padding:0 6px; opacity:.7; }
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

  function buildAiProof(meta){
    try{
      const m = (meta && typeof meta === 'object') ? meta : null;
      if (!m) return null;

      const usedOpenAI = (m.usedOpenAI === true) || (m.openai === true) || (m.aiUsed === true);

      const providerRaw =
        (m.provider || m.aiProvider || m.llmProvider || (m.ai && m.ai.provider) || (m.model && m.model.provider) || '').toString().trim();
      const modelRaw =
        (m.model || m.aiModel || m.llmModel || (m.ai && m.ai.model) || (m.model && m.model.name) || '').toString().trim();

      const proofRaw =
        (m.aiProof || m.proof || m.debugProof || '').toString().trim();

      if (proofRaw){
        const s = proofRaw.replace(/\s+/g,' ').trim();
        if (!s) return null;
        return s.length > 120 ? (s.slice(0,117) + '…') : s;
      }

      const providerLower = providerRaw.toLowerCase();
      const modelLower = modelRaw.toLowerCase();

      const providerIsOpenAI =
        providerLower.includes('openai') ||
        modelLower.startsWith('gpt') ||
        modelLower.includes('openai');

      if (!usedOpenAI && !providerIsOpenAI) return null;

      const provider = providerRaw || 'OpenAI';
      const parts = [];
      parts.push('AI: ' + provider);

      if (modelRaw) parts.push('Model: ' + modelRaw);

      const route = (m.route || m.path || m.pipeline || '').toString().trim();
      if (route) parts.push('Route: ' + route);

      const cached = (m.cacheHit === true || m.cached === true);
      if (cached) parts.push('Cache: yes');

      return parts.join(' • ');
    }catch{
      return null;
    }
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
      return { ok:false, reason:'missing_dom' };
    }

    if (window.__FV_COPILOT_WIRED) return { ok:true, already:true };
    window.__FV_COPILOT_WIRED = false;

    const desktop = isDesktop(opts.desktopMinWidth);
    if (desktop){
      micEl.style.display = 'none';
      micEl.disabled = true;
    }

    let stopDictation = null;
    let ignoreDictationUntil = 0;

    enforceTtl(opts);

    function getThreadId(){
      if (MEM_TID) return MEM_TID;
      const saved = lsGet(opts.threadKey).trim();
      if (saved) {
        MEM_TID = saved;
        return MEM_TID;
      }
      MEM_TID = makeClientTid();
      lsSet(opts.threadKey, MEM_TID);
      touch(opts);
      return MEM_TID;
    }

    function getContinuation(){
      if (MEM_CONT) return MEM_CONT;
      const tid = getThreadId();
      const bag = loadJson(opts.contKey, {});
      const c = (bag && typeof bag === 'object') ? (bag[tid] || null) : null;
      if (c) MEM_CONT = c;
      return MEM_CONT;
    }

    function setContinuation(cont){
      const tid = getThreadId();
      MEM_CONT = cont || null;
      const bag = loadJson(opts.contKey, {});
      const next = (bag && typeof bag === 'object') ? bag : {};
      if (cont) next[tid] = cont;
      else delete next[tid];
      saveJson(opts.contKey, next);
      touch(opts);
    }

    function setStatus(msg){
      if (statusEl) statusEl.textContent = msg || '';
    }

    function setDebugStatus(){
      if (!opts.showDebugStatus) return;
      const tid = getThreadId();
      const cont = getContinuation();
      setStatus(`tid:${tid.slice(0,8)} • cont:${cont ? "yes" : "no"}`);
    }

    function setThinking(on){
      const t = !!on;
      sendEl.disabled = t;
      inputEl.disabled = t;
      if (!desktop) micEl.disabled = t;
      if (t) setStatus('Thinking…');
      else setDebugStatus();
    }

    function clearEmptyState(){
      const empty = logEl.querySelector('.ai-empty');
      if (empty) empty.remove();
    }

    let history = loadJson(opts.storageKey, []);
    if (!Array.isArray(history)) history = [];

    function saveHistory(){
      const trimmed = history.slice(-Math.max(10, Number(opts.maxKeep) || 80));
      saveJson(opts.storageKey, trimmed);
      touch(opts);
    }

    const pdfModal = makePdfModal({ pdfTitle: opts.pdfTitle });

    function renderMessage(role, text, proof){
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

      if (role === 'assistant' && proof && String(proof).trim()){
        const foot = document.createElement('div');
        foot.className = 'ai-proof';
        foot.textContent = String(proof).trim();
        bubble.appendChild(foot);
      }

      wrap.appendChild(bubble);
      wrap.appendChild(meta);

      logEl.appendChild(wrap);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function append(role, text, proof){
      renderMessage(role, text, proof);

      const entry = { role, text: String(text || ''), ts: nowMs() };
      if (role === 'assistant' && proof && String(proof).trim()) entry.proof = String(proof).trim();

      history.push(entry);
      saveHistory();
    }

    for (const m of history){
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      renderMessage(m.role, m.text, m.proof || null);
    }

    getThreadId();
    setDebugStatus();

    function extractAnswer(data){
      const txt = (data && typeof data.text === 'string' && data.text.trim()) ? String(data.text) : '';
      const ans = (data && typeof data.answer === 'string' && data.answer.trim()) ? String(data.answer) : '';
      return txt || ans || '(No response)';
    }

    async function callAssistant(prompt){
      const payload = {
        text: String(prompt || ''),
        threadId: getThreadId(),
        debugAI: !!opts.debugAI
      };

      // keep continuation (backend may ignore safely)
      const cont = getContinuation();
      if (cont) payload.continuation = cont;

      const idToken = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(opts.copilotEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      // Try to parse JSON even on error so we can show the real backend message
      let data = null;
      try { data = await res.json(); } catch { data = null; }

      if (!res.ok) {
        const msg = (data && (data.error || data.message)) ? String(data.error || data.message) : '';
        const detail = msg ? ` — ${msg}` : '';
        throw new Error(`API error ${res.status}${detail}`);
      }

      if (data && data.ok === false) {
        const msg = (data.error || data.message) ? String(data.error || data.message) : 'Unknown error';
        throw new Error(msg);
      }

      // optional continuation support if backend returns it
      if (Object.prototype.hasOwnProperty.call(data?.meta || {}, 'continuation')) {
        setContinuation(data.meta.continuation || null);
      }

      setDebugStatus();

      const proof = buildAiProof(data?.meta || null);

      // Report pathway
      if (data && data.action === 'report') {
        const mode = data?.meta?.reportMode ? String(data.meta.reportMode) : 'recent';
        const url = buildReportUrl(opts.reportEndpoint, getThreadId(), mode);
        pdfModal.open(url);
        return { text: (PDF_MARKER + url), proof };
      }

      return { text: extractAnswer(data), proof };
    }

    formEl.addEventListener('submit', async (evt)=>{
      evt.preventDefault();
      evt.stopPropagation();

      try { if (typeof stopDictation === 'function') stopDictation(); } catch {}

      if (sendEl.disabled) return;
      if (sectionEl.classList.contains('perm-hidden') || sectionEl.getAttribute('aria-hidden') === 'true') return;

      const text = (inputEl.value || '').trim();
      if (!text) return;

      append('user', text);

      ignoreDictationUntil = Date.now() + 500;

      inputEl.value = '';
      inputEl.style.height = 'auto';

      setThinking(true);
      try{
        const out = await callAssistant(text);
        append('assistant', (out && out.text) ? out.text : '(No response)', out ? out.proof : null);
      }catch(e){
        const msg = (e && e.message) ? String(e.message) : "Sorry, I couldn't process that request right now.";
        append('assistant', msg);
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

    /* ==========================
       MIC — Dictation (no overlay)
    ========================== */
    if (!desktop){
      const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!Rec){
        micEl.disabled = true;
      } else {
        let active = false;
        let rec = null;

        function setMic(on){
          active = !!on;
          micEl.classList.toggle('mic-active', active);
          micEl.setAttribute('aria-label', active ? 'Stop dictation' : 'Start dictation');
        }

        function cleanup(){
          try{
            if (rec){
              rec.onresult = null;
              rec.onend = null;
              rec.onerror = null;
            }
          }catch{}
          rec = null;
        }

        function stop(){
          try{ if (rec) rec.stop(); }catch{}
          try{ if (rec) rec.abort(); }catch{}
          cleanup();
          setMic(false);
          if (!sendEl.disabled) setDebugStatus();
        }

        stopDictation = stop;

        function start(){
          rec = new Rec();
          rec.lang = 'en-US';
          rec.interimResults = true;
          rec.continuous = false;
          rec.maxAlternatives = 1;

          const base = inputEl.value ? (inputEl.value.trim() + ' ') : '';
          let finalSoFar = '';

          rec.onresult = (ev)=>{
            if (Date.now() < ignoreDictationUntil) return;

            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++){
              const r = ev.results[i];
              const t = r && r[0] ? (r[0].transcript || '') : '';
              if (!t) continue;
              if (r.isFinal) finalSoFar += (finalSoFar ? ' ' : '') + t.trim();
              else interim += (interim ? ' ' : '') + t.trim();
            }

            const parts = [];
            if (base) parts.push(base.trim());
            if (finalSoFar) parts.push(finalSoFar.trim());
            if (interim) parts.push(interim.trim());

            inputEl.value = parts.join(' ').trim();
            inputEl.dispatchEvent(new Event('input'));
            inputEl.focus();
          };

          rec.onend = ()=> stop();
          rec.onerror = ()=> stop();

          try{
            rec.start();
            setMic(true);
          }catch{
            stop();
          }
        }

        micEl.addEventListener('click', ()=>{
          if (sendEl.disabled) return;
          if (!active) {
            stop();
            start();
          } else {
            stop();
          }
        }, { passive:true });

        document.addEventListener('visibilitychange', ()=>{
          if (document.visibilityState !== 'visible') return;
          if (active) stop();
        });
      }
    }

    window.__FV_COPILOT_WIRED = true;
    return { ok:true };
  }

  return { init };
})();
