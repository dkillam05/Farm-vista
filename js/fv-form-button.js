<!-- /Farm-vista/js/fv-form-button.js -->
/* <fv-form-button> v3.2.9 — form entry tile
   Built-in icons via icon-svg:
   'plus' | 'minus' | 'edit' | 'import' | 'report' | 'done' | 'done-box' | 'camera'
   'reconcile-scale' (balance scale, MIT) — also aliased as 'reconcile' and 'reconcile-sync'
   NEW: 'wrench' (maintenance), 'gauge' (engine-hours), 'checklist' (pre-check items)
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{
        display:block;
        --tile-h:160px;
        --form-accent:#0F3B82; /* switches in _applyAccentFromTheme */
        --icon-extra:0px;      /* certain icons bump this for balance */
      }

      a.tile{
        display:grid; grid-template-rows:55% 45%;
        justify-items:center; align-items:center;

        height:var(--tile-h);
        padding:18px;
        border-radius:16px;

        background:var(--card-surface, var(--surface));
        color:var(--text);
        border:1px solid var(--card-border, var(--border));
        box-shadow:var(--shadow);
        text-decoration:none;
        transition:transform .06s, box-shadow .12s, border-color .12s;
      }
      a.tile:active{ transform:scale(.985); }

      .label{
        align-self:end;
        margin-bottom:32px;
        text-align:center;
        font-weight:800;
        font-size:clamp(18px,2.6vw,22px);
        line-height:1.25;
        color:var(--form-accent);
      }

      .icon{
        align-self:start;
        transform:translateY(-10px);
        line-height:1;
        font-size:calc(clamp(40px,10vw,60px) + var(--icon-extra));
      }

      /* SVG scales like text, responsive + tunable with --icon-extra */
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

  /* Inline SVGs (24x24, inherit currentColor) */
  const ICONS = {
    plus: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`,

    minus: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 12h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
      </svg>`,

    edit: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"
              fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M13.5 6.5l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`,

    import: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"
              fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M12 4v10M8.5 10.5 12 14l3.5-3.5"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,

    report: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="4.5" width="12" height="15.5" rx="2"
              fill="none" stroke="currentColor" stroke-width="1.6"/>
        <rect x="9" y="2.4" width="6" height="3.6" rx="1.2"
              fill="none" stroke="currentColor" stroke-width="1.6"/>
        <rect x="8.5"  y="14.6" width="2.0" height="4.4" rx="0.6" fill="currentColor"/>
        <rect x="11.1" y="12.6" width="2.0" height="6.4" rx="0.6" fill="currentColor"/>
        <rect x="13.7" y="10.4" width="2.0" height="8.6" rx="0.6" fill="currentColor"/>
      </svg>`,

    done: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/>
        <path d="M8.7 12.2l2.4 2.4 4.2-4.7"
              fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,

    "done-box": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5.5" y="5.5" width="13" height="13" rx="2.2"
              fill="none" stroke="currentColor" stroke-width="1.7"/>
        <path d="M8.5 12.5l2.2 2.2 4.3-4.8"
              fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,

    camera: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 7h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <rect x="4" y="7" width="16" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="12" cy="12.5" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="17.3" cy="9.9" r="0.8" fill="currentColor"/>
      </svg>`,

    /* ===== Reconcile (Balance Scale, Tabler Icons – MIT) ===== */
    "reconcile-scale": `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 20h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 6l6 -1l6 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 3v17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 12l-3 -6l-3 6a3 3 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M21 12l-3 -6l-3 6a3 3 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,

    /* ===== NEW: Maintenance (Wrench) ===== */
    wrench: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.8 5.2a4.8 4.8 0 0 0-6.5 5.6L3.5 15.6a2.1 2.1 0 0 0 3 3l4.1-4.1a4.8 4.8 0 0 0 5.6-6.5l-2.1 2.1a2 2 0 1 1-2.8-2.8l2.1-2.1Z"
              fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,

    /* ===== NEW: Engine Hours (Gauge / Tachometer) ===== */
    gauge: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4.5 15.5a7.5 7.5 0 1 1 15 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M12 12l4-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>
      </svg>`,

    /* ===== NEW: Pre-Check (Checklist / Clipboard) ===== */
    checklist: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="5" width="14" height="15" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M9 4h6a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v0a1 1 0 0 1 1-1Z"
              fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 11l1.6 1.6L12 10.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 15h4.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`
  };

  /* Aliases so existing pages keep working */
  ICONS["reconcile"] = ICONS["reconcile-scale"];
  ICONS["reconcile-sync"] = ICONS["reconcile-scale"];
  ICONS["maintenance"] = ICONS["wrench"];
  ICONS["engine-hours"] = ICONS["gauge"];
  ICONS["pre-check"] = ICONS["checklist"];
  ICONS["seasonal-precheck"] = ICONS["checklist"];

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

      // Listen for shell theme changes and system dark mode
      document.addEventListener('fv:theme', this._onFVTheme);
      if (this._mq) this._mq.addEventListener('change', this._onMQ);

      // React if <html> toggles classes/attributes
      this._mo = new MutationObserver(() => this._applyAccentFromTheme());
      this._mo.observe(document.documentElement, {
        attributes:true, attributeFilter:['class','data-theme']
      });

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
        const bump =
          (key === 'report') ? '8px' :
          (key === 'reconcile-scale' || key === 'reconcile' || key === 'reconcile-sync') ? '12px' :
          (key === 'gauge' || key === 'engine-hours') ? '10px' :
          (key === 'wrench' || key === 'maintenance') ? '6px' :
          (key === 'checklist' || key === 'pre-check' || key === 'seasonal-precheck') ? '8px' :
          '0px';

        this.style.setProperty('--icon-extra', bump);
        iconHost.innerHTML = ICONS[key];
      } else {
        this.style.setProperty('--icon-extra', '0px');
        // Fallback to old emoji/text icon prop if provided
        iconHost.textContent = this.getAttribute('icon') || '';
      }
    }

    _applyAccentFromTheme(){
      const html = document.documentElement;
      const mode = html.getAttribute('data-theme'); // 'light' | 'dark' | 'auto'
      const isDarkExplicit = html.classList.contains('dark');
      const isDarkAuto = (mode === 'auto' || mode === 'system') && (this._mq ? this._mq.matches : false);

      const useTextColor = isDarkExplicit || isDarkAuto;
      const accent = useTextColor
        ? (getComputedStyle(html).getPropertyValue('--text').trim() || '#E8EEE9')
        : '#0F3B82';
      this.style.setProperty('--form-accent', accent);
    }
  }

  if (!customElements.get('fv-form-button')) {
    customElements.define('fv-form-button', FVFormButton);
  }
})();