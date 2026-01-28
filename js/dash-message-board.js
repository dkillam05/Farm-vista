// /Farm-vista/js/dash-message-board.js
// Rev: 2026-01-27-dash-message-board-v1
//
// Message Board loader (Firestore via FVData, with localStorage fallback).
// Extracted from your dashboard inline script.

(function(){
  "use strict";

  const COL = "messageBoard";
  const FALLBACK_KEYS = [
    "df_message_board_fallback",
    "df_message_board",
    "fv_message_board_v1"
  ];

  function $(id){ return document.getElementById(id); }

  const box = $("board");
  if (!box) return;

  const toMs = (v)=>{
    if (v == null || v === "") return null;
    if (typeof v === "number") return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };

  const tsToMs = (t)=>{
    if (t && typeof t === "object" && typeof t.seconds === "number") return t.seconds * 1000;
    if (typeof t === "number") return t;
    return null;
  };

  const fmtDate = (ms)=>{
    try{
      return new Date(ms).toLocaleString(undefined, {
        month:"short", day:"numeric", hour:"numeric", minute:"2-digit"
      });
    }catch{ return ""; }
  };

  async function loadFromFirestore(){
    if (!window.FVData || typeof FVData.list !== "function") return null;

    try{
      await FVData.ready();
      const arr = await FVData.list(COL, { limit: 200, mine: false });

      return Array.isArray(arr) ? arr.map(d => ({
        id: d.id,
        title: (d.title||"").toString(),
        body: (d.body||"").toString(),
        pinned: !!d.pinned,
        authorName: (d.authorName||"").toString(),
        createdAt: tsToMs(d.createdAt) || Date.now(),
        expiresAt: toMs(d.expiresAt)
      })) : [];
    }catch(e){
      console.warn("[dash-message-board] Firestore read failed, falling back:", e);
      return null;
    }
  }

  function loadFromLocal(){
    for (const k of FALLBACK_KEYS){
      try{
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const arr = JSON.parse(raw);

        if (Array.isArray(arr) && arr.length){
          return arr.map(m => ({
            id: m.id || String(Math.random()),
            title: (m.title||"").toString(),
            body: (m.body || m.text || "").toString(),
            pinned: !!m.pinned,
            authorName: (m.authorName||"").toString(),
            createdAt: toMs(m.createdAt) || Date.now(),
            expiresAt: toMs(m.expiresAt)
          }));
        }
      }catch{}
    }
    return [];
  }

  function render(list){
    const now = Date.now();
    const active = (list||[]).filter(m => !m.expiresAt || m.expiresAt > now);

    active.sort((a,b)=> (b.pinned - a.pinned) || ((b.createdAt||0) - (a.createdAt||0)));

    if (!active.length){
      box.innerHTML = '<div class="msg empty">No messages at this time.</div>';
      return;
    }

    box.innerHTML = "";
    active.forEach(m=>{
      const el = document.createElement("div");
      el.className = "msg";
      el.innerHTML = `
        ${m.title ? `<div class="title">${m.title}</div>` : ``}
        <div class="body" style="white-space:pre-wrap">${m.body}</div>
        <div class="chips">
          ${m.authorName ? `<span class="chip">Post By: ${m.authorName}</span>` : ``}
          ${m.createdAt ? `<span class="chip">Date Posted: ${fmtDate(m.createdAt)}</span>` : ``}
        </div>
      `;
      box.appendChild(el);
    });
  }

  async function refresh(){
    const fs = await loadFromFirestore();
    if (fs) { render(fs); return; }
    render(loadFromLocal());
  }

  // Kickoff
  refresh();

  document.addEventListener("visibilitychange", ()=>{
    if (document.visibilityState === "visible") refresh();
  });

})();