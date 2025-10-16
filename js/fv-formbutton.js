/* FarmVista — fv-formbutton.js
   Reusable hero-style buttons for forms (blue icon/text, white background)
   Usage: <fv-formbutton icon="💡" label="New Idea" href="/path/to/form.html"></fv-formbutton>
*/
(function () {
  const tpl = document.createElement('template');
  tpl.innerHTML = `
  <style>
    :host {
      display:block;
      margin:8px 0;
    }
    a.btn {
      display:flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      text-decoration:none;
      background:#fff;
      color:#0D3B66; /* dark blue tone */
      font-weight:700;
      border:1.5px solid #cfd4d2;
      border-radius:12px;
      box-shadow:0 2px 4px rgba(0,0,0,0.05);
      padding:14px 16px;
      transition:all .15s ease;
      font-size:17px;
    }
    a.btn:hover {
      border-color:#3B7E46;
      box-shadow:0 3px 10px rgba(0,0,0,0.07);
    }
    a.btn:active {
      transform:translateY(1px);
    }
    .ico {
      font-size:22px;
      line-height:1;
    }
  </style>
  <a class="btn" part="button">
    <span class="ico"></span>
    <span class="label"></span>
  </a>
  `;

  class FVFormButton extends HTMLElement {
    constructor(){
      super();
      this.attachShadow({mode:'open'}).appendChild(tpl.content.cloneNode(true));
    }
    connectedCallback(){
      const r = this.shadowRoot;
      const btn = r.querySelector('.btn');
      const ico = r.querySelector('.ico');
      const label = r.querySelector('.label');

      const href = this.getAttribute('href') || '#';
      const icon = this.getAttribute('icon') || '';
      const text = this.getAttribute('label') || '';

      ico.textContent = icon;
      label.textContent = text;
      btn.href = href;

      if (href === '#') btn.setAttribute('aria-disabled','true');
    }
  }

  if (!customElements.get('fv-formbutton')) {
    customElements.define('fv-formbutton', FVFormButton);
  }
})();