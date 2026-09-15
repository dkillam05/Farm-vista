# JavaScript Structure Rules

1. Organize by FarmVista feature first, then workflow/responsibility.
2. Avoid version-suffixed files in active feature folders when a single current implementation can be identified; superseded revisions belong in `legacy/` during migration and can be removed later only after dependency verification.
3. Keep page-specific code near its feature rather than placing everything in global `shared/`.
4. Use `shared/` only for genuinely cross-feature helpers; use `<feature>/shared/` for helpers shared only inside one feature.
5. Core is infrastructure only. Do not use `core/` as a miscellaneous folder.
6. Fields and Field Readiness are separate sibling features.
7. Preserve filenames during initial relocation where practical; rename only when necessary to resolve ambiguity, because simultaneous moves and renames make reference auditing riskier.
8. Move first with identical blob content, migrate references, then consider code cleanup in a later project. This branch must not alter FarmVista business behavior.
