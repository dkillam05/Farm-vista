/* FarmVista • Message Board Admin (simple FVData version)
   Collection: "messageBoard"
   Uses FVData so Dashboard + Admin stay in sync.
*/
(function () {
  "use strict";

  const COL = "messageBoard";

  const $ = (s, r = document) => r.querySelector(s);

  const ui = {
    title:   $("#title"),
    author:  $("#author"),
    body:    $("#body"),
    expires: $("#expires"),
    pinned:  $("#pinned"),
    saveBtn: $("#saveBtn"),
    purgeExpiredBtn: $("#purgeExpiredBtn"),
    clearAllBtn: $("#clearAllBtn"),
    list:    $("#list"),
    counts:  $("#counts"),
  };

  let editingId = null;

  const now = () => Date.now();

  const toMs = (v) => {
    if (!v) return null;
    if (typeof v === "number") return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const fmtDateTime = (ms) => {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  function toLocalDatetimeValue(d) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      p(d.getMonth() + 1) +
      "-" +
      p(d.getDate()) +
      "T" +
      p(d.getHours()) +
      ":" +
      p(d.getMinutes())
    );
  }

  function setExpiresMin() {
    try {
      const d = new Date(Date.now() + 60000);
      if (ui.expires) ui.expires.min = toLocalDatetimeValue(d);
    } catch {}
  }

  // ---------- FVData helpers ----------
  async function loadAll() {
    await FVData.ready();
    return await FVData.list(COL, { limit: 500, mine: false });
  }

  async function saveMessagePatch(id, fields) {
    await FVData.ready();
    if (id) {
      // update existing
      await FVData.update(COL, id, fields);
      return id;
    } else {
      // create new
      const saved = await FVData.add(COL, fields);
      return saved && saved.id;
    }
  }

  async function deleteMessage(id) {
    await FVData.ready();
    return await FVData.remove(COL, id);
  }

  async function deleteExpired() {
    const t = now();
    const all = await loadAll();
    const expired = all.filter((m) => m.expiresAt && m.expiresAt <= t);
    for (const m of expired) {
      try { await deleteMessage(m.id); } catch (e) {}
    }
  }

  async function deleteAll() {
    const all = await loadAll();
    for (const m of all) {
      try { await deleteMessage(m.id); } catch (e) {}
    }
  }

  // ---------- Form ----------
  function clearForm() {
    if (ui.title) ui.title.value = "";
    if (ui.author) ui.author.value = "";
    if (ui.body) ui.body.value = "";
    if (ui.expires) ui.expires.value = "";
    if (ui.pinned) ui.pinned.checked = false;
    editingId = null;
    if (ui.saveBtn) ui.saveBtn.textContent = "Save Message";
    setExpiresMin();
  }

  async function onSave() {
    const body = (ui.body && ui.body.value || "").trim();
    if (!body) {
      alert("Message body is required.");
      return;
    }

    const expMs = ui.expires && ui.expires.value ? Date.parse(ui.expires.value) : null;
    if (expMs && expMs < Date.now() + 60000) {
      alert("Expiry must be at least 1 minute in the future.");
      return;
    }

    const fields = {
      title: (ui.title && ui.title.value || "").trim(),
      body,
      authorName: (ui.author && ui.author.value || "").trim(),
      pinned: !!(ui.pinned && ui.pinned.checked),
      expiresAt: expMs || null,
    };

    try {
      await saveMessagePatch(editingId, fields);
      clearForm();
      await render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      alert("Save failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  function editItem(m) {
    editingId = m.id;
    if (ui.title) ui.title.value = m.title || "";
    if (ui.author) ui.author.value = m.authorName || "";
    if (ui.body) ui.body.value = m.body || "";
    if (ui.pinned) ui.pinned.checked = !!m.pinned;
    if (ui.expires) {
      ui.expires.value = m.expiresAt
        ? toLocalDatetimeValue(new Date(m.expiresAt))
        : "";
    }
    if (ui.saveBtn) ui.saveBtn.textContent = "Update Message";
    setExpiresMin();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Render ----------
  async function render() {
    const t = now();
    let raw = [];
    try {
      raw = await loadAll();
    } catch (e) {
      alert("Failed to load messages: " + (e && e.message ? e.message : String(e)));
      raw = [];
    }

    const list = raw.map((m) => ({
      id: m.id,
      title: m.title || "",
      body: m.body || "",
      pinned: !!m.pinned,
      authorName: m.authorName || "",
      createdAt:
        m.createdAt && m.createdAt.seconds
          ? m.createdAt.seconds * 1000
          : m.createdAt || t,
      expiresAt: toMs(m.expiresAt),
    }));

    list.sort(
      (a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt)
    );

    const active = list.filter((m) => !m.expiresAt || m.expiresAt > t);
    const expired = list.filter((m) => m.expiresAt && m.expiresAt <= t);

    if (ui.counts) {
      ui.counts.textContent = `${active.length} active · ${expired.length} expired`;
    }

    if (!ui.list) return;
    ui.list.innerHTML = "";

    for (const m of list) {
      const el = document.createElement("div");
      el.className = "item";
      el.dataset.id = m.id || "";

      const expiredBadge =
        m.expiresAt && m.expiresAt <= t
          ? `<span class="chip" style="background:#ffe9e9;border-color:#ffc7c7">Expired</span>`
          : "";

      el.innerHTML = `
        <div class="item-header">
          <div><strong>${m.title || "(Untitled)"}</strong></div>
          <div class="chips">
            ${m.pinned ? `<span class="chip">Pinned</span>` : ""}
            ${
              m.expiresAt
                ? `<span class="chip">Expires ${fmtDateTime(m.expiresAt)}</span>`
                : `<span class="chip">No expiry</span>`
            }
            ${expiredBadge}
          </div>
        </div>

        <div style="margin-top:6px; white-space:pre-wrap">${m.body}</div>

        <div class="muted" style="margin-top:6px">
          Posted ${fmtDateTime(m.createdAt)}
          ${m.authorName ? `· by ${m.authorName}` : ""}
        </div>

        <div class="actions" style="margin-top:10px">
          <button data-act="edit">Edit</button>
          <button data-act="togglePin">${m.pinned ? "Unpin" : "Pin"}</button>
          <button data-act="delete" class="danger">Delete</button>
        </div>
      `;

      ui.list.appendChild(el);
    }
  }

  // ---------- Event delegation ----------
  async function onListClick(evt) {
    const btn = evt.target.closest("button[data-act]");
    if (!btn) return;
    const item = btn.closest(".item");
    if (!item) return;

    const id = item.dataset.id;
    if (!id) {
      alert("Missing message id.");
      return;
    }

    const act = btn.dataset.act;
    const t = now();
    const raw = await loadAll();
    const m = raw.find((x) => x.id === id);
    if (!m) {
      alert("Message not found.");
      await render();
      return;
    }

    const msg = {
      id: m.id,
      title: m.title || "",
      body: m.body || "",
      pinned: !!m.pinned,
      authorName: m.authorName || "",
      createdAt:
        m.createdAt && m.createdAt.seconds
          ? m.createdAt.seconds * 1000
          : m.createdAt || t,
      expiresAt: toMs(m.expiresAt),
    };

    if (act === "edit") {
      editItem(msg);
      return;
    }

    if (act === "togglePin") {
      const fields = {
        title: msg.title,
        body: msg.body,
        authorName: msg.authorName,
        pinned: !msg.pinned,
        expiresAt: msg.expiresAt,
      };
      try {
        await saveMessagePatch(msg.id, fields);
        await render();
      } catch (e) {
        alert("Pin/unpin failed: " + (e && e.message ? e.message : String(e)));
      }
      return;
    }

    if (act === "delete") {
      if (!confirm("Delete this message?")) return;
      try {
        await deleteMessage(msg.id);
        await render();
      } catch (e) {
        alert("Delete failed: " + (e && e.message ? e.message : String(e)));
      }
      return;
    }
  }

  // ---------- Init ----------
  (async function init() {
    if (!window.FVData) {
      alert("FVData is not loaded on this page.");
      return;
    }

    try {
      await FVData.ready();
    } catch (e) {
      alert("FVData not ready: " + (e && e.message ? e.message : String(e)));
      return;
    }

    if (ui.saveBtn) ui.saveBtn.addEventListener("click", onSave);
    if (ui.purgeExpiredBtn)
      ui.purgeExpiredBtn.addEventListener("click", async () => {
        await deleteExpired();
        await render();
      });
    if (ui.clearAllBtn)
      ui.clearAllBtn.addEventListener("click", async () => {
        if (!confirm("Delete ALL messages?")) return;
        await deleteAll();
        await render();
      });

    if (ui.list) ui.list.addEventListener("click", onListClick);

    setExpiresMin();
    await render();
  })();
})();