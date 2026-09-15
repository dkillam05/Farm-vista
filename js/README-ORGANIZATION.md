# FarmVista JavaScript Organization

This branch is the JavaScript restructuring workspace. Main is intentionally untouched until the reorganized tree and all references have been reviewed and tested.

## Top-level organization

- `app/` — application-level helpers already grouped together
- `auth/` — authentication, login, user/session context
- `crop-planning/` — crop planning workflows
- `dashboard/` — dashboard KPIs, markets, messages, permissions and dashboard UI
- `field-readiness/` — rainfall, weather, field-readiness calculations and maps. This is intentionally separate from Fields.
- `fields/` — field-management functionality, boundaries and field records
- `grain/` — grain contracts, hauling jobs, tickets/scanning, load-out, inventory and transfers
- `office/` — employees, vendors, subcontractors, company/team workflows
- `reports/` — report-specific JavaScript
- `shared/` — reusable feature helpers that are not application bootstrap code
- `core/` — FarmVista boot/shell/theme/version/global infrastructure

## Safety rule

This restructuring is path/organization work only. Do not mix business-logic or feature changes into the restructuring commits. Every moved file must have all HTML script sources, ES-module imports, dynamic loaders, service-worker/cache references, and hard-coded JavaScript paths updated before this branch is considered test-ready.
