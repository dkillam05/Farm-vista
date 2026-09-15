/* FarmVista — split/spot portion targets + hauling filter repair — Sept. 15, 2026
   Event-driven only. No MutationObserver, polling, or continuous repaint loop.
   The hauling-job filters are populated directly from grain_hauling_jobs so Buyer,
   Sold Under, and Crop are useful even when a job has zero assigned tickets.
*/
(() => {
  'use strict';
  if (window.__FV_HAULING_SPLIT_TARGETS_20260915_V3) return;
  window.__FV_HAULING_SPLIT_TARGETS_20260915_V3 = true;
  if (!String(location.pathname || '').toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean = value => String(value ?? '').trim();
  const norm = value => clean(value).toLowerCase();
  let loaded = false;

  function unique(values) {
    return [...new Set(values.map(clean).filter(value => value && norm(value) !== 'unknown'))]
      .sort((a,b) => a.localeCompare(b, undefined, { numeric:true, sensitivity:'base' }));
  }

  function jobBuyer(job) { return clean(job?.buyerName || job?.buyer || job?.grainBuyerName || job?.destinationBuyerName); }
  function jobSoldUnder(job) { return clean(job?.customerName || job?.soldUnderName || job?.soldUnder || job?.customer); }
  function jobCrop(job) { return clean(job?.crop || job?.commodity || job?.cropName || job?.cropType); }
  function usableJob(job) {
    const status = norm(job?.status || job?.jobStatus);
    return job?.voided !== true && !status.includes('void') && !status.includes('cancel') && !status.includes('closed');
  }

  function fillSelect(id, label, values) {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = clean(select.value);
    const options = unique(values);
    select.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = `All ${label}`;
    select.appendChild(all);
    options.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = previous && options.includes(previous) ? previous : '';
  }

  function upgradeFilterCombos() {
    const ids = ['fv-ticket-job-status-filter','fv-ticket-filter-buyer','fv-ticket-filter-sold-under','fv-ticket-filter-crop'];
    ids.forEach(id => {
      const select = document.getElementById(id);
      if (!select) return;
      select.setAttribute('data-fv-combo','');
      select.setAttribute('data-fv-search','false');
    });
    window.FVCombo?.upgrade?.(document);
  }

  async function populateFilters(force=false) {
    if (loaded && !force) return;
    try {
      const F = await import('/js/firebase-init.js');
      await F.ready;
      const db = F.getFirestore();
      const snap = await F.getDocs(F.collection(db, 'grain_hauling_jobs'));
      const jobs = snap.docs.map(doc => ({ id:doc.id, ...doc.data() })).filter(usableJob);
      fillSelect('fv-ticket-filter-buyer', 'Buyers', jobs.map(jobBuyer));
      fillSelect('fv-ticket-filter-sold-under', 'Sold Under', jobs.map(jobSoldUnder));
      fillSelect('fv-ticket-filter-crop', 'Crops', jobs.map(jobCrop));
      loaded = true;
      upgradeFilterCombos();

      const message = document.getElementById('fv-ticket-hauling-message');
      if (message && /already have grain tickets assigned/i.test(message.textContent || '')) {
        message.textContent = 'Matching Jobs includes available hauling jobs, including jobs with no grain tickets assigned yet.';
      }
    } catch (error) {
      console.warn('[FarmVista] Could not populate hauling ticket filters:', error);
    }
  }

  function exposeTargets(event) {
    const portion = event.target?.closest?.('.fv-hauling-partial-tile.unassigned, .fv-hauling-partial-tile.spot');
    if (!portion) return;
    const status = document.getElementById('fv-ticket-job-status-filter');
    if (!status || status.value !== 'matching') return;
    status.value = 'active';
    status.dispatchEvent(new Event('change', { bubbles:true }));
    const message = document.getElementById('fv-ticket-hauling-message');
    if (message) {
      message.textContent = 'Showing active hauling jobs for this split/spot portion. Destination and crop must match; Sold Under may be changed by the manual split override.';
      message.classList.add('ready');
    }
  }

  function start() {
    requestAnimationFrame(() => setTimeout(() => {
      populateFilters(false);
      upgradeFilterCombos();
    }, 350));
  }

  document.addEventListener('click', event => {
    if (event.target?.closest?.('#fv-refresh-ticket-hauling')) {
      populateFilters(true).then(upgradeFilterCombos);
    }
  }, true);
  document.addEventListener('pointerdown', exposeTargets, true);
  document.addEventListener('mousedown', exposeTargets, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
