from pathlib import Path

p = Path('js/version.js')
s = p.read_text()

old_version = 'number:  "08.18.01",\n      date:    "2026-08-18",'
new_version = 'number:  "09.08.01",\n      date:    "2026-09-08",'
assert old_version in s, 'Expected FarmVista version block not found'
s = s.replace(old_version, new_version, 1)

marker = "  'use strict';\n"
loader = r'''

  /* ===================================================================
     SEPT 8, 2026 — AUTOMATIC PWA VERSION REFRESH

     Load a tiny network-only version watcher. It checks when FarmVista comes
     back to the foreground and periodically while open. When a newer deploy
     is detected it updates the service worker and reloads only from a safe
     screen, so drivers do not have to force-close or manually refresh.
  =================================================================== */
  if (!window.__FV_AUTO_UPDATE_LOADER_20260908) {
    window.__FV_AUTO_UPDATE_LOADER_20260908 = true;

    const updateScript = document.createElement('script');
    updateScript.src = '/js/fv-auto-update.js?v=20260908-1';
    updateScript.dataset.fvAutoUpdate = '1';
    document.head.appendChild(updateScript);
  }
'''

assert marker in s, 'version.js strict-mode marker not found'
s = s.replace(marker, marker + loader, 1)
p.write_text(s)
