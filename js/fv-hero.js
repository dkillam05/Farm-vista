// /js/fv-hero.js — uses your <fv-hero-card> component to render the 2×2 grid
// Dynamic source: window.FV_HERO_CARDS (optional). Falls back to defaults.

(function () {
  const DEFAULT_CARDS = [
    { key:'crop',    emoji:'🌱', title:'Crop Production', subtitle:'🚧 Coming Soon', href:'#' },
    { key:'equip',   emoji:'🚜', title:'Equipment',       subtitle:'🚧 Coming Soon', href:'#' },
    { key:'grain',   emoji:'🌾', title:'Grain',           subtitle:'🚧 Coming Soon', href:'#' },
    { key:'reports', emoji:'📊', title:'Reports',         subtitle:'🚧 Coming Soon', href:'#' },
  ];

  const ensureGrid = () => {
    let grid = document.getElementById('hero-grid') || document.querySelector('.hero-grid');
    if (!grid) {
      grid = document.createElement('section');
      grid.id = 'hero-grid';
      grid.className = 'hero-grid';
      // try to place after the first page title inside <fv-shell> slot
      const shell = document.querySelector('fv-shell');
      const slotScope = shell ? document : document; // content lives in light DOM inside <fv-shell>
      const h1 = slotScope.querySelector('.page-title') || slotScope.querySelector('h1');
      (h1 && h1.parentNode) ? h1.parentNode.insertBefore(grid, h1.nextSibling) : document.body.appendChild(grid);
    }
    return grid;
  };

  const render = async () => {
    // Wait for custom element if not defined yet
    if (!customElements.get('fv-hero-card')) {
      try { await customElements.whenDefined('fv-hero-card'); }
      catch {}
    }

    const cards = (Array.isArray(window.FV_HERO_CARDS) && window.FV_HERO_CARDS.length)
      ? window.FV_HERO_CARDS
      : DEFAULT_CARDS;

    const grid = ensureGrid();
    grid.innerHTML = '';

    for (const c of cards) {
      const a = document.createElement('a');
      a.className = 'hero-link';
      a.href = c.href || '#';
      a.setAttribute('data-key', c.key || '');

      const card = document.createElement('fv-hero-card');
      if (c.emoji)    card.setAttribute('emoji', c.emoji);
      if (c.title)    card.setAttribute('title', c.title);
      if (c.subtitle) card.setAttribute('subtitle', c.subtitle);

      a.appendChild(card);
      grid.appendChild(a);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once:true });
  } else {
    render();
  }
})();