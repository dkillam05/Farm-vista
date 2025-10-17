// /js/fv-hero-card.js — FULL REPLACEMENT (stable, bigger titles + multiline bullets)
// Titles: top-aligned, centered, cursive+underlined, auto-fit to one line
(() => {
  if (customElements.get('fv-hero-card')) return;

  class FVHeroCard extends HTMLElement {
    static get observedAttributes() { return ['emoji','title','subtitle']; }

    constructor() {
      super();
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `
        <style>
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
            --fv-hero-title-font:cursive;
            --fv-hero-underline-thickness:2px;
            --fv-hero-underline-offset:4px;

            /* Size guardrails — made bigger per request */
            --title-max-size:40px;
            --title-min-size:18px;

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
            align-items:start; /* start at top */
          }

          /* Emoji (e.g., 📢) sits unobtrusively; doesn't affect title centering */
          .emoji{
            position:absolute;
            top:10px; left:10px;
            font-size:22px; line-height:1;
            opacity:.95; user-select:none; pointer-events:none;
          }

          /* Title: top, centered horizontally, bigger + auto-fit */
          .title{
            margin:0;
            padding:0 var(--title-side-pad);
            text-align:center;
            font-weight:700;
            line-height:1.12;

            font-family:var(--fv-hero-title-font);
            text-decoration:underline;
            text-decoration-thickness:var(--fv-hero-underline-thickness);
            text-underline-offset:var(--fv-hero-underline-offset);

            font-size:var(--title-max-size); /* JS shrinks if needed */
            white-space:nowrap; overflow:hidden;
          }

          /* Subtitle: default paragraph; we swap to a UL when there are line breaks */
          .subtitle{ margin:0; font-size:14px; opacity:.9; }
          ul.subtitle-list{ margin:0; padding-left:1.1em; font-size:14px; opacity:.9; }
          ul.subtitle-list li{ margin:.15em 0; }
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
      this._renderSubtitleBound = () => this._renderSubtitle(this.getAttribute('subtitle') || '');
    }

    connectedCallback(){
      requestAnimationFrame(this._fitTitleBound);
      window.addEventListener('resize', this._fitTitleBound, { passive:true });
    }
    disconnectedCallback(){
      window.removeEventListener('resize', this._fitTitleBound);
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
      // Clean up previous list if any
      if (this.$.subtitleList) { this.$.subtitleList.remove(); this.$.subtitleList = null; }

      const lines = (text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (lines.length > 1) {
        this.$.subtitleP.style.display = 'none';
        const ul = document.createElement('ul');
        ul.className = 'subtitle-list';
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line.replace(/^•\s*/, ''); // strip any leading bullet the data may include
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

        const csHost = getComputedStyle(this);
        const csWrap = getComputedStyle(w);
        const csTitle = getComputedStyle(t);

        const maxPx = parseFloat(csHost.getPropertyValue('--title-max-size')) || 40;
        const minPx = parseFloat(csHost.getPropertyValue('--title-min-size')) || 18;

        t.style.fontSize = maxPx + 'px';

        const wrapPadL = parseFloat(csWrap.paddingLeft) || 0;
        const wrapPadR = parseFloat(csWrap.paddingRight) || 0;
        const tPadL = parseFloat(csTitle.paddingLeft) || 0;
        const tPadR = parseFloat(csTitle.paddingRight) || 0;
        const available = w.clientWidth - wrapPadL - wrapPadR - tPadL - tPadR;
        if (available <= 0) return;

        let size = maxPx;
        for (let i=0;i<32;i++){
          if (t.scrollWidth <= available || size <= minPx) break;
          size = Math.max(minPx, size - 1);
          t.style.fontSize = size + 'px';
        }
      }catch{}
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();