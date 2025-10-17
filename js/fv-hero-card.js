// /js/fv-hero-card.js — FULL REPLACEMENT (responsive headline sizing + font-load refit)
(() => {
  if (customElements.get('fv-hero-card')) return;

  // Works at "/" and "/Farm-vista/"
  const BASE = (() => {
    try {
      const src = (document.currentScript && document.currentScript.src) || '';
      const u = new URL(src, location.href);
      return u.pathname.replace(/\/js\/[^\/?#]+$/, '/');
    } catch {
      return location.pathname.startsWith('/Farm-vista/') ? '/Farm-vista/' : '/';
    }
  })();
  const TTMOONS_URL = BASE + 'assets/fonts/ttmoons/TTMoons-Bold.woff2';

  class FVHeroCard extends HTMLElement {
    static get observedAttributes() { return ['emoji','title','subtitle']; }

    constructor() {
      super();
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `
        <style>
          @font-face{
            font-family:"TT Moons";
            src:url("${TTMOONS_URL}") format("woff2");
            font-weight:800; font-style:normal; font-display:swap;
          }

          :host{
            --fv-surface:#fff; --fv-text:#141514; --fv-border:#E3E6E2;
            --fv-shadow:0 10px 22px rgba(0,0,0,.12);
            --hero-pad:16px; --hero-radius:12px; --title-side-pad:12px;

            --fv-hero-title-font:"TT Moons", ui-serif, Georgia, "Times New Roman", serif;
            --fv-hero-title-weight:800;

            /* Underline */
            --fv-hero-underline-thickness:2px;
            --fv-hero-underline-offset:6px;

            /* Guardrails (JS will compute a responsive max too) */
            --title-max-size:64px;
            --title-min-size:20px;

            display:block; border-radius:var(--hero-radius);
            background:var(--fv-surface); color:var(--fv-text);
            border:1px solid var(--fv-border); box-shadow:var(--fv-shadow);
          }
          :host([hidden]){ display:none; }

          .wrap{
            position:relative;
            display:grid;
            grid-template-rows:auto 1fr;
            gap:10px;
            padding:var(--hero-pad);
            min-height:var(--hero-h,120px);
            align-items:start;
          }

          /* Emoji moved top-right so it never collides with the title */
          .emoji{
            position:absolute; top:10px; right:10px;
            font-size:22px; line-height:1; opacity:.95;
            user-select:none; pointer-events:none;
          }

          .title{
            margin:0;
            justify-self:center;
            padding:0 var(--title-side-pad);
            font-family:var(--fv-hero-title-font);
            font-weight:var(--fv-hero-title-weight);
            line-height:1.2;                 /* prevents descender clipping */
            white-space:nowrap;

            /* start large; JS shrinks if needed */
            font-size:var(--title-max-size);

            /* underline that always shows */
            display:inline-block;
            border-bottom: var(--fv-hero-underline-thickness) solid currentColor;
            padding-bottom: var(--fv-hero-underline-offset);
            text-align:center;
          }

          .subtitle{ margin:0; font-size:14px; opacity:.9; }
          ul.subtitle-list{ margin:0; padding-left:1.1em; font-size:14px; opacity:.9; }
          ul.subtitle-list li{ margin:.2em 0; }
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
        subtitleP: r.querySelector('.subtitle'),
        subtitleList: null,
      };

      this._fitTitleBound = () => this._fitTitle();
      this._fontReadyBound = () => this._fitTitle();
    }

    connectedCallback(){
      // Fit after first paint
      requestAnimationFrame(this._fitTitleBound);

      // Refit on resize
      window.addEventListener('resize', this._fitTitleBound, { passive:true });

      // Refit after font loads/swaps (prevents overshoot after TT Moons activates)
      if (document.fonts) {
        document.fonts.ready.then(this._fontReadyBound);
        document.fonts.addEventListener?.('loadingdone', this._fontReadyBound);
      }

      // A tiny delayed refit catches any late layout shifts
      setTimeout(this._fitTitleBound, 350);
      setTimeout(this._fitTitleBound, 900);
    }

    disconnectedCallback(){
      window.removeEventListener('resize', this._fitTitleBound);
      if (document.fonts && document.fonts.removeEventListener) {
        document.fonts.removeEventListener('loadingdone', this._fontReadyBound);
      }
    }

    attributeChangedCallback(name,_old,val){
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
        this._renderSubtitle(val || '');
      }
    }

    _renderSubtitle(text){
      if (this.$.subtitleList) { this.$.subtitleList.remove(); this.$.subtitleList = null; }

      let lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length <= 1 && text.includes('•')) {
        lines = text.split('•').map(s => s.trim()).filter(Boolean).map(s => '• ' + s);
      }

      if (lines.length > 1) {
        this.$.subtitleP.style.display = 'none';
        const ul = document.createElement('ul');
        ul.className = 'subtitle-list';
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line.replace(/^•\s*/, '');
          ul.appendChild(li);
        }
        this.$.wrap.appendChild(ul);
        this.$.subtitleList = ul;
      } else {
        this.$.subtitleP.style.display = '';
        this.$.subtitleP.textContent = lines[0] || text || '';
      }
    }

    _fitTitle(){
      try{
        const t = this.$.title, w = this.$.wrap;
        if (!t || !w) return;

        const csHost  = getComputedStyle(this);
        const csWrap  = getComputedStyle(w);
        const csTitle = getComputedStyle(t);

        const minPx = parseFloat(csHost.getPropertyValue('--title-min-size')) || 20;
        const cssMax = parseFloat(csHost.getPropertyValue('--title-max-size')) || 64;

        // Responsive max: ~9% of card width (looks right on phone), clamped by cssMax
        const responsiveMax = Math.max(minPx, Math.min(cssMax, Math.floor(w.clientWidth * 0.09)));

        t.style.fontSize = responsiveMax + 'px';

        // Available width inside the card (minus paddings)
        const wrapPadL = parseFloat(csWrap.paddingLeft) || 0;
        const wrapPadR = parseFloat(csWrap.paddingRight) || 0;
        const tPadL    = parseFloat(csTitle.paddingLeft) || 0;
        const tPadR    = parseFloat(csTitle.paddingRight) || 0;

        const available = w.clientWidth - wrapPadL - wrapPadR - tPadL - tPadR;
        if (available <= 0) return;

        // Shrink until it fits one line
        let size = responsiveMax;
        // Use scrollWidth to detect overflow beyond the visible width
        for (let i=0;i<64;i++){
          if (t.scrollWidth <= available || size <= minPx) break;
          size = Math.max(minPx, size - 1);
          t.style.fontSize = size + 'px';
        }
      } catch {}
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();