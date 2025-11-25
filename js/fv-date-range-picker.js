// ======================================================================
// /Farm-vista/js/fv-date-range-picker.js
// Reusable date range picker logic for FarmVista.
//
// Usage:
//   1) Include this script (non-module) on any page:
//        <script src="/Farm-vista/js/fv-date-range-picker.js"></script>
//
//   2) Make sure the page has the standard markup IDs:
//        • jobRangeInput     (readonly text input)
//        • calendarPopover   (popover container)
//        • monthSelect       (select for month)
//        • yearSelect        (select for year)
//        • prevMonthBtn      (previous month button)
//        • nextMonthBtn      (next month button)
//        • rangeSummary      (footer summary span)
//        • clearRangeBtn     (Clear button)
//        • applyRangeBtn     (Apply button)
//        • closeCalBtn       (X / close button)
//
//   If those elements aren’t present, this script quietly no-ops.
//
//   It also exposes a tiny global, window.FVDateRangePicker, in case
//   you ever want to re-init manually: FVDateRangePicker.init();
// ======================================================================
(function (global) {
  'use strict';

  function init() {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Grab required elements (if input is missing, abort for this page)
    const jobInput     = document.getElementById('jobRangeInput');
    const popover      = document.getElementById('calendarPopover');
    const monthSelect  = document.getElementById('monthSelect');
    const yearSelect   = document.getElementById('yearSelect');
    const prevBtn      = document.getElementById('prevMonthBtn');
    const nextBtn      = document.getElementById('nextMonthBtn');
    const daysContainer= document.getElementById('calDays');
    const rangeSummary = document.getElementById('rangeSummary');
    const clearBtn     = document.getElementById('clearRangeBtn');
    const applyBtn     = document.getElementById('applyRangeBtn');
    const closeBtn     = document.getElementById('closeCalBtn');

    if (!jobInput || !popover || !monthSelect || !yearSelect ||
        !prevBtn || !nextBtn || !daysContainer || !rangeSummary ||
        !clearBtn || !applyBtn || !closeBtn) {
      // Markup not present on this page – safe no-op
      return;
    }

    let viewYear;
    let viewMonth; // 0-11

    let rangeStart = null;
    let rangeEnd   = null;

    function formatDate(date) {
      if (!date) return '';
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }

    function compareDates(a, b) {
      const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
      const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
      return da - db;
    }

    function isSameDay(a, b) {
      return a && b &&
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
    }

    function updateSummary() {
      if (rangeStart && rangeEnd) {
        rangeSummary.textContent = formatDate(rangeStart) + ' – ' + formatDate(rangeEnd);
      } else if (rangeStart) {
        rangeSummary.textContent = 'Start: ' + formatDate(rangeStart);
      } else {
        rangeSummary.textContent = 'No dates selected';
      }
    }

    function buildYearOptions() {
      const currentYear = new Date().getFullYear();
      const startYear = currentYear - 5;
      const endYear   = currentYear + 5;
      yearSelect.innerHTML = '';
      for (let y = startYear; y <= endYear; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
      }
    }

    function buildMonthOptions() {
      monthSelect.innerHTML = '';
      monthNames.forEach((name, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = name;
        monthSelect.appendChild(opt);
      });
    }

    function renderCalendar() {
      monthSelect.value = viewMonth;
      yearSelect.value = viewYear;
      daysContainer.innerHTML = '';

      const firstOfMonth  = new Date(viewYear, viewMonth, 1);
      const startWeekday  = firstOfMonth.getDay();
      const daysInMonth   = new Date(viewYear, viewMonth + 1, 0).getDate();

      // previous month padding days
      const prevMonth     = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevYear      = viewMonth === 0 ? viewYear - 1 : viewYear;
      const daysInPrevMon = new Date(prevYear, prevMonth + 1, 0).getDate();

      const totalCells = 42; // 6 weeks x 7 days

      for (let cell = 0; cell < totalCells; cell++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';

        let cellDate;

        if (cell < startWeekday) {
          // previous month
          const dayNum = daysInPrevMon - (startWeekday - 1 - cell);
          dayCell.textContent = dayNum;
          dayCell.classList.add('other-month');
          cellDate = new Date(prevYear, prevMonth, dayNum);
        } else if (cell >= startWeekday + daysInMonth) {
          // next month
          const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
          const nextYear  = viewMonth === 11 ? viewYear + 1 : viewYear;
          const dayNum    = cell - (startWeekday + daysInMonth) + 1;
          dayCell.textContent = dayNum;
          dayCell.classList.add('other-month');
          cellDate = new Date(nextYear, nextMonth, dayNum);
        } else {
          // current month
          const dayNum = cell - startWeekday + 1;
          dayCell.textContent = dayNum;
          cellDate = new Date(viewYear, viewMonth, dayNum);
        }

        // First-click start highlight (no end yet)
        if (rangeStart && !rangeEnd && isSameDay(cellDate, rangeStart)) {
          dayCell.classList.add('start-selected');
        }

        // Full range styling once both dates are selected
        if (rangeStart && rangeEnd) {
          const cmpStart = compareDates(cellDate, rangeStart);
          const cmpEnd   = compareDates(cellDate, rangeEnd);

          if (isSameDay(cellDate, rangeStart) && isSameDay(cellDate, rangeEnd)) {
            // Start and end are the same day
            dayCell.classList.add('single-day');
          } else if (isSameDay(cellDate, rangeStart)) {
            dayCell.classList.add('range-start');
          } else if (isSameDay(cellDate, rangeEnd)) {
            dayCell.classList.add('range-end');
          } else if (cmpStart > 0 && cmpEnd < 0) {
            dayCell.classList.add('in-range');
          }
        }

        dayCell.addEventListener('click', function () {
          handleDateClick(cellDate);
        });

        daysContainer.appendChild(dayCell);
      }
    }

    function handleDateClick(date) {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        // start new range
        rangeStart = date;
        rangeEnd = null;
      } else if (rangeStart && !rangeEnd) {
        if (compareDates(date, rangeStart) < 0) {
          // clicked before start — make new start
          rangeStart = date;
        } else {
          rangeEnd = date;
        }
      }
      updateSummary();
      renderCalendar();
    }

    function openCalendar() {
      popover.style.display = 'block';
    }

    function closeCalendar() {
      popover.style.display = 'none';
    }

    // ----------------- Event wiring -----------------

    prevBtn.addEventListener('click', function () {
      if (viewMonth === 0) {
        viewMonth = 11;
        viewYear--;
      } else {
        viewMonth--;
      }
      renderCalendar();
    });

    nextBtn.addEventListener('click', function () {
      if (viewMonth === 11) {
        viewMonth = 0;
        viewYear++;
      } else {
        viewMonth++;
      }
      renderCalendar();
    });

    monthSelect.addEventListener('change', function () {
      viewMonth = parseInt(this.value, 10);
      renderCalendar();
    });

    yearSelect.addEventListener('change', function () {
      viewYear = parseInt(this.value, 10);
      renderCalendar();
    });

    clearBtn.addEventListener('click', function () {
      rangeStart = null;
      rangeEnd   = null;
      jobInput.value = '';
      updateSummary();
      renderCalendar();
    });

    applyBtn.addEventListener('click', function () {
      if (rangeStart && rangeEnd) {
        jobInput.value = formatDate(rangeStart) + ' – ' + formatDate(rangeEnd);
      } else if (rangeStart) {
        jobInput.value = formatDate(rangeStart);
      } else {
        jobInput.value = '';
      }
      closeCalendar();
    });

    closeBtn.addEventListener('click', closeCalendar);

    jobInput.addEventListener('click', openCalendar);
    jobInput.addEventListener('focus', openCalendar);

    // ----------------- Initial boot -----------------
    const today = new Date();
    viewYear  = today.getFullYear();
    viewMonth = today.getMonth();
    buildMonthOptions();
    buildYearOptions();
    updateSummary();
    renderCalendar();
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Small global hook in case you ever want to re-init
  global.FVDateRangePicker = {
    init
  };

})(window);
