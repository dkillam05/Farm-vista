// FarmVista Grain Operations — Settlement placeholder
// Settlement is intentionally not active yet. This module defines the boundary so future
// settlement-sheet imports can consume the same centralized contracts/tickets state.
export const SETTLEMENT_ENABLED = false;
export function settlementStatus(){ return {enabled:false,status:'placeholder'}; }
