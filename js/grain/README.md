# Grain JavaScript

Grain is split by workflow so high-risk ticket scanning and allocation code does not get mixed with contracts, inventory, or load-out.

- `contracts/` — contract list/form/report/manual-close behavior
- `hauling-jobs/` — hauling-job list and assignment behavior
  - `forms/` — add/edit picker/form behavior
  - `legacy/` — superseded picker revisions retained only when still required during migration
- `index/` — Grain Index page behavior
- `inventory/` — bin/bag/storage inventory and movements
- `load-out/` — load-out/preload workflows
- `tickets/` — ticket workflows
  - `scan/` — camera/capture/scan flow
  - `ocr/` — OCR parsing/templates/normalization
  - `detail/` — ticket-detail page behavior
  - `alerts/` — ticket alert/review helpers
  - `images/` — ticket image/viewer helpers
  - `ui/` — reusable ticket UI helpers
- `transfers/` — grain transfer workflows
- `shared/` — helpers shared across multiple Grain workflows

Do not move Field Readiness code here; it is unrelated to Grain.
