/* FarmVista — iPhone grain-ticket native still capture
   Safari getUserMedia exposes a video-preview stream, not the full-resolution
   camera still. For iPhone/iPad grain-ticket scans, route the shutter through
   the existing capture="environment" file input so OCR receives the camera's
   actual still photograph. The existing scanner file-input handler continues
   the normal OCR/save flow. */
(function () {
  'use strict';

  const path = String(location.pathname || '').toLowerCase();
  if (!path.endsWith('/pages/grain/grain-ticket-scan.html')) return;
  if (window.__FV_IOS_NATIVE_GRAIN_STILL_20260916_1) return;
  window.__FV_IOS_NATIVE_GRAIN_STILL_20260916_1 = true;

  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isAppleMobile) return;

  function install() {
    const captureBtn = document.getElementById('captureBtn');
    const fileInput = document.getElementById('fileInput');
    if (!captureBtn || !fileInput || captureBtn.dataset.fvIosNativeStill === '1') return false;

    captureBtn.dataset.fvIosNativeStill = '1';
    fileInput.setAttribute('accept', 'image/*');
    fileInput.setAttribute('capture', 'environment');

    captureBtn.addEventListener('click', event => {
      if (captureBtn.disabled) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      console.log('[Grain Ticket] iPhone native still capture requested for OCR.');
      fileInput.click();
    }, true);

    console.log('[Grain Ticket] iPhone native full-resolution still capture enabled.');
    return true;
  }

  if (install()) return;

  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });

  setTimeout(() => observer.disconnect(), 15000);
})();
