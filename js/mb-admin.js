/* /js/mb-admin.js — Message Board Admin (Firestore-first; FVData fallback; LS fallback)
   Collection: "messageBoard"
   Doc shape:
   {
     title?: string, body: string, pinned?: boolean,
     expiresAt?: number|null, authorName?: string,
     // FVData stamps: uid, createdAt, updatedAt
   }
*/
(function () {
  'use strict';

  const COL = 'messageBoard';
  const LS_KEY = 'df_message_board_fallback';

  // ---------- DOM ----------
  const $ = (s, r = document) => r.querySelector(s);
  const ui = {
    title:   $('#title'),
    author:  $('#author'),
    body:    $('#body'),
    expires: $('#expires'),
    pinned:  $('#pinned'),
    saveBtn: $('#saveBtn'),
    purgeExpiredBtn: $('#purgeExpiredBtn'),
    clearAllBtn: $('#clearAllBtn'),
    list:    $('#list'),
    counts:  $('#counts'),
  };

  // ---------- State ----------
  let editingId = null;
  let useLS = false; // flips to true if no Firestore / FVData

  // Try to grab Firestore db (firebase-config.js should set this)
  let db = null;
  try {
    if (window.db) {
      db = window.db;
    } else if (window.firebase && firebase.firestore) {
      db = firebase.firestore();
    }
  } catch (e) {
    db = null;
  }

  // If we have Firestore, we will NOT use LocalStorage unless absolutely needed
  if (!db && !window.FVData) {
    useLS = true;
  }

  // ---------- Utils ----------
  const uidLocal = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = () => Date.now();

  const toMs = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const fmtDateTime = (ms) => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  function toLocalDatetimeValue(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function setExpiresMin() {
    try {
      const oneMinuteAhead = new Date(Date.now() + 60_000);
      if (ui.expires) ui.expires.min = toLocalDatetimeValue(oneMinuteAhead);
    } catch {}
  }

  // ---------- LocalStorage fallback ----------
  const lsLoad = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const lsSave = (arr) => localStorage.setItem(LS_KEY, JSON.stringify(arr));

  const lsUpsert = (msg) => {
    const list = lsLoad();
    const i = list.findIndex((x) => x.id === msg.id);
    if (i === -1) list.push(msg);
    else list[i] = msg;
    lsSave(list);
  };

  const lsRemove = (id) => lsSave(lsLoad().filter((x) => x.id !== id));

  const lsClearAll = () => localStorage.removeItem(LS_KEY);

  // ---------- Data layer ----------
  async function dlReady() {
    // If we already have db, nothing special to do.
    if (db) return;

    // If no db but FVData exists, we can at least wait for it.
    if (window.FVData && typeof FVData.ready === 'function') {
      try {
        await FVData.ready();
      } catch {
        /* ignore */
      }
    }

    // Decide if LS fallback is needed
    if (!db && !window.FVData) {
      useLS = true;
    }
  }

  // LIST
  async function dlListAll() {
    // 1) Firestore direct (preferred)
    if (db) {
      const snap = await db.collection(COL).get();
      const out = [];
      snap.forEach((doc) => {
        const data = doc.data() || {};
        out.push({
          id: doc.id,
          ...data,
        });
      });
      return out;
    }

    // 2) FVData.list as backup
    if (window.FVData && typeof FVData.list === 'function') {
      const items = await FVData.list(COL, { limit: 500, mine: false });
      return (items || []).map((x) => ({
        id: x.id,
        ...(x || {}),
      }));
    }

    // 3) LocalStorage fallback
    if (useLS) return lsLoad();

    return [];
  }

  // GET
  async function dlGet(id) {
    if (!id) return null;

    if (db) {
      const doc = await db.collection(COL).doc(id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...(doc.data() || {}) };
    }

    if (window.FVData && typeof FVData.getDocData === 'function') {
      const doc = await FVData.getDocData(`${COL}/${id}`);
      return doc ? { id, ...doc } : null;
    }

    if (useLS) return lsLoad().find((x) => x.id === id) || null;

    return null;
  }

  // UPSERT
  async function dlUpsert(msg) {
    // Firestore first
    if (db) {
      const data = {
        title: msg.title || '',
        body: msg.body || '',
        pinned: !!msg.pinned,
        expiresAt: msg.expiresAt ?? null,
        authorName: msg.authorName || '',
      };

      if (msg.id) {
        // Update
        await db.collection(COL).doc(msg.id).set(
          {
            ...data,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
        return msg.id;
      } else {
        // Create
        const createdAt = Date.now();
        const ref = await db.collection(COL).add({
          ...data,
          createdAt,
          updatedAt: createdAt,
        });
        return ref.id;
      }
    }

    // FVData backup
    if (window.FVData) {
      if (msg.id) {
        const { id, ...rest } = msg;
        await FVData.update(COL, id, rest);
        return id;
      } else {
        const saved = await FVData.add(COL, msg);
        return saved?.id || null;
      }
    }

    // LocalStorage fallback
    if (useLS) {
      if (!msg.id) msg.id = uidLocal();
      lsUpsert(msg);
      return msg.id;
    }

    throw new Error('No data layer available for upsert');
  }

  // REMOVE (DELETE)
  async function dlRemove(id) {
    if (!id) return;

    // Firestore direct delete — this is the important part for you
    if (db) {
      await db.collection(COL).doc(id).delete();
      return;
    }

    // FVData delete fallback
    if (window.FVData) {
      if (typeof FVData.deleteDoc === 'function') {
        await FVData.deleteDoc(`${COL}/${id}`);
        return;
      }
      if (typeof FVData.remove === 'function') {
        await FVData.remove(COL, id);
        return;
      }
    }

    // LocalStorage fallback
    if (useLS) {
      lsRemove(id);
      return;
    }

    throw new Error('No delete path available for messageBoard');
  }

  // CLEAR ALL
  async function dlClearAll() {
    // Firestore batch delete
    if (db) {
      const snap = await db.collection(COL).get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
      return;
    }

    // FVData fallback — delete each one
    if (window.FVData) {
      const items = await dlListAll();
      for (const m of items) {
        if (!m.id) continue;
        try {
          if (typeof FVData.deleteDoc === 'function') {
            await FVData.deleteDoc(`${COL}/${m.id}`);
          } else if (typeof FVData.remove === 'function') {
            await FVData.remove(COL, m.id);
          }
        } catch {}
      }
      return;
    }

    // LocalStorage fallback
    if (useLS) {
      lsClearAll();
      return;
    }
  }

  // ---------- UI handlers ----------
  function clearForm() {
    if (ui.title) ui.title.value = '';
    if (ui.author) ui.author.value = '';
    if (ui.body) ui.body.value = '';
    if (ui.expires) ui.expires.value = '';
    if (ui.pinned) ui.pinned.checked = false;
    setExpiresMin();
    editingId = null;
    if (ui.saveBtn) ui.saveBtn.textContent = 'Save Message';
  }

  async function onSave() {
    const body = (ui.body?.value || '').trim();
    if (!body) {
      alert('Message body is required.');
      return;
    }

    // Validate expiry >= +1 minute (if provided)
    if (ui.expires && ui.expires.value) {
      const expMs = Date.parse(ui.expires.value);
      if (!Number.isFinite(expMs)) {
        ui.expires.setCustomValidity('Please enter a valid date/time.');
        ui.expires.reportValidity();
        return;
      }
      const minAllowed = Date.now() + 60_000;
      if (expMs < minAllowed) {
        ui.expires.setCustomValidity('Expiry must be at least 1 minute in the future.');
        ui.expires.reportValidity();
        return;
      }
      ui.expires.setCustomValidity('');
    }

    const msg = {
      id: editingId || null,
      title: (ui.title?.value || '').toString().trim(),
      body,
      pinned: !!ui.pinned?.checked,
      expiresAt: ui.expires?.value ? Date.parse(ui.expires.value) : null,
      authorName: (ui.author?.value || '').toString().trim(),
    };

    try {
      await dlUpsert(msg);
      editingId = null;
      if (ui.saveBtn) ui.saveBtn.textContent = 'Save Message';
      clearForm();
      await render();
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {}
    } catch (e) {
      console.error(e);
      alert('Save failed. Check permissions or network.');
    }
  }

  function editItem(m) {
    editingId = m.id;
    if (ui.title) ui.title.value = m.title || '';
    if (ui.author) ui.author.value = m.authorName || '';
    if (ui.body) ui.body.value = m.body || '';
    if (ui.pinned) ui.pinned.checked = !!m.pinned;
    if (ui.expires) ui.expires.value = m.expiresAt ? toLocalDatetimeValue(new Date(m.expiresAt)) : '';
    setExpiresMin();
    if (ui.saveBtn) ui.saveBtn.textContent = 'Update Message';
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {}
  }

  async function onPurgeExpired() {
    const t = now();
    const list = await dlListAll();
    const expired = list.filter((m) => m.expiresAt && m.expiresAt <= t);
    for (const m of expired) {
      try {
        await dlRemove(m.id);
      } catch {}
    }
    await render();
  }

  async function onClearAll() {
    if (!confirm('Clear ALL messages? This cannot be undone.')) return;
    try {
      await dlClearAll();
      await render();
    } catch (err) {
      console.error('MessageBoard clearAll failed', err);
      alert('Unable to clear messages. Please try again.');
    }
  }

  // ---------- Render ----------
  async function render() {
    const t = now();
    const rawList = await dlListAll();

    const list = rawList
      .filter((m) => m && m.id) // ensure we only work with real Firestore docs
      .map((m) => ({
        id: m.id,
        title: (m.title || '').toString(),
        body: (m.body || '').toString(),
        pinned: !!m.pinned,
        createdAt:
          typeof m.createdAt === 'object' && typeof m.createdAt.seconds === 'number'
            ? m.createdAt.seconds * 1000
            : typeof m.createdAt === 'number'
            ? m.createdAt
            : t,
        expiresAt: toMs(m.expiresAt),
        authorName: (m.authorName || '').toString(),
      }));

    // Sort: pinned first, then newest by createdAt
    list.sort((a, b) => b.pinned - a.pinned || (b.createdAt || 0) - (a.createdAt || 0));

    const active = list.filter((m) => !m.expiresAt || m.expiresAt > t);
    const expired = list.filter((m) => m.expiresAt && m.expiresAt <= t);
    if (ui.counts) ui.counts.textContent = `${active.length} active · ${expired.length} expired`;

    if (!ui.list) return;
    ui.list.innerHTML = '';

    for (const m of list) {
      const isExpired = !!(m.expiresAt && m.expiresAt <= t);
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="item-header">
          <div><div style="font-weight:700">${m.title || '(Untitled)'}</div></div>
          <div class="chips">
            ${m.pinned ? `<span class="chip">Pinned</span>` : ``}
            ${m.expiresAt ? `<span class="chip">Expires ${fmtDateTime(m.expiresAt)}</span>` : `<span class="chip">No expiry</span>`}
            ${isExpired ? `<span class="chip" style="background:#ffe9e9;border-color:#ffc7c7">Expired</span>` : ``}
          </div>
        </div>
        <div style="margin-top:6px; white-space:pre-wrap">${m.body}</div>
        <div class="muted" style="margin-top:6px">
          Posted ${fmtDateTime(m.createdAt)} ${m.authorName ? `· by ${m.authorName}` : ``}
        </div>
        <div class="actions" style="margin-top:10px">
          <button data-act="edit">Edit</button>
          <button data-act="togglePin">${m.pinned ? 'Unpin' : 'Pin'}</button>
          <button data-act="delete" class="danger">Delete</button>
        </div>
      `;

      el.querySelector('[data-act="edit"]').addEventListener('click', () => editItem(m));

      el.querySelector('[data-act="togglePin"]').addEventListener('click', async () => {
        m.pinned = !m.pinned;
        try {
          await dlUpsert(m);
          await render();
        } catch {}
      });

      el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm('Delete this message?')) return;
        try {
          await dlRemove(m.id);
          // Optimistic UI: remove immediately so you see it disappear on phone
          el.remove();
          await render();
        } catch {
          alert('Unable to delete message.');
        }
      });

      ui.list.appendChild(el);
    }
  }

  // ---------- Init ----------
  (async function init() {
    await dlReady();

    // Wire events
    if (ui.saveBtn) ui.saveBtn.addEventListener('click', onSave);
    if (ui.purgeExpiredBtn) ui.purgeExpiredBtn.addEventListener('click', onPurgeExpired);
    if (ui.clearAllBtn) ui.clearAllBtn.addEventListener('click', onClearAll);

    setExpiresMin();
    if (ui.expires) ui.expires.addEventListener('focus', setExpiresMin);

    await render();
  })();
})();