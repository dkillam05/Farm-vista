// /js/fv-hero-card.js — FULL REPLACEMENT (stable build)
// FarmVista — <fv-hero-card> with top-aligned, centered, auto-fit cursive+underlined titles
(() => {
  if (customElements.get('fv-hero-card')) return;

  class FVHeroCard extends HTMLElement {
    static get observedAttributes() { return ['emoji', 'title', 'subtitle']; }

    constructor() {
      super();
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `
        <style>
          :host{
            /* Theming hooks */
            --fv-surface:#fff;
            --fv-text:#141514;
            --fv-border:#E3E6E2;
            --fv-shadow:0 10px 22px rgba(0,0,0,.12);

            /* Layout + spacing */
            --hero-pad:16px;
            --hero-radius:12px;
            --title-side-pad:12px;

            /* Title typography */
            --fv-hero-title-font: cursive;
            --fv-hero-underline-thickness: 2px;
            --fv-hero-underline-offset: 4px;

            /* Auto-fit guardrails */
            --title-max-size: 32px;
            --title-min-size: 18px;

            display:block;
            border-radius:var(--hero-radius);
            background:var(--fv-surface);
            color:var(--fv-text);
            border:1px solid var(--fv-border);
            box-shadow:var(--fv-shadow);
            outline:none;
          }
          :host([hidden]){ display:none; }

          .wrap{
            position:relative;
            display:grid;
            grid-template-rows:auto 1fr; /* title row, then content row */
            gap:8px;
            padding:var(--hero-pad);
            min-height:var(--hero-h,120px);
            align-items:start; /* keep content starting at top */
          }

          /* Emoji stays (e.g., Message Board) but won’t disturb title centering */
          .emoji{
            position:absolute;
            top:10px; left:10px;
            font-size:22px; line-height:1;
            opacity:.95;
            user-select:none;
            pointer-events:none;
          }

          /* Top-aligned, horizontally centered title */
          .title{
            margin:0;
            padding:0 var(--title-side-pad);
            text-align:center;
            font-weight:700;
            line-height:1.15;
            font-family: var(--fv-hero-title-font);
            text-decoration: underline;
            text-decoration-thickness: var(--fv-hero-underline-thickness);
            text-underline-offset: var(--fv-hero-underline-offset);

            /* Start big; we shrink as needed to fit a single line */
            font-size: var(--title-max-size);
            white-space: nowrap;
            overflow: hidden;
          }

          .subtitle{
            margin:0;
            font-size:14px;
            opacity:.9;
          }
        </style>

        <div class="wrap">
          <div class="emoji" part="emoji" aria-hidden="true"></div>
          <h3 class="title" part="title"></h3>
          <p class="subtitle" part="subtitle"></p>
        </div>
      `;
      this.$ = {
        wrap: r.querySelector('.wrap'),
        emoji: r.querySelector('.emoji'),
        title: r.querySelector('.title'),
        subtitle: r.querySelector('.subtitle'),
      };

      this._fitTitleBound = () => this._fitTitle();
    }

    connectedCallback(){
      // Fit after paint and on window resize
      requestAnimationFrame(this._fitTitleBound);
      window.addEventListener('resize', this._fitTitleBound, { passive: true });
    }

    disconnectedCallback(){
      window.removeEventListener('resize', this._fitTitleBound);
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'emoji') {
        const has = val != null && val !== '';
        this.$.emoji.textContent = has ? val : '';
        this.$.emoji.style.display = has ? '' : 'none';
      }
      if (name === 'title') {
        this.$.title.textContent = val || '';
        requestAnimationFrame(this._fitTitleBound);
      }
      if (name === 'subtitle') {
        this.$.subtitle.textContent = val || '';
      }
    }

    _fitTitle(){
      try {
        const t = this.$.title;
        const w = this.$.wrap;
        if (!t || !w) return;

        // Reset to max before measuring
        const csHost = getComputedStyle(this);
        const csWrap = getComputedStyle(w);
        const csTitle = getComputedStyle(t);

        const maxPx = parseFloat(csHost.getPropertyValue('--title-max-size')) || 32;
        const minPx = parseFloat(csHost.getPropertyValue('--title-min-size')) || 18;

        t.style.fontSize = maxPx + 'px';

        // Available width: wrapper inner width minus padding and title padding
        const wrapPadL = parseFloat(csWrap.paddingLeft) || 0;
        const wrapPadR = parseFloat(csWrap.paddingRight) || 0;
        const titlePadL = parseFloat(csTitle.paddingLeft) || 0;
        const titlePadR = parseFloat(csTitle.paddingRight) || 0;

        const available = w.clientWidth - wrapPadL - wrapPadR - titlePadL - titlePadR;
        if (available <= 0) return;

        // Shrink font size until it fits on one line
        let size = maxPx;
        // Hard cap loop iterations to avoid long repaints
        for (let i = 0; i < 32; i++) {
          if (t.scrollWidth <= available || size <= minPx) break;
          size = Math.max(minPx, size - 1);
          t.style.fontSize = size + 'px';
        }
      } catch {}
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();