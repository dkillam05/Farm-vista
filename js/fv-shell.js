// /js/fv-shell.js
// FarmVista — App Shell v1.1.1
// - Theme chips fixed (System/Light/Dark) with html[data-theme] support
// - Update action label simplified to "Check for updates" (still clears cache)
// - Footer pinned; main-only scrolling; mobile drawer; desktop expandable sidebar
// - Absolute paths for GitHub Pages (/Farm-vista/...)

class FVShell extends HTMLElement {
  constructor(){
    super();
    this._r = this.attachShadow({mode:'open'});
    this._r.innerHTML = `
<style>
:host{
  display:block;
  --green:#3B7E46; --gold:#D0C542;
  --bg:#f0f2ef; --ink:#141514;
  --sb-bg:#ffffff; --sb-ink:#141514; --hair:rgba(0,0,0,.10);
  --shadow:0 10px 22px rgba(0,0,0,.14);
  --safe-top:env(safe-area-inset-top,0px);
  --safe-left:env(safe-area-inset-left,0px);
  --safe-right:env(safe-area-inset-right,0px);
}
/* Dark palette when html has .dark (we also set html[data-theme]) */
:host-context(.dark){
  --bg:#0f1210; --ink:#e8eee9;
  --sb-bg:#151b17; --sb-ink:#e8eee9; --hair:#253228;
}

/* Shell grid */
.shell{height:100dvh; display:grid; grid-template-columns:72px 1fr; grid-template-rows:auto 1fr auto; background:var(--bg); color:var(--ink);}
.shell.expanded{grid-template-columns:280px 1fr;}
@media (max-width:1023px){ .shell{grid-template-columns:1fr;} }

/* Header */
.h{grid-column:1/-1; position:sticky; top:0; z-index:1000; background:var(--green); color:#fff; border-bottom:1px solid rgba(0,0,0,.15);}
.h-top{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px max(14px,var(--safe-right)) 10px max(14px,var(--safe-left)); padding-top:calc(10px + var(--safe-top)); max-width:1072px; margin:0 auto;}
.brand{font-weight:800; font-size:20px; letter-spacing:.3px;}
.h-accent{height:3px; background:var(--gold);}
.btn{display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:9px; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.28); color:#fff; cursor:pointer;}

/* Sidebar */
.sb{grid-row:2; background:var(--sb-bg); color:var(--sb-ink); border-right:1px solid var(--hair); position:sticky; top:0; height:100%; display:flex; flex-direction:column;}
.sb-head{padding:14px 12px; border-bottom:1px solid var(--hair);}
.farm{display:flex; align-items:center; gap:10px;}
.flogo{width:36px; height:36px; border-radius:8px; background:#fff; object-fit:contain; border:1px solid var(--hair);}
.ftitle{font-weight:700;}
.fsub{font-size:13px; opacity:.8;}

nav.menu{padding:8px; overflow:auto; flex:1;}
a.item{display:flex; align-items:center; gap:10px; padding:10px; border-radius:10px; color:inherit; text-decoration:none;}
a.item:hover{background:color-mix(in srgb, var(--green) 10%, transparent);}
.em{width:24px; text-align:center;}
.lbl{white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
@media (min-width:1024px){
  .shell:not(.expanded) .ftitle, .shell:not(.expanded) .fsub, .shell:not(.expanded) .lbl{display:none}
}
@media (max-width:1023px){
  .sb{position:fixed; inset:0 auto 0 0; width:84vw; max-width:320px; transform:translateX(-100%); transition:transform .2s ease; z-index:1001; box-shadow:var(--shadow);}
  .shell.mopen .sb{transform:translateX(0);}
}
.sb-foot{border-top:1px solid var(--hair); padding:12px; font-size:12.5px;}
.sb-foot strong{font-weight:800;}
.sb-foot .ver{opacity:.9}

/* Scrim */
.scrim{position:fixed; inset:0; background:rgba(0,0,0,.45); opacity:0; pointer-events:none; transition:opacity .18s; z-index:1000;}
.scrim.show{opacity:1; pointer-events:auto}

/* Main scroller */
main{grid-column:1/-1; overflow:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch;}
.container{max-width:1040px; margin:0 auto; padding:18px 14px 14px;}

/* Footer pinned */
.f{grid-column:1/-1; position:sticky; bottom:0; z-index:1; background:var(--green); color:#fff; border-top:3px solid var(--gold); display:grid; place-items:center; padding:10px max(14px,var(--safe-right)); white-space:nowrap; font-size:clamp(12px,1.6vw,14px);}

/* Settings sheet */
.sheet{position:fixed; left:0; right:0; top:calc(56px + var(--safe-top)); background:var(--green); color:#fff; border-bottom:1px solid rgba(0,0,0,.15); transform:scaleY(.98); opacity:0; visibility:hidden; transform-origin:top; transition:transform .14s ease, opacity .14s ease, visibility .14s; z-index:1002; max-height:calc(100dvh - 56px - var(--safe-top)); overflow:auto;}
.sheet.show{transform:scaleY(1); opacity:1; visibility:visible;}
.sheet-in{max-width:1072px; margin:0 auto; padding:8px max(14px,var(--safe-right)) 14px max(14px,var(--safe-left));}
.sttl{text-transform:uppercase; letter-spacing:.12em; font-size:12px; opacity:.9; margin:8px 0 4px 4px;}
.chips{display:flex; gap:8px; flex-wrap:wrap; padding:6px 4px;}
.chip{border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.08); color:#fff; padding:8px 12px; border-radius:999px; cursor:pointer;}
.chip[aria-pressed="true"]{outline:2px solid #fff; outline-offset:2px;}
.row{display:flex; align-items:center; justify-content:space-between; padding:12px 6px; border-radius:10px; cursor:pointer;}
.row:hover{background:rgba(255,255,255,.08);}
.muted{opacity:.85}

/* Spinner + toast */
#updIcon .spin{width:16px; height:16px; display:inline-block; border:2px solid rgba(255,255,255,.35); border-top-color:#fff; border-radius:50%; animation:fvspin .9s linear infinite;}
@keyframes fvspin{to{transform:rotate(360deg)}}
</style>

<div class="shell">
  <header class="h">
    <div class="h-top">
      <button class="btn" id="btnMenu" aria-label="Menu" title="Menu">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <div class="brand">FarmVista</div>
      <button class="btn" id="btnGear" aria-haspopup="menu" aria-expanded="false" title="User menu">
        <!-- People icon -->
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </button>
    </div>
    <div class="h-accent"></div>
  </header>

  <aside class="sb">
    <div class="sb-head">
      <div class="farm">
        <img id="farmLogo" class="flogo" alt="Farm logo">
        <div>
          <div class="ftitle" id="farmName">Dowson Farms</div>
          <div class="fsub" id="farmAddr">Divernon, IL</div>
        </div>
      </div>
    </div>
    <nav class="menu">
      <a class="item" href="/Farm-vista/dashboard/"><span class="em">🏠</span><span class="lbl">Home</span></a>
      <a class="item" href="#"><span class="em">🌱</span><span class="lbl">Crop Production</span></a>
      <a class="item" href="#"><span class="em">🚜</span><span class="lbl">Equipment</span></a>
      <a class="item" href="#"><span class="em">🌾</span><span class="lbl">Grain</span></a>
      <a class="item" href="#"><span class="em">💵</span><span class="lbl">Expenses</span></a>
      <a class="item" href="#"><span class="em">📊</span><span class="lbl">Reports</span></a>
      <a class="item" href="#"><span class="em">🧰</span><span class="lbl">Setup</span></a>
    </nav>
    <div class="sb-foot">
      <div><strong>FarmVista</strong> <span class="ver" id="ver">v1.0.0</span></div>
      <div class="fsub" id="tagline">Clean farm data. Smarter reporting.</div>
    </div>
  </aside>

  <div class="scrim" id="scrim"></div>

  <main><div class="container"><slot></slot></div></main>

  <footer class="f"><div id="footLine">© 2025 FarmVista</div></footer>

  <!-- Settings -->
  <div class="sheet" id="sheet" role="menu" aria-label="User menu">
    <div class="sheet-in">
      <div class="sttl">Theme</div>
      <div class="chips">
        <button type="button" class="chip" id="chipSystem" data-theme="system" aria-pressed="false">System</button>
        <button type="button" class="chip" id="chipLight"  data-theme="light"  aria-pressed="false">Light</button>
        <button type="button" class="chip" id="chipDark"   data-theme="dark"   aria-pressed="false">Dark</button>
      </div>

      <div class="sttl">Profile</div>
      <div class="row"><div>Account details</div><div class="muted">Coming soon</div></div>
      <div class="row"><div>Feedback</div><div class="muted">Coming soon</div></div>
      <div class="row"><div>Security</div><div class="muted">Coming soon</div></div>

      <div class="sttl">Maintenance</div>
      <div class="row" id="btnUpdateAll" aria-busy="false">
        <div>Check for updates</div><div id="updIcon">↻</div>
      </div>
    </div>
  </div>
</div>
    `;

    // lock page so only <main> scrolls (prevents gray above/below)
    if (!document.getElementById('fv-lock')) {
      const s=document.createElement('style'); s.id='fv-lock';
      s.textContent='html,body{height:100%;margin:0;overflow:hidden;overscroll-behavior:none;}';
      document.head.appendChild(s);
    }
  }

