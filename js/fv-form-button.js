/* /Farm-vista/js/fv-form-button.js
   FarmVista — Reusable form-entry tile (label top, icon bottom).
   Standardized look/size lives here so every page is consistent.
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host{
      /* You can override any of these per-page if needed. */
      --fvfb-width:  min(46vw, 360px);
      --fvfb-height: 150px;
      --fvfb-radius: 14px;

      /* Brand blues (fallbacks if theme.css doesn't define them) */
      --brand-blue:      var(--fv-blue, #23407D);
      --brand-blue-700:  var(--fv-blue-700, #1A2E5C);
      --brand-blue-300:  var(--fv-blue-300, #3E63B2);

      /* Surfaces use your theme tokens with fallbacks */
      --tile-bg:     var(--surface, #FFFFFF);
      --tile-fg:     var(--text,    #142016);
      --tile-border: var(--border,  #E3E6E2);
      --tile-shadow: var(--shadow,  0 12px 24px rgba(0,0,0,.14));

      display:block;
      width:var(--fvfb-width);
      height:var(--fvfb-height);
    }

    a.tile{
      display:flex;
      flex-direction:column;
      justify-content:space-between;
      align-items:flex-start;
      width:100%; height:100%;
      padding:16px;
      border-radius:var(--fvfb-radius);
      background:var(--tile-bg);
      color:var(--brand-blue);
      border:1px solid var(--tile-border);
      box-shadow:
        0 10px 30px color-mix(in srgb, var(--brand-blue) 12%, transparent),
        var(--tile-shadow);
      text-decoration:none;
      transition: transform .08s ease, box-shadow .18s ease, border-color .18s ease;
    }
    a.tile:active{ transform:translateY(1px) scale(.995); }

    /* Top: label (auto-scales but keeps the box size fixed) */
    .label{
      font-weight:800;
      letter-spacing:.2px;
      /* Scales with viewport but clamped for consistency */
      font-size: clamp(15px, 2.6vw, 20px);
      line-height:1.2;
      color: var(--brand-blue);
      text-wrap: balance;
    }

    /* Bottom: icon pill */
    .icon{
      align-self:flex-start;
      display:inline-grid; place-items:center;
      width:44px; height:44px; border-radius:10px;
      background: color-mix(in srgb, var(--brand-blue) 12%, transparent);
      border:1px solid color-mix(in srgb, var(--brand-blue) 24%, transparent);
      /* Scale icon but keep within the tile */
      font-size: clamp(22px, 5.5vw, 28px);
      line-height:1;
      color: var(--brand-blue);
      /* subtle inner lift for the icon chip */
      box-shadow: inset 0 1px 0 color-mix(in srgb,#fff 65%, transparent);
    }

    /* Hover/Focus affordances (desktop + a11y) */
    a.tile:hover{
      border-color: color-mix(in srgb, var(--brand-blue) 30%, var(--tile-border));
      box-shadow:
        0 14px 36px color-mix(in srgb, var(--brand-blue) 18%, transparent),
        var(--tile-shadow);
    }
    a.tile:focus-visible{
      outline:3px solid color-mix(in srgb, var(--brand-blue) 55%, transparent);
      outline-offset:3px;
    }

    /* Dark-mode specific nudges — still piggybacks your tokens */
    :host-context(.dark) a.tile{
      background: var(--surface, #151b17);
      border-color: var(--tile-border, #2a342c);
      box-shadow:
        0 10px 30px color-mix(in srgb, var(--brand-blue) 20%, transparent),
        var(--tile-shadow, 0 12px 24px rgba(0,0,0,.5));
    }
    :host-context(.dark) .icon{
      background: color-mix(in srgb, var(--brand-blue) 20%, transparent);
      border-color: color-mix(in srgb, var(--brand-blue) 36%, transparent);
      color: #E8EEE9;
    }
  </style>

  <a class="tile" part="tile" href="#" role="button" tabindex="0">
    <div class="label"></div>
    <div class="icon"></div>
  </a>
  `;

  class FVFormButton extends HTMLElement {
    static get observedAttributes(){ return ['label','icon','href']; }

    constructor(){
      super();
      const r = this.attachShadow({mode:'open'});
      r.appendChild(tpl.content.cloneNode(true));
      this.$a = r.querySelector('a.tile');
      this.$label = r.querySelector('.label');
      this.$icon = r.querySelector('.icon');
    }

    connectedCallback(){
      // init from attributes
      this._apply();
      // keyboard “Enter/Space” activates like a button
      this.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.$a.click();
        }
      });
    }

    attributeChangedCallback(){ this._apply(); }

    _apply(){
      const label = this.getAttribute('label') || 'Open';
      const icon  = this.getAttribute('icon')  || '📄';
      const href  = this.getAttribute('href')  || '#';

      this.$label.textContent = label;
      this.$icon.textContent = icon;
      this.$a.setAttribute('href', href);
      // If href is “#”, keep it a no-op button
      if (href === '#') this.$a.addEventListener('click', e => e.preventDefault(), { once:true });
    }
  }

  if (!customElements.get('fv-form-button')) {
    customElements.define('fv-form-button', FVFormButton);
  }
})();