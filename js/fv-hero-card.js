l// /js/fv-hero-card.js — FULL REPLACEMENT
// FarmVista — <fv-hero-card> with top-aligned, centered, auto-fit cursive+underlined titles
(() => {
  // Allow redefinition on hard reload only; normal reloads will redefine from scratch.
  if (customElements.get('fv-hero-card')) return;

  class FVHeroCard extends HTMLElement {
    static get observedAttributes() { return ['emoji','title','subtitle']; }

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

            /* Title typography (adjust in theme if desired) */
            --fv-hero-title-font: cursive;
            --fv-hero-underline-thickness: 2px;
            --fv-hero-underline-offset: 4px;

            /* Auto-fit guardrails (px) */
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
            min-height:var(--hero-h, 120px);
            align-items:start; /* keep content starting at top */
          }

          /* Emoji: keep for Message Board, but don't disturb title centering */
          .emoji{
            position:absolute;
            top:10px; left:10px;
            font-size:22px; line-height:1;
            opacity:.95;
            user-select:none;
            pointer-events:none;
          }

          /* Title row at the top, centered horizontally */
          .title{
            margin:0;
            padding:0 var(--title-side-pad);
            text-align:center;
            font-weight:700;
            line-height:1.15;

            /* Cursive + underline for ALL titles */
            font-family: var(--fv-hero-title-font);
            text-decoration: underline;
            text-decoration-thickness: var(--fv-hero-underline-thickness);
            text-underline-offset: var(--fv-hero-underline-offset);

            /* Start big; JS will shrink if needed to keep one line */
            font-size: var(--title-max-size);

            /* Keep it to a single line; JS ensures it fits without ellipsis */
            white-space: nowrap;
            overflow: hidden;
          }

          /* Subtitle/content area */
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

      // Observe size changes to keep title fitted
      this._resizeObs = new ResizeObserver(() => this._fitTitle());
      this._resizeObs.observe(this.$.wrap);
    }

    connectedCallback(){
      // Initial fit after first paint
      requestAnimationFrame(() => this._fitTitle());
    }

    disconnectedCallback(){
      this._resizeObs?.disconnect();
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'emoji') {
        const has = val != null && val !== '';
        this.$.emoji.textContent = has ? val : '';
        this.$.emoji.style.display = has ? '' : 'none';
      }
      if (name === 'title') {
        this.$.title.textContent = val || '';
        // Refit when title changes
        requestAnimationFrame(() => this._fitTitle());
      }
      if (name === 'subtitle') {
        this.$.subtitle.textContent = val || '';
      }
    }

    _fitTitle(){
      const t = this.$.title;
      if (!t) return;

      // Reset to max before measuring
      const maxPx = parseFloat(getComputedStyle(this).getPropertyValue('--title-max-size')) || 32;
      const minPx = parseFloat(getComputedStyle(this).getPropertyValue('--title-min-size')) || 18;

      t.style.fontSize = maxPx + 'px';

      // Available width: wrapper inner width minus side padding applied to title
      const wrapStyle = getComputedStyle(this.$.wrap);
      const padL = parseFloat(wrapStyle.paddingLeft) || 0;
      const padR = parseFloat(wrapStyle.paddingRight) || 0;

      // Also subtract the title's own side padding
      const titleStyle = getComputedStyle(t);
      const tPadL = parseFloat(titleStyle.paddingLeft) || 0;
      const tPadR = parseFloat(titleStyle.paddingRight) || 0;

      const available = this.$.wrap.clientWidth - padL - padR - tPadL - tPadR;
      if (available <= 0) return;

      // Shrink font size until it fits on one line (no overflow)
      let size = maxPx;
      // Guard loop to avoid long repaints
      for (let i = 0; i < 30; i++) {
        const tooWide = t.scrollWidth > available;
        if (!tooWide || size <= minPx) break;
        size = Math.max(minPx, size - 1);
        t.style.fontSize = size + 'px';
      }
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();