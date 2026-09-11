# Trigger 2026-09-11 10:44 CDT
from pathlib import Path
import re

# Keep ADM template active in the scanner wrapper.
p = Path('pages/grain/grain-ticket-scan.html')
s = p.read_text()
s = s.replace("const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260911-3';", "const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260911-4';", 1)
old = "html = replaceRequired(html, '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6', '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6', 'grade normalizer version');"
new = "html = replaceRequired(html, '/js/grain-ticket-ocr-grade-normalizer.js?v=20260909-6', '/js/grain-ticket-ocr-grade-normalizer.js?v=20260911-7', 'grade normalizer version');"
s = s.replace(old, new, 1)
if 'grain-ticket-adm-decatur-grade-fix.js?v=20260911-3' not in s:
    marker = '      const oldAlias = `'
    inject = """      if (!html.includes('/js/grain-ticket-adm-decatur-grade-fix.js')) {\n        html = html.replace('<script type=\"module\">','<script src=\"/js/grain-ticket-adm-decatur-grade-fix.js?v=20260911-3\"></script>\\n<script type=\"module\">');\n      }\n\n"""
    assert marker in s
    s = s.replace(marker, inject + marker, 1)
p.write_text(s)

# A secure load-out scan already knows Grain Source from its assigned load-out.
scan = Path('pages/grain/grain-ticket-scan-core.html')
t = scan.read_text()
if 'LOAD-OUT SOURCE IS AUTHORITATIVE — 2026-09-11' not in t:
    old_block = '''  /* ========================================================
     GRAIN SOURCE
  ======================================================== */
  if (crop) {
    source =
      await askDriverForGrainSource(crop);
  }'''
    new_block = '''  /* ========================================================
     GRAIN SOURCE
  ======================================================== */
  /*
    LOAD-OUT SOURCE IS AUTHORITATIVE — 2026-09-11

    A secure FarmVista load-out scan already has Grain Source on its assigned
    grain_loadouts record. The load-out backend is authoritative, so asking the
    driver again can replace that context and break hauling-job linkage.
    Normal signed-in scans without a load-out still ask Grain Source.
  */
  if (crop && !isGuestScan) {
    source =
      await askDriverForGrainSource(crop);
  }'''
    assert old_block in t, 'grain source assist block not found'
    t = t.replace(old_block, new_block, 1)
    scan.write_text(t)

# Add Load: restore the copied previous hauling job into the actual select.
page = Path('pages/grain/grain-ticket.html')
g = page.read_text()
if 'PREVIOUS LOAD HAULING JOB RESTORE — 2026-09-11' not in g:
    marker = '''  function loOpenModal(){
    loState.mode = "create";
    loState.editingLoadId = null;

    loResetModalBase();
'''
    assert marker in g, 'loOpenModal marker not found'
    addition = marker + '''

    /* PREVIOUS LOAD HAULING JOB RESTORE — 2026-09-11 */
    setTimeout(() => {
      try {
        if (loState.mode !== "create") return;
        if (!loEls.haulingJob || loClean(loEls.haulingJob.value)) return;

        const copyMessage = loClean(loEls.message?.textContent).toLowerCase();
        if (!copyMessage.includes("copied") || !copyMessage.includes("previous")) return;

        const driver = loSelectedDriver();
        if (!driver) return;

        const previousLoad = loState.loads
          .filter(load =>
            loDriverMatchesLoad(load, driver) &&
            loClean(load?.haulingJobId)
          )
          .sort((a,b) =>
            loMillis(b.loadedAt || b.createdAt) -
            loMillis(a.loadedAt || a.createdAt)
          )[0] || null;

        const previousJobId = loClean(previousLoad?.haulingJobId);
        if (!previousJobId) return;

        loRenderHaulingJobs(previousJobId);
        console.log("[Grain Load Out] Restored copied previous hauling job:", {
          loadNumber: previousLoad?.loadNumber || null,
          haulingJobId: previousJobId
        });
      }
      catch (error) {
        console.warn("[Grain Load Out] Could not restore copied hauling job:", error);
      }
    }, 0);
'''
    g = g.replace(marker, addition, 1)
    page.write_text(g)
