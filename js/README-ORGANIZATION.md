# FarmVista JavaScript — Major Restructure Cleanup

Working branch: `major-js-restructure-cleanup`

This branch is the complete JavaScript restructuring workspace. `main` must remain untouched until the new structure has been inspected and the application has been tested.

## Proposed final structure

```text
js/
├── app/
├── auth/
│   ├── login/
│   └── session/
├── core/
│   ├── firebase/
│   ├── shell/
│   ├── theme/
│   └── version/
├── crop-planning/
├── dashboard/
│   ├── kpi/
│   ├── markets/
│   ├── messages/
│   ├── permissions/
│   └── ui/
├── equipment/
│   └── shop/
├── field-readiness/
├── fields/
│   ├── boundaries/
│   ├── records/
│   └── ui/
├── grain/
│   ├── contracts/
│   │   ├── allocation/
│   │   ├── forms/
│   │   └── reports/
│   ├── hauling-jobs/
│   │   ├── forms/
│   │   └── legacy/
│   ├── index/
│   ├── inventory/
│   │   ├── bags/
│   │   ├── bins/
│   │   ├── movements/
│   │   └── shared/
│   ├── load-out/
│   │   └── forms/
│   ├── shared/
│   ├── tickets/
│   │   ├── alerts/
│   │   ├── assignment/
│   │   ├── detail/
│   │   ├── images/
│   │   ├── ocr/
│   │   ├── review/
│   │   ├── scan/
│   │   ├── templates/
│   │   └── ui/
│   └── transfers/
├── office/
│   ├── company/
│   ├── people/
│   ├── shared/
│   ├── subcontractors/
│   └── vendors/
├── reports/
│   ├── grain/
│   └── operations/
└── shared/
    ├── data/
    ├── maps/
    ├── permissions/
    ├── ui/
    └── weather/
```

`field-readiness/` is intentionally separate from `fields/`. Field Readiness owns rainfall/weather/readiness logic. Fields owns actual field management.

## Completion gate

The branch is **not complete** merely because destination folders exist. Before it is called ready for review:

1. Every JavaScript file must be classified into its final feature folder or intentionally documented as a root exception.
2. Every HTML `<script src>` reference must point to the final path.
3. Every ES-module static/dynamic import must point to the final path.
4. Every JavaScript-created script URL and other hard-coded `/js/...` path must point to the final path.
5. Service-worker/precache/cache-manifest references must point to final paths.
6. Old root copies must be removed after consumers are migrated.
7. Searches for old paths must return no active consumers.
8. No business logic or feature behavior should be changed as part of the move.
9. `main` remains untouched until branch inspection and testing are complete.
