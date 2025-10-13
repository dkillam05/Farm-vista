// FarmVista — Global Hero Card <fv-hero-card>
class FVHeroCard extends HTMLElement {
  static get observedAttributes() { return ["emoji","title","subtitle"]; }
  constructor(){
    super();
    this.attachShadow({mode:"open"}).innerHTML = `
      <style>
        :host{
          --fv-gold:#D0C542;
          --fv-surface:#fff;
          --fv-text:#141514;
          --fv-border: #E3E6E2;
          --fv-shadow:0 10px 22px rgba(0,0,0,.12);
          display:block; border-radius:12px;
          background:var(--fv-surface); color:var(--fv-text);
          border:1px solid var(--fv-border);
          box-shadow:var(--fv-shadow);
          outline:none;
        }
        :host{ --fv-gold: var(--fv-gold, #D0C542); }
        :host-context(.dark){
          --fv-surface:#1B1D1B; --fv-text:#F2F4F1; --fv-border:#253228;
          --fv-shadow:0 14px 28px rgba(0,0,0,.28);
        }
        .accent{ height:3px; background:var(--fv-gold); border-top-left-radius:12px; border-top-right-radius:12px; }
        .wrap{ display:flex; align-items:center; justify-content:center; gap:10px; padding:14px 16px; min-height:72px; }
        .emoji{ font-size:28px; line-height:1; }
        .title{ font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sub{ font-size:13px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .text{ display:grid; gap:2px; }
        :host(:focus-visible) { box-shadow:0 0 0 3px rgba(208,197,66,.6); }
      </style>
      <div class="accent" part="accent"></div>
      <div class="wrap" part="wrap">
        <div class="emoji" part="emoji"></div>
        <div class="text">
          <div class="title" part="title"></div>
          <div class="sub" part="subtitle"></div>
        </div>
      </div>
    `;
  }
  connectedCallback(){ if(!this.hasAttribute("tabindex")) this.setAttribute("tabindex","0"); this._sync(); }
  attributeChangedCallback(){ this._sync(); }
  _sync(){
    const r=this.shadowRoot;
    r.querySelector(".emoji").textContent = this.getAttribute("emoji") ?? "📦";
    r.querySelector(".title").textContent = this.getAttribute("title") ?? "Untitled";
    const sub = this.getAttribute("subtitle") ?? "";
    r.querySelector(".sub").textContent = sub;
    r.querySelector(".sub").style.display = sub ? "block" : "none";
  }
}
customElements.define("fv-hero-card", FVHeroCard);