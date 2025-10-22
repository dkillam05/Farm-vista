/* /Farm-vista/js/ocr-tesseract.js
   Quick client-side OCR using Tesseract.js.
   Exposes: window.FV_OCR.imageToText(file) -> Promise<{ text:string }>
   Notes:
   - Works great for phone photos and screenshots.
   - PDFs are NOT supported here (use Cloud Vision later).
*/
(function () {
  if (window.FV_OCR && typeof window.FV_OCR.imageToText === "function") return;

  const CDN = "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js";
  let loading = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = CDN;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Tesseract.js"));
      document.head.appendChild(s);
    });
    return loading;
  }

  async function imageToText(file) {
    if (!file) throw new Error("No file provided");
    // Simple guard: images only in this quick client build
    if (!/^image\//i.test(file.type)) {
      throw new Error("This quick OCR handles images/screenshots only (use a photo, PNG, or JPG).");
    }

    await loadTesseract();

    // Hint: can pass { logger:m=>console.log(m) } to see progress
    const { data } = await window.Tesseract.recognize(file, "eng");
    return { text: (data && data.text) ? String(data.text) : "" };
  }

  window.FV_OCR = Object.freeze({
    imageToText
  });
})();