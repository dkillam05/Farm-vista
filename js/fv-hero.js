// ==========================================================
// FarmVista — Global Hero Card <fv-hero-card>
// Usage:
//   <fv-hero-card emoji="🌱" title="Crop Production" subtitle="🚧 Coming Soon"></fv-hero-card>
//
// Notes:
// - Purely visual for now (no click action). Keyboard focusable for accessibility.
// - Light/Dark: follows app theme. Uses :host-context(.dark) to switch surface/text.
// - Design: rounded, elevated, thin gold top accent, emoji left of title.
// - Reads brand tokens if present (falls back to hard-coded brand colors).
// ==========================================================
class FVHeroCard extends HTMLElement {
  static get observedAttributes() { return ["emoji", "title", "subtitle"]; }

  constructor(){
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `
      <style>
        :host {
          --fv-gold:    #D0C542;
          --fv-surface: #ffffff;    /* light card surface */
          --fv-text:    #141514;    /* light text */
          --fv-shadow:  0 10px 22px rgba(0,0,0,.12);

          display: block;
          border-radius: 12px;
          background: var(--fv-surface);
          color: var(--fv-text);
          box-shadow: var(--fv-shadow);
          border-top: 3px solid var(--fv-gold);
          outline: none;
        }
        /* If app defines tokens at :root, inherit them */
        :host {
          --fv-gold: var(--fv-gold, #D0C542);
        }

        /* Dark theme (inherits from <html>.dark) */
        :host-context(.dark) {
          --fv-surface: #1B1D1B;
          --fv-text:    #F2F4F1;
          --fv-shadow:  0 14px 28px rgba(0,0,0,.28);
        }

        .wrap {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          min-height: 72px;
          border-radius: 12px;
        }
        .left { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .emoji { font-size: 28px; line-height: 1; flex: 0 0 auto; }
        .text { display: grid; gap: 2px; min-width: 0; }
        .title {
          font-weight: 800;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sub {
          font-size: 13px; opacity: .75;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        /* Focus ring (keyboard) */
        :host(:focus-visible) .wrap {
          box-shadow: 0 0 0 3px rgba(208,197,66,.6);
        }
      </style>

      <div class="wrap" part="wrap">
        <div class="left">
          <div class="emoji" part="emoji"></div>
          <div class="text">
            <div class="title" part="title"></div>
            <div class="sub" part="subtitle"></div>
          </div>
        </div>
      </div>
    `;
  }

  connectedCallback(){
    // Keyboard focusable (visual only)
    if (!this.hasAttribute("tabindex")) this.setAttribute("tabindex", "0");
    this._sync();
  }

  attributeChangedCallback(){
    this._sync();
  }

  _sync(){
    const r = this.shadowRoot;
    if (!r) return;
    const emoji = this.getAttribute("emoji") ?? "📦";
    const title = this.getAttribute("title") ?? "Untitled";
    const subtitle = this.getAttribute("subtitle") ?? "";

    r.querySelector(".emoji").textContent = emoji;
    r.querySelector(".title").textContent = title;
    r.querySelector(".sub").textContent = subtitle;
    r.querySelector(".sub").style.display = subtitle ? "block" : "none";
  }
}

customElements.define("fv-hero-card", FVHeroCard);
