# Trigger 2026-09-11 10:47 CDT
from pathlib import Path

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

# Secure FarmVista load-out / SMS scan: Grain Source is already stored on the
# assigned grain_loadouts record and must not be replaced by Driver Assist.
scan = Path('pages/grain/grain-ticket-scan-core.html')
t = scan.read_text()
if 'LOAD-OUT SOURCE IS AUTHORITATIVE — 2026-09-11' not in t:
    old_block = '''  /* ========================================================
     GRAIN SOURCE
  ======================================================== */
  if (crop) {
    source =
      await askDriverForGrainSource(crop);

    if (!source) {
      skippedReasons.push("grain_source_not_selected");
    }
  }'''
    new_block = '''  /* ========================================================
     GRAIN SOURCE
  ======================================================== */
  /*
    LOAD-OUT SOURCE IS AUTHORITATIVE — 2026-09-11

    Secure FarmVista load-out scans already have Grain Source on the assigned
    grain_loadouts record. The backend is authoritative; do not ask the driver
    to choose Active Harvest / Field / Storage again and accidentally replace
    the load-out context. Normal signed-in scans still ask Grain Source.
  */
  if (crop && !isGuestScan) {
    source =
      await askDriverForGrainSource(crop);

    if (!source) {
      skippedReasons.push("grain_source_not_selected");
    }
  }'''
    assert old_block in t, 'grain source assist block not found'
    t = t.replace(old_block, new_block, 1)

    # Back-navigation to Source must also stay disabled for secure load-out scans.
    t = t.replace(
        '''      if (crop) {
        const correctedSource =
          await askDriverForGrainSource(crop);''',
        '''      if (crop && !isGuestScan) {
        const correctedSource =
          await askDriverForGrainSource(crop);'''
    )
    t = t.replace(
        '''        if (crop) {
          const correctedSource =
            await askDriverForGrainSource(crop);''',
        '''        if (crop && !isGuestScan) {
          const correctedSource =
            await askDriverForGrainSource(crop);'''
    )
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

    /*
      PREVIOUS LOAD HAULING JOB RESTORE — 2026-09-11

      Copy Previous can restore Crop, Destination, Sold Under and Grain Source,
      then a dependent rerender clears only the hauling-job select. That is why
      the correct delivery/remaining note can show while the select is blank.
    */
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
