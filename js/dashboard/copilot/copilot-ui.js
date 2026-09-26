import {createIssueManager} from './copilot-issues.js';
'use strict';

import { ready, getAuth, onAuthStateChanged } from '/js/firebase/firebase-init.js';
import { scopeKeys, requestHistory, safeSources, readProof } from './copilot-context.js';
import { messageHtml, mountChatActions } from './copilot-presentation.js?v=buttons-20260926-1';
import { wireChatViewport } from './copilot-viewport.js';
import { wireChatDictation } from './copilot-dictation.js';
import { createReportManager } from './copilot-reports.js';

export const FVCopilotUI = (() => {
  const DEFAULTS = {
    copilotEndpoint: (window.FV_COPILOT_ENDPOINT || 'https://farmvista-copilot-300398089669.us-central1.run.app/chat/agronomy-preview').toString(),
    reportEndpoint:  (window.FV_COPILOT_REPORT_ENDPOINT || 'https://farmvista-copilot-300398089669.us-central1.run.app/report/beta').toString(),

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

    showDebugStatus: false,

    // ✅ request-controlled AI debug proof (backend may append meta)
    debugAI: false
  };

  const PDF_MARKER = '[[FV_PDF]]:';

  // In-memory (session) copies
  let MEM_TID = '';
  let MEM_CONT = null;

  function nowMs(){ return Date.now(); }

  function isDesktop(minWidth){
    try { return window.matchMedia && window.matchMedia(`(min-width: ${minWidth}px)`).matches; }
    catch { return false; }
  }

  function getEl(sel){ return document.querySelector(sel); }

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

  function installChatStyles(){
    const style = document.createElement('style');
    style.textContent = `
      #ai-mic.mic-active{background:#2F6C3C!important;color:#fff!important;border-color:#2F6C3C!important;border-radius:999px!important}
      #ai-section .ai-msg-wrap{display:flex;flex-direction:column;gap:5px;flex:0 0 auto;width:100%;min-width:0}
      #ai-section .ai-row-user{align-items:flex-end}
      #ai-section .ai-row-assistant{align-items:flex-start}
      #ai-section .ai-msg{max-width:88%;min-width:0;padding:12px 15px;border:1px solid var(--border,#dce4de);border-radius:18px;box-shadow:0 2px 5px rgba(20,40,25,.035);overflow-wrap:anywhere}
      #ai-section .ai-msg-user{background:#2f6c3c;color:#fff;border-color:#2f6c3c;border-top-right-radius:5px}
      #ai-section .ai-msg-assistant{background:var(--surface,#fff);color:var(--text,#18251c);border-top-left-radius:5px}
      #ai-section .ai-msg-meta{padding:0 4px;font:600 12px/1.3 system-ui;color:var(--muted,#67706b)}
      #ai-section .ai-proof{margin-top:12px;padding-top:9px;border-top:1px solid var(--border,#dce4de);font-size:11px;line-height:1.45;letter-spacing:0;color:var(--muted,#67706b);text-transform:none;font-weight:500;user-select:text}
      #ai-section .ai-proof .dot{padding:0 6px;opacity:.7}
      #ai-section .ai-msg-assistant>a{font-size:12px;line-height:1.4}
      @media(min-width:900px){#ai-section .ai-msg{max-width:82%}}
    `;
    document.head.appendChild(style);
  }

  function buildAiProof(meta){
    try{
      const evidence=readProof(meta);
      if(evidence)return evidence;
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

  async function initialize(userOpts = {}){
    const opts = { ...DEFAULTS, ...(userOpts || {}) };

    await ready;
    const auth = getAuth();
    const signedInUser = await new Promise(resolve => {
      let stop;
      stop = onAuthStateChanged(auth, user => { queueMicrotask(() => stop?.()); resolve(user); });
    });
    if (!signedInUser) {
      const status = getEl(opts.statusSel);
      if (status) status.textContent = 'Sign in to ask about your farm records.';
      return { ok:false, reason:'sign_in_required' };
    }
    const projectId = String(auth.app?.options?.projectId || window.FV_FIREBASE_CONFIG?.projectId || '');
    Object.assign(opts, scopeKeys(opts, projectId, signedInUser.uid));
    MEM_TID = '';
    MEM_CONT = null;

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
    let dictation = null;

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
      if (!opts.showDebugStatus) { setStatus(''); return; }
      const tid = getThreadId();
      const cont = getContinuation();
      setStatus(`tid:${tid.slice(0,8)} • cont:${cont ? "yes" : "no"}`);
    }

    let activeTurn=null;
    const stopButton=document.createElement('button');stopButton.type='button';stopButton.className='ai-stop';stopButton.textContent='■ Stop';stopButton.setAttribute('aria-label','Stop response');stopButton.hidden=true;
    stopButton.style.cssText='display:none;min-height:44px;padding:8px 12px;border:1px solid var(--border,#ccc);border-radius:9px;background:transparent;color:inherit;font:inherit;';
    sendEl.insertAdjacentElement('afterend',stopButton);
    stopButton.addEventListener('click',async()=>{
      const turn=activeTurn;if(!turn||turn.stopped||!sameSession())return;
      turn.stopped=true;clearTimeout(thinkingTimer);stopButton.disabled=true;stopButton.textContent='Stopping…';setStatus('Stopping this question…');
      try{
        const token=await getAuthToken();if(!sameSession())return;
        const response=await fetch('https://farmvista-copilot-300398089669.us-central1.run.app/chat/beta/cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({projectId,requestId:turn.id}),signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error('Stop could not be confirmed.');
        const result=await response.json();
        if(result.stopped)turn.controller.abort();
        else if(activeTurn===turn)setStatus('Stop requested. Waiting for the current search to finish stopping…');
      }catch{if(sameSession()&&activeTurn===turn)setStatus('Stop could not be confirmed. Waiting for the current request to finish.');}
    });
    let thinkingTimer = null;
    function setThinking(on){
      const t = !!on;
      if (thinkingTimer) clearTimeout(thinkingTimer);
      thinkingTimer = null;
      sendEl.disabled = t;sendEl.style.display=t?'none':'';
      stopButton.hidden=!t;stopButton.style.display=t?'inline-flex':'none';stopButton.disabled=false;stopButton.textContent='■ Stop';
      chatActions.refresh();
      inputEl.disabled = t;
      reportCreate.disabled = t;
      if (!desktop) micEl.disabled = t || dictation?.supported === false;
      if (t) {
        setStatus('Checking your records…');
        thinkingTimer = setTimeout(()=>{
          if (sameSession() && sendEl.disabled) setStatus('Still checking records. A complete farm-wide search can take a few minutes.');
        },20000);
      }
      else setDebugStatus();
    }

    function clearEmptyState(){
      const empty = logEl.querySelector('.ai-empty');
      if (empty) empty.remove();
    }

    let history = loadJson(opts.storageKey, []);
    if (!Array.isArray(history)) history = [];
    let sessionChanged = false;
    function sameSession(){
      return !sessionChanged && getAuth()?.currentUser?.uid === signedInUser.uid && window.FV_FIREBASE_CONFIG?.projectId === projectId;
    }
    const issues = createIssueManager({getHistory:()=>history,getToken:getAuthToken,isCurrent:sameSession,projectId});
    const chatActions = mountChatActions({
      onReport:()=>{stopDictation?.();issues.open();},
      host: formEl.querySelector('.ai-actions') || formEl,
      getHistory: () => history,
      isCurrent: sameSession,
      canClear: () => !sendEl.disabled,
      onClear: () => {
        if(!sameSession()||sendEl.disabled)return;
        stopDictation?.();
        history=[];
        for(const key of [opts.storageKey,opts.threadKey,opts.contKey,opts.lastKey])lsRemove(key);
        MEM_TID='';MEM_CONT=null;
        logEl.replaceChildren();
        const empty=document.createElement('div');
        empty.className='ai-empty';empty.textContent='Start a new conversation.';logEl.appendChild(empty);
        inputEl.value='';inputEl.dispatchEvent(new Event('input'));
        setStatus('');
      }
    });
    const chatViewport = wireChatViewport({section:sectionEl, input:inputEl, form:formEl, log:logEl});
    const reports = createReportManager({endpoint:opts.reportEndpoint,getToken:getAuthToken,projectId,isCurrent:sameSession});
    const reportCreate = document.createElement('button');
    reportCreate.type = 'button';
    reportCreate.className = 'fv-report-create';
    reportCreate.title = 'Create a report';
    reportCreate.setAttribute('aria-label','Create a report');
    reportCreate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/></svg>';
    (formEl.querySelector('.ai-actions') || formEl).appendChild(reportCreate);
    reportCreate.addEventListener('click',()=>{
      if (!sameSession() || sendEl.disabled) return;
      if (!inputEl.value.trim()) inputEl.value = 'Make a report on ';
      inputEl.dispatchEvent(new Event('input'));
      inputEl.focus();
      inputEl.setSelectionRange(inputEl.value.length,inputEl.value.length);
      setStatus('Name one topic, such as corn in grain bags, HEL ground or RTK towers.');
    });

    function saveHistory(){
      const trimmed = history.slice(-Math.max(10, Number(opts.maxKeep) || 80));
      saveJson(opts.storageKey, trimmed);
      touch(opts);
      chatActions.refresh();
    }

    installChatStyles();

    function renderMessage(role, text, proof, sources = [], details = {}){
      clearEmptyState();

      const who = role === 'user' ? 'You' : 'Scout';

      const wrap = document.createElement('div');
      wrap.className = 'ai-msg-wrap ' + (role === 'user' ? 'ai-row-user' : 'ai-row-assistant');

      const bubble = document.createElement('div');
      bubble.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-assistant');

      const meta = document.createElement('div');
      meta.className = 'ai-msg-meta ' + (role === 'user' ? 'user' : 'assistant');
      meta.textContent = who;

      if (role === 'assistant' && typeof text === 'string' && text.startsWith(PDF_MARKER)) {
        bubble.textContent = 'Please request a new report to read the current records.';
      } else {
        const content = document.createElement('div');
        content.className = 'fv-chat-content';
        content.innerHTML = messageHtml(text);
        bubble.appendChild(content);
      }
      if (role === 'assistant' && details.reportRef?.id && details.reportRef?.query) {
        const button = document.createElement('button');
        button.type = 'button';button.className = 'fv-report-link';button.textContent = 'View report PDF';
        button.addEventListener('click',()=>{if(sameSession()){inputEl.blur();reports.open(details.reportRef);}});
        bubble.appendChild(button);
      }

      if (role === 'assistant' && proof && String(proof).trim()){
        const foot = document.createElement('div');
        foot.className = 'ai-proof';
        foot.textContent = String(proof).trim();
        bubble.appendChild(foot);
      }

      if (role === 'assistant') {
        for (const source of safeSources(sources)) {
          const link = document.createElement('a');
          link.href = source.path;
          link.textContent = 'Open ' + source.label;
          link.style.cssText = 'display:block;margin-top:8px;text-decoration:underline;color:inherit;';
          bubble.appendChild(link);
        }
      }

      wrap.appendChild(meta);
      wrap.appendChild(bubble);

      logEl.appendChild(wrap);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function append(role, text, proof, sources = [], failed = false, details = {}){
      renderMessage(role, text, proof, sources, details);

      const entry = { role, text: String(text || ''), ts: nowMs() };
      if (role === 'assistant' && proof && String(proof).trim()) entry.proof = String(proof).trim();
      if (role === 'assistant') entry.sources = safeSources(sources);
      if (failed) entry.failed = true;
      if (role === 'assistant') {
        if (details.reportRef) entry.reportRef = details.reportRef;
        if (details.reportTopicRequired) entry.reportTopicRequired = true;
        if (details.reportDataset) entry.reportDataset = details.reportDataset;
      }

      history.push(entry);
      saveHistory();
    }

    for (const m of history){
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      renderMessage(m.role, m.text, m.proof || null, m.sources || [], m);
    }

    getThreadId();
    setDebugStatus();

    function extractAnswer(data){
      const txt = (data && typeof data.text === 'string' && data.text.trim()) ? String(data.text) : '';
      const ans = (data && typeof data.answer === 'string' && data.answer.trim()) ? String(data.answer) : '';
      return txt || ans || '(No response)';
    }

    async function callAssistant(prompt,turn){
      if (!sameSession()) {
        throw new Error('Your farm or sign-in changed. Reload FarmVista before continuing.');
      }
      const payload = {
        text: String(prompt || ''),requestId:turn.id,cancellable:true,
        threadId: getThreadId(),
        projectId,
        history: requestHistory(history, prompt),
        debugAI: !!opts.debugAI
      };
      const previousAnswer = [...history].reverse().find(item=>item.role === 'assistant');
      if (previousAnswer?.reportTopicRequired) {
        payload.reportRequested = true;
        if (previousAnswer.reportDataset) payload.reportDataset = previousAnswer.reportDataset;
      }

      // keep continuation (backend may ignore safely)
      const cont = getContinuation();
      if (cont) payload.continuation = cont;

      const idToken = await getAuthToken();
      if (!idToken) throw new Error('Please sign in again to read your farm records.');
      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;

      const res = await fetch(opts.copilotEndpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.any([AbortSignal.timeout(240000),turn.controller.signal]),
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
      if (!sameSession()) throw new Error('Your sign-in changed. Reload FarmVista.');

      if(turn.stopped)throw new Error('Question stopped.');
      // optional continuation support if backend returns it
      if (Object.prototype.hasOwnProperty.call(data?.meta || {}, 'continuation')) {
        setContinuation(data.meta.continuation || null);
      }

      setDebugStatus();

      const proof = buildAiProof(data?.meta || null);

      return { text: extractAnswer(data), proof, sources:safeSources(data?.meta?.sources),
        reportRef:data?.report ? reports.remember(data.report) : null,
        reportTopicRequired:data?.reportTopicRequired === true,reportDataset:data?.reportDataset };
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
      const turn={id:crypto.randomUUID(),controller:new AbortController(),text,entry:history.at(-1),node:logEl.lastElementChild,stopped:false};activeTurn=turn;

      inputEl.value = '';
      inputEl.style.height = 'auto';

      setThinking(true);
      try{
        const out = await callAssistant(text,turn);
        if (!sameSession()||turn.stopped) return;
        append('assistant', (out && out.text) ? out.text : '(No response)', out ? out.proof : null, out?.sources || [], false, out || {});
      }catch(e){
        if (!sameSession()) return;
        if(turn.stopped)return;
        const msg = (e && e.message) ? String(e.message) : "Sorry, I couldn't process that request right now.";
        append('assistant', msg, null, [], true);
      }finally{
        if(activeTurn===turn)activeTurn=null;
        if (sameSession()) {
          setThinking(false);
          if(turn.stopped){
            history=history.filter(entry=>entry!==turn.entry);turn.node?.remove();saveHistory();setContinuation(null);
            inputEl.value=turn.text;inputEl.dispatchEvent(new Event('input'));inputEl.focus();setStatus('Question stopped. Edit it and send again.');
          }
        }
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
      dictation = wireChatDictation({button:micEl,input:inputEl,section:sectionEl,
        isAllowed:()=>sameSession()&&!sendEl.disabled&&!sectionEl.classList.contains('perm-hidden'),
        onStatus:setStatus,onIdle:()=>{if(!sendEl.disabled)setDebugStatus();}});
      stopDictation = ()=>dictation.stop();
    }

    window.__FV_COPILOT_WIRED = true;
    onAuthStateChanged(auth, user => {
      if (user?.uid === signedInUser.uid) return;
      sessionChanged = true;
      activeTurn?.controller.abort();stopButton.hidden=true;
      dictation?.destroy();
      chatViewport.destroy();
      reports.destroy();
      issues.destroy();
      reportCreate.disabled = true;
      history = [];
      chatActions.refresh();
      logEl.replaceChildren();
      inputEl.disabled = sendEl.disabled = micEl.disabled = true;
      setStatus('Your sign-in changed. Reload FarmVista to continue.');
    });
    return { ok:true };
  }

  let initializing;
  function init(userOpts = {}) {
    if (!initializing) initializing = initialize(userOpts).catch(error => {
      initializing = null;
      const status = getEl(userOpts.statusSel || DEFAULTS.statusSel);
      if (status) status.textContent = 'Scout could not connect. Reload FarmVista to try again.';
      console.warn('[copilot] initialization failed', error?.name || 'Error');
      return { ok:false, reason:'initialization_failed' };
    });
    return initializing;
  }
  return { init };
})();
