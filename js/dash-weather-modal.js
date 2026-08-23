// /js/dash-weather-modal.js
// Rev: 2026-08-23-dash-weather-modal-v2
//
// Dashboard weather card → modal wiring.
//
// DOES NOT replace fv-weather.js.
//
// Weather location priority:
// 1. window.FV_DASH_WEATHER_LOCATION if valid lat/lon already exists
// 2. Firestore company/main → addressZip
// 3. Final fallback ZIP: 62530
//
// The ZIP code is geocoded to lat/lon before FVWeather is initialized.

(function () {
  "use strict";


  const DEFAULT_ZIP =
    "62530";


  let resolvedWeatherLocationPromise =
    null;


  /*
    Hide the weather modal scrollbar while keeping
    mouse-wheel, trackpad, and touch scrolling enabled.
  */
  const weatherModalStyle =
    document.createElement(
      "style"
    );

  weatherModalStyle.textContent =
    `
      #fv-weather-modal,
      #fv-weather-modal-body {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }

      #fv-weather-modal::-webkit-scrollbar,
      #fv-weather-modal-body::-webkit-scrollbar {
        display: none;
        width: 0;
        height: 0;
      }
    `;

  document.head.appendChild(
    weatherModalStyle
  );


  function onReady(
    fn
  ) {

    if (
      document.readyState ===
      "loading"
    ) {

      document.addEventListener(
        "DOMContentLoaded",
        fn,
        {
          once: true
        }
      );

    }
    else {

      fn();

    }

  }


  function hasValidCoordinates(
    location
  ) {

    if (
      !location
    ) {

      return false;

    }


    const lat =
      Number(
        location.lat
      );


    const lon =
      Number(
        location.lon
      );


    return (
      Number.isFinite(
        lat
      ) &&
      Number.isFinite(
        lon
      ) &&
      Math.abs(
        lat
      ) <= 90 &&
      Math.abs(
        lon
      ) <= 180
    );

  }


  function getFirestoreDb() {

    /*
      Some FarmVista pages expose the Firestore
      instance directly as window.db.
    */

    if (
      window.db &&
      typeof window.db.collection ===
        "function"
    ) {

      return window.db;

    }


    /*
      Firebase compat SDK fallback.
    */

    if (
      window.firebase &&
      typeof window.firebase.firestore ===
        "function"
    ) {

      try {

        return window.firebase.firestore();

      }
      catch (
        err
      ) {

        console.warn(
          "Weather: unable to access Firebase Firestore.",
          err
        );

      }

    }


    return null;

  }


  async function getCompanyWeatherInfo() {

    const fallback = {
      addressZip:
        DEFAULT_ZIP,

      addressCity:
        "",

      addressState:
        ""
    };


    const db =
      getFirestoreDb();


    if (
      !db
    ) {

      console.warn(
        "Weather: Firestore unavailable. Using default ZIP.",
        DEFAULT_ZIP
      );

      return fallback;

    }


    try {

      const snap =
        await db
          .collection(
            "company"
          )
          .doc(
            "main"
          )
          .get();


      if (
        !snap.exists
      ) {

        console.warn(
          "Weather: company/main not found. Using default ZIP.",
          DEFAULT_ZIP
        );

        return fallback;

      }


      const company =
        snap.data() ||
        {};


      const addressZip =
        String(
          company.addressZip ||
          DEFAULT_ZIP
        )
          .trim();


      const addressCity =
        String(
          company.addressCity ||
          ""
        )
          .trim();


      const addressState =
        String(
          company.addressState ||
          ""
        )
          .trim();


      return {
        addressZip,
        addressCity,
        addressState
      };

    }
    catch (
      err
    ) {

      console.error(
        "Weather: failed reading company address.",
        err
      );


      return fallback;

    }

  }


  async function geocodeZip(
    zip,
    city,
    state
  ) {

    const cleanZip =
      String(
        zip ||
        DEFAULT_ZIP
      )
        .trim();


    /*
      ZIP is the main lookup value.

      Adding state helps prevent a bad match
      if the geocoder sees multiple possible results.
    */

    let searchName =
      cleanZip;


    if (
      state
    ) {

      searchName +=
        `, ${state}`;

    }


    const url =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(searchName)}` +
      "&count=10" +
      "&language=en" +
      "&format=json" +
      "&countryCode=US";


    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          cache:
            "no-store"
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        `ZIP geocoding failed with HTTP ${response.status}.`
      );

    }


    const data =
      await response.json();


    const results =
      Array.isArray(
        data?.results
      )
        ? data.results
        : [];


    if (
      !results.length
    ) {

      throw new Error(
        `No weather location found for ZIP ${cleanZip}.`
      );

    }


    /*
      Prefer an Illinois / matching-state result,
      then a matching city,
      then just use the first US result.
    */

    const wantedState =
      String(
        state ||
        ""
      )
        .trim()
        .toLowerCase();


    const wantedCity =
      String(
        city ||
        ""
      )
        .trim()
        .toLowerCase();


    let selected =
      null;


    if (
      wantedCity
    ) {

      selected =
        results.find(
          function (
            item
          ) {

            return (
              String(
                item?.name ||
                ""
              )
                .trim()
                .toLowerCase() ===
              wantedCity
            );

          }
        ) ||
        null;

    }


    if (
      !selected &&
      wantedState
    ) {

      selected =
        results.find(
          function (
            item
          ) {

            const admin1 =
              String(
                item?.admin1 ||
                ""
              )
                .trim()
                .toLowerCase();


            const adminCode =
              String(
                item?.admin1_code ||
                ""
              )
                .trim()
                .toLowerCase();


            return (
              admin1 ===
                wantedState ||
              adminCode ===
                wantedState
            );

          }
        ) ||
        null;

    }


    if (
      !selected
    ) {

      selected =
        results[0];

    }


    const lat =
      Number(
        selected.latitude
      );


    const lon =
      Number(
        selected.longitude
      );


    if (
      !Number.isFinite(
        lat
      ) ||
      !Number.isFinite(
        lon
      )
    ) {

      throw new Error(
        `Invalid coordinates returned for ZIP ${cleanZip}.`
      );

    }


    let locationLabel =
      "";


    if (
      city &&
      state
    ) {

      locationLabel =
        `${city}, ${state}`;

    }
    else if (
      selected.name &&
      selected.admin1
    ) {

      locationLabel =
        `${selected.name}, ${selected.admin1}`;

    }
    else if (
      selected.name
    ) {

      locationLabel =
        selected.name;

    }
    else {

      locationLabel =
        cleanZip;

    }


    return {
      lat,
      lon,
      locationLabel,
      zip:
        cleanZip
    };

  }


  async function resolveWeatherLocation() {

    /*
      If something elsewhere in FarmVista already
      supplied coordinates, keep using them.
    */

    const configured =
      window.FV_DASH_WEATHER_LOCATION ||
      null;


    if (
      hasValidCoordinates(
        configured
      )
    ) {

      return {
        lat:
          Number(
            configured.lat
          ),

        lon:
          Number(
            configured.lon
          ),

        locationLabel:
          String(
            configured.locationLabel ||
            ""
          )
      };

    }


    /*
      Otherwise use the company's ZIP from Firestore.
    */

    const company =
      await getCompanyWeatherInfo();


    try {

      const location =
        await geocodeZip(
          company.addressZip,
          company.addressCity,
          company.addressState
        );


      /*
        Save it globally so anything else on
        the dashboard can reuse the result.
      */

      window.FV_DASH_WEATHER_LOCATION =
        location;


      return location;

    }
    catch (
      err
    ) {

      console.error(
        "Weather: company ZIP geocoding failed.",
        err
      );


      /*
        One final attempt using the FarmVista
        default ZIP by itself.
      */

      if (
        company.addressZip !==
        DEFAULT_ZIP
      ) {

        try {

          const fallbackLocation =
            await geocodeZip(
              DEFAULT_ZIP,
              "Divernon",
              "IL"
            );


          window.FV_DASH_WEATHER_LOCATION =
            fallbackLocation;


          return fallbackLocation;

        }
        catch (
          fallbackErr
        ) {

          console.error(
            "Weather: default ZIP geocoding failed.",
            fallbackErr
          );

        }

      }


      return null;

    }

  }


  function getWeatherLocation() {

    /*
      Only resolve Firestore + ZIP once per page load.
    */

    if (
      !resolvedWeatherLocationPromise
    ) {

      resolvedWeatherLocationPromise =
        resolveWeatherLocation();

    }


    return resolvedWeatherLocationPromise;

  }


  onReady(
    function () {

      const shell =
        document.getElementById(
          "fv-weather"
        );


      const modal =
        document.getElementById(
          "fv-weather-modal"
        );


      const modalBody =
        document.getElementById(
          "fv-weather-modal-body"
        );


      const closeBtn =
        document.getElementById(
          "fv-weather-modal-close"
        );


      if (
        !shell ||
        !modal ||
        !modalBody ||
        !closeBtn
      ) {

        console.warn(
          "Weather modal: required dashboard elements were not found."
        );

        return;

      }


      async function openModal() {

        modal.removeAttribute(
          "hidden"
        );


        document.body.style.overflow =
          "hidden";


        modalBody.innerHTML =
          `
            <div class="fv-weather-card">
              Loading weather…
            </div>
          `;


        if (
          !window.FVWeather ||
          typeof window.FVWeather.initWeatherModule !==
            "function"
        ) {

          /*
            If weather JS itself did not load,
            cloning the little dashboard card is
            still better than an empty modal.
          */

          modalBody.innerHTML =
            shell.innerHTML;


          console.warn(
            "Weather modal: FVWeather.initWeatherModule is unavailable."
          );


          return;

        }


        const weatherLocation =
          await getWeatherLocation();


        if (
          !hasValidCoordinates(
            weatherLocation
          )
        ) {

          modalBody.innerHTML =
            `
              <div class="fv-weather-card">
                Weather location could not be loaded.
              </div>
            `;


          return;

        }


        /*
          Clear the loading message before
          FVWeather renders.
        */

        modalBody.innerHTML =
          "";


        try {

          window.FVWeather.initWeatherModule({
            googleApiKey:
              "AIzaSyD5qLrXZch_rM4sVXmBrpGDH3Zp7RgfVHc",

            lat:
              Number(
                weatherLocation.lat
              ),

            lon:
              Number(
                weatherLocation.lon
              ),

            unitsSystem:
              "IMPERIAL",

            selector:
              "#fv-weather-modal-body",

            showOpenMeteo:
              true,

            mode:
              "modal",

            locationLabel:
              weatherLocation.locationLabel ||
              ""
          });

        }
        catch (
          err
        ) {

          console.error(
            "Weather modal: FVWeather initialization failed.",
            err
          );


          modalBody.innerHTML =
            `
              <div class="fv-weather-card">
                Weather could not be loaded.
              </div>
            `;

        }

      }


      function closeModal() {

        modal.setAttribute(
          "hidden",
          "hidden"
        );


        document.body.style.overflow =
          "";

      }


      shell.addEventListener(
        "click",
        function (
          evt
        ) {

          /*
            Refresh button should continue doing
            its normal refresh action instead
            of opening the modal.
          */

          if (
            evt.target.closest(
              ".fv-weather-refresh"
            )
          ) {

            return;

          }


          if (
            shell.querySelector(
              ".fv-weather-card"
            )
          ) {

            openModal();

          }

        }
      );


      closeBtn.addEventListener(
        "click",
        closeModal
      );


      modal.addEventListener(
        "click",
        function (
          evt
        ) {

          if (
            evt.target ===
            modal
          ) {

            closeModal();

          }

        }
      );


      document.addEventListener(
        "keydown",
        function (
          evt
        ) {

          if (
            evt.key ===
            "Escape"
          ) {

            closeModal();

          }

        }
      );

    }
  );

})();
