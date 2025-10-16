/* <fv-form-button> v2.1 — form entry tile
   - Light: title uses dark blue
   - Dark:  title uses global --text
   - No emoji bubble
   - Label on top, emoji at bottom
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{
        display:block;
        --tile-h: 160px;
        /* Light accent (title) */
        --form-accent: #0F3B82;
      }
      /* In dark mode, just use the app text color so it always contrasts */
      :host-context(.dark){ --form-accent: var(--text); }
      :host-context(html[data-theme="auto"].dark){ --form-accent: var(--text); }

      a.tile{
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        gap:10px;

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
        font-weight:800;
        /* Scales inside a fixed tile height */
        font-size:clamp(18px, 2.6vw, 22px);
        line-height:1.2;
        color:var(--form-accent);
      }

      .icon{
        /* No background, no border — pure emoji */
        display:inline-block;
        line-height:1;
        font-size:clamp(32px, 8vw, 44px);
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
    }
    connectedCallback(){ this._sync(); }
    attributeChangedCallback(){ this._sync(); }
    _sync(){
      const r = this.shadowRoot;
      r.querySelector('.label').textContent = this.getAttribute('label') || '';
      r.querySelector('.icon').textContent  = this.getAttribute('icon') || '';
      r.querySelector('a.tile').setAttribute('href', this.getAttribute('href') || '#');
    }
  }

  if (!customElements.get('fv-form-button')) {
    customElements.define('fv-form-button', FVFormButton);
  }
})();