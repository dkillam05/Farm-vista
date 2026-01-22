/* =====================================================================
/Farm-vista/js/shop-equipment-modal.js  (FULL FILE)
Rev: 2026-01-22a

Purpose:
  Pull the Shop Equipment popup logic OUT of the HTML page.

Works with the CURRENT Shop Equipment page markup you pasted:
  - Uses existing <dialog id="svcSheet"> + fields inside it
  - Adds buttons (Service Records + Edit) into the existing footer
  - Builds + injects a Service Records drilldown modal (hub-style: list -> detail)

How the page will use this later (NOT done in this step):
  - <script type="module" src="/Farm-vista/js/shop-equipment-modal.js"></script>
  - Replace openServiceSheet(eq) with: window.FVShopEquipModal.open(eq)

Notes:
  - Edit button opens an editor URL template (adjust later if needed).
  - Service records query tries multiple collections (same spirit as hub).
===================================================================== */

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit
} from "/Farm-vista/js/firebase-init.js";

(function(){
  const $ = (sel) => document.querySelector(sel);

  const UI = {
    svcSheet: null,
    svcTitle: null,
    svcMeta: null,
    lifetimeNotes: null,
    btnSaveNotes: null,
    svcFooter: null,
    toast: null,
    alertBox: null,
    btnClose1: null,
    btnClose2: null,

    // injected
    btnSvcRecords: null,
    btnEdit: null,
    srSheet: null
  };

  const state = {
    eq: null,
    srRows: [],
    srSelectedId: null,
    srMode: "list", // list | detail
    editUrlTemplate: "/Farm-vista/pages/equipment/actions/edit.html?type={type}&id={id}"
  };

  // ---------- helpers ----------
  const norm = (v) => (v||"").toString().trim().toLowerCase();

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function showToast(msg="Saved."){
    if(!UI.toast) return;
    UI.toast.textContent = msg;
    UI.toast.classList.remove("show");
    void UI.toast.offsetWidth;
    UI.toast.classList.add("show");
  }

  function showError(msg){
    if(!UI.alertBox){
      console.error(msg);
      return;
    }
    UI.alertBox.textContent = msg;
    UI.alertBox.classList.add("show");
    clearTimeout(showError._t);
    showError._t = setTimeout(()=> UI.alertBox.classList.remove("show"), 8000);
  }

  function openSheet(dlg){
    if(!dlg) return;
    try{ dlg.showModal(); }catch{ dlg.setAttribute("open",""); }
  }
  function closeSheet(dlg){
    if(!dlg) return;
    try{ dlg.close(); }catch{ dlg.removeAttribute("open"); }
  }

  function todayISO(){
    const d=new Date(); const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,"0");
    const da=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
  }

  function toDateMaybe(ts){
    if(!ts) return null;
    try{
      if(ts.toDate) return ts.toDate();
      if(typeof ts === "object" && typeof ts.seconds === "number"){
        const d = new Date(ts.seconds * 1000);
        return Number.isFinite(d.getTime()) ? d : null;
      }
      if(typeof ts === "string" || typeof ts === "number"){
        const d = new Date(ts);
        return Number.isFinite(d.getTime()) ? d : null;
      }
    }catch(_){}
    return null;
  }

  function formatDateTime(d){
    if(!d) return "—";
    try{ return d.toLocaleString(); }catch{ return "—"; }
  }

  function statusLabel(st){
    const s = norm(st);
    if(!s) return "—";
    if(s === "open") return "Open";
    if(s === "pending") return "Pending";
    if(s === "in progress" || s === "in-progress" || s === "in_progress") return "In progress";
    if(s === "completed" || s === "complete") return "Completed";
    return st;
  }

  function bestRecordDate(r){
    return (
      toDateMaybe(r?.completedAt) ||
      toDateMaybe(r?.updatedAt) ||
      toDateMaybe(r?.createdAt) ||
      toDateMaybe(r?.date) ||
      null
    );
  }

  function pickTitle(r){
    return (
      String(r?.title||"").trim() ||
      String(r?.summary||"").trim() ||
      String(r?.problem||"").trim() ||
      String(r?.issue||"").trim() ||
      "Service Record"
    );
  }

  function pickNotes(r){
    return (
      String(r?.summaryNotes||"").trim() ||
      String(r?.notes||"").trim() ||
      String(r?.description||"").trim() ||
      String(r?.details||"").trim() ||
      ""
    );
  }

  function detectShopCategory(eq){
    // mirror Shop Equipment page logic (best-effort)
    const t = norm(eq?.type);
    const it = norm(eq?.implementType);

    if(t === "tractor") return "tractors";
    if(t === "combine") return "combines";
    if(t === "sprayer") return "sprayers";
    if(t === "truck") return "trucks";
    if(t === "starfire") return "starfire";

    if(t === "implement"){
      // editor page likely uses implements bucket
      return "implements";
    }

    // fallback
    return "equipment";
  }

  function buildEditUrl(eq){
    const type = detectShopCategory(eq);
    const id = eq?.id || "";
    return state.editUrlTemplate
      .replaceAll("{type}", encodeURIComponent(type))
      .replaceAll("{id}", encodeURIComponent(id));
  }

  // ---------- inject buttons into existing svcSheet footer ----------
  function ensureSvcFooterButtons(){
    if(!UI.svcFooter) return;

    // If already injected, skip
    if(UI.svcFooter.querySelector("[data-fv='svcRecordsBtn']")) return;

    // Keep existing close button(s) intact; we add buttons to the LEFT.
    const leftWrap = document.createElement("div");
    leftWrap.style.display = "flex";
    leftWrap.style.gap = "8px";
    leftWrap.style.flexWrap = "wrap";
    leftWrap.style.alignItems = "center";

    const btnSvcRecords = document.createElement("button");
    btnSvcRecords.type = "button";
    btnSvcRecords.className = "btn";
    btnSvcRecords.textContent = "Service Records";
    btnSvcRecords.setAttribute("data-fv","svcRecordsBtn");

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.className = "btn";
    btnEdit.textContent = "Edit";
    btnEdit.setAttribute("data-fv","editBtn");

    btnSvcRecords.addEventListener("click", async ()=>{
      if(!state.eq) return;
      try{
        await openServiceRecordsModal(state.eq);
      }catch(e){
        console.error(e);
        showError(e?.message || "Failed to load service records.");
      }
    });

    btnEdit.addEventListener("click", ()=>{
      if(!state.eq) return;
      const url = buildEditUrl(state.eq);
      // open editor in new tab so it behaves like the rest of the app
      window.open(url, "_blank", "noopener");
    });

    leftWrap.appendChild(btnSvcRecords);
    leftWrap.appendChild(btnEdit);

    // Put at start of footer
    UI.svcFooter.insertBefore(leftWrap, UI.svcFooter.firstChild);

    UI.btnSvcRecords = btnSvcRecords;
    UI.btnEdit = btnEdit;
  }

  // ---------- Service Records Modal (injected) ----------
  function ensureSrSheet(){
    if(UI.srSheet) return UI.srSheet;

    const dlg = document.createElement("dialog");
    dlg.id = "srSheet";
    dlg.className = "sheet";
    dlg.setAttribute("aria-modal","true");

    dlg.innerHTML = `
      <header>
        <strong id="srSheetTitle">Service Records</strong>
        <button id="srSheetClose" class="btn" type="button">Close</button>
      </header>

      <div class="body" style="gap:12px;">
        <div id="srBanner" class="muted" style="display:none;"></div>

        <!-- LIST VIEW -->
        <div id="srListView">
          <div class="subcard">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
              <strong>Records</strong>
              <span class="muted" id="srCount">—</span>
            </div>
            <div id="srList" style="display:grid;gap:10px;"></div>
          </div>
        </div>

        <!-- DETAIL VIEW -->
        <div id="srDetailView" style="display:none;">
          <div class="subcard">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
              <button id="srBack" class="btn" type="button">← Back</button>
              <span class="muted" id="srDetailStatus">—</span>
            </div>
            <div style="display:grid;gap:8px;">
              <div style="font-weight:950;" id="srDetailTitle">—</div>
              <div class="muted" id="srDetailWhen">—</div>
            </div>
          </div>

          <div class="subcard" id="srDetailNotesBlock" style="display:none;">
            <strong>Notes</strong>
            <div id="srDetailNotes" style="white-space:pre-wrap;line-height:1.35;"></div>
          </div>

          <div class="subcard" id="srDetailLineItemsBlock" style="display:none;">
            <strong>Line Items</strong>
            <div id="srDetailLineItems" style="display:grid;gap:10px;"></div>
          </div>
        </div>
      </div>

      <footer>
        <button id="srSheetClose2" class="btn" type="button">Close</button>
      </footer>
    `;

    document.body.appendChild(dlg);

    const closeBtn = dlg.querySelector("#srSheetClose");
    const closeBtn2 = dlg.querySelector("#srSheetClose2");
    const backBtn = dlg.querySelector("#srBack");

    closeBtn.addEventListener("click", ()=> closeSheet(dlg));
    closeBtn2.addEventListener("click", ()=> closeSheet(dlg));
    backBtn.addEventListener("click", ()=> srShowList());

    dlg.addEventListener("close", ()=>{
      // reset view when closed
      srShowList(true);
    });

    UI.srSheet = dlg;
    return dlg;
  }

  function srBanner(msg){
    const el = UI.srSheet?.querySelector("#srBanner");
    if(!el) return;
    if(!msg){
      el.style.display = "none";
      el.textContent = "";
      return;
    }
    el.style.display = "block";
    el.textContent = msg;
  }

  function srShowList(reset=false){
    const dlg = UI.srSheet;
    if(!dlg) return;
    dlg.querySelector("#srListView").style.display = "block";
    dlg.querySelector("#srDetailView").style.display = "none";
    state.srMode = "list";
    if(reset){
      state.srSelectedId = null;
    }
  }

  function srShowDetail(){
    const dlg = UI.srSheet;
    if(!dlg) return;
    dlg.querySelector("#srListView").style.display = "none";
    dlg.querySelector("#srDetailView").style.display = "block";
    state.srMode = "detail";
    const body = dlg.querySelector(".body");
    if(body) body.scrollTop = 0;
  }

  function srRenderList(){
    const dlg = UI.srSheet;
    if(!dlg) return;

    const list = dlg.querySelector("#srList");
    const count = dlg.querySelector("#srCount");
    list.innerHTML = "";

    count.textContent = state.srRows.length ? `${state.srRows.length} record(s)` : "No records";

    if(!state.srRows.length){
      list.innerHTML = `<div class="muted">No service records found for this equipment.</div>`;
      return;
    }

    state.srRows.forEach(row=>{
      const r = row.data || {};
      const when = bestRecordDate(r);
      const title = pickTitle(r);
      const notes = pickNotes(r);
      const st = statusLabel(r.status);

      const li = Array.isArray(r.lineItems) ? r.lineItems : [];
      const openCount = li.filter(x => !x?.completed).length;
      const tag2 = li.length ? `${li.length} items (${openCount} open)` : "";

      const card = document.createElement("div");
      card.className = "subcard";
      card.style.cursor = "pointer";
      card.style.userSelect = "none";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;">
          <div style="min-width:0;flex:1 1 auto;">
            <div style="font-weight:950;line-height:1.15;">${escapeHtml(title)}</div>
            <div class="muted" style="margin-top:2px;">${escapeHtml(when ? formatDateTime(when) : "—")}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${st && st!=="—" ? `<span class="muted" style="border:1px solid var(--border);border-radius:999px;padding:5px 10px;font-weight:850;">${escapeHtml(st)}</span>` : ``}
            ${tag2 ? `<span class="muted" style="border:1px solid var(--border);border-radius:999px;padding:5px 10px;font-weight:850;">${escapeHtml(tag2)}</span>` : ``}
          </div>
        </div>
        ${notes ? `<div style="white-space:pre-wrap;line-height:1.35;">${escapeHtml(notes)}</div>` : ``}
      `;

      card.addEventListener("click", ()=> srOpenDetail(row.id));
      list.appendChild(card);
    });
  }

  function srOpenDetail(rowId){
    const dlg = UI.srSheet;
    if(!dlg) return;

    const row = state.srRows.find(x => x.id === rowId);
    if(!row) return;

    state.srSelectedId = rowId;

    const r = row.data || {};
    const when = bestRecordDate(r);
    const title = pickTitle(r);
    const notes = pickNotes(r);
    const st = statusLabel(r.status);

    dlg.querySelector("#srDetailTitle").textContent = title || "Service Record";
    dlg.querySelector("#srDetailWhen").textContent = when ? formatDateTime(when) : "—";
    dlg.querySelector("#srDetailStatus").textContent = st || "—";

    const notesBlock = dlg.querySelector("#srDetailNotesBlock");
    const notesEl = dlg.querySelector("#srDetailNotes");
    if(notes){
      notesEl.textContent = notes;
      notesBlock.style.display = "grid";
      notesBlock.style.gap = "8px";
    }else{
      notesEl.textContent = "";
      notesBlock.style.display = "none";
    }

    const liBlock = dlg.querySelector("#srDetailLineItemsBlock");
    const liHost = dlg.querySelector("#srDetailLineItems");
    const lineItems = Array.isArray(r.lineItems) ? r.lineItems : [];

    liHost.innerHTML = "";
    if(!lineItems.length){
      liBlock.style.display = "none";
    }else{
      liBlock.style.display = "grid";
      liBlock.style.gap = "10px";

      // collapsed by default; tap to expand
      lineItems.forEach((li, idx)=>{
        const isDone = !!li.completed;
        const topic = (li.serviceTopicOther ? String(li.serviceTopicOther) : (li.serviceTopic ? String(li.serviceTopic) : "")) || li.label || li.title || `Item ${idx+1}`;
        const parts = li.partsNeeded || li.parts || "";
        const itemNotes = li.notes || li.details || "";

        const submittedBy = li.submittedByName || li.submittedByEmployeeName || "—";
        const completedBy = li.completedByEmployeeName || li.completedByEmployeeId || "—";
        const doneAt = li.completedAt ? formatDateTime(toDateMaybe(li.completedAt)) : "—";

        const el = document.createElement("div");
        el.className = "subcard";
        el.style.cursor = "pointer";
        el.dataset.open = "0";
        el.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div style="font-weight:950;min-width:0;flex:1 1 auto;">
              <span style="opacity:.85;">▾</span> ${escapeHtml(String(topic))}
            </div>
            <div class="muted" style="border:1px solid var(--border);border-radius:999px;padding:5px 10px;font-weight:850;">
              ${escapeHtml(isDone ? "Completed" : "Open")}
            </div>
          </div>

          <div class="sr-li-body" style="display:none; margin-top:8px; gap:10px;">
            <div style="display:grid;gap:8px;">
              <div class="muted"><b>Submitted by:</b> ${escapeHtml(String(submittedBy))}</div>
              <div class="muted"><b>Completed by:</b> ${escapeHtml(String(completedBy))}</div>
              <div class="muted"><b>Completed at:</b> ${escapeHtml(String(doneAt))}</div>
              ${parts ? `<div class="muted"><b>Parts:</b> ${escapeHtml(String(parts))}</div>` : ``}
              ${itemNotes ? `<div style="white-space:pre-wrap;line-height:1.35;"><b class="muted">Notes:</b>\n${escapeHtml(String(itemNotes))}</div>` : ``}
            </div>
          </div>
        `;

        el.addEventListener("click", ()=>{
          const open = (el.dataset.open === "1");
          el.dataset.open = open ? "0" : "1";
          const body = el.querySelector(".sr-li-body");
          body.style.display = open ? "none" : "grid";

          // swap chevron
          const head = el.querySelector("div[style*='opacity:.85']");
          if(head) head.textContent = open ? "▾" : "▴";
        });

        liHost.appendChild(el);
      });
    }

    srShowDetail();
  }

  async function loadServiceRecords(eqId){
    const db = getFirestore();
    const candidates = ["equipmentWorkOrders","equipment_work_orders","equipment_service_records"];
    const rows = [];

    for(const colName of candidates){
      try{
        // try ordered query first
        try{
          const qy = query(
            collection(db, colName),
            where("equipmentId", "==", eqId),
            orderBy("createdAt", "desc"),
            limit(250)
          );
          const snap = await getDocs(qy);
          if(!snap.empty){
            snap.forEach(d => rows.push({ id: d.id, data: d.data(), _col: colName }));
            return rows;
          }
        }catch(orderErr){
          // fallback no orderBy
          const qy2 = query(
            collection(db, colName),
            where("equipmentId", "==", eqId),
            limit(250)
          );
          const snap2 = await getDocs(qy2);
          if(!snap2.empty){
            snap2.forEach(d => rows.push({ id: d.id, data: d.data(), _col: colName }));
            return rows;
          }
        }
      }catch(e){
        // keep trying other collections
        console.warn("[shop-equip-modal] SR query failed:", colName, e?.code || e);
      }
    }
    return rows; // empty
  }

  async function openServiceRecordsModal(eq){
    ensureSrSheet();

    const titleEl = UI.srSheet.querySelector("#srSheetTitle");
    const label = (eq?.unitId ? `${eq.unitId} • ` : "") + (eq?.name || "Equipment");
    titleEl.textContent = `Service Records • ${label}`;

    srBanner("Loading…");
    srShowList(true);
    openSheet(UI.srSheet);

    const rows = await loadServiceRecords(eq.id);

    // sort newest first
    rows.sort((a,b)=>{
      const da = bestRecordDate(a.data);
      const dbb = bestRecordDate(b.data);
      const ta = da ? da.getTime() : 0;
      const tb = dbb ? dbb.getTime() : 0;
      return tb - ta;
    });

    state.srRows = rows;
    srBanner("");
    srRenderList();
  }

  // ---------- main popup open (existing svcSheet) ----------
  async function open(eq){
    bootstrap(); // ensure DOM wired
    state.eq = eq || null;
    if(!eq) return;

    ensureSvcFooterButtons();

    // keep EXACT existing meta build from the page
    const unitIdLine = eq.unitId ? `Unit ID ${eq.unitId}` : "Unit ID —";
    UI.svcTitle.textContent = eq.unitId ? `${eq.unitId} • ${eq.name || "Equipment"}` : (eq.name || "Equipment");

    // category label should match current page behavior
    const cat = (function(){
      const t = norm(eq.type);
      const it = norm(eq.implementType);
      if(t === "starfire") return "StarFire";
      if(t === "tractor") return "Tractor";
      if(t === "truck") return "Truck";
      if(t === "sprayer") return "Sprayer";
      if(t === "combine") return "Combine";
      if(t === "implement"){
        if(it === "planter") return "Planter";
        if(it.includes("grain") || it.includes("cart") || it.includes("auger") || it.includes("bin")) return "Grain";
        if(it.includes("tillage")) return "Tillage";
        if(it.includes("drill") || it.includes("seeder")) return "Seeder/Drill";
        return "Implement";
      }
      return "Equipment";
    })();

    UI.svcMeta.textContent = [
      unitIdLine,
      cat,
      eq.year ? `Year ${eq.year}` : "",
      eq.serial ? `Serial ${eq.serial}` : "",
      eq.placedInServiceDate ? `In Service ${eq.placedInServiceDate}` : ""
    ].filter(Boolean).join(" • ");

    UI.lifetimeNotes.value = eq.lifetimeNotes || "";

    openSheet(UI.svcSheet);
  }

  async function saveNotes(){
    if(!state.eq) return;
    try{
      const db = getFirestore();
      const txt = (UI.lifetimeNotes.value || "").trim();
      await updateDoc(doc(db, "equipment", state.eq.id), { lifetimeNotes: txt, updatedAt: serverTimestampLike() });
      state.eq.lifetimeNotes = txt;
      showToast("Notes saved.");
    }catch(e){
      console.error(e);
      showError(e?.message || "Save notes failed.");
    }
  }

  // serverTimestamp is not always imported in some pages; keep safe.
  function serverTimestampLike(){
    // If firebase-init exports serverTimestamp in other pages, we could import it,
    // but we are keeping this JS file minimal. UpdatedAt is optional.
    return new Date();
  }

  // ---------- wiring / bootstrap ----------
  function bootstrap(){
    // Only run once
    if(UI.svcSheet) return;

    UI.svcSheet = $("#svcSheet");
    UI.svcTitle = $("#svcTitle");
    UI.svcMeta = $("#svcMeta");
    UI.lifetimeNotes = $("#lifetimeNotes");
    UI.btnSaveNotes = $("#btnSaveNotes");
    UI.svcFooter = UI.svcSheet ? UI.svcSheet.querySelector("footer") : null;

    UI.toast = $("#toast");
    UI.alertBox = $("#alert");

    UI.btnClose1 = $("#svcClose");
    UI.btnClose2 = $("#svcClose2");

    if(UI.btnSaveNotes){
      // avoid double-binding if page already had it
      UI.btnSaveNotes.removeEventListener("click", saveNotes);
      UI.btnSaveNotes.addEventListener("click", saveNotes);
    }

    if(UI.btnClose1){
      UI.btnClose1.addEventListener("click", ()=> closeSheet(UI.svcSheet));
    }
    if(UI.btnClose2){
      UI.btnClose2.addEventListener("click", ()=> closeSheet(UI.svcSheet));
    }
  }

  // expose public API
  window.FVShopEquipModal = {
    open,
    openServiceRecords: async (eq)=> openServiceRecordsModal(eq),
    setEditUrlTemplate: (tpl)=>{ state.editUrlTemplate = String(tpl||"").trim() || state.editUrlTemplate; }
  };

  // If the page loads this file, bootstrap now (safe).
  // Does not change page behavior until window.FVShopEquipModal.open(eq) is called.
  try{ bootstrap(); }catch(e){ console.warn("[shop-equip-modal] bootstrap failed", e); }
})();
