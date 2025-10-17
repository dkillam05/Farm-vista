/* <fv-form-button> v3.1 — form entry tile
   ✅ Adds optional SVG icons via icon-svg (plus | edit | import | report)
   ✅ 100% backward compatible with existing icon="…" usage (emoji/text)
   ✅ Keeps your light/dark accent logic and layout exactly the same
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{
        display:block;
        --tile-h:160px;
        --form-accent:#0F3B82; /* Light-mode blue */
      }

      a.tile{
        display:grid;
        grid-template-rows: 55% 45%;   /* label higher, emoji same */
        justify-items:center;
        align-items:center;

        height:var(--tile-h);
        padding:18px;
        border-radius:16px;

        background:var(--card-surface, var(--surface));
        color:var(--text);
        border:1px solid var(--card-border, var(--border));
        box-shadow:var(--shadow);
        text-decoration:none;
        transition:transform .06s ease, box-shadow .12s ease, border-color .12s ease;
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
        font-size:clamp(40px,10vw,60px);
        filter:none;
      }

      /* --- ADDED: size SVG icons like the text icons --- */
      .icon svg{
        display:block;
        width:clamp(40px,10vw,60px);
        height:clamp(40px,10vw,60px);
      }
    </style>

    <a class="tile" part="tile">
      <div class="label" part="label"></div>
      <div class="icon" part="icon"></div>
    </a>
  `;

  /* --- ADDED: tiny internal SVG library (inherits currentColor) --- */
  const ICONS = {
    plus: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
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
    /* Clipboard + bars + pie (Reports) */
    report: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="4.5" width="12" height="15.5" rx="2"
              fill="none" stroke="currentColor" stroke-width="1.6"/>
        <rect x="9" y="2.5" width="6" height="3.5" rx="1.2"
              fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M8.5 9.5h4.6M8.5 11.8h3.9"
              stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M13.5 15.6v-2.8M15.5 15.6v-4.2M17.5 15.6v-1.6"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M8.8 15.2a2.6 2.6 0 1 0 0-5.2v2.6H6.2"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
  };

  class FVFormButton extends HTMLElement{
    /* --- ADDED: 'icon-svg' attribute --- */
    static get observedAttributes(){ return ['label','icon','href','icon-svg']; }

    constructor(){
      super();
      this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));

      // media query for "auto" (system) dark mode
      this._mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      this._onMQ = () => this._applyAccentFromTheme();
      this._onFVTheme = () => this._applyAccentFromTheme();
    }

    connectedCallback(){
      this._sync();

      // Listen for your shell’s theme changes (fv:theme event)
      document.addEventListener('fv:theme', this._onFVTheme);

      // Watch OS-level dark mode if data-theme="auto"
      if (this._mq) this._mq.addEventListener('change', this._onMQ);

      // Watch for changes to <html> class or data-theme attr
      this._mo = new MutationObserver(() => this._applyAccentFromTheme());
      this._mo.observe(document.documentElement, {
        attributes:true,
        attributeFilter:['class','data-theme']
      });

      // Apply current theme accent on load
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

      /* --- UPDATED: prefer icon-svg when provided; fallback to text icon --- */
      const iconHost = r.querySelector('.icon');
      const svgKey = (this.getAttribute('icon-svg') || '').trim();

      if (svgKey && ICONS[svgKey]) {
        iconHost.innerHTML = ICONS[svgKey];          // inject SVG
      } else {
        iconHost.textContent = this.getAttribute('icon') || ''; // original behavior
      }
    }

    _applyAccentFromTheme(){
      const html = document.documentElement;
      const mode = html.getAttribute('data-theme'); // 'light' | 'dark' | 'auto' (or null)
      const isDarkExplicit = html.classList.contains('dark'); // manual dark toggle
      const isDarkAuto = (mode === 'auto' || mode === 'system') &&
                         (this._mq ? this._mq.matches : false);

      const shouldUseText = isDarkExplicit || isDarkAuto;
      if (shouldUseText) {
        // In dark or auto-dark → use global --text color
        const computed = getComputedStyle(html).getPropertyValue('--text').trim() || '#E8EEE9';
        this.style.setProperty('--form-accent', computed);
      } else {
        // In light mode → blue accent
        this.style.setProperty('--form-accent', '#0F3B82');
      }
    }
  }

  if (!customElements.get('fv-form-button')) {
    customElements.define('fv-form-button', FVFormButton);
  }
})();