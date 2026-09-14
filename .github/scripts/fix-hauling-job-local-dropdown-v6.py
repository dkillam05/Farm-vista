from pathlib import Path

js = Path('js/grain-hauling-jobs.js')
html = Path('pages/grain/grain-contracts.html')
s = js.read_text(encoding='utf-8')

old = '''      const visible = Array.from(document.querySelectorAll(".fv-panel.show"));
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
'''

new = '''      const visible = Array.from(document.querySelectorAll(".fv-panel.show"));
      const panel = visible[visible.length - 1];
      if (!panel) return;

      if (panel.parentElement !== combo) combo.appendChild(panel);
      panel.classList.add("fv-hauling-job-local-panel");

      ["top","right","bottom","left","inset","transform","translate","margin","width","max-width","position"].forEach(prop => {
        panel.style.removeProperty(prop);
      });

      panel.style.setProperty("position", "absolute", "important");
      panel.style.setProperty("inset", "auto auto auto 0", "important");
      panel.style.setProperty("top", "calc(100% + 4px)", "important");
      panel.style.setProperty("left", "0", "important");
      panel.style.setProperty("right", "auto", "important");
      panel.style.setProperty("bottom", "auto", "important");
      panel.style.setProperty("transform", "none", "important");
      panel.style.setProperty("translate", "none", "important");
      panel.style.setProperty("width", "100%", "important");
      panel.style.setProperty("max-width", "100%", "important");
      panel.style.setProperty("margin", "0", "important");
      panel.style.setProperty("z-index", "20000", "important");
'''

if old not in s:
    raise SystemExit('Expected v5 localization block not found')
s = s.replace(old, new, 1)
s = s.replace('fv-hauling-modal-touch-repair-v5', 'fv-hauling-modal-touch-repair-v6', 2)
js.write_text(s, encoding='utf-8')

h = html.read_text(encoding='utf-8')
import re
h, n = re.subn(r'/js/grain-hauling-jobs\.js\?v=[^\"\']+', '/js/grain-hauling-jobs.js?v=20260913-1920', h, count=1)
if n != 1:
    raise SystemExit('Could not bump hauling job script version')
html.write_text(h, encoding='utf-8')
print('Applied hard local anchoring for hauling job dropdowns')
