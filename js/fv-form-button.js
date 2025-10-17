/* <fv-form-button> v2.5 — form entry tile
   - Label centered, placed lower
   - Emoji centered and raised
   - Dark mode label color = var(--text)
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

      /* Dark mode (explicit) */
      :host-context(html.dark){ --form-accent: var(--text); }

      /* Dark mode when data-theme="auto" honors OS preference */
      @media (prefers-color-scheme: dark){
        :host-context(html[data-theme="auto"]){ --form-accent: var(--text); }
      }

      a.tile{
        display:grid;
        /* Push label lower by giving top track more height,
           emoji lives in bottom track */
        grid-template-rows: 60% 40%;
        justify-items:center;

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
        align-self:end;           /* sits toward bottom of row 1 */
        margin-bottom:8px;        /* nudge a bit lower */
        text-align:center;
        font-weight:800;
        font-size:clamp(18px,2.6vw,22px);
        line-height:1.25;
        color:var(--form-accent);
      }

      .icon{
        align-self:start;         /* start of row 2 (higher) */
        transform:translateY(-6px); /* raise emoji visually */
        line-height:1;
        font-size:clamp(40px,10vw,60px);
        filter:none;              /* pure emoji, no bubble */
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