  connectedCallback(){
    // logo
    const logo=this._r.getElementById('farmLogo');
    if (logo) logo.src = '/Farm-vista/assets/icons/logo.png';

    // footer date
    this._setFooterDate();

    // version + tagline
    const ver = (window.FarmVistaVersion) || (window.FV_VERSION && window.FV_VERSION.number) || '1.0.0';
    const tag = (window.FV_TAGLINE) || 'Clean farm data. Smarter reporting.';
    const vEl = this._r.getElementById('ver'); if (vEl) vEl.textContent = 'v'+ver;
    const tg  = this._r.getElementById('tagline'); if (tg) tg.textContent = tag;

    // wiring
    const shell=this._r.querySelector('.shell');
    const scrim=this._r.getElementById('scrim');
    const btnMenu=this._r.getElementById('btnMenu');
    const btnGear=this._r.getElementById('btnGear');
    const sheet=this._r.getElementById('sheet');

    const isDesktop = ()=> matchMedia('(min-width:1024px)').matches;
    const closeAll  = ()=>{ shell.classList.remove('mopen'); shell.classList.remove('expanded'); scrim.classList.remove('show'); sheet.classList.remove('show'); btnGear?.setAttribute('aria-expanded','false'); };

    btnMenu?.addEventListener('click', ()=>{
      if (isDesktop()) shell.classList.toggle('expanded');
      else {
        const on = !shell.classList.contains('mopen');
        shell.classList.toggle('mopen', on);
        scrim.classList.toggle('show', on);
        if (on) sheet.classList.remove('show');
      }
    });

    btnGear?.addEventListener('click', ()=>{
      const on = !sheet.classList.contains('show');
      sheet.classList.toggle('show', on);
      btnGear.setAttribute('aria-expanded', String(on));
      scrim.classList.toggle('show', on);
      if (on) shell.classList.remove('mopen');
      this._reflectThemeChips();
    });

    scrim?.addEventListener('click', closeAll);
    addEventListener('resize', closeAll);

    // Theme: restore + apply + reflect
    const saved = this._getTheme();
    this._applyTheme(saved);
    this._reflectThemeChips();

    ['chipSystem','chipLight','chipDark'].forEach(id=>{
      const el=this._r.getElementById(id);
      el?.addEventListener('click', ()=>{
        const mode = el.getAttribute('data-theme') || 'system';
        this._setTheme(mode);
        this._applyTheme(mode);
        this._reflectThemeChips();
      }, {passive:true});
    });

    // Update action
    this._r.getElementById('btnUpdateAll')?.addEventListener('click', ()=> this._updateAndRefresh());

    // SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/Farm-vista/serviceworker.js').catch(()=>{});
    }

