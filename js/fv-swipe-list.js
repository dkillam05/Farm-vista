/* =======================================================================
/Farm-vista/js/fv-swipe-list.js
Rev: 2025-11-26b

Reusable swipeable-list helper for FarmVista.

Features
- Turns simple list items into swipeable rows with:
    • Right-swipe: "positive" action (e.g., Add / Confirm)
    • Left-swipe:  "danger" action (e.g., Delete / Remove)
- Only one row can be open at a time.
- Handles touch vs. scroll on phones (only horizontal drags become swipes).
- Provides callbacks for your page to handle the actions.

Usage on a page (example):

  <link rel="stylesheet" href="/Farm-vista/assets/css/swipe-list.css" />

  <!-- Your list markup -->
  <div id="trial-fields-list">
    <div class="fv-swipe-item" data-field-id="abc123">
      <!-- existing card content -->
    </div>
    ...
  </div>

  <script type="module">
    import { initSwipeList } from '/Farm-vista/js/fv-swipe-list.js';

    initSwipeList('#trial-fields-list', {
      itemSelector: '.fv-swipe-item',
      rightAction: { // swipe LEFT to reveal (danger)
        label: 'Remove',
        onAction: (itemEl) => {
          const fieldId = itemEl.dataset.fieldId;
          // call your delete/remove logic here
        }
      },
      leftAction: {  // swipe RIGHT to reveal (positive)
        label: 'Add Yield',
        onAction: (itemEl) => {
          const fieldId = itemEl.dataset.fieldId;
          // open your yield popup here
        }
      }
    });
  </script>

======================================================================= */

// Simple inline SVG icons for reuse.
const ICON_CHECK = `
  <svg viewBox="0 0 24 24" aria-hidden="true" class="fv-swipe-icon">
    <path d="M9.5 16.2L5.3 12l-1.4 1.4L9.5 18 20 7.5 18.6 6.1z"></path>
  </svg>
`;

const ICON_TRASH = `
  <svg viewBox="0 0 24 24" aria-hidden="true" class="fv-swipe-icon">
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9z"></path>
  </svg>
`;

/**
 * Initialize swipe behavior on a list.
 *
 * @param {string|Element} rootSelectorOrEl - container element or selector.
 * @param {Object} options
 * @param {string} [options.itemSelector='.fv-swipe-item'] - which children to make swipeable.
 * @param {Object|null} [options.leftAction]  - revealed when swiping RIGHT.
 * @param {string} [options.leftAction.label=''] - label text.
 * @param {Function} [options.leftAction.onAction] - callback(itemEl).
 * @param {Object|null} [options.rightAction] - revealed when swiping LEFT.
 * @param {string} [options.rightAction.label=''] - label text.
 * @param {Function} [options.rightAction.onAction] - callback(itemEl).
 */
