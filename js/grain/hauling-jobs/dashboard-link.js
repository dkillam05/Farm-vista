/* Open the existing hauling record or crop filter from a dashboard link. */
const params = new URLSearchParams(location.search);
const jobId = params.get('dashboardJob');
const crop = params.get('dashboardCrop');
if (jobId || crop) {
  let done = false;
  function apply() {
    if (done) return;
    const tbody = document.getElementById('hauling-jobs-table-body');
    if (!tbody?.querySelector('[data-hauling-job-id]')) return;
    if (jobId) {
      const row = [...tbody.querySelectorAll('[data-hauling-job-id]')].find(row=>row.dataset.haulingJobId === jobId);
      if (!row) return;
      done = true;
      row.scrollIntoView({block:'center'});
      row.focus({preventScroll:true});
      row.click(); // Same existing record opener as a user's table tap; no writes.
    } else {
      const filter = document.getElementById('hauling-crop-filter');
      if (!filter) return;
      const option = [...filter.options].find(option=>option.value.toLowerCase() === crop.toLowerCase() || (/soy/i.test(crop) && /soy/i.test(option.value)));
      if (!option) return;
      done = true;
      filter.value = option.value;
      filter.dispatchEvent(new Event('change',{bubbles:true}));
      filter.scrollIntoView({block:'center'});
    }
    observer.disconnect();
  }
  const observer = new MutationObserver(apply);
  observer.observe(document.body,{childList:true,subtree:true});
  apply();
  setTimeout(()=>observer.disconnect(),30000);
}
