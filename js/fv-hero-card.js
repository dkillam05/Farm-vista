// FarmVista — Global Hero Card <fv-hero-card> v2
class FVHeroCard extends HTMLElement {
  static get observedAttributes(){ return ["emoji","title","subtitle"]; }
  constructor(){
    super();
    this.attachShadow({mode:"open"}).innerHTML = `
      <style>
        :host{
          --fv-gold:#D0C542; --fv-surface:#fff; --fv-text:#141514; --fv-border:#E3E6E2; --fv-shadow:0 10px 22px rgba(0,0,0,.12);
          display:block; border-radius:12px; background:var(--fv-surface); color:var(--fv-text);
          border:1px solid var(--fv-border); box-shadow:var(--fv-shadow); outline:none;
        }
        :host-context(.dark){ --fv-surface:#1B1D1B; --fv-text:#F2F4F1; --fv-border:#253228; --fv-shadow:0 14px 28px rgba(0,0,0,.28); }
        .accent{ height:3px; background:var(--fv-gold); border-top-left-radius:12px; border-top-right-radius:12px; }
        .wrap{ display:grid; grid-template-columns:auto 1fr; align-items:center; gap:12px; padding:18px 16px; min-height:92px; }
        .emoji{ font-size:32px; line-height:1; align-self:center; }
        .title{ font-weight:800; font-size:18px; line-height:1.2; }
        .sub{ font-size:14px; opacity:.8; }
        .title, .sub{ white-space:normal; overflow:visible; text-overflow:clip; }
        :host(:focus-visible){ box-shadow:0 0 0 3px rgba(208,197,66,.6); }
      </style>
      <div class="accent"></div>
      <div class="wrap">
        <div class="emoji"></div>
        <div class="text">
          <div class="title"></div>
          <div class="sub"></div>
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