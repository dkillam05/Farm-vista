# FarmVista JavaScript — Major Restructure Cleanup

Working branch: `major-js-restructure-cleanup`

This branch is the complete JavaScript restructuring workspace. `main` must remain untouched until the new structure has been inspected and the application has been tested.

## Structure

- `core/`
  - `firebase/` — Firebase configuration and application data plumbing
  - `shell/` — FarmVista shell, startup and application bootstrap
  - `theme/` — theme/bootstrap appearance infrastructure
  - `version/` — version/update infrastructure
- `auth/` — login, authentication, session and user context
- `dashboard/`
  - `kpi/`
  - `markets/`
  - `messages/`
  - `permissions/`
- `fields/`
  - `boundaries/`
  - `records/`
- `field-readiness/` — rainfall/weather/readiness only; intentionally independent from `fields/`
- `grain/`
  - `contracts/`
  - `hauling-jobs/`
    - `forms/`
    - `legacy/`
  - `tickets/`
    - `scan/`
    - `ocr/`
    - `detail/`
    - `alerts/`
    - `images/`
    - `ui/`
  - `load-out/`
  - `inventory/`
  - `transfers/`
  - `shared/`
- `crop-planning/`
- `equipment/`
  - `shop/`
- `office/`
- `reports/`
- `shared/`
  - `ui/`
  - `data/`
  - `maps/`
  - `permissions/`
  - `weather/`
- `app/` — existing app-level modules that are already logically grouped

## Restructure completion gate

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