export function initSwipeList(rootSelectorOrEl, options = {}) {
  const {
    itemSelector = '.fv-swipe-item',
    leftAction = null,
    rightAction = null
  } = options;

  const root =
    typeof rootSelectorOrEl === 'string'
      ? document.querySelector(rootSelectorOrEl)
      : rootSelectorOrEl;

  if (!root) {
    console.warn('fv-swipe-list: root not found for', rootSelectorOrEl);
    return;
  }

  const items = Array.from(root.querySelectorAll(itemSelector));
  if (!items.length) {
    console.warn('fv-swipe-list: no items found with selector', itemSelector);
    return;
  }

  const ACTION_WIDTH = 88;      // px, width of action buttons
  const OPEN_THRESHOLD = 40;    // px, drag needed to "snap" open
  const SWIPE_MIN_MOVE = 8;     // px, minimum movement before we decide
  const rows = [];
  let openRow = null;

  // Close any currently open row.
  function closeOpenRow(exceptRow) {
    if (!openRow || openRow === exceptRow) return;
    openRow.content.style.transform = 'translateX(0)';
    openRow.el.classList.remove('fv-swipe-open-left', 'fv-swipe-open-right');
    openRow.el.dataset.fvSwipeState = 'closed';
    openRow = null;
  }

  // Create DOM structure and wire events for each item.
  items.forEach((item) => {
    const original = item;
    const parent = original.parentElement;
    if (!parent) return;

    const row = document.createElement('div');
    row.className = 'fv-swipe-row';
    row.dataset.fvSwipeState = 'closed';

    const actions = document.createElement('div');
    actions.className = 'fv-swipe-actions';

    // Left (swipe RIGHT) action – typically "positive"
    let leftBtn = null;
    if (leftAction) {
      leftBtn = document.createElement('button');
      leftBtn.type = 'button';
      leftBtn.className =
        'fv-swipe-action fv-swipe-action-left fv-swipe-intent-positive';
      leftBtn.innerHTML = `
        <span class="fv-swipe-action-inner">
          ${ICON_CHECK}
          ${leftAction.label ? `<span class="fv-swipe-label">${leftAction.label}</span>` : ''}
        </span>
      `;
      actions.appendChild(leftBtn);
    }

    // Right (swipe LEFT) action – typically "danger"
    let rightBtn = null;
    if (rightAction) {
      rightBtn = document.createElement('button');
      rightBtn.type = 'button';
      rightBtn.className =
        'fv-swipe-action fv-swipe-action-right fv-swipe-intent-danger';
      rightBtn.innerHTML = `
        <span class="fv-swipe-action-inner">
          ${ICON_TRASH}
          ${rightAction.label ? `<span class="fv-swipe-label">${rightAction.label}</span>` : ''}
        </span>
      `;
      actions.appendChild(rightBtn);
    }

    const content = document.createElement('div');
    content.className = 'fv-swipe-content';

    // Build row structure first.
    row.appendChild(actions);
    row.appendChild(content);

    // IMPORTANT FIX:
    // Replace the original element in the DOM with our new row
    // *before* we move the original into the content wrapper.
    parent.replaceChild(row, original);

    // Now move the original item into the content wrapper.
    content.appendChild(original);

    // Keep references.
    const rowState = {
      el: row,
      content,
      item: original,
      pointerId: null,
      startX: 0,
      startY: 0,
      currentX: 0,
      dragging: false,
      swiping: false,
      ignoreClickOnce: false
    };
    rows.push(rowState);

    // ---- Pointer events for swipe ----
    const downHandler = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;

      rowState.pointerId = ev.pointerId;
      rowState.startX = ev.clientX;
      rowState.startY = ev.clientY;
      rowState.currentX = ev.clientX;
      rowState.dragging = true;
      rowState.swiping = false;
      rowState.ignoreClickOnce = false;

      content.setPointerCapture(ev.pointerId);
    };

    const moveHandler = (ev) => {
      if (!rowState.dragging || ev.pointerId !== rowState.pointerId) return;

      const dx = ev.clientX - rowState.startX;
      const dy = ev.clientY - rowState.startY;

      // Decide if this is a swipe vs scroll.
      if (!rowState.swiping) {
        if (
          Math.abs(dx) < SWIPE_MIN_MOVE &&
          Math.abs(dy) < SWIPE_MIN_MOVE
        ) {
          return;
        }

        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal swipe.
          rowState.swiping = true;
          closeOpenRow(rowState); // close others
        } else {
          // Vertical scroll – cancel swipe.
          rowState.dragging = false;
          content.releasePointerCapture(ev.pointerId);
          return;
        }
      }

      ev.preventDefault(); // prevent page scroll while swiping

      let translateX = dx;

      // Clamp translation.
      if (translateX > ACTION_WIDTH) translateX = ACTION_WIDTH;
      if (translateX < -ACTION_WIDTH) translateX = -ACTION_WIDTH;

      rowState.currentX = translateX;
      content.style.transition = 'none';
      content.style.transform = `translateX(${translateX}px)`;
    };

    const upHandler = (ev) => {
      if (!rowState.dragging || ev.pointerId !== rowState.pointerId) return;

      rowState.dragging = false;
      content.releasePointerCapture(ev.pointerId);

      if (!rowState.swiping) {
        // Not a swipe – let click go through.
        return;
      }

      ev.preventDefault();
      rowState.swiping = false;

      const dx = rowState.currentX;
      let finalState = 'closed';

      content.style.transition = ''; // restore CSS transition

      if (dx > OPEN_THRESHOLD && leftAction) {
        // Open left (positive) action – swipe RIGHT
        content.style.transform = `translateX(${ACTION_WIDTH}px)`;
        row.classList.add('fv-swipe-open-left');
        row.classList.remove('fv-swipe-open-right');
        finalState = 'left';
        openRow = rowState;
      } else if (dx < -OPEN_THRESHOLD && rightAction) {
        // Open right (danger) action – swipe LEFT
        content.style.transform = `translateX(${-ACTION_WIDTH}px)`;
        row.classList.add('fv-swipe-open-right');
        row.classList.remove('fv-swipe-open-left');
        finalState = 'right';
        openRow = rowState;
      } else {
        // Snap closed
        content.style.transform = 'translateX(0)';
        row.classList.remove('fv-swipe-open-left', 'fv-swipe-open-right');
        openRow = null;
      }

      row.dataset.fvSwipeState = finalState;

      // If we ended with an open state, ignore the click that follows.
      if (finalState !== 'closed') {
        rowState.ignoreClickOnce = true;
      }
    };

    content.addEventListener('pointerdown', downHandler);
    content.addEventListener('pointermove', moveHandler);
    content.addEventListener('pointerup', upHandler);
    content.addEventListener('pointercancel', upHandler);

    // Prevent accidental click after a swipe.
    content.addEventListener(
      'click',
      (ev) => {
        if (rowState.ignoreClickOnce) {
          rowState.ignoreClickOnce = false;
          ev.stopPropagation();
          ev.preventDefault();
        }
      },
      true
    );

    // ---- Action button clicks ----
    if (leftBtn && leftAction && typeof leftAction.onAction === 'function') {
      leftBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        leftAction.onAction(rowState.item);
      });
    }

    if (rightBtn && rightAction && typeof rightAction.onAction === 'function') {
      rightBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        rightAction.onAction(rowState.item);
      });
    }
  });

  // Click anywhere outside an open row closes it.
  document.addEventListener('click', (ev) => {
    if (!openRow) return;
    if (!openRow.el.contains(ev.target)) {
      closeOpenRow(null);
    }
  });

  console.log(`fv-swipe-list: initialized ${rows.length} row(s)`);
}
