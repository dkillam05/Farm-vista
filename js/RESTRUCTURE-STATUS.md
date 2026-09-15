# Major JavaScript Restructure — Status

## Current phase

**ACTIVE — inventory, classification, relocation and reference migration.**

Do not merge this branch into `main` yet.

## Rules for this operation

- Work only on `major-js-restructure-cleanup`.
- Preserve runtime behavior; organization/path changes only.
- `fields/` and `field-readiness/` remain independent feature areas.
- Do not delete an old JS path until its active consumers have been migrated.
- After migration, delete old duplicate/root files so `/js` reflects the final structure rather than two copies.
- Audit HTML, JS modules, dynamic loaders, service workers, cache lists, guest scan pages, dashboard/index pages and report pages for references.
- Final branch review happens before runtime testing and before any change to `main`.

## Ready-for-user-review means

The GitHub tree itself is clean enough to inspect as the proposed final organization, old duplicate JS paths are gone, and source references have been migrated. Runtime testing is a separate phase after folder-layout approval.
