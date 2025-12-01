/* =======================================================================
/Farm-vista/js/ai-reports.js
Lightweight AI helper for reports (trial summaries, etc.)

Usage from a report page:
  window.FVAiReports.renderTrialSummary(containerElement, {
    trial: {...},          // trial document from fieldTrials/{id}
    totals: {...},         // rolled up totals (see reports-trial-summary)
    fields: [ { data, stats }, ... ]
  });

Behavior:
  • If window.FV_AI_REPORTS_ENDPOINT is defined, POSTs payload to that URL
    and expects JSON: { summary: "paragraph..." } or { text: "..." }.
  • If no endpoint is defined, falls back to a numeric-based narrative that
    runs entirely in the browser (no external calls).
======================================================================= */
(function(global){
  function buildLocalSummary(payload){
    if (!payload) return 'This trial summary is available, but there was not enough information to describe it.';

    const t = payload.trial || {};
    const s = payload.totals || {};

    const parts = [];

    const cropYear = t.cropYear ? String(t.cropYear) : '';
    const crop = t.crop || '';
    const trialType = t.trialType || 'trial';
    const treat = t.treatmentProduct || 'the treatment';
    const check = t.check || 'the check';

    let header = 'This trial compared ' + treat + ' against ' + check;
    if (crop || cropYear || trialType) {
      const extras = [];
      if (trialType) extras.push(trialType.toLowerCase());
      if (crop) extras.push(crop.toLowerCase());
      if (cropYear) extras.push('in ' + cropYear);
      header += ' as a ' + extras.join(' ');
    }
    header += '.';
    parts.push(header);

    const fieldsCount = s.fieldCount || 0;
    if (fieldsCount || s.tillableAll || s.trialAcresAll) {
      const areaBits = [];
      if (fieldsCount) areaBits.push(fieldsCount + ' field' + (fieldsCount === 1 ? '' : 's'));
      if (s.trialAcresAll) areaBits.push(Math.round(s.trialAcresAll).toLocaleString() + ' trial acres');
      if (s.tillableAll) areaBits.push(Math.round(s.tillableAll).toLocaleString() + ' tillable acres covered');
      if (areaBits.length) {
        parts.push('The trial covered approximately ' + areaBits.join(', ') + '.');
      }
    }

    if (typeof s.checkAvgAll === 'number' && typeof s.trialAvgAll === 'number') {
      const diff = s.trialAvgAll - s.checkAvgAll;
      const direction = diff >= 0 ? 'increase' : 'decrease';
      const absDiff = Math.abs(diff);

      let perf = 'Across all fields with yield data, the treatment averaged '
        + s.trialAvgAll.toFixed(1) + ' bu/acre compared with '
        + s.checkAvgAll.toFixed(1) + ' bu/acre for the check, a '
        + absDiff.toFixed(1) + ' bu/acre ' + direction + ' for the treatment';
      perf += '.';
      parts.push(perf);
    }

    const fields = Array.isArray(payload.fields) ? payload.fields : [];
    if (fields.length) {
      // Spot the largest advantage field
      let best = null;
      for (const f of fields) {
        if (!f || !f.stats) continue;
        if (typeof f.stats.advantage !== 'number') continue;
        if (!best || f.stats.advantage > best.stats.advantage) {
          best = f;
        }
      }
      if (best && best.stats.advantage > 0.01) {
        const name = (best.data && best.data.fieldName) || 'one field';
        const adv = best.stats.advantage.toFixed(1);
        parts.push(name + ' showed the strongest response, with the treatment out-yielding the check by about ' + adv + ' bu/acre.');
      }
    }

    if (!parts.length) {
      return 'This trial has been recorded, but yield data is limited so a narrative summary is not yet available.';
    }

    return parts.join(' ');
  }

  function renderTrialSummary(container, payload){
    if (!container) return;
    container.innerHTML = '<div class="ai-summary-loading">Building trial summary…</div>';

    const endpoint = global.FV_AI_REPORTS_ENDPOINT;
    if (!endpoint) {
      // Local, non-network summary
      const text = buildLocalSummary(payload);
      container.innerHTML = '<p>' + text + '</p><p class="ai-summary-note">This summary was generated locally from your numbers. To plug in your Cloud Run AI service later, set <code>window.FV_AI_REPORTS_ENDPOINT</code> to your endpoint URL.</p>';
      return;
    }

    // Remote AI endpoint
    fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        kind: 'trial-summary',
        payload: payload
      })
    })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        const txt = (data && (data.summary || data.text)) || buildLocalSummary(payload);
        container.innerHTML = '<p>' + txt + '</p>';
      })
      .catch(err => {
        console.error('AI trial summary error:', err);
        const fallback = buildLocalSummary(payload);
        container.innerHTML = '<p class="ai-summary-error">Could not contact the AI summary service. Showing a basic summary instead.</p><p>' + fallback + '</p>';
      });
  }

  global.FVAiReports = {
    renderTrialSummary
  };
})(window);
