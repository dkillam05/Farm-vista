/* /js/mb-admin.js — Message Board Admin (FVData + Firestore; LS fallback)
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
  let useLS = false; // flips to true if FVData not ready

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

  // ---------- Data layer (FVData first) ----------
  async function dlReady() {
    try {
      if (window.FVData && typeof FVData.ready === 'function') {
        await FVData.ready();
      }
    } catch {
      /* ignore */
    }

    // useLS if FVData is missing or doesn't have the basic methods
    useLS = !window.FVData || typeof FVData.add !== 'function';
  }

  async function dlListAll() {
    if (useLS) return lsLoad();

    // By default FVData.list() filters to current uid; for message board we usually want all.
    const items = await FVData.list(COL, { limit: 500, mine: false });
    // Normalize IDs on reads
    return (items || []).map((x) => ({ id: x.id, ...(x || {}) }));
  }

  async function dlGet(id) {
    if (useLS) return lsLoad().find((x) => x.id === id) || null;
    if (!window.FVData || typeof FVData.getDocData !== 'function') return null;
    const doc = await FVData.getDocData(`${COL}/${id}`);
    return doc ? { id, ...doc } : null;
  }

  async function dlUpsert(msg) {
    if (useLS) {
      if (!msg.id) msg.id = uidLocal();
      lsUpsert(msg);
      return msg.id;
    }

    if (!window.FVData) {
      throw new Error('FVData not available for upsert');
    }

    if (msg.id) {
      const { id, ...rest } = msg;
      await FVData.update(COL, id, rest);
      return id;
    } else {
      const saved = await FVData.add(COL, msg);
      return saved?.id || null;
    }
  }

  async function dlRemove(id) {
    if (!id) return;

    if (useLS) {
      lsRemove(id);
      return;
    }

    // Firestore / FVData path
    try {
      if (window.FVData) {
        // Preferred: FVData.remove(collection, id)
        if (typeof FVData.remove === 'function') {
          await FVData.remove(COL, id);
          return;
        }

        // Alternate: FVData.deleteDoc("collection/id")
        if (typeof FVData.deleteDoc === 'function') {
          await FVData.deleteDoc(`${COL}/${id}`);
          return;
        }
      }

      // Fallback: raw Firestore
      if (window.db && typeof db.collection === 'function') {
        await db.collection(COL).doc(id).delete();
        return;
      }

      throw new Error('No delete implementation available for messageBoard');
    } catch (err) {
      console.error('MessageBoard delete failed for id:', id, err);
      throw err;
    }
  }

  async function dlClearAll() {
    if (useLS) {
      lsClearAll();
      return;
    }

    // Prefer batch deletion via Firestore if available
    try {
      if (window.db && typeof db.collection === 'function') {
        const snap = await db.collection(COL).get();
        if (!snap.empty) {
          const batch = db.batch();
          snap.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
        return;
      }
    } catch (err) {
      console.error('MessageBoard clearAll via db failed, falling back to per-doc delete', err);
    }

    // Fallback: per-doc delete via dlRemove / FVData
    const items = await dlListAll();
    for (const m of items) {
      try {
        if (m.id) await dlRemove(m.id);
      } catch (err) {
        console.error('MessageBoard clearAll: failed to delete', m.id, err);
      }
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
      const id = await dlUpsert(msg);
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
      } catch (err) {
        console.error('MessageBoard purgeExpired: failed to delete', m.id, err);
      }
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

    const list = rawList.map((m) => ({
      id: m.id || uidLocal(),
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
        } catch (err) {
          console.error('MessageBoard togglePin failed', err);
        }
      });

      el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!confirm('Delete this message?')) return;
        try {
          await dlRemove(m.id);
          await render();
        } catch (err) {
          console.error('MessageBoard delete handler failed', err);
          alert('Unable to delete message. Please check console for details.');
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