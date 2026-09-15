# Major JavaScript Restructure — Status

## Current phase

**ACTIVE — folder architecture established; file inventory/relocation and consumer-path migration remain in progress.**

Do not merge this branch into `main` yet and do not treat it as runtime-test-ready yet.

## Working branch

`major-js-restructure-cleanup`

## Safety

- `main` is intentionally not part of this restructuring operation.
- Preserve runtime behavior; organization/path changes only.
- `fields/` and `field-readiness/` remain independent feature areas.
- Do not delete an old JS path until its active consumers have been migrated.
- After migration, delete old duplicate/root files so `/js` reflects the final structure rather than two copies.
- Audit HTML, JS modules, dynamic loaders, service workers, cache lists, guest scan pages, dashboard/index pages and report pages for references.

## Ready-for-user-review means

The GitHub tree itself is clean enough to inspect as the proposed final organization, old duplicate JS paths are gone, and source references have been migrated. Runtime testing is a separate phase after folder-layout approval.
