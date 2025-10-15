/* /js/mb-admin.js — Message Board Admin (localStorage only)
   Storage key: "df_message_board"
   Message shape:
   { id: string, title?: string, body: string, pinned?: boolean,
     createdAt: number, expiresAt?: number|null, authorName?: string }
*/
(function () {
  const LS_KEY = 'df_message_board';

  // DOM helpers
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const ui = {
    title:   $('#title'),
    author:  $('#author'),
    body:    $('#body'),
    expires: $('#expires'),
    pinned:  $('#pinned'),
    saveBtn: $('#saveBtn'),
    exportBtn: $('#exportBtn'),         // may be null (we removed Import/Export from Tools)
    importFile: $('#importFile'),       // may be null
    purgeExpiredBtn: $('#purgeExpiredBtn'),
    clearAllBtn: $('#clearAllBtn'),
    list:    $('#list'),
    counts:  $('#counts'),
  };

  // State
  let editingId = null;

  // Utils
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = () => Date.now();

  const load = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  const save = (arr) => {
    localStorage.setItem(LS_KEY, JSON.stringify(arr));
  };

  const toMs = (v) => {
    if (!v) return null;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const fmtDateTime = (ms) => {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday:'short', month:'short', day:'numeric',
        hour:'numeric', minute:'2-digit'
      });
    } catch { return ''; }
  };

  const normalize = (m) => ({
    id: m.id || uid(),
    title: (m.title || '').toString().trim(),
    body: (m.body || '').toString().trim(),
    pinned: !!m.pinned,
    createdAt: toMs(m.createdAt) ?? now(),
    expiresAt: toMs(m.expiresAt),
    authorName: (m.authorName || '').toString().trim(),
  });

  // ---- Expiry helpers (validation + min for picker) ----
  function toLocalDatetimeValue(d){
    const p = (n)=> String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function setExpiresMin(){
    if (!ui.expires) return;
    try {
      const oneMinuteAhead = new Date(Date.now() + 60_000);
      ui.expires.min = toLocalDatetimeValue(oneMinuteAhead);
    } catch {}
  }

  // CRUD
  function upsert(msg) {
    const n = normalize(msg);
    const list = load();
    const i = list.findIndex(x => x.id === n.id);
    if (i === -1) list.push(n); else list[i] = n;
    save(list);
    render();
    return n.id;
  }

  function remove(id) {
    const list = load().filter(x => x.id !== id);
    save(list);
    render();
  }

  function purgeExpired() {
    const t = now();
    const list = load().filter(x => !x.expiresAt || x.expiresAt > t);
    save(list);
    render();
  }

  function clearAll() {
    localStorage.removeItem(LS_KEY);
    render();
  }

  // UI handlers
  function onSave() {
    const msg = {
      id: editingId || null,
      title: ui.title?.value || '',
      body: ui.body?.value || '',
      pinned: !!ui.pinned?.checked,
      createdAt: editingId ? undefined : now(),
      expiresAt: ui.expires?.value ? Date.parse(ui.expires.value) : null,
      authorName: ui.author?.value || '',
    };

    if (!msg.body.trim()) {
      alert('Message body is required.');
      return;
    }

    // Validate expiry >= 1 minute in the future (if provided)
    if (ui.expires && ui.expires.value) {
      const expMs = Date.parse(ui.expires.value);
      if (!Number.isFinite(expMs)) {
        ui.expires.setCustomValidity('Please enter a valid date/time.');
        ui.expires.reportValidity();
        return;
      }
      const minAllowed = Date.now() + 60_000; // 1 minute
      if (expMs < minAllowed) {
        ui.expires.setCustomValidity('Expiry must be at least 1 minute in the future.');
        ui.expires.reportValidity();
        return;
      }
      ui.expires.setCustomValidity('');
    }

    const id = upsert(msg);
    editingId = null;
    if (ui.saveBtn) ui.saveBtn.textContent = 'Save Message';
    clearForm();
  }

  function clearForm() {
    if (ui.title) ui.title.value = '';
    if (ui.author) ui.author.value = '';
    if (ui.body) ui.body.value = '';
    if (ui.expires) ui.expires.value = '';
    if (ui.pinned) ui.pinned.checked = false;
    setExpiresMin();
  }

  function editItem(m) {
    editingId = m.id;
    if (ui.title) ui.title.value = m.title || '';
    if (ui.author) ui.author.value = m.authorName || '';
    if (ui.body) ui.body.value = m.body || '';
    if (ui.pinned) ui.pinned.checked = !!m.pinned;
    if (ui.expires) {
      ui.expires.value = m.expiresAt ? toLocalDatetimeValue(new Date(m.expiresAt)) : '';
      setExpiresMin();
    }
    if (ui.saveBtn) ui.saveBtn.textContent = 'Update Message';
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  }

  // Render list
  function render() {
    const t = now();
    const list = load().map(normalize);

    // Sort: pinned first, then newest
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const active = list.filter(m => !m.expiresAt || m.expiresAt > t);
    const expired = list.filter(m => m.expiresAt && m.expiresAt <= t);

    if (ui.counts) ui.counts.textContent = `${active.length} active · ${expired.length} expired`;

    if (!ui.list) return;
    ui.list.innerHTML = '';
    for (const m of list) {
      const isExpired = !!(m.expiresAt && m.expiresAt <= t);

      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="item-header">
          <div>
            <div style="font-weight:700">${m.title || '(Untitled)'}</div>
          </div>
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

      // Actions
      el.querySelector('[data-act="edit"]').addEventListener('click', () => editItem(m));
      el.querySelector('[data-act="togglePin"]').addEventListener('click', () => {
        m.pinned = !m.pinned;
        upsert(m);
      });
      el.querySelector('[data-act="delete"]').addEventListener('click', () => {
        if (confirm('Delete this message?')) remove(m.id);
      });

      ui.list.appendChild(el);
    }
  }

  // Import/Export (optional; only if buttons are present)
  function onExport() {
    const data = JSON.stringify(load(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'dowson-message-board.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function onImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result || '[]');
        if (!Array.isArray(arr)) throw new Error('Invalid JSON: expected an array');
        save(arr);
        render();
        alert('Messages imported.');
      } catch (err) {
        alert('Import failed: ' + err.message);
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(f);
  }

  // Wire up events
  if (ui.saveBtn) ui.saveBtn.addEventListener('click', onSave);
  if (ui.exportBtn) ui.exportBtn.addEventListener('click', onExport);
  if (ui.importFile) ui.importFile.addEventListener('change', onImport);
  if (ui.purgeExpiredBtn) ui.purgeExpiredBtn.addEventListener('click', purgeExpired);
  if (ui.clearAllBtn) ui.clearAllBtn.addEventListener('click', () => {
    if (confirm('Clear ALL messages? This cannot be undone.')) clearAll();
  });

  // Initialize min guard for expiry and initial paint
  setExpiresMin();
  if (ui.expires) ui.expires.addEventListener('focus', setExpiresMin);

  render();
})();