/* FarmVista — hauling-job ticket sequence compatibility shim — Sept. 12, 2026
   Sequence, split-load, Spot Loads, collapse/expand, and hauling-job DND behavior
   are now owned by grain-hauling-status-dnd.js. This file intentionally does
   nothing so the older decorator cannot compete with the live DND renderer.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_TICKET_SEQUENCE_COMPAT_20260912_V4) return;
  window.__FV_HAULING_TICKET_SEQUENCE_COMPAT_20260912_V4 = true;
})();
