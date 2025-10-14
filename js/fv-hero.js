// FarmVista – Dashboard hero grid renderer (mounts 4 cards)
(function () {
  function mount() {
    const grid = document.getElementById('hero-grid');
    if (!grid) return;

    // Ensure the custom element exists
    if (!customElements.get('fv-hero-card')) {
      grid.innerHTML = `
        <div class="card" style="padding:12px">
          Hero component not loaded. Check that /Farm-vista/js/fv-hero-card.js is present
          and the cache-buster on the <script> tag is bumped.
        </div>`;
      return;
    }

    const cards = [
      { emoji: '🌱', title: 'Crop Production', subtitle: '🚧 Coming Soon' },
      { emoji: '🚜', title: 'Equipment',       subtitle: '🚧 Coming Soon' },
      { emoji: '🌾', title: 'Grain',           subtitle: '🚧 Coming Soon' },
      { emoji: '📊', title: 'Reports',         subtitle: '🚧 Coming Soon' },
    ];

    grid.innerHTML = '';
    for (const c of cards) {
      const el = document.createElement('fv-hero-card');
      el.setAttribute('emoji', c.emoji);
      el.setAttribute('title', c.title);
      el.setAttribute('subtitle', c.subtitle);
      grid.appendChild(el);
    }
  }

  // Run after DOM is ready (safe if loaded late)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();