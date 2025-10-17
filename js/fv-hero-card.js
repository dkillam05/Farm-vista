// /js/fv-hero-card.js — FULL REPLACEMENT
// FarmVista — Global Hero Card <fv-hero-card> (cursive + underlined titles)
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
            --fv-surface:#fff;
            --fv-text:#141514;
            --fv-border:#E3E6E2;
            --fv-shadow:0 10px 22px rgba(0,0,0,.12);
            --hero-pad:16px;
            --hero-gap:10px;
            --hero-radius:12px;
            --title-size:18px;
            --subtitle-size:14px;

            /* Customize these two to taste in your theme.css if you want */
            --fv-hero-title-font: cursive;
            --fv-hero-underline-thickness: 2px;
            --fv-hero-underline-offset: 4px;

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
            display:grid;
            grid-template-columns:auto 1fr;
            gap:var(--hero-gap);
            padding:var(--hero-pad);
            align-items:center;
            min-height:var(--hero-h,112px);
          }
          .emoji{
            font-size:24px; line-height:1;
          }
          .text{
            display:flex; flex-direction:column; gap:6px;
          }
          .title{
            margin:0;
            font-size:var(--title-size);
            line-height:1.2;
            font-weight:700;

            /* 👇 Your request: cursive + underlined for ALL hero titles */
            font-family: var(--fv-hero-title-font);
            text-decoration: underline;
            text-decoration-thickness: var(--fv-hero-underline-thickness);
            text-underline-offset: var(--fv-hero-underline-offset);
            letter-spacing:.2px;
          }
          .subtitle{
            margin:0;
            font-size:var(--subtitle-size);
            opacity:.9;
          }
        </style>

        <div class="wrap">
          <div class="emoji" part="emoji" aria-hidden="true"></div>
          <div class="text">
            <h3 class="title" part="title"></h3>
            <p class="subtitle" part="subtitle"></p>
          </div>
        </div>
      `;
      this.$ = {
        emoji: r.querySelector('.emoji'),
        title: r.querySelector('.title'),
        subtitle: r.querySelector('.subtitle'),
      };
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'emoji') {
        if (val == null || val === '') {
          this.$.emoji.textContent = '';
          this.$.emoji.style.display = 'none';
        } else {
          this.$.emoji.textContent = val;
          this.$.emoji.style.display = '';
        }
      }
      if (name === 'title') {
        this.$.title.textContent = val || '';
      }
      if (name === 'subtitle') {
        this.$.subtitle.textContent = val || '';
      }
    }
  }

  customElements.define('fv-hero-card', FVHeroCard);
})();