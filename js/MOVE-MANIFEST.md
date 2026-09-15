# JavaScript Move Manifest

This file is the path-migration ledger for the major restructure. It exists to prevent deleting an old path before all consumers have been changed.

For every JavaScript source being relocated, record:

```text
OLD: /js/<old-file>.js
NEW: /js/<feature>/<subfeature>/<file>.js
CONSUMERS: <HTML/JS/service-worker/cache files>
STATUS: inventory | copied | consumers-migrated | old-path-removed | verified
```

## Required consumer classes

- HTML `<script src>`
- ES-module `import ... from`
- dynamic `import()`
- runtime-created script elements
- service worker/precache/cache lists
- absolute and relative `/js/` URLs
- guest scanner
- dashboard/root index
- report pages
- Grain pages
- authentication pages

No entry is `verified` until the old path has no active consumer and the new target exists.
