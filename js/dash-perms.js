// /Farm-vista/js/dash-perms.js
// Rev: 2026-01-27-dash-perms-v1
//
// Dashboard Capability Permissions (Role + Employee Overrides)
// Extracted from your dashboard inline module script.
//
// Emits: "fv:dash-perms-ready" with { permsKnown:true/false }
// Exposes: window.FV_DASH_PERMS, window.FV_DASH_CAN

import {
  ready,
  getAuth,
  onAuthStateChanged,
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where
} from '/Farm-vista/js/firebase-init.js';

(function(){
  "use strict";

  const CAP = {
    CHATBOT:   "cap-chatbot",
    KPI_FIELD: "cap-kpi-field-maint",
    KPI_GRAIN: "cap-kpi-grain",
    KPI_EQUIP: "cap-kpi-equipment",

    // OPTIONAL quick-link keys (fallbacks handled below)
    QL_BOUNDARIES:     "cap-quick-field-boundaries",
    QL_MAINT_ADD:      "cap-quick-maintenance-add",
    QL_FIELD_WEATHER:  "cap-quick-field-weather",
    QL_EQUIP_OVERVIEW: "cap-quick-equipment-overview"
  };

  const els = {
    chatbot:          document.getElementById("ai-section"),
    kpiWO:            document.getElementById("wo-approve-kpi"),
    kpiBoundary:      document.getElementById("boundary-kpi"),
    kpiBag:           document.getElementById("bag-kpi"),

    qlSection:        document.getElementById("quick-links"),
    qlBoundaries:     document.getElementById("ql-boundaries"),
    qlMaintAdd:       document.getElementById("ql-maint-add"),
    qlFieldWeather:   document.getElementById("ql-field-weather"),
    qlEquipOverview:  document.getElementById("ql-equip-overview")
  };

  function hide(el){
    if (!el) return;
    el.classList.add("perm-hidden");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
  }
  function show(el){
    if (!el) return;
    el.classList.remove("perm-hidden");
    el.removeAttribute("aria-hidden");
    el.removeAttribute("tabindex");
  }

  function hasPermObj(p){
    return p && typeof p === "object" && (
      Object.prototype.hasOwnProperty.call(p,"view") ||
      Object.prototype.hasOwnProperty.call(p,"add") ||
      Object.prototype.hasOwnProperty.call(p,"edit") ||
      Object.prototype.hasOwnProperty.call(p,"delete")
    );
  }

  function canFromPermValue(val, action){
    if (val == null) return false;
    if (val === true) return true;
    if (val === false) return false;

    if (typeof val === "object"){
      if (typeof val.on === "boolean") return !!val.on;

      if (hasPermObj(val)){
        const a = (action || "view").toLowerCase();
        if (typeof val[a] === "boolean") return !!val[a];
        return !!(val.view || val.add || val.edit || val.delete);
      }
    }
    return false;
  }

  function makeCan(perms){
    return function(key, action){
      if (!key) return true;
      return canFromPermValue(perms ? perms[key] : null, action || "view");
    };
  }

  function deepClone(obj){
    try { return JSON.parse(JSON.stringify(obj || {})); } catch { return {}; }
  }

  function mergePerms(base, overrides){
    const out = deepClone(base || {});
    const ov = (overrides && typeof overrides === "object") ? overrides : {};
    for (const k of Object.keys(ov)){
      out[k] = ov[k];
    }
    return out;
  }

  function extractEmployeeGroupAndOverrides(emp){
    const e = emp || {};
    const permissionGroup = (e.permissionGroup || "").toString().trim();

    const overrides =
      (e.overrides && e.overrides.perms && typeof e.overrides.perms === "object" ? e.overrides.perms : null) ||
      (e.overrides && typeof e.overrides === "object" ? e.overrides : null) ||
      (e.perms && typeof e.perms === "object" ? e.perms : null) ||
      {};

    return { permissionGroup, overrides };
  }

  async function readEmployeeByEmail(db, user){
    const email = (user && user.email ? user.email.toString().trim().toLowerCase() : "");
    if (!email) return null;

    const ref = doc(db, "employees", email);
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() || {}) : null;
  }

  async function readRolePermsByDocId(db, maybeId){
    if (!maybeId) return null;
    try{
      const ref = doc(db, "accountRoles", maybeId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const d = snap.data() || {};
      return (d.perms && typeof d.perms === "object") ? d.perms : {};
    }catch{
      return null;
    }
  }

  async function readRolePermsByName(db, roleName){
    if (!roleName) return null;
    try{
      const qy = query(collection(db, "accountRoles"), where("name", "==", roleName));
      const ss = await getDocs(qy);
      let first = null;
      ss.forEach(d => { if (!first) first = d; });

      if (!first) return null;
      const d = first.data() || {};
      return (d.perms && typeof d.perms === "object") ? d.perms : {};
    }catch{
      return null;
    }
  }

  function dispatchReady(permsKnown){
    document.dispatchEvent(new CustomEvent("fv:dash-perms-ready", { detail:{ permsKnown: !!permsKnown } }));
  }

  function applyVisibility(perms, permsKnown){
    if (!permsKnown){
      // If perms are unknown, default to visible (so nobody gets locked out by a read failure)
      show(els.chatbot);
      show(els.kpiWO);
      show(els.kpiBoundary);
      show(els.kpiBag);

      show(els.qlSection);
      show(els.qlBoundaries);
      show(els.qlMaintAdd);
      show(els.qlFieldWeather);
      show(els.qlEquipOverview);

      window.FV_DASH_PERMS = null;
      window.FV_DASH_CAN = null;

      dispatchReady(false);
      return;
    }

    const can = makeCan(perms);

    const canAny = (keys, action)=>{
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list){
        if (can(k, action || "view")) return true;
      }
      return false;
    };

    if (els.chatbot){
      if (!can(CAP.CHATBOT, "view")) hide(els.chatbot); else show(els.chatbot);
    }

    if (els.kpiWO){
      if (!can(CAP.KPI_FIELD, "view")) hide(els.kpiWO); else show(els.kpiWO);
    }
    if (els.kpiBoundary){
      if (!can(CAP.KPI_FIELD, "view")) hide(els.kpiBoundary); else show(els.kpiBoundary);
    }
    if (els.kpiBag){
      if (!can(CAP.KPI_GRAIN, "view")) hide(els.kpiBag); else show(els.kpiBag);
    }

    // Quick Links:
    // Prefer dedicated caps; fall back so employees don’t lose access.
    if (els.qlBoundaries){
      if (!canAny([CAP.QL_BOUNDARIES, CAP.KPI_FIELD], "view")) hide(els.qlBoundaries); else show(els.qlBoundaries);
    }
    if (els.qlMaintAdd){
      if (!canAny([CAP.QL_MAINT_ADD, CAP.KPI_FIELD], "view")) hide(els.qlMaintAdd); else show(els.qlMaintAdd);
    }
    if (els.qlFieldWeather){
      if (!canAny([CAP.QL_FIELD_WEATHER, CAP.KPI_FIELD], "view")) hide(els.qlFieldWeather); else show(els.qlFieldWeather);
    }
    if (els.qlEquipOverview){
      if (!canAny([CAP.QL_EQUIP_OVERVIEW, CAP.KPI_EQUIP], "view")) hide(els.qlEquipOverview); else show(els.qlEquipOverview);
    }

    // If every quick-link is hidden, hide the section.
    if (els.qlSection){
      const anyVisible =
        (els.qlBoundaries && !els.qlBoundaries.classList.contains("perm-hidden")) ||
        (els.qlMaintAdd && !els.qlMaintAdd.classList.contains("perm-hidden")) ||
        (els.qlFieldWeather && !els.qlFieldWeather.classList.contains("perm-hidden")) ||
        (els.qlEquipOverview && !els.qlEquipOverview.classList.contains("perm-hidden"));

      if (!anyVisible) hide(els.qlSection);
      else show(els.qlSection);
    }

    window.FV_DASH_PERMS = perms || {};
    window.FV_DASH_CAN = can;

    dispatchReady(true);
  }

  async function init(){
    await ready;

    const auth = getAuth();
    const db = getFirestore();

    // Default open
    applyVisibility(null, false);

    onAuthStateChanged(auth, async (user)=>{
      try{
        if (!user){
          applyVisibility(null, false);
          return;
        }

        const emp = await readEmployeeByEmail(db, user);
        if (!emp){
          console.warn("[dash-perms] employees doc not found for user:", user.email);
          applyVisibility(null, false);
          return;
        }

        const { permissionGroup, overrides } = extractEmployeeGroupAndOverrides(emp);

        let basePerms = await readRolePermsByDocId(db, permissionGroup);
        if (!basePerms) basePerms = await readRolePermsByName(db, permissionGroup);

        if (!basePerms){
          console.warn("[dash-perms] accountRoles not found for permissionGroup:", permissionGroup);
          applyVisibility(null, false);
          return;
        }

        const merged = mergePerms(basePerms, overrides);
        applyVisibility(merged, true);
      }catch(err){
        console.warn("[dash-perms] perms resolver failed:", err);
        applyVisibility(null, false);
      }
    });
  }

  // Run as soon as this module is loaded
  init();

})();