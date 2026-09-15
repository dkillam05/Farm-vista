# Restructure Audit Notes

## High-risk consumers to verify before old paths are removed

- Grain Contracts page and its contract/hauling/manual-close module scripts
- Grain Ticket Detail page
- Grain Ticket Scan pages and guest `/scan/` entry point
- Load Out / preload pages
- Grain Index
- dashboard/root `index.html`
- report pages
- login/authentication pages
- service worker and offline cache lists

## Migration principle

A successful page load is not sufficient proof of a correct move. The final audit must also find references that only execute conditionally (dynamic imports, runtime script creation, offline caches, guest scanning and rarely used add/edit pages).
