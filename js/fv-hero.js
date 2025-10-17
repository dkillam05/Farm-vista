/* /js/fv-hero.js — FULL REPLACEMENT (no Firestore)
   FarmVista – Dashboard hero grid + local Message Board (📢)
   Uses localStorage key: "df_message_board"
   Message object shape:
   { title?: string, body: string, pinned?: boolean,
     createdAt?: number|ISO, expiresAt?: number|ISO, authorName?: string }
*/
(function () {
  const MSG_CARD_ID = 'msg-board-card';
  const LS_KEY = 'df_message_board';

  // Initial cards (Message Board first)
  // NOTE: Links point to /pages/<section>/index.html (per your screenshots).
  const CARDS = [
    { id: MSG_CARD_ID, emoji: '📢', title: 'Dowson Farms Message Board', subtitle: 'Loading…' },

    { emoji: '🌱', title: 'Crop Production', subtitle: 'Open', href: './pages/crop-production/' },
    { emoji: '🚜', title: 'Equipment',       subtitle: 'Open', href: './pages/equipment/' },
    { emoji: '🌾', title: 'Grain',           subtitle: 'Open', href: './pages/grain/' },
    { emoji: '📊', title: 'Reports',         subtitle: 'Open', href: './pages/reports/' },
  ];

  function mount() {
    const grid = document.getElementById('hero-grid');
    if (!grid) return;

    grid.innerHTML = '';
    for (const c of CARDS) {
      const el = document.createElement('fv-hero-card');
      el.setAttribute('emoji', c.emoji);
      el.setAttribute('title', c.title);
      el.setAttribute('subtitle', c.subtitle || '');
      if (c.id) el.id = c.id;

      if (c.href) {
        makeCardLink(el, c.href, c.title);
      } else {
        el.style.cursor = 'default';
        el.setAttribute('aria-disabled', 'true');
      }
      grid.appendChild(el);
    }

    const msgEl = document.getElementById(MSG_CARD_ID);
    if (msgEl) populateMessageBoard(msgEl);
  }

  /** Turn a hero card into an accessible link-like element */
  function makeCardLink(cardEl, href, title = '') {
    cardEl.style.cursor = 'pointer';
    cardEl.setAttribute('role', 'link');
    cardEl.setAttribute('tabindex', '0');
    if (title) cardEl.setAttribute('aria-label', `${title} — Open`);

    const go = (evt, newTab = false) => {
      if (evt && (evt.metaKey || evt.ctrlKey || evt.button === 1 || newTab)) {
        window.open(href, '_blank', 'noopener,noreferrer');
      } else {
        location.href = href;
      }
    };

    cardEl.addEventListener('click', (e) => go(e));
    cardEl.addEventListener('auxclick', (e) => { if (e.button === 1) go(e, true); });
    cardEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
    });
  }

  /** Populate from localStorage; never navigates */
  function populateMessageBoard(cardEl) {
    const list = getActiveMessages();

    if (list.length === 0) {
      cardEl.setAttribute('title', 'Dowson Farms Message Board');
      cardEl.setAttribute('subtitle', 'No active messages.');
      cardEl.style.minHeight = 'var(--hero-h)';
      return;
    }

    const subtitle = summarizeMessages(list, 4);
    cardEl.setAttribute('title', 'Dowson Farms Message Board');
    cardEl.setAttribute('subtitle', subtitle);
    cardEl.style.minHeight = subtitle.length > 220 ? 'auto' : 'var(--hero-h)';
  }

  /** Return active, normalized, sorted messages (pinned first, newest next) */
  function getActiveMessages() {
    let list = [];
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) list = JSON.parse(raw);
    } catch { /* ignore */ }

    if (!Array.isArray(list)) list = [];

    const now = Date.now();
    const norm = list.map(normalizeDoc)
      .filter(m => m.body && (!m.expiresAt || m.expiresAt > now));

    norm.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return norm;
  }

  /** Summarize messages as bullets: • [📌]Title: snippet */
  function summarizeMessages(list, limit = 4) {
    const bullets = [];
    for (const m of list.slice(0, limit)) {
      const pin = m.pinned ? '📌 ' : '';
      const title = m.title ? `${m.title}: ` : '';
      const words = m.body.trim().split(/\s+/);
      const snippet = words.slice(0, 12).join(' ');
      const more = words.length > 12 ? '…' : '';
      bullets.push(`• ${pin}${title}${snippet}${more}`);
    }
    if (list.length > limit) bullets.push(`+${list.length - limit} more…`);
    return bullets.join('   ');
  }

  function normalizeDoc(d) {
    const toMs = (v) => {
      if (!v) return null;
      if (typeof v === 'number') return v;
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    };
    return {
      title: (d.title || '').toString().trim(),
      body: (d.body || '').toString().trim(),
      pinned: !!d.pinned,
      createdAt: toMs(d.createdAt) ?? Date.now(),
      expiresAt: toMs(d.expiresAt),
      authorName: d.authorName || ''
    };
  }

  // Small global helper for seeding/testing messages
  window.DFMessageBoard = {
    set(arr) {
      if (!Array.isArray(arr)) throw new Error('DFMessageBoard.set expects an array');
      localStorage.setItem(LS_KEY, JSON.stringify(arr));
      refresh();
    },
    add(msg) {
      const list = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      list.push(msg || {});
      localStorage.setItem(LS_KEY, JSON.stringify(list));
      refresh();
    },
    clear() {
      localStorage.removeItem(LS_KEY);
      refresh();
    }
  };

  function refresh() {
    const el = document.getElementById(MSG_CARD_ID);
    if (el) populateMessageBoard(el);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();