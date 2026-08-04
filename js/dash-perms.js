// /Farm-vista/js/dash-perms.js
// Rev: 2026-08-04-dashboard-permissions-v3
//
// Uses FVUserContext as the single permission source.
//
// Account Role + Employee Overrides = effectivePerms
//
// Dashboard-only permissions:
//   cap-grain-markets
//   cap-logistics-overview
//   cap-chatbot
//   cap-kpi-field-maint
//   cap-kpi-grain
//   cap-kpi-equipment

(function () {
  "use strict";

  const CAP = {
    MARKETS: "cap-grain-markets",
    LOGISTICS_OVERVIEW: "cap-logistics-overview",
    CHATBOT: "cap-chatbot",

    KPI_FIELD: "cap-kpi-field-maint",
    KPI_GRAIN: "cap-kpi-grain",
    KPI_EQUIP: "cap-kpi-equipment",

    FIELD_BOUNDARIES: "office-field-boundaries",
    MAINTENANCE: "crop-maint",
    FIELD_WEATHER: "crop-weather",
    EQUIPMENT: "equipment",

    QL_BOUNDARIES: "cap-quick-field-boundaries",
    QL_MAINT_ADD: "cap-quick-maintenance-add",
    QL_FIELD_WEATHER: "cap-quick-field-weather",
    QL_EQUIP_OVERVIEW: "cap-quick-equipment-overview"
  };

  const byId = id => document.getElementById(id);

  function getElements() {
    return {
      markets: byId("markets-section"),
      chatbot: byId("ai-section"),
      logisticsOverview: byId("logistics-panel"),

      attentionSection: byId("attention-section"),
      kpiWO: byId("wo-approve-kpi"),
      kpiBoundary: byId("boundary-kpi"),
      kpiBag: byId("bag-kpi"),

      desktopQuickLinks: byId("desktop-quick-links"),
      mobileQuickLinks: byId("quick-links"),

      qlBoundaries: byId("ql-boundaries"),
      qlBoundariesMobile: byId("ql-boundaries-mobile"),

      qlMaintAdd: byId("ql-maint-add"),
      qlMaintAddMobile: byId("ql-maint-add-mobile"),

      qlEquipOverview: byId("ql-equip-overview"),
      qlEquipOverviewMobile: byId("ql-equip-overview-mobile"),

      qlFieldWeather: byId("ql-field-weather"),
      qlFieldWeatherMobile: byId("ql-field-weather-mobile"),

      /*
       * This currently opens the company-wide Pre-Trip Dashboard.
       * It must use cap-logistics-overview, not logistics-pre-trip.
       */
      qlLogistics: byId("ql-logistics"),

      /*
       * Steering is treated as equipment access for now.
       */
      qlSteering: byId("ql-steering"),

      desktopDashboard: document.querySelector(".desktop-dashboard"),
      desktopRight: byId("desktop-right")
    };
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

  function canFromValue(value, action = "view") {
    if (value === true) return true;
    if (value === false || value == null) return false;

    if (typeof value !== "object") return false;

    if (typeof value.on === "boolean") {
      return value.on;
    }

    const key = String(action || "view").toLowerCase();

    if (typeof value[key] === "boolean") {
      return value[key];
    }

    return false;
  }

  function makeCan(perms) {
    return function can(permission, action = "view") {
      if (!permission) return true;

      const value = Object.prototype.hasOwnProperty.call(
        perms || {},
        permission
      )
        ? perms[permission]
        : null;

      return canFromValue(value, action);
    };
  }

  function canAny(can, permissions, action = "view") {
    return permissions.some(permission =>
      can(permission, action)
    );
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.classList.contains("perm-hidden")) return false;

    return getComputedStyle(el).display !== "none";
  }

  function updateAttentionSection(els) {
    const hasVisibleKPI =
      isVisible(els.kpiWO) ||
      isVisible(els.kpiBoundary) ||
      isVisible(els.kpiBag);

    setVisible(els.attentionSection, hasVisibleKPI);
  }

  function updateQuickLinkSections(els) {
    const desktopHasLinks =
      isVisible(els.qlBoundaries) ||
      isVisible(els.qlMaintAdd) ||
      isVisible(els.qlEquipOverview) ||
      isVisible(els.qlFieldWeather);

    const mobileHasLinks =
      isVisible(els.qlLogistics) ||
      isVisible(els.qlBoundariesMobile) ||
      isVisible(els.qlMaintAddMobile) ||
      isVisible(els.qlEquipOverviewMobile) ||
      isVisible(els.qlFieldWeatherMobile) ||
      isVisible(els.qlSteering);

    setVisible(els.desktopQuickLinks, desktopHasLinks);
    setVisible(els.mobileQuickLinks, mobileHasLinks);
  }

  function updateDesktopLayout(els) {
    if (!els.desktopDashboard || !els.desktopRight) return;

    const visibleRightSections = Array
      .from(els.desktopRight.children)
      .filter(isVisible);

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

  /*
   * Hide all permission-controlled dashboard content until the
   * signed-in user's effective permissions are available.
   *
   * This prevents users from briefly seeing features they do not have.
   */
  function hideControlledContent() {
    const els = getElements();

    [
      els.markets,
      els.chatbot,
      els.logisticsOverview,

      els.attentionSection,
      els.kpiWO,
      els.kpiBoundary,
      els.kpiBag,

      els.desktopQuickLinks,
      els.mobileQuickLinks,

      els.qlBoundaries,
      els.qlBoundariesMobile,

      els.qlMaintAdd,
      els.qlMaintAddMobile,

      els.qlEquipOverview,
      els.qlEquipOverviewMobile,

      els.qlFieldWeather,
      els.qlFieldWeatherMobile,

      els.qlLogistics,
      els.qlSteering
    ].forEach(hide);

    window.FV_DASH_PERMS = null;
    window.FV_DASH_CAN = null;
  }

  function applyPermissions(context) {
    const perms =
      context &&
      context.effectivePerms &&
      typeof context.effectivePerms === "object"
        ? context.effectivePerms
        : null;

    if (!perms) {
      hideControlledContent();
      dispatchReady(false);
      return;
    }

    const els = getElements();
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

    /*
     * Company-wide Pre-Trip Overview.
     *
     * This is intentionally separate from logistics-pre-trip.
     * A driver can create and later view their own records without
     * seeing every employee's inspections.
     */
    setVisible(
      els.logisticsOverview,
      can(CAP.LOGISTICS_OVERVIEW, "view")
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

    const equipmentAllowed = canAny(
      can,
      [
        CAP.QL_EQUIP_OVERVIEW,
        CAP.KPI_EQUIP,
        CAP.EQUIPMENT
      ],
      "view"
    );

    const fieldWeatherAllowed = canAny(
      can,
      [
        CAP.QL_FIELD_WEATHER,
        CAP.FIELD_WEATHER
      ],
      "view"
    );

    const companyLogisticsAllowed =
      can(CAP.LOGISTICS_OVERVIEW, "view");

    setVisible(
      els.qlBoundaries,
      boundariesAllowed
    );

    setVisible(
      els.qlBoundariesMobile,
      boundariesAllowed
    );

    setVisible(
      els.qlMaintAdd,
      maintenanceAllowed
    );

    setVisible(
      els.qlMaintAddMobile,
      maintenanceAllowed
    );

    setVisible(
      els.qlEquipOverview,
      equipmentAllowed
    );

    setVisible(
      els.qlEquipOverviewMobile,
      equipmentAllowed
    );

    setVisible(
      els.qlFieldWeather,
      fieldWeatherAllowed
    );

    setVisible(
      els.qlFieldWeatherMobile,
      fieldWeatherAllowed
    );

    /*
     * The current mobile Pre-Trip Dashboard link opens the
     * company-wide overview, so drivers should not see it.
     */
    setVisible(
      els.qlLogistics,
      companyLogisticsAllowed
    );

    /*
     * Steering currently follows equipment access.
     */
    setVisible(
      els.qlSteering,
      equipmentAllowed
    );

    updateAttentionSection(els);
    updateQuickLinkSections(els);
    updateDesktopLayout(els);

    window.FV_DASH_PERMS = perms;
    window.FV_DASH_CAN = can;

    dispatchReady(true);
  }

  async function refreshPermissions() {
    try {
      if (
        !window.FVUserContext ||
        typeof window.FVUserContext.ready !== "function"
      ) {
        hideControlledContent();
        return;
      }

      const context = await window.FVUserContext.ready();
      applyPermissions(context);
    } catch (error) {
      console.warn(
        "[dash-perms] Effective permissions could not be loaded:",
        error
      );

      hideControlledContent();
      dispatchReady(false);
    }
  }

  function boot() {
    hideControlledContent();
    refreshPermissions();

    document.addEventListener(
      "fv:user-ready",
      event => {
        const context =
          event?.detail?.data ||
          window.FVUserContext?.get?.() ||
          null;

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
