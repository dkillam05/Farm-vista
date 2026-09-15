# Grain Inventory

- `bags/` — grain bag inventory/workflows
- `bins/` — grain bin inventory/workflows
- `movements/` — inventory movement/transfer accounting helpers
- `shared/` — helpers used across multiple inventory types

Ticket scanning belongs under `../tickets/`; inventory effects triggered by a valid ticket can call shared Grain/inventory helpers without moving ticket UI into Inventory.
