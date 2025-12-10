/* FarmVista • Message Board Admin (FVData version with delete error popup)
   Collection: "messageBoard"
*/
(function () {
  "use strict";

  const COL = "messageBoard";

  // ---------- DOM ----------
  const $ = (s, r=document) => r.querySelector(s);
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
    counts:  $("#counts")
  };

  if (!window.FVData) {
    alert("FVData is not loaded. Message Board admin cannot function.");
    return;
  }

  let editingId = null;

  // ---------- Helpers ----------
  const now = () => Date.now();

  const toMs = (v)=>{
    if (!v) return null;
    if (typeof v === "number") return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const fmtDateTime = (ms)=>{
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString(undefined, {
        month:"short", day:"numeric",
        hour:"numeric", minute:"2-digit"
      });
    } catch { return ""; }
  };

  function toLocalDatetimeValue(d){
    const p = (n)=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function setExpiresMin(){
    try {
      const d = new Date(Date.now()+60000);
      ui.expires.min = toLocalDatetimeValue(d);
    } catch {}
  }

  // ---------- FVData wrappers ----------
  async function loadAll(){
    await FVData.ready();
    return await FVData.list(COL, { limit: 500, mine:false });
  }

  async function saveMessage(msg){
    await FVData.ready();
    if (msg.id){
      await FVData.update(COL, msg.id, msg);
      return msg.id;
    }
    const saved = await FVData.add(COL, msg);
    return saved?.id;
  }

  async function deleteMessage(id){
    await FVData.ready();
    return await FVData.remove(COL, id);
  }

  async function deleteExpired(){
    const t = now();
    const all = await loadAll();
    const expired = all.filter(m => m.expiresAt && m.expiresAt <= t);
    for (const m of expired){
      try { await deleteMessage(m.id); } catch(e) {}
    }
  }

  async function deleteAll(){
    const all = await loadAll();
    for (const m of all){
      try { await deleteMessage(m.id); } catch(e) {}
    }
  }

  // ---------- Form handlers ----------
  function clearForm(){
    ui.title.value   = "";
    ui.author.value  = "";
    ui.body.value    = "";
    ui.expires.value = "";
    ui.pinned.checked = false;
    editingId = null;
    ui.saveBtn.textContent = "Save Message";
    setExpiresMin();
  }

  async function onSave(){
    const body = ui.body.value.trim();
    if (!body){
      alert("Message body is required.");
      return;
    }

    const expMs = ui.expires.value ? Date.parse(ui.expires.value) : null;
    if (expMs && expMs < Date.now() + 60000){
      alert("Expiry must be at least 1 minute in the future.");
      return;
    }

    const msg = {
      id: editingId || null,
      title: ui.title.value.trim(),
      body,
      pinned: ui.pinned.checked,
      authorName: ui.author.value.trim(),
      expiresAt: expMs || null
    };

    try {
      await saveMessage(msg);
      clearForm();
      await render();
      window.scrollTo({ top:0, behavior:"smooth" });
    } catch (e) {
      alert("Save failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  function editItem(m){
    editingId = m.id;
    ui.title.value   = m.title || "";
    ui.author.value  = m.authorName || "";
    ui.body.value    = m.body || "";
    ui.pinned.checked = !!m.pinned;
    ui.expires.value = m.expiresAt ? toLocalDatetimeValue(new Date(m.expiresAt)) : "";
    ui.saveBtn.textContent = "Update Message";
    setExpiresMin();
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  // ---------- Render ----------
  async function render(){
    const t = now();
    let raw = [];
    try {
      raw = await loadAll();
    } catch (e) {
      alert("Failed to load messages: " + (e && e.message ? e.message : String(e)));
      raw = [];
    }

    const list = raw.map(m => ({
      id: m.id,
      title: m.title || "",
      body: m.body || "",
      pinned: !!m.pinned,
      authorName: m.authorName || "",
      createdAt: (m.createdAt?.seconds ? m.createdAt.seconds*1000 : m.createdAt || t),
      expiresAt: toMs(m.expiresAt)
    }));

    list.sort((a,b)=> (b.pinned - a.pinned) || (b.createdAt - a.createdAt));

    const active = list.filter(m => !m.expiresAt || m.expiresAt > t);
    const expired = list.filter(m => m.expiresAt && m.expiresAt <= t);

    ui.counts.textContent = `${active.length} active · ${expired.length} expired`;

    ui.list.innerHTML = "";
    for (const m of list){
      const el = document.createElement("div");
      el.className = "item";

      const expiredBadge = m.expiresAt && m.expiresAt <= t
        ? `<span class="chip" style="background:#ffe9e9;border-color:#ffc7c7">Expired</span>`
        : ``;

      el.innerHTML = `
        <div class="item-header">
          <div><strong>${m.title || "(Untitled)"}</strong></div>
          <div class="chips">
            ${m.pinned ? `<span class="chip">Pinned</span>` : ""}
            ${m.expiresAt ? `<span class="chip">Expires ${fmtDateTime(m.expiresAt)}</span>` : `<span class="chip">No expiry</span>`}
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

      el.querySelector("[data-act='edit']").onclick = ()=> editItem(m);

      el.querySelector("[data-act='togglePin']").onclick = async ()=>{
        m.pinned = !m.pinned;
        try {
          await saveMessage(m);
          await render();
        } catch (e) {
          alert("Pin/unpin failed: " + (e && e.message ? e.message : String(e)));
        }
      };

      el.querySelector("[data-act='delete']").onclick = async ()=>{
        if (!confirm("Delete this message?")) return;
        try {
          await deleteMessage(m.id);
          await render();
        } catch (e) {
          alert("Delete failed: " + (e && e.message ? e.message : String(e)));
        }
      };

      ui.list.appendChild(el);
    }
  }

  // ---------- Init ----------
  (async function init(){
    try {
      await FVData.ready();
    } catch (e) {
      alert("FVData not ready: " + (e && e.message ? e.message : String(e)));
      return;
    }

    ui.saveBtn.onclick = onSave;
    ui.purgeExpiredBtn.onclick = async ()=>{
      try {
        await deleteExpired();
        await render();
      } catch (e) {
        alert("Remove expired failed: " + (e && e.message ? e.message : String(e)));
      }
    };
    ui.clearAllBtn.onclick = async ()=>{
      if (!confirm("Delete ALL messages?")) return;
      try {
        await deleteAll();
        await render();
      } catch (e) {
        alert("Clear all failed: " + (e && e.message ? e.message : String(e)));
      }
    };

    setExpiresMin();
    await render();
  })();
})();