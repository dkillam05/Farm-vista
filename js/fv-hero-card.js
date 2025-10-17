// /js/fv-hero-card.js — FULL REPLACEMENT
// Titles: big, bold, centered (h), top-aligned, underline, fixed max size across cards
// Bullets: one per line. Font: TT Moons if present.
(() => {
  if (customElements.get('fv-hero-card')) return;

  // Detect base so @font-face works both locally and on /Farm-vista/
  const BASE = (() => {
    try {
      const src = (document.currentScript && document.currentScript.src) || '';
      const u = new URL(src, location.href);
      return u.pathname.replace(/\/js\/[^\/?#]+$/, '/'); // strip "/js/<file>"
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

      const styles = `
        <style>
          /* Try to load TT Moons Bold if present in /assets/fonts/ttmoons/ */
          @font-face{
            font-family:"TT Moons";
            src: url("${TTMOONS_URL}") format("woff2");
            font-weight:800;
            font-style:normal;
            font-display:swap;
          }

          :host{
            /* Theme hooks */
            --fv-surface:#fff;
            --fv-text:#141514;
            --fv-border:#E3E6E2;
            --fv-shadow:0 10px 22px rgba(0,0,0,.12);

            /* Layout */
            --hero-pad:16px;
            --hero-radius:12px;
            --title-side-pad:12px;

            /* Title typography */
            --fv-hero-title-font: "TT Moons", ui-serif, Georgia, "Times New Roman", serif;
            --fv-hero-title-weight: 800;

            /* Underline controls */
            --fv-hero-underline-thickness: 3px;
            --fv-hero-underline-offset: 5px;

            /* === Fixed headline sizing === */
            --title-max-size: 20px;  /* <- set the “Crop Production” look here */
            --title-min-size: 15px;  /* only shrink below max if needed */

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
            gap:10px;
            padding:var(--hero-pad);
            min-height:var(--hero-h,120px);
            align-items:start; /* keep content at top */
          }

          /* Emoji (e.g., 📢) — keep but don't disturb title centering */
          .emoji{
            position:absolute; top:10px; left:10px;
            font-size:22px; line-height:1;
            opacity:.95; user-select:none; pointer-events:none;
          }

          /* Title: top, centered horizontally, BIG + bold, underline (border-based) */
          .title{
            margin:0;
            padding:0 var(--title-side-pad);
            text-align:center;
            font-weight:var(--fv-hero-title-weight);
            line-height:1.12;                              /* avoid descender clipping */
            font-family:var(--fv-hero-title-font);

            /* Start at MAX; JS will only shrink if it overflows */
            font-size:var(--title-max-size);
            white-space:nowrap; overflow:hidden;

            /* Robust underline */
            display:inline-block;                           /* width hugs text */
            justify-self:center;                            /* center in grid */
            border-bottom: var(--fv-hero-underline-thickness) solid currentColor;
            padding-bottom: var(--fv-hero-underline-offset);
          }

          /* Subtitle: bullets on their own lines when we render as <ul> */
          .subtitle{ margin:0; font-size:14px; opacity:.9; }
          ul.subtitle-list{ margin:0; padding-left:1.1em; font-size:14px; opacity:.9; }
          ul.subtitle-list li{ margin:.2em 0; }
        </style>
      `;

      r.innerHTML = `
        ${styles}
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
    }

    connectedCallback(){
      // First fit and on resize
      requestAnimationFrame(this._fitTitleBound);
      window.addEventListener('resize', this._fitTitleBound, { passive:true });
    }
    disconnectedCallback(){
      window.removeEventListener('resize', this._fitTitleBound);
    }

    static get observedAttributes(){ return ['emoji','title','subtitle']; }

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
      // Remove prior list if any
      if (this.$.subtitleList) { this.$.subtitleList.remove(); this.$.subtitleList = null; }

      // Accept either explicit newlines OR a single-line string with bullets
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

        const maxPx = parseFloat(csHost.getPropertyValue('--title-max-size')) || 36;
        const minPx = parseFloat(csHost.getPropertyValue('--title-min-size')) || 20;

        // Start at the fixed MAX size for uniformity
        t.style.fontSize = maxPx + 'px';

        // Available width inside the card (minus paddings)
        const wrapPadL = parseFloat(csWrap.paddingLeft) || 0;
        const wrapPadR = parseFloat(csWrap.paddingRight) || 0;
        const tPadL    = parseFloat(csTitle.paddingLeft) || 0;
        const tPadR    = parseFloat(csTitle.paddingRight) || 0;

        const available = w.clientWidth - wrapPadL - wrapPadR - tPadL - tPadR;
        if (available <= 0) return;

        // Only shrink (never grow) until it fits on one line
        let size = maxPx;
        for (let i = 0; i < 48; i++) {
          if (t.scrollWidth <= available || size <= minPx) break;
          size = Math.max(minPx, size - 1);
          t.style.fontSize = size + 'px';
        }
      }catch{}
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();