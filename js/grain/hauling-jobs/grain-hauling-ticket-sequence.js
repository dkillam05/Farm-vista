/* FarmVista — hauling-job ticket sequence compatibility loader — Sept. 12, 2026
   Sequence, split-load, Spot Loads, collapse/expand, and hauling-job DND behavior
   are owned by grain-hauling-status-dnd.js. Load the split-portion follow-up that
   turns the fill/spot ticket into two independently draggable portion tiles.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_TICKET_SEQUENCE_COMPAT_20260912_V5) return;
  window.__FV_HAULING_TICKET_SEQUENCE_COMPAT_20260912_V5 = true;
  import('/js/grain-hauling-split-portion-dnd.js?v=20260912-0838').catch(error => {
    console.warn('[FarmVista] Could not load hauling split-portion DND:', error);
  });
})();