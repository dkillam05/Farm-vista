/* /Farm-vista/js/ocr-tesseract.js
   Quick, zero-backend OCR using Tesseract.js in the browser.
   Exposes: window.FV_OCR.imageToText(file|blob) -> { text }
   Notes: PDF isn’t handled in this quick path (images only).
*/
(function () {
  // ---- Config
  var CDN = "https://unpkg.com/tesseract.js@4.0.2/dist/tesseract.min.js";
  var LANG = "eng";

  // ---- Utils
  function loadScriptOnce(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.defer = true;
      s.onload = res; s.onerror = function () { rej(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureTesseract() {
    if (window.Tesseract && window.Tesseract.createWorker) return;
    await loadScriptOnce(CDN);
  }

  // ---- Worker lifecycle (re-used across calls)
  var workerPromise = null;
  async function getWorker() {
    await ensureTesseract();
    if (workerPromise) return workerPromise;

    workerPromise = (async function () {
      try {
        var worker = await window.Tesseract.createWorker({
          logger: function (m) { /* console.debug("[OCR]", m); */ }
        });
        await worker.loadLanguage(LANG);
        await worker.initialize(LANG);
        return worker;
      } catch (e) {
        workerPromise = null;
        throw e;
      }
    })();
    return workerPromise;
  }

  async function imageToText(input) {
    if (!input) throw new Error("No file provided");
    // Quick mode: images only. (PDF would need a PDF->image step.)
    if (String(input.type || "").toLowerCase() === "application/pdf") {
      throw new Error("Quick OCR doesn’t support PDF. Please use a photo/image.");
    }
    var worker = await getWorker();
    var result = await worker.recognize(input);
    var text = (result && result.data && result.data.text) || "";
    return { text: text };
  }

  async function teardown() {
    try {
      if (workerPromise) {
        var w = await workerPromise;
        await w.terminate();
      }
    } finally {
      workerPromise = null;
    }
  }

  // ---- Public API
  window.FV_OCR = window.FV_OCR || {};
  window.FV_OCR.imageToText = imageToText;
  window.FV_OCR.teardown = teardown;
})();