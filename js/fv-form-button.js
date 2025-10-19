/* <fv-form-button> v3.2.4 — form entry tile
   Icons via icon-svg:
   'plus' | 'minus' | 'edit' | 'import' | 'report' | 'done' | 'done-box' | 'camera' | 'reconcile-scales'
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{
        display:block;
        --tile-h:160px;
        --form-accent:#0F3B82; /* switches in _applyAccentFromTheme */
        --icon-extra:0px;      /* 'report' uses +8px */
      }
      a.tile{
        display:grid; grid-template-rows:55% 45%;
        justify-items:center; align-items:center;
        height:var(--tile-h); padding:18px; border-radius:16px;
        background:var(--card-surface, var(--surface));
        color:var(--text); border:1px solid var(--card-border, var(--border)); box-shadow:var(--shadow);
        text-decoration:none; transition:transform .06s, box-shadow .12s, border-color .12s;
      }
      a.tile:active{ transform:scale(.985); }
      .label{
        align-self:end; margin-bottom:32px; text-align:center;
        font-weight:800; font-size:clamp(18px,2.6vw,22px); line-height:1.25; color:var(--form-accent);
      }
      .icon{
        align-self:start; transform:translateY(-10px); line-height:1;
        font-size:calc(clamp(40px,10vw,60px) + var(--icon-extra));
      }
      .icon svg{
        display:block;
        width:calc(clamp(40px,10vw,60px) + var(--icon-extra));
        height:calc(clamp(40px,10vw,60px) + var(--icon-extra));
      }
    </style>

    <a class="tile" part="tile">
      <div class="label" part="label"></div>
      <div class="icon" part="icon"></div>
    </a>
  `;

  // 24x24 inline SVGs (inherit currentColor)
  const ICONS = {
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,

    minus: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 12h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`,

    edit: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"
            fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M13.5 6.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,

    import: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
            fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M12 4v10M8.5 10.5 12 14l3.5-3.5"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    report: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4.5" width="12" height="15.5" rx="2"
            fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="9" y="2.4" width="6" height="3.6" rx="1.2"
            fill="none" stroke="currentColor" stroke-width="1.6"/>
      <rect x="8.5"  y="14.6" width="2.0" height="4.4" rx="0.6" fill="currentColor"/>
      <rect x="11.1" y="12.6" width="2.0" height="6.4" rx="0.6" fill="currentColor"/>
      <rect x="13.7" y="10.4" width="2.0" height="8.6" rx="0.6" fill="currentColor"/></svg>`,

    done: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M8.7 12.2l2.4 2.4 4.2-4.7"
            fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    "done-box": `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="5.5" width="13" height="13" rx="2.2"
            fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M8.5 12.5l2.2 2.2 4.3-4.8"
            fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

    camera: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="4" y="7" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="17.3" cy="9.9" r="0.8" fill="currentColor"/></svg>`,

    // Option A: balanced scales
    "reconcile-scales": `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M6 7h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M7.5 7c-.9 2.5-2.1 4-3.5 4 1.4 0 2.6 1.5 3.5 4 .9-2.5 2.1-4 3.5-4-1.4 0-2.6-1.5-3.5-4Z"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M16.5 7c-.9 2.5-2.1 4-3.5 4 1.4 0 2.6 1.5 3.5 4 .9-2.5 2.1-4 3.5-4-1.4 0-2.6-1.5-3.5-4Z"
            fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M8 18h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
  };

  class FVFormButton extends HTMLElement{
    static get observedAttributes(){ return ['label','icon','href','icon-svg']; }
    constructor(){
      super();
      this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));
      this._mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      this._onMQ = () => this._applyAccentFromTheme();
      this._onFVTheme = () => this._applyAccentFromTheme();
    }
    connectedCallback(){
      this._sync();
      document.addEventListener('fv:theme', this._onFVTheme);
      if (this._mq) this._mq.addEventListener('change', this._onMQ);
      this._mo = new MutationObserver(() => this._applyAccentFromTheme());
      this._mo.observe(document.documentElement, { attributes:true, attributeFilter:['class','data-theme'] });
      this._applyAccentFromTheme();
    }
    disconnectedCallback(){
      document.removeEventListener('fv:theme', this._onFVTheme);
      if (this._mq) this._mq.removeEventListener('change', this._onMQ);
      if (this._mo) this._mo.disconnect();
    }
    attributeChangedCallback(){ this._sync(); }
    _sync(){
      const r = this.shadowRoot;
      r.querySelector('.label').textContent = this.getAttribute('label') || '';
      r.querySelector('a.tile').setAttribute('href', this.getAttribute('href') || '#');
      const iconHost = r.querySelector('.icon');
      const key = (this.getAttribute('icon-svg') || '').trim();
      if (key && ICONS[key]) {
        this.style.setProperty('--icon-extra', key === 'report' ? '8px' : '0px');
        iconHost.innerHTML = ICONS[key];
      } else {
        this.style.setProperty('--icon-extra', '0px');
        iconHost.textContent = this.getAttribute('icon') || '';
      }
    }
    _applyAccentFromTheme(){
      const html = document.documentElement;
      const mode = html.getAttribute('data-theme'); // 'light' | 'dark' | 'auto'
      const isDarkExplicit = html.classList.contains('dark');
      const isDarkAuto = (mode === 'auto' || mode === 'system') && (this._mq ? this._mq.matches : false);
      const shouldUseText = isDarkExplicit || isDarkAuto;
      this.style.setProperty('--form-accent',
        shouldUseText ? (getComputedStyle(html).getPropertyValue('--text').trim() || '#E8EEE9') : '#0F3B82');
    }
  }

  if (!customElements.get('fv-form-button')) {
    customElements.define('fv-form-button', FVFormButton);
  }
})();