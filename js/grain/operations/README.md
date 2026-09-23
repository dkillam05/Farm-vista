# FarmVista Grain Operations

This directory is the single application boundary for Grain Hauling Jobs, optional Grain Contracts, Grain Tickets, allocation, and future Settlement.

## Architecture rules
- `core/` owns business rules, totals, compatibility, status, and validation. UI files must not duplicate those rules.
- `data/grain-store.js` is the centralized Firestore read gateway.
- `data/grain-writes.js` is the centralized Firestore write gateway. UI files must not write directly to Firestore.
- `hauling/`, `contracts/`, and `tickets/` build read models from the same central state.
- `drag-drop/` decides whether and how manual allocations may move. Persistence is delegated to `data/`.
- `tickets/ticket-allocation.js` owns automatic ticket planning. Automatic hauling assignment never requires or mutates a contract assignment.
- `ui/` renders and handles browser interaction only. It must preserve the established FarmVista Grain Contracts/Hauling visual workflow rather than inventing a replacement design.
- `settlements/` remains disabled/placeholder until Settlement is intentionally designed.

## Hauling is the operational layer
A hauling job is complete and usable without a contract. Dispatch, Load Out, ticket assignment, hauling totals, rollover, completion, overhaul, and Spot behavior must continue to work when a hauling job has zero linked contracts.

Contracts are optional detail. A hauling job may have no contracts, one contract, or multiple contracts. Contracts may be created and linked later, after tickets already exist. Adding contract detail must not rewrite or invalidate the hauling assignment of those tickets.

Example: a 100,000 bu hauling job can operate by itself, or it can later contain two 50,000 bu contracts with different contract numbers, prices, or Sold Under entities. The hauling job still answers the operational question: how many bushels have been hauled and how many remain. Contracts answer the accounting/detail question: which agreement receives those bushels.

## Allocation invariants
A physical ticket remains one ticket. Bushels may be allocated in portions; never duplicate the ticket to represent a split. Compatible active hauling jobs are filled oldest-first. Overflow rolls into the next compatible active job. Spot fallback is used only when no compatible active capacity remains. Genuine Spot remains visible against its source job as operational overhaul. A whole new load arriving after all matching job capacity is filled also remains attached as Spot to an eligible job; completion by bushels does not close its delivery date window. The scanner and historical reconciliation use the same planner for this rule.

Manual hauling and manual contract overrides are independent dimensions. Changing a contract assignment must not silently move the hauling assignment, and moving a hauling assignment must not silently erase a contract assignment.

## Data-integrity invariants
- Firestore writes go through the write gateway.
- Editing a contract must not reset delivered/open totals.
- Derived hauling/contract totals are calculated from tickets and allocations where possible rather than trusted from stale status fields.
- A stale `active:true` flag cannot make a physically full hauling job eligible for new automatic allocation.
- Automatic hauling writes do not create, clear, or change contract allocation fields.
- Office review checks are advisory only. They never reject an otherwise valid ticket and never expose review warnings to the driver.

## File policy
This rebuild is intentionally organized by responsibility. Do not add one-off `fix`, `followup`, dated patch, or duplicate helper modules inside `operations/`. Extend the owning module instead. Temporary test harnesses belong outside the production module tree and must be removed when the live page is switched.

## Cutover and cleanup policy
`/pages/grain/grain-contracts.html` now runs this centralized workspace in Beta. Do not reattach the retired legacy Grain Contracts/Hauling execution path to that route. Keep legacy helpers only while another live route still references them; remove each obsolete helper only after direct reference checks confirm it is unused. Preserve Firestore schema compatibility while cleanup proceeds.
