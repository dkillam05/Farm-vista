/* <fv-form-button> v3.0 — form entry tile
   ✅ Light: title uses dark blue (#0F3B82)
   ✅ Dark:  title uses global --text (matches hero cards)
   ✅ Auto/system: follows OS preference
   ✅ Emoji placement unchanged (perfect)
   ✅ Label lifted slightly higher and always centered
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
    </style>

    <a class="tile" part="tile">
      <div class="label" part="label"></div>
      <div class="icon" part="icon"></div>
    </a>
  `;

  class FVFormButton extends HTMLElement{
    static get observedAttributes(){ return ['label','icon','href']; }

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
      r.querySelector('.icon').textContent  = this.getAttribute('icon') || '';
      r.querySelector('a.tile').setAttribute('href', this.getAttribute('href') || '#');
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