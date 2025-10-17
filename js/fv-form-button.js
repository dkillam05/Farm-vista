/* <fv-form-button> v2.3 — form entry tile
   Tweaks:
   - Uses CSS Grid inside the tile for stable positioning
   - Label sits a bit lower
   - Emoji is centered horizontally and raised visually
   - Dark mode: title color = --text; Light mode: deep blue
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
    <style>
      :host{
        display:block;
        --tile-h:160px;
        --form-accent:#0F3B82; /* light title color */
      }
      /* Dark: match global text so it always contrasts the darker card */
      :host-context(.dark){ --form-accent: var(--text); }
      :host-context(html[data-theme="auto"].dark){ --form-accent: var(--text); }

      a.tile{
        display:grid;
        grid-template-rows: auto 1fr auto;   /* label | flexible space | emoji */
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
        justify-self:start;
        margin-top:8px;                  /* ↓ a touch lower */
        font-weight:800;
        font-size:clamp(18px,2.6vw,22px);
        line-height:1.25;
        color:var(--form-accent);
      }

      .icon{
        justify-self:center;
        align-self:end;
        margin:0 0 12px 0;               /* ↑ raised from bottom */
        line-height:1;
        font-size:clamp(36px,9vw,56px);  /* scales to tile height */
        filter:none;                     /* pure emoji, no bubble */
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
      const r=this.shadowRoot;
      r.querySelector('.label').textContent=this.getAttribute('label')||'';
      r.querySelector('.icon').textContent=this.getAttribute('icon')||'';
      r.querySelector('a.tile').setAttribute('href', this.getAttribute('href')||'#');
    }
  }

  if(!customElements.get('fv-form-button')){
    customElements.define('fv-form-button', FVFormButton);
  }
})();