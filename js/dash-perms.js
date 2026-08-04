// /Farm-vista/js/dash-perms.js
// Rev: 2026-08-04-dashboard-effective-permissions-v2
//
// Dashboard permissions now use FVUserContext as the single source.
// FVUserContext already combines:
//   Account Role permissions + Employee overrides = effectivePerms
//
// Emits: "fv:dash-perms-ready"
// Exposes:
//   window.FV_DASH_PERMS
//   window.FV_DASH_CAN

(function () {
  "use strict";

  const CAP = {
    MARKETS: "cap-grain-markets",
    CHATBOT: "cap-chatbot",

    KPI_FIELD: "cap-kpi-field-maint",
    KPI_GRAIN: "cap-kpi-grain",
    KPI_EQUIP: "cap-kpi-equipment",

    LOGISTICS: "logistics-pre-trip",

    FIELD_BOUNDARIES: "office-field-boundaries",
    MAINTENANCE: "crop-maint",
    FIELD_WEATHER: "crop-weather",
    EQUIPMENT: "equipment",

    // Keep supporting these older optional dashboard keys.
    QL_BOUNDARIES: "cap-quick-field-boundaries",
    QL_MAINT_ADD: "cap-quick-maintenance-add",
    QL_FIELD_WEATHER: "cap-quick-field-weather",
    QL_EQUIP_OVERVIEW: "cap-quick-equipment-overview"
  };

  function getElement(id) {
    return document.getElementById(id);
  }

  function hide(el) {
    if (!el) return;

    el.classList.add("perm-hidden");
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");

    if (el.matches("a, button, input, select, textarea")) {
      el.setAttribute("tabindex", "-1");
    }
  }

  function show(el) {
    if (!el) return;

    el.classList.remove("perm-hidden");
    el.hidden = false;
    el.removeAttribute("aria-hidden");

    if (el.getAttribute("tabindex") === "-1") {
      el.removeAttribute("tabindex");
    }
  }

  function setVisible(el, allowed) {
    if (allowed) show(el);
    else hide(el);
  }

  function hasPermissionObject(value) {
    return value &&
      typeof value === "object" &&
      (
        Object.prototype.hasOwnProperty.call(value, "view") ||
        Object.prototype.hasOwnProperty.call(value, "add") ||
        Object.prototype.hasOwnProperty.call(value, "edit") ||
        Object.prototype.hasOwnProperty.call(value, "delete")
      );
  }

  function canFromPermissionValue(value, action = "view") {
    if (value == null) return false;
    if (value === true) return true;
    if (value === false) return false;

    if (typeof value !== "object") return false;

    if (typeof value.on === "boolean") {
      return value.on;
    }

    if (hasPermissionObject(value)) {
      const requestedAction = String(action || "view").toLowerCase();

      if (typeof value[requestedAction] === "boolean") {
        return value[requestedAction];
      }

      return false;
    }

    return false;
  }

  function makeCan(perms) {
    return function can(key, action = "view") {
      if (!key) return true;

      return canFromPermissionValue(
        perms && Object.prototype.hasOwnProperty.call(perms, key)
          ? perms[key]
          : null,
        action
      );
    };
  }

  function canAny(can, permissions, action = "view") {
    const list = Array.isArray(permissions)
      ? permissions
      : [permissions];

    return list.some(key => can(key, action));
  }

  function getDashboardElements() {
    return {
      markets: getElement("markets-section"),
      chatbot: getElement("ai-section"),
      logistics: getElement("logistics-panel"),

      kpiWO: getElement("wo-approve-kpi"),
      kpiBoundary: getElement("boundary-kpi"),
      kpiBag: getElement("bag-kpi"),

      desktopQuickLinks: getElement("desktop-quick-links"),
      mobileQuickLinks: getElement("quick-links"),

      qlBoundaries: getElement("ql-boundaries"),
      qlBoundariesMobile: getElement("ql-boundaries-mobile"),

      qlMaintAdd: getElement("ql-maint-add"),
      qlMaintAddMobile: getElement("ql-maint-add-mobile"),

      qlFieldWeather: getElement("ql-field-weather"),
      qlFieldWeatherMobile: getElement("ql-field-weather-mobile"),

      qlEquipOverview: getElement("ql-equip-overview"),
      qlEquipOverviewMobile: getElement("ql-equip-overview-mobile"),

      qlLogistics: getElement("ql-logistics"),
      qlLogisticsMobile: getElement("ql-logistics-mobile"),

      desktopDashboard: document.querySelector(".desktop-dashboard"),
      desktopRight: getElement("desktop-right")
    };
  }

  function elementIsVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.classList.contains("perm-hidden")) return false;

    return getComputedStyle(el).display !== "none";
  }

  function updateQuickLinkSection(section, links) {
    if (!section) return;

    const hasVisibleLink = links.some(elementIsVisible);
    setVisible(section, hasVisibleLink);
  }

  function updateDashboardLayout(els) {
    if (!els.desktopDashboard || !els.desktopRight) return;

    const visibleRightSections = Array.from(
      els.desktopRight.children
    ).filter(elementIsVisible);

    const singleColumn = visibleRightSections.length === 0;

    els.desktopDashboard.classList.toggle(
      "dashboard-single-column",
      singleColumn
    );
  }

  function dispatchReady(permsKnown) {
    document.dispatchEvent(
      new CustomEvent("fv:dash-perms-ready", {
        detail: {
          permsKnown: Boolean(permsKnown)
        }
      })
    );
  }

  function applyOpenState() {
    const els = getDashboardElements();

    [
      els.markets,
      els.chatbot,
      els.logistics,
      els.kpiWO,
      els.kpiBoundary,
      els.kpiBag,
      els.desktopQuickLinks,
      els.mobileQuickLinks,
      els.qlBoundaries,
      els.qlBoundariesMobile,
      els.qlMaintAdd,
      els.qlMaintAddMobile,
      els.qlFieldWeather,
      els.qlFieldWeatherMobile,
      els.qlEquipOverview,
      els.qlEquipOverviewMobile,
      els.qlLogistics,
      els.qlLogisticsMobile
    ].forEach(show);

    window.FV_DASH_PERMS = null;
    window.FV_DASH_CAN = null;

    updateDashboardLayout(els);
    dispatchReady(false);
  }

  function applyPermissions(context) {
    const perms =
      context &&
      context.effectivePerms &&
      typeof context.effectivePerms === "object"
        ? context.effectivePerms
        : null;

    /*
     * Until the user context is available, leave the dashboard visible.
     * This prevents a blank dashboard during startup.
     */
    if (!perms) {
      applyOpenState();
      return;
    }

    const els = getDashboardElements();
    const can = makeCan(perms);

    /*
     * Main dashboard sections
     */
    setVisible(
      els.markets,
      can(CAP.MARKETS, "view")
    );

    setVisible(
      els.chatbot,
      can(CAP.CHATBOT, "view")
    );

    setVisible(
      els.logistics,
      can(CAP.LOGISTICS, "view")
    );

    /*
     * KPI cards
     */
    setVisible(
      els.kpiWO,
      can(CAP.KPI_FIELD, "view")
    );

    setVisible(
      els.kpiBoundary,
      can(CAP.KPI_FIELD, "view")
    );

    setVisible(
      els.kpiBag,
      can(CAP.KPI_GRAIN, "view")
    );

    /*
     * Quick links
     *
     * Dedicated dashboard permission wins when present.
     * The actual page permission remains a fallback.
     */
    const boundariesAllowed = canAny(
      can,
      [
        CAP.QL_BOUNDARIES,
        CAP.FIELD_BOUNDARIES
      ],
      "view"
    );

    const maintenanceAllowed =
      can(CAP.QL_MAINT_ADD, "view") ||
      can(CAP.MAINTENANCE, "add");

    const fieldWeatherAllowed = canAny(
      can,
      [
        CAP.QL_FIELD_WEATHER,
        CAP.FIELD_WEATHER
      ],
      "view"
    );

    const equipmentAllowed = canAny(
      can,
      [
        CAP.QL_EQUIP_OVERVIEW,
        CAP.KPI_EQUIP,
        CAP.EQUIPMENT
      ],
      "view"
    );

    const logisticsAllowed =
      can(CAP.LOGISTICS, "add") ||
      can(CAP.LOGISTICS, "view");

    setVisible(els.qlBoundaries, boundariesAllowed);
    setVisible(els.qlBoundariesMobile, boundariesAllowed);

    setVisible(els.qlMaintAdd, maintenanceAllowed);
    setVisible(els.qlMaintAddMobile, maintenanceAllowed);

    setVisible(els.qlFieldWeather, fieldWeatherAllowed);
    setVisible(els.qlFieldWeatherMobile, fieldWeatherAllowed);

    setVisible(els.qlEquipOverview, equipmentAllowed);
    setVisible(els.qlEquipOverviewMobile, equipmentAllowed);

    setVisible(els.qlLogistics, logisticsAllowed);
    setVisible(els.qlLogisticsMobile, logisticsAllowed);

    updateQuickLinkSection(
      els.desktopQuickLinks,
      [
        els.qlBoundaries,
        els.qlMaintAdd,
        els.qlFieldWeather,
        els.qlEquipOverview,
        els.qlLogistics
      ]
    );

    updateQuickLinkSection(
      els.mobileQuickLinks,
      [
        els.qlBoundariesMobile,
        els.qlMaintAddMobile,
        els.qlFieldWeatherMobile,
        els.qlEquipOverviewMobile,
        els.qlLogisticsMobile
      ]
    );

    window.FV_DASH_PERMS = perms;
    window.FV_DASH_CAN = can;

    updateDashboardLayout(els);
    dispatchReady(true);
  }

  async function refreshPermissions() {
    try {
      if (
        !window.FVUserContext ||
        typeof window.FVUserContext.ready !== "function"
      ) {
        applyOpenState();
        return;
      }

      const context = await window.FVUserContext.ready();
      applyPermissions(context);
    } catch (error) {
      console.warn(
        "[dash-perms] Could not load user permissions:",
        error
      );

      applyOpenState();
    }
  }

  function boot() {
    /*
     * Keep the page visible while the user context is loading.
     */
    applyOpenState();

    refreshPermissions();

    document.addEventListener(
      "fv:user-ready",
      event => {
        const context =
          event &&
          event.detail &&
          event.detail.data
            ? event.detail.data
            : window.FVUserContext?.get?.();

        applyPermissions(context);
      }
    );

    if (
      window.FVUserContext &&
      typeof window.FVUserContext.onChange === "function"
    ) {
      window.FVUserContext.onChange(context => {
        applyPermissions(context);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      { once: true }
    );
  } else {
    boot();
  }
})();
