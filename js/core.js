// =========================================
// File: /js/core.js  (FULL REPLACEMENT)
// Self-contained mock logic (no backend)
// =========================================
(function(){
  const html = document.documentElement;
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const panel = document.getElementById('gear-panel');
  const gearBtn = document.getElementById('btn-gear');

  // -------- Theme --------
  const THEME_KEY = 'fv-theme'; // 'light' | 'dark' | 'auto'
  function applyTheme(mode){
    if(!mode) mode='auto';
    html.setAttribute('data-theme', mode);
    try{ localStorage.setItem(THEME_KEY, mode); }catch{}
    document.querySelectorAll('.theme-chip').forEach(b=>{
      b.setAttribute('aria-pressed', String(b.dataset.theme===mode));
    });
  }
  function initTheme(){
    let m='auto';
    try{ m = localStorage.getItem(THEME_KEY) || 'auto'; }catch{}
    applyTheme(m);
  }

  // -------- Panel open/close --------
  function openPanel(){
    panel.setAttribute('aria-hidden','false');
    gearBtn.setAttribute('aria-expanded','true');
    document.addEventListener('keydown', onEsc, {once:true});
    document.addEventListener('click', onOutside);
  }
  function closePanel(){
    panel.setAttribute('aria-hidden','true');
    gearBtn.setAttribute('aria-expanded','false');
    document.removeEventListener('click', onOutside);
  }
  function onEsc(e){ if(e.key==='Escape') closePanel(); }
  function onOutside(e){ if(!panel.contains(e.target) && e.target!==gearBtn) closePanel(); }

  if(gearBtn){
    gearBtn.addEventListener('click', ()=>{
      const closed = panel.getAttribute('aria-hidden')!=='false';
      closed?openPanel():closePanel();
    });
  }

  // -------- Views (in-panel) --------
  const VIEWS = ['menu','theme','feedback','account'];
  function showView(name){
    VIEWS.forEach(v=>{
      const el = document.getElementById('view-'+v);
      if(el) el.hidden = (v!==name);
    });
  }
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const nav = el.getAttribute('data-nav');
      if (VIEWS.includes(nav)) showView(nav);
      else if (nav==='menu') showView('menu');
    });
  });

  // -------- Theme handlers --------
  document.querySelectorAll('.theme-chip').forEach(b=>{
    b.addEventListener('click', ()=> applyTheme(b.dataset.theme));
  });

  // -------- Profile (mock) --------
  const PROFILE_KEY = 'fv-profile';
  function getProfile(){
    try{
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    }catch{return {};}
  }
  function saveProfile(p){
    try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }catch{}
    setLogoutLabel();
  }
  function setLogoutLabel(){
    const el = document.getElementById('logout-label');
    if(!el) return;
    const p = getProfile();
    const full = [p.first, p.last].filter(Boolean).join(' ').trim();
    el.textContent = full ? `Logout ${full}` : 'Logout (mock)';
  }
  // init profile form
  const formProfile = document.getElementById('form-profile');
  if(formProfile){
    const p = getProfile();
    ['first','last','email','phone'].forEach(k=>{
      const input = formProfile.querySelector(`[name="${k}"]`);
      if(input && p[k]) input.value = p[k];
    });
    formProfile.addEventListener('submit', (e)=>{
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formProfile).entries());
      saveProfile(data);
      alert('Saved (mock).');
    });
  }

  // -------- Feedback (mock) --------
  const IDEA_KEY = 'fv-feedback-ideas';
  const BUG_KEY  = 'fv-feedback-bugs';
  function loadList(key){
    try{ return JSON.parse(localStorage.getItem(key) || '[]'); }catch{ return []; }
  }
  function saveList(key, arr){
    try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
  }
  function addFeedback(key, text){
    const arr = loadList(key);
    arr.unshift({text, ts:new Date().toISOString()});
    saveList(key, arr);
  }
  function renderList(key, ul){
    const arr = loadList(key);
    ul.innerHTML = arr.map(item=>`<li><div>${escapeHtml(item.text)}</div><div class="muted">${new Date(item.ts).toLocaleString()}</div></li>`).join('');
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  const ideasForm = document.getElementById('form-ideas');
  const bugsForm  = document.getElementById('form-bugs');
  const ideasUl   = document.getElementById('list-ideas');
  const bugsUl    = document.getElementById('list-bugs');

  if(ideasForm){
    ideasForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      const ta = ideasForm.querySelector('textarea');
      const val = (ta.value||'').trim();
      if(!val) return;
      addFeedback(IDEA_KEY, val);
      ta.value = '';
      renderList(IDEA_KEY, ideasUl);
    });
    renderList(IDEA_KEY, ideasUl);
  }
  if(bugsForm){
    bugsForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      const ta = bugsForm.querySelector('textarea');
      const val = (ta.value||'').trim();
      if(!val) return;
      addFeedback(BUG_KEY, val);
      ta.value = '';
      renderList(BUG_KEY, bugsUl);
    });
    renderList(BUG_KEY, bugsUl);
  }

  // Feedback tabs
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.getAttribute('data-tab');
      document.querySelectorAll('[data-tab-panel]').forEach(p=>{
        p.hidden = (p.getAttribute('data-tab-panel')!==which);
      });
    });
  });

  // -------- Reset password (mock) --------
  const btnReset = document.getElementById('btn-reset');
  if(btnReset){
    btnReset.addEventListener('click', ()=>{
      const p = getProfile();
      alert(`(Mock) Would send reset link to: ${p.email || 'no-email-set'}`);
    });
  }

  // -------- Logout (mock) --------
  const btnLogout = document.getElementById('btn-logout');
  if(btnLogout){
    btnLogout.addEventListener('click', ()=>{
      if(confirm('Logout (mock)? This clears local profile only.')){
        try{ localStorage.removeItem(PROFILE_KEY); }catch{}
        setLogoutLabel();
        showView('menu');
      }
    });
  }

  // Init
  initTheme();
  setLogoutLabel();
  showView('menu');
})();
