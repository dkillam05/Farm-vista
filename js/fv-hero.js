// FarmVista – Dashboard hero grid renderer (robust auto-upgrade version)
(function () {
  const CARDS = [
    { emoji: '🌱', title: 'Crop Production', subtitle: '🚧 Coming Soon' },
    { emoji: '🚜', title: 'Equipment',       subtitle: '🚧 Coming Soon' },
    { emoji: '🌾', title: 'Grain',           subtitle: '🚧 Coming Soon' },
    { emoji: '📊', title: 'Reports',         subtitle: '🚧 Coming Soon' },
  ];

  function mount() {
    const grid = document.getElementById('hero-grid');
    if (!grid) return;

    // Render immediately; custom element will upgrade when defined.
    grid.innerHTML = '';
    for (const c of CARDS) {
      const el = document.createElement('fv-hero-card');
      el.setAttribute('emoji', c.emoji);
      el.setAttribute('title', c.title);
      el.setAttribute('subtitle', c.subtitle);
      grid.appendChild(el);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();