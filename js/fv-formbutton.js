<!-- /Farm-vista/js/fv-form-button.js -->
<script type="module">
class FVFormButton extends HTMLElement{
  static get observedAttributes(){ return ['href']; }
  constructor(){
    super();
    const tpl = document.createElement('template');
    tpl.innerHTML = `
      <style>
        :host{
          display:block;
        }

        /* Tile container */
        .btn{
          display:flex;
          align-items:center;
          gap:14px;

          /* size/shape -> tile-like */
          border-radius:14px;
          padding:18px 16px;
          min-height:120px;

          background: var(--formbtn-bg, var(--surface, #ffffff));
          color: var(--formbtn-text, var(--text, #132015));
          border: 1px solid var(--formbtn-border, color-mix(in srgb, var(--text, #132015) 10%, transparent));
          box-shadow:
            0 1px 0 rgba(0,0,0,.06),
            0 8px 18px color-mix(in srgb, #000 12%, transparent);
          text-decoration:none;
          transition: transform .08s ease, box-shadow .18s ease, background .2s ease;
        }
        .btn:active{
          transform: translateY(1px);
          box-shadow:
            0 0 0 rgba(0,0,0,0),
            0 4px 10px color-mix(in srgb, #000 18%, transparent);
        }

        /* Icon tile (left) */
        .ico{
          flex: 0 0 56px;
          height:56px;
          border-radius:12px;
          display:grid; place-items:center;
          font-size:28px; line-height:1;

          background: var(--formbtn-ico-bg, color-mix(in srgb, var(--accent-blue, #163B7A) 6%, #fff));
          color: var(--formbtn-ico-fg, var(--accent-blue, #163B7A));
          border: 1px solid color-mix(in srgb, var(--accent-blue, #163B7A) 26%, transparent);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.35);
        }

        /* Text block (right) */
        .text{
          display:flex; flex-direction:column; gap:6px;
        }
        .title{
          font-weight:800;
          font-size:18px;
          color: var(--formbtn-title, var(--accent-blue, #163B7A)); /* dark blue title */
          letter-spacing: .2px;
        }
        .caption{
          font-size:14px;
          color: color-mix(in srgb, var(--formbtn-text, var(--text, #132015)) 70%, transparent);
        }

        /* Full-width by default */
        a{ display:block; }

        /* Dark theme adjustments (piggybacks on your .dark class) */
        :host-context(.dark) .btn{
          background: var(--formbtn-bg, color-mix(in srgb, var(--surface, #171a18) 94%, #000));
          color: var(--formbtn-text, var(--text, #F2F4F1));
          border-color: var(--formbtn-border, color-mix(in srgb, #fff 6%, transparent));
          box-shadow:
            0 0 0 rgba(0,0,0,0),
            0 10px 24px rgba(0,0,0,.45);
        }
        :host-context(.dark) .ico{
          background: color-mix(in srgb, var(--accent-blue, #6ea4ff) 12%, #000);
          color: var(--formbtn-ico-fg, var(--accent-blue, #9cc1ff));
          border-color: color-mix(in srgb, var(--accent-blue, #6ea4ff) 30%, transparent);
        }
        :host-context(.dark) .title{
          color: var(--formbtn-title, var(--accent-blue, #9cc1ff));
        }
        :host-context(.dark) .caption{
          color: color-mix(in srgb, var(--formbtn-text, var(--text, #F2F4F1)) 70%, transparent);
        }
      </style>

      <a class="btn">
        <div class="ico"><slot name="icon">⬜️</slot></div>
        <div class="text">
          <div class="title"><slot name="title">Form</slot></div>
          <div class="caption"><slot name="caption"></slot></div>
        </div>
      </a>
    `;
    this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));
  }
  connectedCallback(){ this._applyHref(); }
  attributeChangedCallback(){ this._applyHref(); }
  _applyHref(){
    const a = this.shadowRoot.querySelector('a');
    const href = this.getAttribute('href') || '#';
    a.setAttribute('href', href);
  }
}
if(!customElements.get('fv-form-button')) customElements.define('fv-form-button', FVFormButton);
</script>