/* =====================================================================
/Farm-vista/js/shop-equipment-modal.js  (FULL FILE)
Rev: 2026-01-22d
Fixes:
✅ Edit modal now hydrates Extras controllers (implementType / constructionType) so Planter options show automatically
✅ Removed Archive + Delete buttons from Edit modal (safety)
✅ Status select styling fixed (centered / readable)

Keeps:
- Lifetime Notes popup (svcSheet) + Save Notes
- Service Records modal (list -> detail)
- Edit modal (in-page) with Make/Model dd, Year combo, Unit ID, Serial, Status, Notes, Extras engine
===================================================================== */

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
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

    btnSvcRecords: null,
    btnEdit: null,

    srSheet: null,
    editSheet: null
  };

  const state = {
    eq: null,

    // service records
    srRows: [],
    srSelectedId: null,
    srMode: "list",

    // editor caches
    makes: [],
    models: [],
    makesLoaded: false,
    modelsLoaded: false,

    // editor state
    editEqId: null,
    editEqDoc: null,
    editExtras: null,
    editTypeKey: "equipment"
  };

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

  function detectTypeKeyFromEq(eq){
    const t = norm(eq?.type);
    if(!t) return "equipment";
    // normalize plural -> singular
    if(t === "tractors") return "tractor";
    if(t === "combines") return "combine";
    if(t === "sprayers") return "sprayer";
    if(t === "trucks") return "truck";
    if(t === "implements") return "implement";
    if(t === "trailers") return "trailer";
    return t;
  }

  function safeUnitId(eq){
    const v = (eq && (eq.unitId ?? eq?.extras?.unitId)) ?? "";
    return String(v || "").trim();
  }

  function last6(v){ return String(v||"").slice(-6); }

  // ----- extras hydration helpers (copied concept from your Edit Tractors page) -----
  function boolify(v){
    if (v === true || v === false) return v;
    if (v == null) return false;
    if (typeof v === 'number') return v !== 0;

    const s = String(v).trim().toLowerCase();
    if (s === '') return false;
    if (['true','t','yes','y','1','on'].includes(s)) return true;
    if (['false','f','no','n','0','off'].includes(s)) return false;
    return true;
  }

  function findExtraEl(fieldId){
    const dlg = UI.editSheet;
    if(!dlg) return null;

    let el = dlg.querySelector("#extra-" + fieldId);
    if(el) return el;

    el = dlg.querySelector(`[data-extra-id="${fieldId}"]`)
      || dlg.querySelector(`[name="${fieldId}"]`)
      || dlg.querySelector(`[data-field="${fieldId}"]`);
    return el || null;
  }

  function setExtraValue(fieldId, value){
    const el = findExtraEl(fieldId);
    if(!el) return false;

    // pill toggle button
    if (el.tagName === "BUTTON" && el.classList.contains("pill-toggle")){
      const isOn = boolify(value);
      el.dataset.state = isOn ? "on" : "off";
      el.classList.toggle("on", isOn);
      el.textContent = isOn ? "Yes" : "No";
      return true;
    }

    // checkbox/switch
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")){
      el.checked = boolify(value);
      el.dispatchEvent(new Event("change", { bubbles:true }));
      el.dispatchEvent(new Event("input", { bubbles:true }));
      return true;
    }

    // inputs/selects/textarea
    try{
      el.value = (value === undefined || value === null) ? "" : String(value);
      el.dispatchEvent(new Event("change", { bubbles:true }));
      el.dispatchEvent(new Event("input", { bubbles:true }));
      return true;
    }catch{
      return false;
    }
  }

  function readAny(d, keys){
    for (const k of keys){
      if (d && Object.prototype.hasOwnProperty.call(d, k) && d[k] != null && String(d[k]).trim() !== ""){
        return d[k];
      }
    }
    return null;
  }

  function hydrateExtrasFromDoc(d){
    // Force controller fields first (this is the missing piece causing Planter not to show)
    if (state.editTypeKey === "implement"){
      const impType = readAny(d, ['implementType','implement_type','subType','subtype','implementSubtype','implement_subtype']);
      if (impType){
        setExtraValue("implementType", impType);
        const ctrl = findExtraEl("implementType");
        if (ctrl) ctrl.dispatchEvent(new Event("change", { bubbles:true }));
      }
    }

    if (state.editTypeKey === "construction"){
      const conType = readAny(d, ['constructionType','construction_type','subType','subtype']);
      if (conType){
        setExtraValue("constructionType", conType);
        const ctrl = findExtraEl("constructionType");
        if (ctrl) ctrl.dispatchEvent(new Event("change", { bubbles:true }));
      }
    }

    // Then fill common extras keys
    const keys = [
      "unitId",
      "engineHours","separatorHours","odometerMiles","boomWidthFt","tankSizeGal","starfireCapable",
      "workingWidthFt","numRows","rowSpacingIn","totalAcres","totalHours","bushelCapacityBu","augerDiameterIn","augerLengthFt",
      "applicationType",
      "licensePlate","licensePlateExp","insuranceExp","tireSizes","dotRequired","dotExpiration",
      "trailerType","trailerPlate","trailerPlateExp","trailerDotRequired","lastDotInspection","gvwrLb",
      "attachmentType",
      "activationLevel","firmwareVersion"
    ];

    const triesMax = 8;
    let tries = 0;

    const apply = ()=>{
      let anySet = false;

      // unitId: prefer root unitId
      if (d && (d.unitId || d?.extras?.unitId)){
        anySet = setExtraValue("unitId", d.unitId || d?.extras?.unitId) || anySet;
      }

      keys.forEach(k=>{
        if(!d || !Object.prototype.hasOwnProperty.call(d, k)) return;
        if(k === "starfireCapable") anySet = setExtraValue(k, boolify(d[k])) || anySet;
        else anySet = setExtraValue(k, d[k]) || anySet;
      });

      // retry a few frames in case equipment-forms renders late
      if(!anySet && tries < triesMax){
        tries++;
        requestAnimationFrame(apply);
      }
    };

    requestAnimationFrame(apply);
  }

  // ---------- bootstrap ----------
  function bootstrap(){
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
      UI.btnSaveNotes.addEventListener("click", saveNotes);
    }
    if(UI.btnClose1){
      UI.btnClose1.addEventListener("click", ()=> closeSheet(UI.svcSheet));
    }
    if(UI.btnClose2){
      UI.btnClose2.addEventListener("click", ()=> closeSheet(UI.svcSheet));
    }
  }

  // ---------- inject buttons into svcSheet footer ----------
  function ensureSvcFooterButtons(){
    if(!UI.svcFooter) return;
    if(UI.svcFooter.querySelector("[data-fv='svcRecordsBtn']")) return;

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
      try{ await openServiceRecordsModal(state.eq); }
      catch(e){ console.error(e); showError(e?.message || "Failed to load service records."); }
    });

    btnEdit.addEventListener("click", async ()=>{
      if(!state.eq) return;
      try{ await openEditModal(state.eq.id); }
      catch(e){ console.error(e); showError(e?.message || "Failed to open editor."); }
    });

    leftWrap.appendChild(btnSvcRecords);
    leftWrap.appendChild(btnEdit);
    UI.svcFooter.insertBefore(leftWrap, UI.svcFooter.firstChild);

    UI.btnSvcRecords = btnSvcRecords;
    UI.btnEdit = btnEdit;
  }

  // ===================================================================
  //  SERVICE RECORDS MODAL
  // ===================================================================
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

        <div id="srListView">
          <div class="subcard">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
              <strong>Records</strong>
              <span class="muted" id="srCount">—</span>
            </div>
            <div id="srList" style="display:grid;gap:10px;"></div>
          </div>
        </div>

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

    dlg.querySelector("#srSheetClose").addEventListener("click", ()=> closeSheet(dlg));
    dlg.querySelector("#srSheetClose2").addEventListener("click", ()=> closeSheet(dlg));
    dlg.querySelector("#srBack").addEventListener("click", ()=> srShowList());
    dlg.addEventListener("close", ()=> srShowList(true));

    UI.srSheet = dlg;
    return dlg;
  }

  function srBanner(msg){
    const el = UI.srSheet?.querySelector("#srBanner");
    if(!el) return;
    if(!msg){ el.style.display="none"; el.textContent=""; return; }
    el.style.display="block";
    el.textContent = msg;
  }

  function srShowList(reset=false){
    const dlg = UI.srSheet;
    if(!dlg) return;
    dlg.querySelector("#srListView").style.display = "block";
    dlg.querySelector("#srDetailView").style.display = "none";
    state.srMode = "list";
    if(reset) state.srSelectedId = null;
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
              <span class="sr-chev" style="opacity:.85;">▾</span> ${escapeHtml(String(topic))}
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
          const chev = el.querySelector(".sr-chev");
          if(chev) chev.textContent = open ? "▾" : "▴";
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
        }catch(_orderErr){
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
        console.warn("[shop-equip-modal] SR query failed:", colName, e?.code || e);
      }
    }
    return rows;
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

  // ===================================================================
  //  EDIT MODAL
  // ===================================================================
  function ensureEditSheet(){
    if(UI.editSheet) return UI.editSheet;

    injectEditModalStyles();

    const dlg = document.createElement("dialog");
    dlg.id = "shopEquipEdit";
    dlg.className = "sheet fv-edit-sheet";
    dlg.setAttribute("aria-modal","true");

    dlg.innerHTML = `
      <header>
        <strong id="seTitle">Edit Equipment</strong>
        <button id="seClose" class="btn" type="button">Close</button>
      </header>

      <div class="body">
        <div class="fv-kv">
          <div>
            <label>Make</label>
            <input type="hidden" id="seMakeId"/>
            <div class="fv-dd" id="seDdMake">
              <button type="button" id="seMakeBtn" class="fv-dd-btn">— Loading… —</button>
              <div class="fv-dd-list">
                <input type="text" id="seMakeSearch" placeholder="Search make…">
                <ul id="seMakeList"></ul>
              </div>
            </div>
          </div>

          <div>
            <label>Model</label>
            <input type="hidden" id="seModelId"/>
            <div class="fv-dd" id="seDdModel">
              <button type="button" id="seModelBtn" class="fv-dd-btn" disabled>— Select a Make first —</button>
              <div class="fv-dd-list">
                <input type="text" id="seModelSearch" placeholder="Search model…" disabled>
                <ul id="seModelList"></ul>
              </div>
            </div>
            <div class="fv-tip">Models filter by the selected make.</div>
          </div>

          <div>
            <label for="seYear">Year</label>
            <div class="fv-combo" id="seYearCombo">
              <button type="button" id="seYearTrigger" class="fv-combo-trigger" aria-haspopup="listbox" aria-expanded="false">— Select —</button>
              <div id="seYearPanel" class="fv-combo-panel fv-hidden" role="listbox" aria-label="Year"></div>
              <select id="seYear" aria-hidden="true" style="display:none"></select>
            </div>
          </div>

          <div>
            <label for="seUnitId">Unit ID</label>
            <input id="seUnitId" class="fv-input" placeholder="Optional unit ID"/>
            <div class="fv-tip">This is the Unit ID shown in the grid.</div>
          </div>

          <div>
            <label for="seSerial">Serial (full)</label>
            <input id="seSerial" class="fv-input" placeholder="Full serial"/>
            <div class="fv-tip">Last 6: <strong id="seSerial6">—</strong></div>
          </div>

          <div>
            <label for="seStatus">Status</label>
            <select id="seStatus" class="fv-select">
              <option value="Active">Active</option>
              <option value="Archived">Archived</option>
              <option value="Out of Service">Out of Service</option>
            </select>
          </div>

          <div id="seExtras" class="fv-extras" aria-label="Equipment extra fields"></div>

          <div style="grid-column:1/-1">
            <label for="seNotes">Notes</label>
            <textarea id="seNotes" class="fv-textarea" placeholder="Notes (replaces equipment notes field)"></textarea>
          </div>
        </div>
      </div>

      <footer>
        <button id="seSave" class="btn btn-primary" type="button">Save Changes</button>
      </footer>
    `;

    document.body.appendChild(dlg);
    UI.editSheet = dlg;

    dlg.querySelector("#seClose").addEventListener("click", ()=> closeSheet(dlg));
    dlg.addEventListener("close", ()=>{
      document.querySelectorAll(".fv-dd").forEach(x=>x.classList.remove("open"));
      state.editEqId = null;
      state.editEqDoc = null;
      state.editExtras = null;
    });

    wireDd(dlg.querySelector("#seDdMake"));
    wireDd(dlg.querySelector("#seDdModel"));
    wireDdGlobalClose();
    wireYearCombo();

    dlg.querySelector("#seSave").addEventListener("click", saveEditModal);
    dlg.querySelector("#seSerial").addEventListener("input", ()=>{
      dlg.querySelector("#seSerial6").textContent = last6(dlg.querySelector("#seSerial").value || "");
    });

    return dlg;
  }

  function injectEditModalStyles(){
    if(document.getElementById("fv-edit-modal-styles")) return;

    const st = document.createElement("style");
    st.id = "fv-edit-modal-styles";
    st.textContent = `
      .fv-edit-sheet{ width:min(760px, 92vw); }
      .fv-kv{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      @media(max-width:700px){ .fv-kv{ grid-template-columns:1fr } }

      .fv-input{
        width:100%; font:inherit; color:inherit;
        background:var(--card-surface,var(--surface));
        border:1px solid var(--border);
        border-radius:10px;
        padding:12px;
        height:48px; line-height:46px;
        outline:none;
      }
      .fv-select{
        width:100%;
        font:inherit;
        color:var(--text);
        background:var(--card-surface,var(--surface));
        border:1px solid var(--border);
        border-radius:10px;
        padding:10px 12px;
        height:48px;
        line-height:48px;
        appearance:auto;
        -webkit-appearance:menulist;
        outline:none;
      }
      .fv-textarea{
        width:100%; font:inherit; color:inherit;
        background:var(--card-surface,var(--surface));
        border:1px solid var(--border);
        border-radius:10px;
        padding:12px;
        min-height:110px;
        resize:vertical;
        outline:none;
      }
      .fv-tip{ font-size:12px; color:var(--muted,#6f7772); margin-top:6px; }

      .fv-dd{ position:relative; }
      .fv-dd-btn{
        width:100%; text-align:left;
        padding:12px; padding-right:40px;
        height:48px;
        border:1px solid var(--border);
        border-radius:10px;
        background:var(--card-surface,var(--surface));
        font:inherit; color:var(--text)!important;
        display:flex; align-items:center;
        -webkit-text-fill-color: var(--text) !important;
        cursor:pointer;
      }
      .fv-dd-btn[disabled]{opacity:.6;cursor:not-allowed;}
      .fv-dd-btn::after{
        content:"";
        position:absolute;
        right:12px; top:50%;
        transform:translateY(-50%);
        width:18px; height:18px;
        pointer-events:none;
        opacity:.7;
        background:no-repeat center/18px 18px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='%2367706B' d='M7.41 8.58L12 13.17l4.59-4.59L18 10l-6 6-6-6z'/></svg>");
      }
      .fv-dd-list{
        position:absolute; z-index:1000;
        top:calc(100% + 4px); left:0; right:0;
        max-height:260px; overflow:auto;
        border:1px solid var(--border);
        border-radius:10px;
        background:var(--surface);
        box-shadow:0 12px 26px rgba(0,0,0,.18);
        display:none;
      }
      .fv-dd.open .fv-dd-list{ display:block; }
      .fv-dd-list input{
        width:100%; box-sizing:border-box;
        padding:10px 12px;
        border:none;
        border-bottom:1px solid var(--border);
        font:inherit; outline:none;
        background:var(--surface);
        color:var(--text);
      }
      .fv-dd-list ul{ list-style:none; margin:0; padding:0; max-height:220px; overflow-y:auto }
      .fv-dd-list li{ padding:10px 12px; cursor:pointer; }
      .fv-dd-list li:hover{ background:rgba(127,127,127,.08); }

      .fv-combo{ position:relative; }
      .fv-combo-trigger{
        position:relative;
        width:100%;
        text-align:left;
        display:flex;
        align-items:center;
        height:48px;
        border:1px solid var(--border);
        border-radius:10px;
        background:var(--card-surface,var(--surface));
        padding:12px;
        color:var(--text)!important;
        cursor:pointer;
        -webkit-text-fill-color:var(--text)!important;
      }
      .fv-combo-trigger::after{
        content:"";
        position:absolute;
        right:12px; top:50%;
        width:8px; height:8px;
        transform:translateY(-50%) rotate(45deg);
        border-right:2px solid currentColor;
        border-bottom:2px solid currentColor;
        opacity:.75;
        pointer-events:none;
      }
      .fv-combo-panel{
        position:absolute; left:0; right:0;
        z-index:1000;
        margin-top:6px;
        padding:6px;
        background:var(--surface);
        border:1px solid var(--border);
        border-radius:12px;
        box-shadow:0 12px 26px rgba(0,0,0,.18);
        --row-h:36px;
        max-height: calc(var(--row-h) * 5 + 12px);
        overflow:auto;
      }
      .fv-combo-item{
        display:block; width:100%;
        text-align:left;
        font:inherit; color:var(--text);
        background:transparent;
        border:none;
        border-radius:10px;
        padding:10px 12px;
        height:var(--row-h);
        cursor:pointer;
      }
      .fv-combo-item:hover{ background:rgba(127,127,127,.08); }
      .fv-hidden{ display:none !important; }

      .fv-extras{
        grid-column: 1 / -1;
        border:1px solid var(--border);
        border-radius:14px;
        background:var(--surface);
        padding:12px;
      }
    `;
    document.head.appendChild(st);
  }

  function wireDd(root){
    if(!root) return;
    const btn = root.querySelector(".fv-dd-btn");
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".fv-dd").forEach(d=>{ if(d!==root) d.classList.remove("open"); });
      if(btn.disabled) return;
      root.classList.toggle("open");
      const inp = root.querySelector(".fv-dd-list input");
      if(root.classList.contains("open") && inp) setTimeout(()=> inp.focus(), 60);
    });
  }

  function wireDdGlobalClose(){
    if(wireDdGlobalClose._wired) return;
    wireDdGlobalClose._wired = true;

    document.addEventListener("click", (e)=>{
      if(!e.target.closest(".fv-dd")){
        document.querySelectorAll(".fv-dd").forEach(d=>d.classList.remove("open"));
      }
    });
    window.addEventListener("keydown", (e)=>{
      if(e.key === "Escape"){
        document.querySelectorAll(".fv-dd").forEach(d=>d.classList.remove("open"));
      }
    });
  }

  function wireYearCombo(){
    const dlg = UI.editSheet || document.getElementById("shopEquipEdit");
    if(!dlg) return;

    const trigger = dlg.querySelector("#seYearTrigger");
    const panel = dlg.querySelector("#seYearPanel");
    const sel = dlg.querySelector("#seYear");
    const combo = dlg.querySelector("#seYearCombo");
    if(!trigger || !panel || !sel || !combo) return;

    function closePanel(){
      panel.classList.add("fv-hidden");
      trigger.setAttribute("aria-expanded","false");
      document.removeEventListener("keydown", onEsc);
    }
    function openPanel(){
      panel.classList.remove("fv-hidden");
      trigger.setAttribute("aria-expanded","true");
      document.addEventListener("keydown", onEsc);
      document.addEventListener("click", onDocOnce, { once:true });
    }
    function onDocOnce(e){
      if(!combo.contains(e.target)) closePanel();
      else document.addEventListener("click", onDocOnce, { once:true });
    }
    function onEsc(e){ if(e.key==="Escape") closePanel(); }

    trigger.addEventListener("click", ()=>{
      const open = trigger.getAttribute("aria-expanded") === "true";
      if(open) closePanel(); else openPanel();
    });

    wireYearCombo._build = ()=>{
      const now = new Date().getFullYear();
      sel.innerHTML = `<option value="">— Select —</option>`;
      for(let y=now+1; y>=now-40; y--){
        const o=document.createElement("option");
        o.value=String(y); o.textContent=String(y);
        sel.appendChild(o);
      }
      panel.innerHTML = "";
      [...sel.options].forEach(opt=>{
        const b = document.createElement("button");
        b.type="button";
        b.className="fv-combo-item";
        b.dataset.val=opt.value;
        b.textContent=opt.textContent;
        b.addEventListener("click", ()=>{
          sel.value = opt.value;
          trigger.textContent = opt.value ? opt.textContent : "— Select —";
          closePanel();
        });
        panel.appendChild(b);
      });
    };
  }

  async function ensureEquipmentFormsLoaded(){
    if(window.FVEquipForms && typeof window.FVEquipForms.initExtras === "function") return;
    if(ensureEquipmentFormsLoaded._loading) return ensureEquipmentFormsLoaded._loading;

    ensureEquipmentFormsLoaded._loading = new Promise((resolve)=>{
      const s = document.createElement("script");
      s.src = "/Farm-vista/js/equipment-forms.js";
      s.defer = true;
      s.onload = ()=> resolve();
      s.onerror = ()=> resolve();
      document.head.appendChild(s);
    });
    return ensureEquipmentFormsLoaded._loading;
  }

  async function loadMakesModels(){
    const db = getFirestore();

    if(!state.makesLoaded){
      state.makesLoaded = true;
      try{
        const snap = await getDocs(query(collection(db,"equipment-makes"), orderBy("name")));
        const out = [];
        snap.forEach(d=>{
          const v = d.data() || {};
          if(v.archived) return;
          out.push({ id:d.id, name:(v.name || v.make || "").trim() });
        });
        out.sort((a,b)=>a.name.localeCompare(b.name));
        state.makes = out;
      }catch(e){
        console.error("load makes failed", e);
        state.makes = [];
      }
    }

    if(!state.modelsLoaded){
      state.modelsLoaded = true;
      try{
        const snap = await getDocs(query(collection(db,"equipment-models"), orderBy("name")));
        const out = [];
        snap.forEach(d=>{
          const v = d.data() || {};
          if(v.archived) return;
          out.push({
            id:d.id,
            name:(v.name || v.model || "").trim(),
            makeId:(v.makeId || "").trim()
          });
        });
        out.sort((a,b)=>a.name.localeCompare(b.name));
        state.models = out;
      }catch(e){
        console.error("load models failed", e);
        state.models = [];
      }
    }
  }

  function setupMakeModelDd(prefMakeIdOrName, prefModelIdOrName){
    const dlg = UI.editSheet;

    const makeRoot = dlg.querySelector("#seDdMake");
    const makeBtn  = dlg.querySelector("#seMakeBtn");
    const makeSearch = dlg.querySelector("#seMakeSearch");
    const makeList = dlg.querySelector("#seMakeList");
    const makeIdHidden = dlg.querySelector("#seMakeId");

    const modelRoot = dlg.querySelector("#seDdModel");
    const modelBtn  = dlg.querySelector("#seModelBtn");
    const modelSearch = dlg.querySelector("#seModelSearch");
    const modelList = dlg.querySelector("#seModelList");
    const modelIdHidden = dlg.querySelector("#seModelId");

    function buildList(ul, items, onPick){
      ul.innerHTML = "";
      items.forEach(({id,name})=>{
        const li = document.createElement("li");
        li.textContent = name || "(unnamed)";
        li.dataset.value = id;
        li.addEventListener("click", ()=> onPick(id, name));
        ul.appendChild(li);
      });
    confirmingAlive();
    }

    function filterList(input, ul){
      const term = (input.value || "").toLowerCase().trim();
      ul.querySelectorAll("li").forEach(li=>{
        li.style.display = li.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    }

    makeSearch.oninput = ()=> filterList(makeSearch, makeList);
    modelSearch.oninput = ()=> filterList(modelSearch, modelList);

    function setModel(id, name){
      modelIdHidden.value = id || "";
      modelBtn.textContent = id ? name : (makeIdHidden.value ? "— Select —" : "— Select a Make first —");
      modelRoot.classList.remove("open");
    }

    function modelsForMake(){
      const mk = makeIdHidden.value;
      if(!mk) return [];
      return state.models.filter(m=>m.makeId === mk);
    }

    function refreshModels(){
      const items = modelsForMake();
      modelBtn.disabled = !items.length;
      modelSearch.disabled = !items.length;

      if(!items.length){
        modelBtn.textContent = "— Select a Make first —";
        modelIdHidden.value = "";
        modelList.innerHTML = "";
        return;
      }

      buildList(modelList, items, setModel);

      const byId = items.find(m=>m.id===prefModelIdOrName);
      const byNm = items.find(m=>m.name===prefModelIdOrName);
      if(byId) setModel(byId.id, byId.name);
      else if(byNm) setModel(byNm.id, byNm.name);
      else{
        modelIdHidden.value = "";
        modelBtn.textContent = "— Select —";
      }
    }

    function setMake(id, name){
      makeIdHidden.value = id || "";
      makeBtn.textContent = id ? name : "— Select —";
      makeRoot.classList.remove("open");
      setModel("", "");
      refreshModels();
    }

    // initial make list
    buildList(makeList, state.makes, setMake);

    // preselect make
    const byId = state.makes.find(m=>m.id===prefMakeIdOrName);
    const byNm = state.makes.find(m=>m.name===prefMakeIdOrName);
    if(byId) setMake(byId.id, byId.name);
    else if(byNm) setMake(byNm.id, byNm.name);
    else{
      makeIdHidden.value = "";
      makeBtn.textContent = "— Select —";
      refreshModels();
    }
  }

  function initExtrasEngineForEdit(eqDoc){
    const host = UI.editSheet.querySelector("#seExtras");
    host.innerHTML = "";

    if(!window.FVEquipForms || typeof window.FVEquipForms.initExtras !== "function"){
      host.innerHTML = `<div class="muted">Extras engine missing (equipment-forms.js).</div>`;
      state.editExtras = null;
      return;
    }

    const typeKey = detectTypeKeyFromEq(eqDoc);
    state.editTypeKey = typeKey;

    state.editExtras = window.FVEquipForms.initExtras({
      equipType: typeKey,
      container: host,
      document
    });

    // NOW force hydration of implementType etc so the right options appear immediately
    hydrateExtrasFromDoc(eqDoc);
  }

  async function openEditModal(eqId){
    bootstrap();
    ensureSvcFooterButtons();
    ensureEditSheet();

    await ensureEquipmentFormsLoaded();
    await loadMakesModels();

    const db = getFirestore();
    const snap = await getDoc(doc(db,"equipment", eqId));
    if(!snap.exists()){
      showError("Equipment not found.");
      return;
    }
    const d = { id: snap.id, ...(snap.data()||{}) };
    state.editEqId = eqId;
    state.editEqDoc = d;

    UI.editSheet.querySelector("#seTitle").textContent =
      `Edit • ${d.unitId ? d.unitId : ""}${d.unitId ? " • " : ""}${d.name || "Equipment"}`;

    if(typeof wireYearCombo._build === "function") wireYearCombo._build();

    setupMakeModelDd(d.makeId || d.makeName || "", d.modelId || d.modelName || "");

    const yearSel = UI.editSheet.querySelector("#seYear");
    const yearTrigger = UI.editSheet.querySelector("#seYearTrigger");
    yearSel.value = d.year ? String(d.year) : "";
    yearTrigger.textContent = yearSel.value ? yearSel.value : "— Select —";

    UI.editSheet.querySelector("#seUnitId").value = safeUnitId(d);
    UI.editSheet.querySelector("#seSerial").value = d.serial || "";
    UI.editSheet.querySelector("#seSerial6").textContent = last6(d.serial || "");
    UI.editSheet.querySelector("#seStatus").value = (d.status || "Active");
    UI.editSheet.querySelector("#seNotes").value = d.notes || "";

    initExtrasEngineForEdit(d);

    openSheet(UI.editSheet);
  }

  function readEditForm(){
    const dlg = UI.editSheet;
    const makeId = dlg.querySelector("#seMakeId").value || null;
    const modelId = dlg.querySelector("#seModelId").value || null;

    const makeObj = state.makes.find(m=>m.id===makeId);
    const modelObj = state.models.find(m=>m.id===modelId);

    const makeName = makeObj ? makeObj.name : (state.editEqDoc?.makeName || "");
    const modelName = modelObj ? modelObj.name : (state.editEqDoc?.modelName || "");

    const yearVal = dlg.querySelector("#seYear").value;
    const year = yearVal ? Number(yearVal) : null;

    const unitId = String(dlg.querySelector("#seUnitId").value || "").trim();
    const serial = String(dlg.querySelector("#seSerial").value || "").trim();
    const status = dlg.querySelector("#seStatus").value || "Active";
    const notes = String(dlg.querySelector("#seNotes").value || "").trim();

    const extras = (state.editExtras && typeof state.editExtras.read === "function")
      ? (state.editExtras.read() || {})
      : {};

    // ensure unitId stored at root and/or extras as your system expects
    extras.unitId = unitId;

    return { makeId, modelId, makeName, modelName, year, unitId, serial, status, notes, extras };
  }

  function validateEditForm(p){
    if(!p.makeId) return "Make is required.";
    if(!p.modelId) return "Model is required.";
    if(!p.year) return "Year is required.";
    if(!p.serial || p.serial.length < 3) return "Serial looks short.";
    if(state.editExtras && typeof state.editExtras.validate === "function"){
      const v = state.editExtras.validate();
      if(v && v.ok === false) return v.message || "Missing required extra field.";
    }
    return "";
  }

  async function saveEditModal(){
    if(!state.editEqId) return;

    const patchIn = readEditForm();
    const err = validateEditForm(patchIn);
    if(err){ alert(err); return; }

    const payload = {
      makeId: patchIn.makeId,
      modelId: patchIn.modelId,
      makeName: patchIn.makeName || null,
      modelName: patchIn.modelName || null,
      year: patchIn.year,
      unitId: patchIn.unitId || null,
      serial: patchIn.serial,
      status: patchIn.status,
      notes: patchIn.notes || "",
      ...patchIn.extras,
      updatedAt: serverTimestamp()
    };

    try{
      const db = getFirestore();
      await setDoc(doc(db,"equipment", state.editEqId), payload, { merge:true });
      Object.assign(state.editEqDoc, payload);

      showToast("Saved ✓");
      closeSheet(UI.editSheet);
    }catch(e){
      console.error(e);
      alert("Save failed by Firestore rules.");
    }
  }

  // ===================================================================
  //  svcSheet open + lifetime notes save
  // ===================================================================
  async function open(eq){
    bootstrap();
    state.eq = eq || null;
    if(!eq) return;

    ensureSvcFooterButtons();

    const unitIdLine = eq.unitId ? `Unit ID ${eq.unitId}` : "Unit ID —";
    UI.svcTitle.textContent = eq.unitId ? `${eq.unitId} • ${eq.name || "Equipment"}` : (eq.name || "Equipment");

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
      await updateDoc(doc(db, "equipment", state.eq.id), { lifetimeNotes: txt, updatedAt: serverTimestamp() });
      state.eq.lifetimeNotes = txt;
      showToast("Notes saved.");
    }catch(e){
      console.error(e);
      showError(e?.message || "Save notes failed.");
    }
  }

  window.FVShopEquipModal = {
    open,
    openServiceRecords: async (eq)=> openServiceRecordsModal(eq),
    openEdit: async (id)=> openEditModal(id)
  };

  try{ bootstrap(); }catch(e){ console.warn("[shop-equip-modal] bootstrap failed", e); }
})();
