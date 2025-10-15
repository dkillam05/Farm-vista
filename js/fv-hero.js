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
  const CARDS = [
    { id: MSG_CARD_ID, emoji: '📢', title: 'Dowson Farms Message Board', subtitle: 'Loading…' },
    { emoji: '🌱', title: 'Crop Production', subtitle: '🚧 Coming Soon' },
    { emoji: '🚜', title: 'Equipment',       subtitle: '🚧 Coming Soon' },
    { emoji: '🌾', title: 'Grain',           subtitle: '🚧 Coming Soon' },
    { emoji: '📊', title: 'Reports',         subtitle: '🚧 Coming Soon' },
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
      grid.appendChild(el);
    }

    // Populate the Message Board hero
    const msgEl = document.getElementById(MSG_CARD_ID);
    if (msgEl) populateMessageBoard(msgEl);
  }

  /** Populate from localStorage; never navigates */
  function populateMessageBoard(cardEl) {
    const list = getActiveMessages();

    if (list.length === 0) {
      cardEl.setAttribute('title', 'Dowson Farms Message Board');
      cardEl.setAttribute('subtitle', 'No active messages.');
      cardEl.style.minHeight = 'var(--hero-h)'; // default height
      return;
    }

    // Build a compact, professional summary: up to 4 bullets
    const subtitle = summarizeMessages(list, 4);

    cardEl.setAttribute('title', 'Dowson Farms Message Board'); // fixed header, no hyphen
    cardEl.setAttribute('subtitle', subtitle);

    // If long, let the hero grow a bit; otherwise keep the standard height
    if (subtitle.length > 220) {
      cardEl.style.minHeight = 'auto';
    } else {
      cardEl.style.minHeight = 'var(--hero-h)';
    }
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
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; // pinned first
      return (b.createdAt || 0) - (a.createdAt || 0);       // newest first
    });

    return norm;
  }

  /** Summarize messages as bullets: • [📌]Title: snippet */
  function summarizeMessages(list, limit = 4) {
    const bullets = [];
    for (const m of list.slice(0, limit)) {
      const pin = m.pinned ? '📌 ' : '';
      const title = m.title ? `${m.title}: ` : '';
      const snippet = m.body.trim().split(/\s+/).slice(0, 12).join(' ');
      const more = m.body.trim().split(/\s+/).length > 12 ? '…' : '';
      bullets.push(`• ${pin}${title}${snippet}${more}`);
    }
    if (list.length > limit) {
      bullets.push(`+${list.length - limit} more…`);
    }
    // Keep as a single string so <fv-hero-card> can render it gracefully
    // The spaced " • " separators help line wrapping look natural
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