// ======================================================================
// /Farm-vista/js/fv-date-range-picker.js
// Reusable date range picker logic for FarmVista.
//
// Usage:
//   1) Include this script (non-module) on any page:
//        <script src="/Farm-vista/js/fv-date-range-picker.js"></script>
//
//   2) Make sure the page has the standard markup IDs:
//
//        • jobRangeInput     (readonly text input)
//        • calendarPopover   (popover container)
//        • monthSelect       (select for month)
//        • yearSelect        (select for year)
//        • rangeSummary      (footer summary span)
//        • clearRangeBtn     (Clear button)
//        • applyRangeBtn     (Apply button)
//        • closeCalBtn       (X / close button)
//        • calDays           (calendar grid container)
//
//   3) Optional per-page config (set BEFORE including this script):
//
//        <script>
//          window.FV_DATE_RANGE_PICKER_CONFIG = {
//            disallowFuture: true,
//            maxLookbackDays: 30
//          };
//        </script>
//
//      Notes:
//      - maxLookbackDays is inclusive of today.
//        Example: 30 means today + prior 29 days are selectable.
//      - If no config is supplied, picker behaves like normal.
//
//   It exposes window.FVDateRangePicker with:
//      • init()
//      • getRange()
//      • setRange(start, end, opts)
//      • clear(opts)
//      • open()
//      • close()
//
//   It dispatches:
//      • document event: 'fv:date-range-applied'
//      • document event: 'fv:date-range-cleared'
//
// ======================================================================
(function (global) {
  'use strict';

  let api = null;

  function startOfDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function toDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      const d = startOfDay(value);
      return d && !Number.isNaN(d.getTime()) ? d : null;
    }

    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;

      const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) {
        const y = Number(isoMatch[1]);
        const m = Number(isoMatch[2]) - 1;
        const d = Number(isoMatch[3]);
        const out = new Date(y, m, d);
        if (!Number.isNaN(out.getTime())) return startOfDay(out);
      }

      const parsed = new Date(s);
      if (!Number.isNaN(parsed.getTime())) return startOfDay(parsed);
    }

    return null;
  }

  function toISODate(date) {
    const d = startOfDay(date);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function compareDates(a, b) {
    const da = startOfDay(a);
    const db = startOfDay(b);
    if (!da || !db) return 0;
    return da.getTime() - db.getTime();
  }

  function isSameDay(a, b) {
    const da = startOfDay(a);
    const db = startOfDay(b);
    return !!(da && db && da.getTime() === db.getTime());
  }

  function formatDate(date) {
    const d = startOfDay(date);
    if (!d) return '';
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function getConfig() {
    const cfg = global.FV_DATE_RANGE_PICKER_CONFIG;
    if (!cfg || typeof cfg !== 'object') return {};
    return cfg;
  }

  function resolveMaxDate(cfg) {
    if (cfg.maxDate) {
      const d = toDate(cfg.maxDate);
      if (d) return d;
    }
    if (cfg.disallowFuture) {
      return startOfDay(new Date());
    }
    return null;
  }

  function resolveMinDate(cfg, maxDate) {
    if (cfg.minDate) {
      const d = toDate(cfg.minDate);
      if (d) return d;
    }

    const lookback = Number(cfg.maxLookbackDays);
    if (Number.isFinite(lookback) && lookback > 0) {
      const anchor = maxDate || startOfDay(new Date());
      const min = new Date(anchor);
      min.setDate(min.getDate() - Math.max(0, Math.floor(lookback) - 1));
      return startOfDay(min);
    }

    return null;
  }

  function init() {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const jobInput      = document.getElementById('jobRangeInput');
    const popover       = document.getElementById('calendarPopover');
    const monthSelect   = document.getElementById('monthSelect');
    const yearSelect    = document.getElementById('yearSelect');
    const daysContainer = document.getElementById('calDays');
    const rangeSummary  = document.getElementById('rangeSummary');
    const clearBtn      = document.getElementById('clearRangeBtn');
    const applyBtn      = document.getElementById('applyRangeBtn');
    const closeBtn      = document.getElementById('closeCalBtn');

    if (!jobInput || !popover || !monthSelect || !yearSelect ||
        !daysContainer || !rangeSummary || !clearBtn ||
        !applyBtn || !closeBtn) {
      api = {
        init,
        getRange: function () {
          return {
            startDate: null,
            endDate: null,
            startISO: '',
            endISO: '',
            displayValue: ''
          };
        },
        setRange: function () {},
        clear: function () {},
        open: function () {},
        close: function () {}
      };
      global.FVDateRangePicker = api;
      return;
    }

    const cfg = getConfig();

    let viewYear;
    let viewMonth;
    let rangeStart = null;
    let rangeEnd = null;

    const maxDate = resolveMaxDate(cfg);
    const minDate = resolveMinDate(cfg, maxDate);

    function inAllowedWindow(date) {
      const d = startOfDay(date);
      if (!d) return false;
      if (minDate && compareDates(d, minDate) < 0) return false;
      if (maxDate && compareDates(d, maxDate) > 0) return false;
      return true;
    }

    function getAllowedYears() {
      if (!minDate && !maxDate) {
        const currentYear = new Date().getFullYear();
        const out = [];
        for (let y = currentYear - 5; y <= currentYear + 5; y++) out.push(y);
        return out;
      }

      const startYear = minDate ? minDate.getFullYear() : (maxDate ? maxDate.getFullYear() : new Date().getFullYear());
      const endYear = maxDate ? maxDate.getFullYear() : startYear;
      const out = [];
      for (let y = startYear; y <= endYear; y++) out.push(y);
      return out;
    }

    function getAllowedMonthsForYear(year) {
      const out = [];

      for (let m = 0; m < 12; m++) {
        const monthStart = new Date(year, m, 1);
        const monthEnd = new Date(year, m + 1, 0);

        const afterMin = !minDate || compareDates(monthEnd, minDate) >= 0;
        const beforeMax = !maxDate || compareDates(monthStart, maxDate) <= 0;

        if (afterMin && beforeMax) out.push(m);
      }

      if (!out.length) {
        for (let m = 0; m < 12; m++) out.push(m);
      }

      return out;
    }

    function ensureViewInsideAllowedWindow() {
      const anchor = maxDate || startOfDay(new Date());

      if (!Number.isFinite(viewYear)) viewYear = anchor.getFullYear();
      if (!Number.isFinite(viewMonth)) viewMonth = anchor.getMonth();

      const allowedYears = getAllowedYears();
      if (!allowedYears.includes(viewYear)) {
        viewYear = anchor.getFullYear();
        if (!allowedYears.includes(viewYear)) viewYear = allowedYears[0];
      }

      const allowedMonths = getAllowedMonthsForYear(viewYear);
      if (!allowedMonths.includes(viewMonth)) {
        if (viewYear === anchor.getFullYear() && allowedMonths.includes(anchor.getMonth())) {
          viewMonth = anchor.getMonth();
        } else {
          viewMonth = allowedMonths[allowedMonths.length - 1];
        }
      }
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

    function rebuildYearOptions() {
      const selectedYear = Number(viewYear);
      const allowedYears = getAllowedYears();

      yearSelect.innerHTML = '';
      allowedYears.forEach(function (year) {
        const opt = document.createElement('option');
        opt.value = String(year);
        opt.textContent = String(year);
        if (year === selectedYear) opt.selected = true;
        yearSelect.appendChild(opt);
      });

      if (!allowedYears.includes(selectedYear)) {
        viewYear = allowedYears[0];
        yearSelect.value = String(viewYear);
      }
    }

    function rebuildMonthOptions() {
      const selectedMonth = Number(viewMonth);
      const allowedMonths = getAllowedMonthsForYear(Number(viewYear));

      monthSelect.innerHTML = '';
      allowedMonths.forEach(function (monthIndex) {
        const opt = document.createElement('option');
        opt.value = String(monthIndex);
        opt.textContent = monthNames[monthIndex];
        if (monthIndex === selectedMonth) opt.selected = true;
        monthSelect.appendChild(opt);
      });

      if (!allowedMonths.includes(selectedMonth)) {
        viewMonth = allowedMonths[allowedMonths.length - 1];
        monthSelect.value = String(viewMonth);
      }
    }

    function refreshSelectors() {
      ensureViewInsideAllowedWindow();
      rebuildYearOptions();
      rebuildMonthOptions();
      yearSelect.value = String(viewYear);
      monthSelect.value = String(viewMonth);
    }

    function applyDisabledVisuals(dayCell) {
      dayCell.setAttribute('aria-disabled', 'true');
      dayCell.classList.remove('in-range', 'range-start', 'range-end', 'single-day', 'start-selected');
      dayCell.style.opacity = '0.22';
      dayCell.style.pointerEvents = 'none';
      dayCell.style.filter = 'saturate(.45)';
      dayCell.style.cursor = 'default';
      dayCell.style.background = 'color-mix(in srgb, var(--surface) 96%, #000 4%)';
      dayCell.style.borderColor = 'rgba(255,255,255,.05)';
      dayCell.style.color = 'rgba(255,255,255,.32)';
      dayCell.style.boxShadow = 'none';
    }

    function clearDisabledVisuals(dayCell) {
      dayCell.removeAttribute('aria-disabled');
      dayCell.style.opacity = '';
      dayCell.style.pointerEvents = '';
      dayCell.style.filter = '';
      dayCell.style.cursor = '';
      dayCell.style.background = '';
      dayCell.style.borderColor = '';
      dayCell.style.color = '';
      dayCell.style.boxShadow = '';
    }

    function renderCalendar() {
      ensureViewInsideAllowedWindow();
      refreshSelectors();
      daysContainer.innerHTML = '';

      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const startWeekday = firstOfMonth.getDay();
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

      const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
      const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
      const daysInPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

      const totalCells = 42;

      for (let cell = 0; cell < totalCells; cell++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';

        let cellDate;

        if (cell < startWeekday) {
          const dayNum = daysInPrevMonth - (startWeekday - 1 - cell);
          dayCell.textContent = dayNum;
          dayCell.classList.add('other-month');
          cellDate = new Date(prevYear, prevMonth, dayNum);
        } else if (cell >= startWeekday + daysInMonth) {
          const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
          const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
          const dayNum = cell - (startWeekday + daysInMonth) + 1;
          dayCell.textContent = dayNum;
          dayCell.classList.add('other-month');
          cellDate = new Date(nextYear, nextMonth, dayNum);
        } else {
          const dayNum = cell - startWeekday + 1;
          dayCell.textContent = dayNum;
          cellDate = new Date(viewYear, viewMonth, dayNum);
        }

        const actualDate = startOfDay(cellDate);
        const disabled = !inAllowedWindow(actualDate);

        if (!disabled && rangeStart && !rangeEnd && isSameDay(actualDate, rangeStart)) {
          dayCell.classList.add('start-selected');
        }

        if (!disabled && rangeStart && rangeEnd) {
          const cmpStart = compareDates(actualDate, rangeStart);
          const cmpEnd = compareDates(actualDate, rangeEnd);

          if (isSameDay(actualDate, rangeStart) && isSameDay(actualDate, rangeEnd)) {
            dayCell.classList.add('single-day');
          } else if (isSameDay(actualDate, rangeStart)) {
            dayCell.classList.add('range-start');
          } else if (isSameDay(actualDate, rangeEnd)) {
            dayCell.classList.add('range-end');
          } else if (cmpStart > 0 && cmpEnd < 0) {
            dayCell.classList.add('in-range');
          }
        }

        if (disabled) {
          applyDisabledVisuals(dayCell);
        } else {
          clearDisabledVisuals(dayCell);
        }

        dayCell.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!inAllowedWindow(actualDate)) return;
          handleDateClick(actualDate);
        });

        dayCell.addEventListener('mousedown', function (e) {
          e.stopPropagation();
        });

        dayCell.addEventListener('touchstart', function (e) {
          e.stopPropagation();
        }, { passive: true });

        daysContainer.appendChild(dayCell);
      }
    }

    function handleDateClick(date) {
      if (!inAllowedWindow(date)) return;

      const picked = startOfDay(date);

      if (!rangeStart || (rangeStart && rangeEnd)) {
        rangeStart = picked;
        rangeEnd = null;
      } else if (rangeStart && !rangeEnd) {
        if (compareDates(picked, rangeStart) < 0) {
          rangeStart = picked;
        } else {
          rangeEnd = picked;
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

    function getRange() {
      return {
        startDate: rangeStart ? new Date(rangeStart) : null,
        endDate: rangeEnd ? new Date(rangeEnd) : null,
        startISO: rangeStart ? toISODate(rangeStart) : '',
        endISO: rangeEnd ? toISODate(rangeEnd) : '',
        displayValue: String(jobInput.value || '').trim()
      };
    }

    function emitApplied() {
      const detail = getRange();
      document.dispatchEvent(new CustomEvent('fv:date-range-applied', { detail }));
    }

    function emitCleared() {
      const detail = getRange();
      document.dispatchEvent(new CustomEvent('fv:date-range-cleared', { detail }));
    }

    function setRange(start, end, opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      const s = toDate(start);
      const e = toDate(end);

      if (!s) {
        rangeStart = null;
        rangeEnd = null;
        jobInput.value = '';
        updateSummary();
        renderCalendar();
        if (!options.silent) emitCleared();
        return;
      }

      if (!inAllowedWindow(s)) return;

      rangeStart = s;
      rangeEnd = null;

      if (e && inAllowedWindow(e) && compareDates(e, s) >= 0) {
        rangeEnd = e;
      }

      viewYear = rangeStart.getFullYear();
      viewMonth = rangeStart.getMonth();

      if (rangeStart && rangeEnd) {
        jobInput.value = formatDate(rangeStart) + ' – ' + formatDate(rangeEnd);
      } else {
        jobInput.value = formatDate(rangeStart);
      }

      updateSummary();
      renderCalendar();

      if (!options.silent) emitApplied();
    }

    function clear(opts) {
      const options = opts && typeof opts === 'object' ? opts : {};
      rangeStart = null;
      rangeEnd = null;
      jobInput.value = '';
      updateSummary();
      renderCalendar();
      if (!options.silent) emitCleared();
    }

    yearSelect.addEventListener('change', function (e) {
      e.stopPropagation();
      viewYear = parseInt(this.value, 10);
      ensureViewInsideAllowedWindow();
      rebuildMonthOptions();
      renderCalendar();
    });

    monthSelect.addEventListener('change', function (e) {
      e.stopPropagation();
      viewMonth = parseInt(this.value, 10);
      renderCalendar();
    });

    clearBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      rangeStart = null;
      rangeEnd = null;
      jobInput.value = '';
      updateSummary();
      renderCalendar();
    });

    applyBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (rangeStart && rangeEnd) {
        jobInput.value = formatDate(rangeStart) + ' – ' + formatDate(rangeEnd);
      } else if (rangeStart) {
        jobInput.value = formatDate(rangeStart);
      } else {
        jobInput.value = '';
      }

      closeCalendar();

      if (rangeStart || rangeEnd) emitApplied();
      else emitCleared();
    });

    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCalendar();
    });

    jobInput.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openCalendar();
    });

    jobInput.addEventListener('focus', function () {
      openCalendar();
    });

    popover.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    popover.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });

    popover.addEventListener('touchstart', function (e) {
      e.stopPropagation();
    }, { passive: true });

    document.addEventListener('click', function (e) {
      if (!popover || popover.style.display === 'none') return;
      if (popover.contains(e.target) || jobInput.contains(e.target)) return;
      closeCalendar();
    });

    const today = startOfDay(new Date());
    const anchor = maxDate || today;

    viewYear = anchor.getFullYear();
    viewMonth = anchor.getMonth();

    refreshSelectors();
    updateSummary();
    renderCalendar();

    api = {
      init: init,
      getRange: getRange,
      setRange: setRange,
      clear: clear,
      open: openCalendar,
      close: closeCalendar
    };

    global.FVDateRangePicker = api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FVDateRangePicker = {
    init: init,
    getRange: function () {
      return api && typeof api.getRange === 'function'
        ? api.getRange()
        : { startDate: null, endDate: null, startISO: '', endISO: '', displayValue: '' };
    },
    setRange: function (start, end, opts) {
      if (api && typeof api.setRange === 'function') api.setRange(start, end, opts);
    },
    clear: function (opts) {
      if (api && typeof api.clear === 'function') api.clear(opts);
    },
    open: function () {
      if (api && typeof api.open === 'function') api.open();
    },
    close: function () {
      if (api && typeof api.close === 'function') api.close();
    }
  };

})(window);