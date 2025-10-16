/* /Farm-vista/js/fv-form-button.js
   FarmVista — blue “form entry” tile button
   - Registers <fv-form-button> (and alias <fv-formbutton>)
   - No module/exports; safe to load as a classic script
*/
(function () {
  if (customElements.get('fv-form-button')) return;

  class FVFormButton extends HTMLElement {
    static get observedAttributes() { return ['label','icon','href']; }
    constructor(){
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host{ display:block; }
          a.btn{
            --tile-w: 100%;
            --tile-h: 112px;

            display:flex; align-items:center; gap:14px;
            width:var(--tile-w); height:var(--tile-h);
            padding:16px 18px;
            text-decoration:none; border-radius:14px;

            background: var(--surface);
            color: var(--text);
            border: 1px solid var(--card-border, var(--border));
            box-shadow: var(--shadow);

            transition: transform .06s ease, box-shadow .12s ease, border-color .12s ease, background .12s ease;
          }
          a.btn:active{ transform: scale(.98); }

          .icon{
            flex:0 0 auto;
            width:44px; height:44px;
            display:grid; place-items:center;
            border-radius:10px;
            /* Blue tile */
            background: var(--action-blue-50, #e9f0ff);
            color: var(--action-blue-700, #143a8c);
            border: 1px solid var(--action-blue-200, #cbd9ff);
            font-size:26px; line-height:1;
          }

          .label{
            font: 800 18px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
            color: var(--action-blue-900, #0f2f77);
            letter-spacing:.2px;
          }

          /* Hover (desktop only) */
          @media (hover:hover){
            a.btn:hover{
              box-shadow: 0 18px 34px rgba(0,0,0,.16);
              border-color: color-mix(in srgb, var(--action-blue-300, #b0c4ff) 50%, var(--card-border, var(--border)));
              background: color-mix(in srgb, var(--surface) 92%, var(--action-blue-50, #e9f0ff));
            }
          }

          /* Dark mode tweaks via tokens */
          :host-context(html.dark), :host-context(html[data-theme="auto"][class*="dark"]) {
            .icon{
              background: var(--action-blue-900, #0f2f77);
              color: var(--surface);
              border-color: color-mix(in srgb, var(--action-blue-700, #143a8c) 65%, transparent);
            }
            .label{ color: var(--action-blue-100, #e6eeff); }
          }
        </style>
        <a class="btn" part="button" href="#">
          <div class="icon" part="icon"></div>
          <div class="label" part="label"></div>
        </a>
      `;
    }

    connectedCallback(){ this._upgrade(); }
    attributeChangedCallback(){ this._render(); }

    _upgrade(){
      // populate and wire up
      this._a = this.shadowRoot.querySelector('a.btn');
      this._icon = this.shadowRoot.querySelector('.icon');
      this._label = this.shadowRoot.querySelector('.label');
      this._render();

      this._a.addEventListener('click', (e)=>{
        const href = this.getAttribute('href');
        if (!href || href === '#') return;  // allow “dead” buttons for now
        // Close the top drawer if this was tapped from there (nice-to-have)
        try {
          const shell = this.closest('fv-shell');
          if (shell && shell.toggleTop) shell.toggleTop(false);
        } catch {}
      });
    }

    _render(){
      if(!this._a) return;
      const label = this.getAttribute('label') || '';
      const icon = this.getAttribute('icon') || '';
      const href = this.getAttribute('href') || '#';

      this._label.textContent = label;
      this._icon.textContent = icon;
      this._a.setAttribute('href', href);
      this.setAttribute('role','button');
      this.setAttribute('aria-label', label || 'Form');
    }
  }

  customElements.define('fv-form-button', FVFormButton);
  // Alias so legacy <fv-formbutton> still works if used anywhere
  try { customElements.define('fv-formbutton', FVFormButton); } catch {}
})();