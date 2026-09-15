# Shared JavaScript

Reusable helpers used by multiple feature areas.

- `ui/` — generic UI controls/helpers
- `data/` — reusable data helpers
- `maps/` — reusable mapping helpers
- `permissions/` — generic permission helpers
- `weather/` — generic weather helpers that are not specifically Field Readiness behavior

A helper should stay inside its feature folder when it is only shared within that feature. For example, helpers shared only among Grain pages belong in `grain/shared/`, not here.
