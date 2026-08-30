// /js/dash-kpi-dynamic.js
// FarmVista Dashboard — Dynamic Needs Attention
// Rev: 2026-08-30-v1
//
// Keeps the existing KPI data loaders unchanged.
// This controller only decides whether each KPI should be visible:
//
//   count > 0  => show it, if permissions allow it
//   count <= 0 => hide it
//   no visible active KPIs => hide the entire Needs Attention section
//
// Examples:
//   4 boundary corrections => Boundary KPI shows
//   all 4 fixed => Boundary KPI disappears
//   new boundary request => Boundary KPI comes back
//   no grain bags => Grain Bags KPI disappears
//   all KPI counts = 0 => entire Needs Attention section disappears

(function(){
  "use strict";

  const KPI_CONFIG = [
    {
      cardId: "wo-approve-kpi",
      countId: "wo-approve-count"
    },
    {
      cardId: "boundary-kpi",
      countId: "boundary-kpi-count"
    },
    {
      cardId: "bag-kpi",
      countId: "bag-kpi-count"
    }
  ];

  const section =
    document.getElementById(
      "attention-section"
    );

  if (!section){
    return;
  }

  function readCount(
    el
  ){

    if (!el){
      return null;
    }

    const raw =
      String(
        el.textContent ||
        ""
      )
        .replace(
          /,/g,
          ""
        )
        .trim();

    /*
     * Initial KPI value is "–".
     *
     * Treat anything not yet loaded as zero
     * so we do not briefly show empty KPI cards.
     */
    if (
      !raw ||
      raw === "–" ||
      raw === "-"
    ){
      return null;
    }

    const value =
      Number(
        raw
      );

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  /*
   * Check only the permission state of the KPI.
   *
   * dash-perms.js uses:
   *
   *   .perm-hidden
   *   hidden
   *   aria-hidden="true"
   *
   * We never override those on an individual KPI.
   */
  function permissionAllows(
    card
  ){

    if (!card){
      return false;
    }

    return !(
      card.hidden ||
      card.classList.contains(
        "perm-hidden"
      ) ||
      card.getAttribute(
        "aria-hidden"
      ) === "true"
    );
  }


  /*
   * Dynamic hiding is done with inline display.
   *
   * This is intentionally separate from
   * the existing permission classes.
   */
  function setZeroHidden(
    card,
    shouldHide
  ){

    if (!card){
      return;
    }

    const nextDisplay =
      shouldHide
        ? "none"
        : "";

    if (
      card.style.display !==
      nextDisplay
    ){
      card.style.display =
        nextDisplay;
    }

    card.dataset.attentionActive =
      shouldHide
        ? "false"
        : "true";
  }


  function sync(){

    let hasVisibleAttention =
      false;

    KPI_CONFIG.forEach(
      ({
        cardId,
        countId
      }) => {

        const card =
          document.getElementById(
            cardId
          );

        const countEl =
          document.getElementById(
            countId
          );

        if (
          !card ||
          !countEl
        ){
          return;
        }

        const count =
          readCount(
            countEl
          );

        const hasItems =
          count !== null &&
          count > 0;


        /*
         * Zero or not loaded:
         * hide this KPI.
         *
         * Positive count:
         * allow it to show.
         */
        setZeroHidden(
          card,
          !hasItems
        );


        /*
         * It counts toward Needs Attention
         * only when:
         *
         *   1. It actually has something open.
         *   2. The user has permission to see it.
         */
        if (
          hasItems &&
          permissionAllows(
            card
          )
        ){
          hasVisibleAttention =
            true;
        }

      }
    );


    /*
     * The Needs Attention section has no reason
     * to exist when none of its KPIs have anything
     * requiring attention.
     *
     * If at least one permitted KPI has a positive
     * count, restore the section.
     */
    if (
      hasVisibleAttention
    ){

      section.style.display =
        "";

      section.hidden =
        false;

      /*
       * attention-section itself is derived from
       * the visibility of the KPI cards, so it is
       * safe to restore it when a permitted KPI
       * actually contains an open item.
       */
      section.classList.remove(
        "perm-hidden"
      );

      section.removeAttribute(
        "aria-hidden"
      );

    }
    else{

      section.style.display =
        "none";

      section.hidden =
        true;

      section.setAttribute(
        "aria-hidden",
        "true"
      );

    }

  }


  /*
   * Watch the live numbers.
   *
   * The existing KPI scripts change these
   * count elements after Firestore finishes
   * loading.
   */
  function observe(){

    KPI_CONFIG.forEach(
      ({
        cardId,
        countId
      }) => {

        const card =
          document.getElementById(
            cardId
          );

        const countEl =
          document.getElementById(
            countId
          );


        if (
          countEl
        ){

          new MutationObserver(
            sync
          ).observe(
            countEl,
            {
              childList:
                true,

              characterData:
                true,

              subtree:
                true
            }
          );

        }


        /*
         * Also watch permission changes.
         *
         * This matters for separate farms/accounts
         * where the logged-in user may not have
         * access to one of these KPI categories.
         */
        if (
          card
        ){

          new MutationObserver(
            sync
          ).observe(
            card,
            {
              attributes:
                true,

              attributeFilter: [
                "class",
                "hidden",
                "aria-hidden"
              ]
            }
          );

        }

      }
    );

  }


  /*
   * Initial run.
   *
   * This hides the placeholder KPI cards while
   * their Firestore counts are still loading.
   */
  sync();

  observe();


  /*
   * Recheck after dashboard permissions
   * finish loading.
   */
  document.addEventListener(
    "fv:dash-perms-ready",
    sync
  );


  /*
   * Recheck when the signed-in user/farm
   * context becomes available.
   */
  document.addEventListener(
    "fv:user-ready",
    sync
  );


  /*
   * Existing KPI scripts refresh themselves when
   * the page becomes visible again.
   *
   * Re-run our visibility calculation immediately
   * and once again after they have had time to
   * update their Firestore counts.
   */
  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        !document.hidden
      ){

        setTimeout(
          sync,
          0
        );

        setTimeout(
          sync,
          250
        );

      }

    }
  );


  window.addEventListener(
    "focus",
    () => {

      setTimeout(
        sync,
        0
      );

      setTimeout(
        sync,
        250
      );

    }
  );

})();