    // Post-refresh toast
    const post = sessionStorage.getItem('fv-postUpdateMsg');
    if (post) { this._toast(post, 2400); sessionStorage.removeItem('fv-postUpdateMsg'); }
  }

  /* Helpers ----------------------------- */
  _setFooterDate(){
    try{
      const el=this._r.getElementById('footLine'); if (!el) return;
      const d=new Date();
      const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric'});
      const parts=fmt.formatToParts(d).reduce((a,p)=> (a[p.type]=p.value,a),{});
      const n=parseInt(parts.day,10); const s=(n%10===1&&n%100!==11)?'st':(n%10===2&&n%100!==12)?'nd':(n%10===3&&n%100!==13)?'rd':'th';
      el.textContent=`© ${parts.year} FarmVista • ${parts.weekday}, ${parts.month} ${n}${s}, ${parts.year}`;
    }catch{
      this._r.getElementById('footLine').textContent = '© ' + new Date().getFullYear() + ' FarmVista';
    }
  }

  _getTheme(){ try{ return localStorage.getItem('fv-theme') || 'system'; }catch{ return 'system'; } }
  _setTheme(m){ try{ localStorage.setItem('fv-theme', m); }catch{} }
  _applyTheme(mode){
    const root=document.documentElement;
    // keep class for older CSS
    root.classList.remove('dark');
    if (mode==='dark') root.classList.add('dark');
    else if (mode==='system' && matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
    // ALSO set data-theme to work with your theme.css tokens
    const token = (mode==='system') ? 'auto' : mode; // your CSS expects 'auto' not 'system'
    try{ root.setAttribute('data-theme', token); }catch{}
  }
  _reflectThemeChips(){
    const m=this._getTheme();
    this._r.querySelectorAll('.chip[data-theme]').forEach(ch=>{
      ch.setAttribute('aria-pressed', String(ch.getAttribute('data-theme')===m));
    });
  }

  _toast(msg, ms=2200){
    let el=this._r.getElementById('fvToast');
    if(!el){ el=document.createElement('div'); el.id='fvToast'; el.style.cssText='position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:3000;background:rgba(0,0,0,.88);color:#fff;padding:10px 12px;border-radius:10px;font-size:14px;box-shadow:0 8px 18px rgba(0,0,0,.25);transition:opacity .18s;'; this._r.appendChild(el); }
    el.textContent=msg; el.style.opacity='1'; clearTimeout(this._t); this._t=setTimeout(()=> el.style.opacity='0', ms);
  }
  _spin(on){
    const row=this._r.getElementById('btnUpdateAll'); const ico=this._r.getElementById('updIcon');
    if(row&&ico){ row.setAttribute('aria-busy', String(on)); row.style.pointerEvents= on?'none':''; ico.innerHTML = on ? '<span class="spin" aria-hidden="true"></span>' : '↻'; }
  }

  async _fetchLatestTag(){
    try{
      const res=await fetch('/Farm-vista/js/version.js?rev='+Date.now(), {cache:'no-store'});
      if(!res.ok) return null;
      const text=await res.text();
      const m=text.match(/FarmVistaVersion\s*=\s*["']([^"']+)["']/);
      return m?m[1]:null;
    }catch{ return null; }
  }
  async _updateAndRefresh(){
    this._spin(true);
    this._toast('Checking for updates…', 900);
    const latest = await this._fetchLatestTag();
    this._toast('Clearing cache…', 900);

    try{
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        for(const r of regs){ await r.unregister(); }
      }
      if('caches' in window){
        const ks=await caches.keys();
        for(const k of ks){ await caches.delete(k); }
      }
      const theme=this._getTheme();
      localStorage.clear();
      this._setTheme(theme);
    }catch{}

    sessionStorage.setItem('fv-postUpdateMsg', latest ? `Updated & Refreshed (v${latest}).` : 'Refreshed with latest files.');
    const bust = latest || Date.now();
    setTimeout(()=>{ location.replace(location.pathname + '?rev=' + encodeURIComponent(bust)); }, 150);
  }
}
customElements.define('fv-shell', FVShell);