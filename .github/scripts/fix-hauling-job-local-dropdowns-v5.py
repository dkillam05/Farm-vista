from pathlib import Path
import re

js_path = Path('js/grain-hauling-jobs.js')
html_path = Path('pages/grain/grain-contracts.html')
js = js_path.read_text(encoding='utf-8')
html = html_path.read_text(encoding='utf-8')

start = js.find('function installHaulingModalTouchRepair() {')
end = js.find('\ninstallVoidGuardStyles();', start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate hauling modal repair function boundaries')

replacement = r'''function installHaulingModalTouchRepair() {
  if (document.getElementById("fv-hauling-modal-touch-repair-v5")) return;

  const style = document.createElement("style");
  style.id = "fv-hauling-modal-touch-repair-v5";
  style.textContent = `
    @media (max-width: 900px), (pointer: coarse) {
      #hauling-job-modal {
        position: fixed !important;
        inset: 0 !important;
        width: 100dvw !important;
        height: 100dvh !important;
        max-width: 100dvw !important;
        max-height: 100dvh !important;
        margin: 0 !important;
        padding: max(8px, env(safe-area-inset-top, 0px)) 8px max(8px, env(safe-area-inset-bottom, 0px)) !important;
        overflow: hidden !important;
        justify-content: center !important;
        align-items: flex-start !important;
        touch-action: none !important;
      }

      #hauling-job-modal > .modal-card {
        width: min(100%, 900px) !important;
        max-width: 100% !important;
        min-width: 0 !important;
        height: auto !important;
        max-height: calc(100dvh - max(16px, env(safe-area-inset-top, 0px)) - max(16px, env(safe-area-inset-bottom, 0px))) !important;
        margin: 0 auto !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
        touch-action: pan-y !important;
        border-radius: 14px !important;
      }

      #hauling-job-modal .modal-actions {
        position: relative !important;
        inset: auto !important;
        padding-bottom: max(18px, env(safe-area-inset-bottom, 0px)) !important;
      }

      #hauling-job-modal .edit-grid,
      #hauling-job-modal .field,
      #hauling-job-modal .fv-combo,
      #hauling-job-modal input,
      #hauling-job-modal select,
      #hauling-job-modal textarea,
      #hauling-job-modal button {
        min-width: 0 !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }

      #hauling-job-modal .fv-combo {
        position: relative !important;
        overflow: visible !important;
      }

      #hauling-job-modal .fv-combo > select {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        left: 0 !important;
        top: 0 !important;
      }

      #hauling-job-modal .fv-panel.fv-hauling-job-local-panel {
        position: absolute !important;
        top: calc(100% + 4px) !important;
        left: 0 !important;
        right: auto !important;
        bottom: auto !important;
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        z-index: 20000 !important;
        max-height: min(42dvh, 360px) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
        overscroll-behavior: contain !important;
      }
    }
  `;
  document.head.appendChild(style);

  let activeSelectId = "";
  let localizeFrame = 0;

  const localizeVisiblePanel = () => {
    cancelAnimationFrame(localizeFrame);
    localizeFrame = requestAnimationFrame(() => {
      const modal = document.getElementById("hauling-job-modal");
      if (!modal?.classList.contains("open") || !activeSelectId) return;

      const select = document.getElementById(activeSelectId);
      const combo = select?.closest?.(".fv-combo");
      if (!combo) return;

      const visible = Array.from(document.querySelectorAll(".fv-panel.show"));
      const panel = visible.find(item => {
        const owner = clean(
          item.dataset?.fvSelectId ||
          item.dataset?.selectId ||
          item.getAttribute?.("data-for")
        );
        return !owner || owner === activeSelectId;
      });

      if (!panel) return;

      if (panel.parentElement !== combo) combo.appendChild(panel);
      panel.classList.add("fv-hauling-job-local-panel");
      panel.style.removeProperty("transform");
      panel.style.setProperty("position", "absolute", "important");
      panel.style.setProperty("top", "calc(100% + 4px)", "important");
      panel.style.setProperty("left", "0", "important");
      panel.style.setProperty("right", "auto", "important");
      panel.style.setProperty("bottom", "auto", "important");
      panel.style.setProperty("width", "100%", "important");
      panel.style.setProperty("max-width", "100%", "important");
      panel.style.setProperty("margin", "0", "important");
      panel.style.setProperty("z-index", "20000", "important");

      if (activeSelectId !== "hauling-job-customer") {
        panel.querySelectorAll(".fv-item").forEach(item => {
          if (clean(item.textContent) === "+ Add New Sold Under") item.remove();
        });
      }
    });
  };

  const rememberActiveCombo = event => {
    const button = event.target.closest?.("#hauling-job-modal .fv-buttonish");
    if (!button) return;
    const select = comboSelectFromButton(button);
    if (!select?.id?.startsWith("hauling-job-")) return;
    activeSelectId = select.id;
    queueMicrotask(localizeVisiblePanel);
    setTimeout(localizeVisiblePanel, 0);
    setTimeout(localizeVisiblePanel, 20);
    setTimeout(localizeVisiblePanel, 70);
  };

  document.addEventListener("pointerdown", rememberActiveCombo, true);
  document.addEventListener("click", rememberActiveCombo, true);

  const observer = new MutationObserver(localizeVisiblePanel);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  const modalCard = document.querySelector("#hauling-job-modal > .modal-card");
  modalCard?.addEventListener("scroll", () => {
    const panel = modalCard.querySelector(".fv-panel.show.fv-hauling-job-local-panel");
    if (panel) panel.classList.remove("show");
  }, { passive: true });
}
'''

js = js[:start] + replacement + js[end:]
js_path.write_text(js, encoding='utf-8')

html, count = re.subn(
    r'/js/grain-hauling-jobs\.js\?v=[^\"\']+',
    '/js/grain-hauling-jobs.js?v=20260913-1914',
    html,
    count=1,
)
if count != 1:
    raise SystemExit('Could not bump hauling jobs module version')
html_path.write_text(html, encoding='utf-8')

print('Installed hauling job local anchored dropdown behavior v5')
