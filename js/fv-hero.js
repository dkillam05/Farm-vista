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
    const msg = getLatestMessage();
    if (!msg) {
      cardEl.setAttribute('subtitle', 'No active messages.');
      cardEl.style.minHeight = 'var(--hero-h)'; // default height
      return;
    }

    const title = msg.title
      ? `Dowson Farms Message Board — ${msg.title}`
      : 'Dowson Farms Message Board';

    const expText = msg.expiresAt ? formatExpires(msg.expiresAt) : '';
    const body = expText ? `${msg.body}\n\n${expText}` : msg.body;

    cardEl.setAttribute('title', title);
    cardEl.setAttribute('subtitle', body);

    // If message is long, let this hero grow taller than the default clamp
    if (body && body.length > 180) {
      cardEl.style.minHeight = 'auto';
    } else {
      cardEl.style.minHeight = 'var(--hero-h)';
    }
  }

  /** Read and select best active message from localStorage */
  function getLatestMessage() {
    let list = [];
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) list = JSON.parse(raw);
    } catch { /* ignore */ }

    if (!Array.isArray(list)) list = [];

    const now = Date.now();
    const norm = list.map(normalizeDoc)
      .filter(m => m.body && (!m.expiresAt || m.expiresAt > now));

    if (norm.length === 0) return null;

    norm.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1; // pinned first
      return (b.createdAt || 0) - (a.createdAt || 0);       // newest first
    });

    return norm[0];
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

  function formatExpires(ms) {
    try {
      const d = new Date(typeof ms === 'number' ? ms : Date.parse(ms));
      return `Expires ${d.toLocaleString(undefined, {
        weekday:'short', month:'short', day:'numeric',
        hour:'numeric', minute:'2-digit'
      })}`;
    } catch { return ''; }
  }

  // Small global helper for seeding messages (until Admin composer exists)
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