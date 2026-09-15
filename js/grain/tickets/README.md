# Grain Tickets

Ticket code is intentionally split because scanning/OCR, assignment, review rules, image handling and ticket-detail UI are different responsibilities.

- `scan/` — capture/scanner workflow
- `ocr/` — OCR extraction, normalization and parsing
- `templates/` — elevator/ticket-layout knowledge used by OCR
- `assignment/` — hauling-job/contract/source assignment logic
- `review/` — office review/warning classification logic
- `alerts/` — grain alert threshold/notification helpers
- `detail/` — ticket detail page behavior
- `images/` — image viewer/rotation/image handling
- `ui/` — ticket UI helpers shared by ticket pages

During relocation, behavior must remain byte-for-byte identical wherever possible. Path migration is the goal, not scanner or allocation changes.
