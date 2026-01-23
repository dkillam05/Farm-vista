/* =====================================================================
/Farm-vista/js/shop-equipment-wo-modal.js  (NEW FILE)
Rev: 2026-01-23a
Purpose:
✅ Standalone "Add New Work Order" modal (multi-task, attachments)
✅ Creates Work Order directly (NO approval flow):
   - status: "pending"
✅ Uploads attachments to Storage (WO-level):
   - attachmentUrls[]
   - attachmentCount
Notes:
- Designed to be lazy-loaded from shop-equipment-modal.js
- Keeps main file small and editable
===================================================================== */

import {
  ready,
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "/Farm-vista/js/firebase-init.js";

(function(){
  const $id = (id)=> document.getElementById(id);
  const norm = (v)=> (v||"").toString().trim().toLowerCase();

  const TOPIC_OPTIONS = [
    { v:"", label:"Select a topic…" },
    { v:"engine", label:"Engine / Powertrain" },
    { v:"hydraulics", label:"Hydraulics" },
    { v:"electrical", label:"Electrical / Wiring" },
    { v:"driveline", label:"Driveline / Transmission" },
    { v:"tires_tracks", label:"Tires / Tracks / Undercarriage" },
    { v:"precision", label:"Precision / GPS / StarFire" },
    { v:"cab_controls", label:"Cab Controls / Displays" },
    { v:"leaks", label:"Leaks / Fluids" },
    { v:"scheduled_service", label:"Scheduled Service / Oil Change" },
    { v:"inspection", label:"Pre-Season Inspection" },
    { v:"other", label:"Other (describe below)" }
  ];

  const WO_COLLECTION = "equipmentWorkOrders"; // ✅ per Dane: option 1 is WO-level attachments

  const UI = {
    dlg: null
  };

  const STATE = {
    eq: null,
    tasks: [],
    isSaving: false
  };

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function last6(v){ return String(v||"").slice(-6); }

  function ensureCss(){
    if(document.getElementById("fv-wo-modal-css")) return;
    const st = document.createElement("style");
    st.id = "fv-wo-modal-css";
    st.textContent = `
.fv-wo-skin{
  width:min(900px, 94vw);
  border:1px solid var(--border);
  border-radius:14px;
  padding:0;
  background:var(--card-surface,var(--surface));
  color:var(--text);
  box-shadow:0 18px 40px rgba(0,0,0,.45);
  overflow:hidden;
}
.fv-wo-skin::backdrop{ background:rgba(0,0,0,.55); }
.fv-wo-skin header{
  padding:14px 16px; border-bottom:1px solid var(--border);
  display:flex; justify-content:space-between; align-items:center; gap:10px;
}
.fv-wo-skin .body{
  padding:14px 16px; max-height:70vh;
  overflow-y:auto; overflow-x:hidden;
  -webkit-overflow-scrolling:touch;
  touch-action: pan-y; overscroll-behavior: contain;
  scrollbar-width:none;
  -ms-overflow-style:none;
}
.fv-wo-skin .body::-webkit-scrollbar{ width:0; height:0; }

.fv-wo-skin footer{
  padding:12px 16px; border-top:1px solid var(--border);
  display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;
  align-items:center;
}
.fv-wo-skin .left-actions{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.fv-wo-skin .right-actions{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }

.fv-wo-skin .subcard{
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
  padding:12px;
  display:grid;
  gap:10px;
}

.fv-wo-skin .muted{ color:var(--muted,#67706B); font-size:13px; }
.fv-wo-skin label{ display:block; font-size:13px; color:var(--muted); margin:0 0 6px; font-weight:850; }

.fv-wo-skin .input,
.fv-wo-skin .select,
.fv-wo-skin .textarea{
  width:100%; font:inherit; color:inherit; background:var(--card-surface,var(--surface));
  border:1px solid var(--border); border-radius:10px;
  padding:12px; box-sizing:border-box;
}
.fv-wo-skin .textarea{ min-height:110px; resize:vertical; line-height:1.35; }

.fv-wo-skin .btn{
  display:inline-flex; align-items:center; gap:8px; border:1px solid var(--border); border-radius:12px;
  background:var(--surface); color:var(--text)!important; padding:10px 14px; font-weight:900; cursor:pointer; text-decoration:none;
}
.fv-wo-skin .btn[disabled]{ opacity:.55; pointer-events:none; }
.fv-wo-skin .btn-primary{ border-color:transparent; background:var(--green,#3B7E46); color:#fff!important }

.fv-wo-skin .btn-mini{
  display:inline-flex; align-items:center; justify-content:center;
  padding:8px 10px; border-radius:10px; border:1px solid var(--border);
  background:var(--card-surface,var(--surface)); color:var(--text);
  font-weight:900; cursor:pointer; user-select:none; white-space:nowrap;
}
.fv-wo-skin .btn-mini-danger{
  border-color:color-mix(in srgb,#b3261e 30%, var(--border));
  color:#b3261e;
  background:color-mix(in srgb,#b3261e 5%, var(--surface));
}

.fv-wo-skin .task-list{ display:grid; gap:12px; }
.fv-wo-skin .task-card{
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
  padding:12px;
  display:grid;
  gap:12px;
}
.fv-wo-skin .task-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.fv-wo-skin .task-title{ font-weight:950; font-size:14px; margin:0; }
.fv-wo-skin .details-wrap{ display:grid; gap:12px; padding-top:2px; }

.fv-wo-skin .req-badge{
  font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em;
  padding:2px 6px; border-radius:999px;
  background:color-mix(in srgb,var(--green,#3B7E46) 12%, transparent);
  color:var(--green,#3B7E46);
  margin-left:6px;
}

.fv-wo-skin .btn-secondary{
  display:inline-flex; align-items:center; justify-content:center;
  min-height:44px; padding:10px 14px;
  border-radius:12px; border:1px solid var(--border);
  font-weight:900; cursor:pointer; user-select:none;
  color:var(--text); background:var(--card-surface,var(--surface));
  box-sizing:border-box; text-decoration:none;
}
.fv-wo-skin .btn-secondary[aria-expanded="true"]{
  background:color-mix(in srgb,var(--green,#3B7E46) 10%, var(--surface));
  border-color:color-mix(in srgb,var(--green,#3B7E46) 30%, var(--border));
}

.fv-wo-skin input[type="file"].file-input{
  width:100%;
  padding:8px 10px;
  border-radius:10px;
  border:1px solid var(--border);
  background:var(--card-surface,var(--surface));
  font-size:0.9rem;
  color:var(--text);
  box-sizing:border-box;
}
.fv-wo-skin input[type="file"].file-input::file-selector-button{
  border:none;
  border-radius:999px;
  padding:4px 12px;
  margin-right:10px;
  background:var(--surface);
  color:var(--text);
  font-size:0.85rem;
  cursor:pointer;
}
.fv-wo-skin .thumbs{ display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.fv-wo-skin .thumb{
  width:72px; height:72px;
  border-radius:10px; border:1px solid var(--border);
  background:var(--card-surface,var(--surface));
  display:grid; place-items:center;
  overflow:hidden; font-size:11px; text-align:center;
  padding:4px; box-sizing:border-box;
}
.fv-wo-skin .thumb img{ max-width:100%; max-height:100%; display:block; }

.fv-wo-skin .error{
  border:1px solid #b3261e;
  background:#fff;
  color:#b3261e;
  border-radius:10px;
  padding:10px 12px;
  display:none;
}
.fv-wo-skin .error.show{ display:block; }

.fv-wo-toast{
  position:fixed;
  left:50%;
  bottom:18px;
  transform:translateX(-50%);
  background:rgba(20,20,20,.92);
  color:#fff;
  padding:10px 14px;
  border-radius:999px;
  font-weight:900;
  box-shadow:0 12px 26px rgba(0,0,0,.22);
  z-index:999999;
  opacity:0;
  pointer-events:none;
  transition:opacity .18s ease;
}
.fv-wo-toast.show{ opacity:1; }
    `;
    document.head.appendChild(st);
  }

  function openSheet(dlg){
    if(!dlg) return;
    try{ dlg.showModal(); }catch{ dlg.setAttribute("open",""); }
  }
  function closeSheet(dlg){
    if(!dlg) return;
    try{ dlg.close(); }catch{ dlg.removeAttribute("open"); }
  }

  function showToast(msg="Saved."){
    let t = document.getElementById("fvWoToast");
    if(!t){
      t = document.createElement("div");
      t.id = "fvWoToast";
      t.className = "fv-wo-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove("show");
    void t.offsetWidth;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> t.classList.remove("show"), 2200);
  }

  function showErr(msg){
    const box = UI.dlg?.querySelector("#woErr");
    if(!box) return;
    box.textContent = msg || "";
    box.classList.toggle("show", !!msg);
  }

  function buildTopicSelect(selectEl){
    selectEl.innerHTML = "";
    for(const opt of TOPIC_OPTIONS){
      const o = document.createElement("option");
      o.value = opt.v;
      o.textContent = opt.label;
      selectEl.appendChild(o);
    }
  }

  function uid(){
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function setupFiles(input, thumbs, hint){
    if(!input) return;
    input.addEventListener("change", ()=>{
      const files = Array.from(input.files || []);
      thumbs.innerHTML = "";

      if(!files.length){
        thumbs.setAttribute("aria-hidden","true");
        hint.textContent = "";
        hint.setAttribute("aria-hidden","true");
        return;
      }

      files.forEach(f=>{
        const wrap = document.createElement("div");
        wrap.className = "thumb";

        if(f.type && f.type.startsWith("image/")){
          const img = document.createElement("img");
          img.alt = f.name;
          wrap.appendChild(img);
          const reader = new FileReader();
          reader.onload = e=>{ img.src = e.target.result; };
          reader.readAsDataURL(f);
        }else{
          wrap.textContent = (f.name || "file").split(".").pop().toUpperCase();
        }
        thumbs.appendChild(wrap);
      });

      thumbs.removeAttribute("aria-hidden");
      hint.textContent = files.length === 1 ? "1 file selected" : `${files.length} files selected`;
      hint.removeAttribute("aria-hidden");
    });
  }

  function getUserName(){
    let label = "";
    try{
      const ctx = window.FVUserContext && window.FVUserContext.get && window.FVUserContext.get();
      if(ctx) label = ctx.displayName || ctx.email || "";
    }catch{}
    if(!label){
      try{
        const u = window.firebaseAuth && window.firebaseAuth.currentUser;
        if(u) label = u.displayName || u.email || "";
      }catch{}
    }
    if(label && label.includes("@")){
      const local = String(label).split("@")[0] || "";
      const spaced = local.replace(/[._-]+/g," ").replace(/([a-z])([A-Z])/g,"$1 $2");
      label = spaced.split(" ").filter(Boolean).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
    }
    return (label || "FarmVista User").trim();
  }

  function makeTaskCard(taskIndex){
    const taskId = uid();
    const card = document.createElement("div");
    card.className = "task-card";
    card.dataset.taskId = taskId;

    card.innerHTML = `
      <div class="task-head">
        <div class="task-title">Task ${taskIndex + 1}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="btn-mini btn-mini-danger" data-act="remove">Remove</button>
        </div>
      </div>

      <div class="form-row">
        <label>
          Service topic
          <span class="req-badge">Required</span>
        </label>
        <select class="select" data-role="topic" required></select>
        <div class="muted">Pick the closest topic. Use “Other” only if needed.</div>
      </div>

      <div class="form-row" data-role="topicOtherRow" hidden>
        <label>If “Other”, what’s the main topic?</label>
        <input class="input" data-role="topicOther" type="text" maxlength="120"
          placeholder="Example: Rear axle vibration, cab door seal, etc.">
      </div>

      <div class="details-wrap" data-role="details" hidden>
        <div class="form-row">
          <label>
            Notes for shop
            <span class="req-badge">Required</span>
          </label>
          <textarea class="textarea" data-role="notes"
            placeholder="Describe the issue, when it happens, warning lights, urgency."></textarea>
        </div>

        <div class="form-row">
          <button type="button" class="btn-secondary" data-role="toggleMore" aria-expanded="false">
            Additional info
          </button>
          <div class="muted">Tap if you need parts, photos, files, or extra details.</div>
        </div>

        <div class="details-wrap" data-role="more" hidden>
          <div class="form-row">
            <label>Parts needed (if known)</label>
            <textarea class="textarea" data-role="partsNeeded"
              placeholder="Filter kits, bearings, hoses, tires/tracks, etc. Include part # if known."></textarea>
          </div>

          <div class="form-row">
            <label>Photos & files</label>
            <input class="file-input" data-role="attachments" type="file" multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt">
            <div class="thumbs" data-role="thumbs" aria-hidden="true"></div>
            <div class="muted" data-role="fileHint" aria-hidden="true"></div>
            <div class="muted">Attachments will be saved on the Work Order (WO-level).</div>
          </div>
        </div>
      </div>
    `;

    const topicSel = card.querySelector('[data-role="topic"]');
    const topicOtherRow = card.querySelector('[data-role="topicOtherRow"]');
    const topicOther = card.querySelector('[data-role="topicOther"]');
    const details = card.querySelector('[data-role="details"]');
    const notes = card.querySelector('[data-role="notes"]');
    const toggleMore = card.querySelector('[data-role="toggleMore"]');
    const moreWrap = card.querySelector('[data-role="more"]');
    const attachments = card.querySelector('[data-role="attachments"]');
    const thumbs = card.querySelector('[data-role="thumbs"]');
    const fileHint = card.querySelector('[data-role="fileHint"]');
    const removeBtn = card.querySelector('[data-act="remove"]');

    buildTopicSelect(topicSel);

    const onTopicChange = ()=>{
      const v = (topicSel.value || "").trim();
      topicOtherRow.hidden = (v !== "other");
      details.hidden = !v;
      if(v){
        setTimeout(()=>{ try{ notes.focus(); }catch{} }, 50);
      }
    };
    topicSel.addEventListener("change", onTopicChange);
    onTopicChange();

    toggleMore.addEventListener("click", ()=>{
      const expanded = toggleMore.getAttribute("aria-expanded") === "true";
      toggleMore.setAttribute("aria-expanded", expanded ? "false" : "true");
      moreWrap.hidden = expanded;
    });

    setupFiles(attachments, thumbs, fileHint);

    return {
      id: taskId,
      el: card,
      refs: { topicSel, topicOther, notes, attachments, removeBtn }
    };
  }

  function renumberTasks(){
    const list = UI.dlg?.querySelector("#woTaskList");
    if(!list) return;
    const cards = Array.from(list.querySelectorAll(".task-card"));
    cards.forEach((c, idx)=>{
      const t = c.querySelector(".task-title");
      if(t) t.textContent = `Task ${idx + 1}`;
    });
    const onlyOne = cards.length <= 1;
    cards.forEach(c=>{
      const btn = c.querySelector('[data-act="remove"]');
      if(btn) btn.disabled = onlyOne;
    });
  }

  function addTask(){
    const list = UI.dlg.querySelector("#woTaskList");
    const t = makeTaskCard(STATE.tasks.length);
    STATE.tasks.push(t);
    list.appendChild(t.el);

    t.refs.removeBtn.addEventListener("click", ()=>{
      removeTask(t.id);
    });

    renumberTasks();
    return t;
  }

  function removeTask(taskId){
    const idx = STATE.tasks.findIndex(t=>t.id === taskId);
    if(idx < 0) return;
    if(STATE.tasks.length <= 1) return;

    const t = STATE.tasks[idx];
    try{ t.el.remove(); }catch{}
    STATE.tasks.splice(idx, 1);
    renumberTasks();
  }

  function validate(){
    for(let i=0;i<STATE.tasks.length;i++){
      const t = STATE.tasks[i];
      const topic = (t.refs.topicSel.value || "").trim();
      const notes = (t.refs.notes.value || "").trim();
      const other = (t.refs.topicOther.value || "").trim();

      if(!topic){
        showErr(`Task ${i+1}: Service topic is required.`);
        try{ t.refs.topicSel.focus(); }catch{}
        return false;
      }
      if(topic === "other" && !other){
        showErr(`Task ${i+1}: Please fill in the “Other” topic box.`);
        try{ t.refs.topicOther.focus(); }catch{}
        return false;
      }
      if(!notes){
        showErr(`Task ${i+1}: Notes for shop are required.`);
        try{ t.refs.notes.focus(); }catch{}
        return false;
      }
    }
    return true;
  }

  function gatherAllFiles(){
    const out = [];
    for(let i=0;i<STATE.tasks.length;i++){
      const t = STATE.tasks[i];
      const files = Array.from(t.refs.attachments?.files || []);
      files.forEach(f=> out.push({ file:f, taskIndex:i }));
    }
    return out;
  }

  async function uploadAllWoFiles(woId){
    const selected = gatherAllFiles();
    if(!selected.length) return { urls: [], count: 0, skipped: 0 };

    if(!window.FV_HAS_STORAGE){
      console.warn("[wo-modal] FV_HAS_STORAGE is false; skipping uploads.");
      return { urls: [], count: 0, skipped: selected.length };
    }

    const storage = getStorage();
    if(!storage){
      console.warn("[wo-modal] getStorage() returned null; skipping uploads.");
      return { urls: [], count: 0, skipped: selected.length };
    }

    const urls = [];
    let uploaded = 0;

    for(let i=0;i<selected.length;i++){
      const { file, taskIndex } = selected[i];
      try{
        const cleanName = (file.name || "file").replace(/\s+/g,"-");
        const path = `equipmentWorkOrders/${woId}/${Date.now()}-${taskIndex}-${i}-${cleanName}`;
        const fileRef = ref(storage, path);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        urls.push(url);
        uploaded++;
      }catch(err){
        console.error("[wo-modal] single file upload failed", err);
      }
    }

    const skipped = selected.length - uploaded;
    return { urls, count: uploaded, skipped };
  }

  function buildWoPayload(eq){
    const submittedByName = getUserName();

    const equipmentId = eq?.id || null;
    const equipmentName = eq?.name || null;

    // keep consistent with your WO examples
    const equipmentSerialLast6 = last6(eq?.serial || eq?.equipmentSerial || "");
    const equipmentType = eq?.type || null;

    const lineItems = STATE.tasks.map(t=>{
      const topic = (t.refs.topicSel.value || "").trim();
      const other = (t.refs.topicOther.value || "").trim();
      const notes = (t.refs.notes.value || "").trim();

      // partsNeeded lives in "Additional info" section
      const partsNeeded = (t.el.querySelector('[data-role="partsNeeded"]')?.value || "").trim();

      return {
        completed: false,
        completedAt: null,
        completedByEmployeeId: null,
        completedByEmployeeName: null,
        notes,
        origin: "request",
        partsNeeded: partsNeeded || null,
        serviceRequestId: null,
        serviceTopic: topic,
        serviceTopicOther: topic === "other" ? (other || null) : null,
        submittedByName
      };
    });

    return {
      equipmentId,
      equipmentName,
      equipmentSerialLast6: equipmentSerialLast6 || null,
      equipmentType,
      status: "pending",
      lineItems,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  function resetModal(){
    showErr("");
    STATE.tasks = [];
    STATE.isSaving = false;

    const list = UI.dlg?.querySelector("#woTaskList");
    if(list) list.innerHTML = "";

    const btnSubmit = UI.dlg?.querySelector("#woSubmit");
    if(btnSubmit){
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Create Work Order";
    }

    // Start with one task
    addTask();
  }

  function ensureWoSheet(){
    if(UI.dlg) return UI.dlg;

    ensureCss();

    const dlg = document.createElement("dialog");
    dlg.id = "fvWoSheet";
    dlg.className = "sheet fv-wo-skin";
    dlg.setAttribute("aria-modal","true");

    dlg.innerHTML = `
      <header>
        <strong id="woTitle">Add New Work Order</strong>
        <button id="woClose" class="btn" type="button">Close</button>
      </header>

      <div class="body">
        <div id="woErr" class="error"></div>

        <div class="subcard">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start;">
            <div style="min-width:0;flex:1 1 auto;">
              <div style="font-weight:950;line-height:1.15;" id="woEqName">—</div>
              <div class="muted" id="woEqMeta">—</div>
            </div>
            <div class="muted" style="border:1px solid var(--border);border-radius:999px;padding:6px 10px;font-weight:900;">
              Status: Pending
            </div>
          </div>
        </div>

        <div class="subcard">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
            <div style="font-weight:950;">Work order tasks</div>
            <button id="woAddTask" class="btn" type="button">+ Add another task</button>
          </div>
          <div class="muted">Add as many tasks as you want. Each task becomes a line item.</div>
          <div class="task-list" id="woTaskList" style="margin-top:12px;"></div>
        </div>
      </div>

      <footer>
        <div class="left-actions">
          <button id="woCancel" class="btn" type="button">Cancel</button>
        </div>
        <div class="right-actions">
          <button id="woSubmit" class="btn btn-primary" type="button">Create Work Order</button>
        </div>
      </footer>
    `;

    document.body.appendChild(dlg);
    UI.dlg = dlg;

    dlg.querySelector("#woClose").addEventListener("click", ()=> closeSheet(dlg));
    dlg.querySelector("#woCancel").addEventListener("click", ()=> closeSheet(dlg));

    dlg.querySelector("#woAddTask").addEventListener("click", ()=>{
      const t = addTask();
      setTimeout(()=>{
        try{ t.el.scrollIntoView({ behavior:"smooth", block:"start" }); }catch{}
        try{ t.el.querySelector('[data-role="topic"]')?.focus(); }catch{}
      }, 50);
    });

    dlg.addEventListener("close", ()=>{
      // wipe when closed so it always opens clean
      STATE.eq = null;
      STATE.tasks = [];
      STATE.isSaving = false;
      showErr("");
      const list = dlg.querySelector("#woTaskList");
      if(list) list.innerHTML = "";
    });

    dlg.querySelector("#woSubmit").addEventListener("click", async ()=>{
      if(STATE.isSaving) return;
      showErr("");

      if(!STATE.eq){
        showErr("No equipment loaded.");
        return;
      }
      if(!validate()) return;

      STATE.isSaving = true;
      const btn = dlg.querySelector("#woSubmit");
      btn.disabled = true;
      btn.textContent = "Creating…";

      try{
        await ready;
        const db = getFirestore();

        // 1) Create WO first
        const payload = buildWoPayload(STATE.eq);
        const docRef = await addDoc(collection(db, WO_COLLECTION), payload);

        // 2) Upload all files (WO-level)
        const up = await uploadAllWoFiles(docRef.id);

        // 3) Patch WO with attachmentUrls/count
        if(up.urls.length || up.skipped){
          await updateDoc(doc(db, WO_COLLECTION, docRef.id), {
            attachmentUrls: up.urls,
            attachmentCount: up.urls.length,
            updatedAt: serverTimestamp()
          });
        }

        // notify any listeners
        window.dispatchEvent(new CustomEvent("fv-wo:created", {
          detail: { woId: docRef.id, equipmentId: STATE.eq.id, attachmentCount: up.urls.length }
        }));

        if(up.urls.length){
          showToast(`Work order created ✓ (${up.urls.length} attachment${up.urls.length===1?"":"s"})`);
        }else if(up.skipped){
          showToast("Work order created ✓ (attachments skipped)");
        }else{
          showToast("Work order created ✓");
        }

        closeSheet(dlg);
      }catch(e){
        console.error("[wo-modal] create failed", e);
        showErr(e?.message || "Failed to create work order.");
      }finally{
        STATE.isSaving = false;
        btn.disabled = false;
        btn.textContent = "Create Work Order";
      }
    });

    return dlg;
  }

  function open(eq){
    ensureWoSheet();
    STATE.eq = eq || null;

    const name = (eq?.unitId ? `${eq.unitId} • ` : "") + (eq?.name || "Equipment");
    UI.dlg.querySelector("#woTitle").textContent = "Add New Work Order";
    UI.dlg.querySelector("#woEqName").textContent = name;

    const meta = [
      eq?.type ? String(eq.type).charAt(0).toUpperCase()+String(eq.type).slice(1) : "",
      eq?.year ? `Year ${eq.year}` : "",
      eq?.serial ? `Serial ${eq.serial}` : "",
      eq?.placedInServiceDate ? `In Service ${eq.placedInServiceDate}` : ""
    ].filter(Boolean).join(" • ");

    UI.dlg.querySelector("#woEqMeta").textContent = meta || "—";

    resetModal();
    openSheet(UI.dlg);
  }

  // expose global API for lazy-loader caller
  window.FVShopEquipWOModal = { open };
})();
