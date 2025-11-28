/* ====================================================================
/Farm-vista/js/trials-mh-yield-helper.js
Reusable Multi-Hybrid Yield helper engine.
Now:
 • Still drives the modal UI (setup + blocks)
 • Persists mhState to Firestore when trialId + fieldDocId are provided
   at: fieldTrials/{trialId}/fields/{fieldDocId}/multiHybrid/state
 • Variety chooser pulls from productsSeed (by crop + active)
 • Tracks plantDate from a calendar picker under plot length
==================================================================== */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs
} from '/Farm-vista/js/firebase-init.js';

export function initMhYieldHelper(options = {}) {
  const PASS_WIDTH_OPTIONS = [15,20,25,30,35,40,45,50,60];

  // Firestore wiring (optional – if not provided we stay in dev mode)
  let db = options.db || null;
  const trialId    = options.trialId || null;
  const fieldDocId = options.fieldDocId || null;

  function getDb() {
    if (!db) db = getFirestore();
    return db;
  }

  function getMhDocRef() {
    if (!trialId || !fieldDocId) return null;
    return doc(
      getDb(),
      'fieldTrials',
      trialId,
      'fields',
      fieldDocId,
      'multiHybrid',
      'state'
    );
  }

  const mhState = {
    cropKind: 'corn',      // 'corn' | 'soy' – will be overridden from trial context
    stage: 'setup',        // 'setup' | 'blocks'
    passLengthFt: 600,
    passWidthFt: 20,
    plantDate: null,       // 'YYYY-MM-DD' string
    checkProductId: null,
    hybrids: [],
    blocks: []
  };

  // Seed product options loaded from productsSeed
  let seedOptions = [];

  // Fallback mock hybrids (only used if no seedOptions found)
  const mockHybrids = [
    { id: 'P1185Q', name: 'Pioneer P1185Q', maturity: 118 },
    { id: 'P1742Q', name: 'Pioneer P1742Q', maturity: 117 },
    { id: 'P1366Q', name: 'Pioneer P1366Q', maturity: 113 },
    { id: 'DKC6460', name: 'Dekalb DKC6460', maturity: 114 },
    { id: 'DKC6499', name: 'Dekalb DKC6499', maturity: 114 },
    { id: 'AG3640',  name: 'AgriGold 3640',  maturity: 112 }
  ];

  // Try to pick cropKind from the trial (window.MH_TRIAL_CONTEXT.trial.crop)
  (function initCropFromTrialContext(){
    try{
      const ctx = window.MH_TRIAL_CONTEXT || {};
      const t   = ctx.trial || {};
      const raw = t.crop || t.cropKind || '';
      if(!raw) return;
      const v = String(raw).toLowerCase();
      if(v.includes('soy')){
        mhState.cropKind = 'soy';
      }else if(v.includes('corn')){
        mhState.cropKind = 'corn';
      }
    }catch(err){
      console.warn('MH helper: unable to read crop from MH_TRIAL_CONTEXT', err);
    }
  })();

  const modalBackdrop = document.getElementById('yieldModalBackdrop');
  const btnOpenModal  = document.getElementById('btnOpenModal');
  const devFieldCard  = document.getElementById('devFieldCard');
  const btnClose      = document.getElementById('btnYieldClose');
  const btnOk         = document.getElementById('btnYieldOk');
  const btnSetUpPlot  = document.getElementById('btnSetUpPlot');
  const stageShell    = document.getElementById('mhStageShell');
  const devFieldSummaryEl = document.getElementById('devFieldSummary');

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function nextRowId(){
    return 'row_' + Math.random().toString(36).slice(2,9);
  }

  function formatNumber(num, decimals){
    if(num === null || num === undefined || isNaN(num)) return '—';
    return Number(num).toFixed(decimals);
  }

  function formatWithCommas(num){
    if(num === null || num === undefined || isNaN(num)) return '';
    const s = String(Math.round(num));
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function calcDevYield({ cropKind, moisturePct, wetWeightLbs, lengthFt, widthFt }){
    if(!moisturePct || !wetWeightLbs || !lengthFt || !widthFt) return null;
    const areaAc = (lengthFt * widthFt) / 43560;
    if(areaAc <= 0) return null;

    const stdMoist = cropKind === 'soy' ? 13.0 : 15.0;
    const testWt   = cropKind === 'soy' ? 60.0 : 56.0;
    const m = Number(moisturePct);
    const w = Number(wetWeightLbs);
    if(!isFinite(m) || !isFinite(w) || m <= 0 || m >= 80 || w <= 0) return null;

    // Drier than standard -> treat as standard, so no over-dry credit
    const used = Math.max(m, stdMoist);
    const dryWeightStd = w * (100 - used) / (100 - stdMoist);
    const bu = dryWeightStd / testWt;
    return bu / areaAc;
  }

  function renderDevSummary(){
    if(!devFieldSummaryEl) return;
    if(!mhState.hybrids.length){
      devFieldSummaryEl.textContent = '';
      return;
    }
    const lines = mhState.hybrids.map((h, idx) => {
      if(!h.productId) return null;
      const blk = mhState.blocks.find(b => b.rowId === h.rowId) || {};
      const hasData = blk.moisturePct != null && blk.weightLbs != null && blk.yieldBuPerAc != null;
      const isCheck = mhState.checkProductId && h.productId === mhState.checkProductId;

      const parts = [];
      const displayName = h.name || [
        h.brand || '',
        h.variety || ''
      ].join(' ').trim() || 'Variety';

      parts.push(`Entry ${idx+1}: ${displayName}`);
      if(h.maturity != null) parts.push(`(${h.maturity} RM)`);
      if(isCheck) parts.push('– CHECK');
      if(hasData){
        parts.push(`– ${formatNumber(blk.moisturePct,2)}% • ${formatNumber(blk.yieldBuPerAc,1)} bu/ac`);
      }
      return parts.join(' ');
    }).filter(Boolean);
    devFieldSummaryEl.innerHTML = lines.join('<br>');
  }

  function openModal(){
    if(!modalBackdrop) return;

    modalBackdrop.classList.remove('hidden');

    // If we've already generated blocks once, go straight to data entry
    if (mhState.blocks.length > 0) {
      mhState.stage = 'blocks';
    } else {
      mhState.stage = 'setup';
    }

    renderStage();
  }

  function closeModal(){
    if(!modalBackdrop) return;
    modalBackdrop.classList.add('hidden');
  }

  function closeAllCombos(except=null){
    $$('.combo-panel.show').forEach(p => { if(p !== except) p.classList.remove('show'); });
  }

  function makeCombo({ btn, panel, list, items=[], formatter=x=>String(x.label ?? x), onPick }){
    if(!btn || !panel || !list) return;

    panel.addEventListener('click', e => e.stopPropagation());
    panel.addEventListener('mousedown', e => e.stopPropagation());

    function renderList(){
      list.innerHTML = (items||[]).map(x => `
        <div class="combo-item" data-id="${String(x.id)}">${formatter(x)}</div>
      `).join('') || `<div class="combo-empty">(no options)</div>`;
    }

    function open(){
      closeAllCombos(panel);
      panel.classList.add('show');
      renderList();
    }
    function close(){
      panel.classList.remove('show');
    }

    btn.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.contains('show') ? close() : open();
    });

    list.addEventListener('mousedown', e => {
      const row = e.target.closest('.combo-item');
      if(!row) return;
      const id  = row.dataset.id;
      const it  = (items||[]).find(x => String(x.id) === id);
      if(!it) return;
      onPick?.(it);
      close();
    });

    return { open, close };
  }

  // Build display items for the variety combo based on seedOptions (or mock fallback)
  function getHybridItemsForCombo(){
    if(seedOptions && seedOptions.length){
      return seedOptions.map(s => {
        const brand   = s.brand   || '';
        const variety = s.variety || '';
        const mat     = s.maturity != null ? String(s.maturity) : '';
        let label = `${brand} ${variety}`.trim();
        if(mat) label += ` (${mat} RM)`;
        return {
          // IMPORTANT: use doc id as unique id/productId
          id: s.id,
          productId: s.id,
          brand,
          variety,
          maturity: s.maturity ?? null,
          label
        };
      });
    }

    // Fallback (dev-only) when no seed products are loaded
    return mockHybrids.map(m => ({
      id: m.id,
      productId: m.id,
      brand: '',
      variety: m.id,
      maturity: m.maturity,
      label: `${m.name} (${m.maturity} RM)`
    }));
  }

  function validateSetup(){
    const errors = [];
    if(!mhState.passLengthFt || mhState.passLengthFt <= 0){
      errors.push('Enter a positive plot length.');
    }
    if(!mhState.passWidthFt || mhState.passWidthFt <= 0){
      errors.push('Select a positive pass width.');
    }
    if(!mhState.hybrids.length){
      errors.push('Add at least one entry.');
    }else{
      mhState.hybrids.forEach((h, idx) => {
        if(!h.productId){
          errors.push(`Entry ${idx+1}: select a variety.`);
        }
      });
    }
    if(!mhState.checkProductId){
      errors.push('Pick one check variety (tied to the variety).');
    }
    const box = document.getElementById('mh-setup-errors');
    if(box){
      box.innerHTML = errors.map(e => '• ' + e).join('<br>');
    }
    return errors.length === 0;
  }

  function renderSetup(){
    if(!stageShell) return;
    const hybrids = mhState.hybrids;
    const lengthFt = mhState.passLengthFt;
    const widthFt  = mhState.passWidthFt;
    const plantDateVal = mhState.plantDate || '';
    let html = '';

    html += `
      <div class="setup-panel">
        <div class="row">
          <div class="field">
            <label for="mh-length-input">Plot length (ft)</label>
            <input id="mh-length-input" type="text" inputmode="numeric" class="input" value="${lengthFt}">
            <div class="help">Same length for every strip in this plot.</div>

            <label for="mh-plantdate-input" style="margin-top:10px;">Plant date</label>
            <input id="mh-plantdate-input" type="date" class="input" value="${plantDateVal}">
            <div class="help">Optional. Calendar pick the planted date for this plot.</div>
          </div>

          <div class="field combo">
            <label for="mh-width-btn">Pass width (ft)</label>
            <div class="combo-anchor">
              <button id="mh-width-btn" class="buttonish has-caret" type="button">${widthFt}</button>
              <div class="combo-panel" id="mh-width-panel" role="listbox" aria-label="Pass width options">
                <div class="list" id="mh-width-list"></div>
              </div>
            </div>
            <div class="help">Planter/harvest width, e.g. 20 ft, 30 ft.</div>
          </div>
        </div>

        <div class="setup-hybrids-header">
          <h3>Varieties in this plot (planting order)</h3>
          <button type="button" class="btn btn-small btn-quiet" id="mh-add-row-btn">+ Add variety</button>
        </div>
    `;

    if(!hybrids.length){
      html += `<p class="muted">No entries yet. Tap <strong>+ Add variety</strong> to start.</p>`;
    }else{
      hybrids.forEach((hyb, idx) => {
        const isCheckRow = hyb.productId && mhState.checkProductId === hyb.productId;
        const displayName = hyb.productId
          ? (hyb.name || `${hyb.brand || ''} ${hyb.variety || ''}`.trim() || 'Variety')
          : 'Select variety…';
        const label = hyb.productId
          ? `${displayName}${hyb.maturity != null ? ' (' + hyb.maturity + ' RM)' : ''}`
          : 'Select variety…';

        html += `
          <div class="setup-hybrid-row" data-row-id="${hyb.rowId}">
            <div class="entry-label">Entry ${idx+1}</div>
            <div class="combo">
              <div class="combo-anchor">
                <button type="button"
                        class="buttonish has-caret"
                        id="mh-hybrid-btn-${hyb.rowId}">
                  ${label}
                </button>
                <div class="combo-panel" id="mh-hybrid-panel-${hyb.rowId}">
                  <div class="list" id="mh-hybrid-list-${hyb.rowId}"></div>
                </div>
              </div>
            </div>
            <div class="check-indicator" data-row-id="${hyb.rowId}">
              <span class="check-dot ${isCheckRow ? 'check-dot--on' : ''}"></span>
              <span>Check</span>
            </div>
            <button type="button" class="row-remove" data-row-id="${hyb.rowId}" aria-label="Remove entry">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.22 4.22a.75.75 0 0 1 1.06 0L8 6.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L9.06 8l2.72 2.72a.75.75 0 0 1-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 0 1 0-1.06z"></path>
              </svg>
            </button>
          </div>
        `;
      });
    }

    html += `<div class="setup-errors" id="mh-setup-errors"></div></div>`;
    stageShell.innerHTML = html;

    const lenInput = document.getElementById('mh-length-input');
    if(lenInput){
      lenInput.addEventListener('input', e => {
        const vRaw = e.target.value.replace(/[^0-9]/g,'');
        e.target.value = vRaw;
        mhState.passLengthFt = vRaw === '' ? 0 : Number(vRaw);
      });
    }

    const plantInput = document.getElementById('mh-plantdate-input');
    if(plantInput){
      plantInput.addEventListener('change', e => {
        const v = e.target.value || '';
        mhState.plantDate = v || null;  // store as 'YYYY-MM-DD' string
      });
    }

    const widthBtn   = document.getElementById('mh-width-btn');
    const widthPanel = document.getElementById('mh-width-panel');
    const widthList  = document.getElementById('mh-width-list');

    if(widthBtn && widthPanel && widthList){
      makeCombo({
        btn: widthBtn,
        panel: widthPanel,
        list: widthList,
        items: PASS_WIDTH_OPTIONS.map(v => ({ id:String(v), label:String(v) })),
        formatter: x => x.label,
        onPick: it => {
          mhState.passWidthFt = Number(it.id);
          widthBtn.textContent = it.label;
          renderDevSummary();
        }
      });
    }

    const addRowBtn = document.getElementById('mh-add-row-btn');
    if(addRowBtn){
      addRowBtn.addEventListener('click', () => {
        const newRowId = nextRowId();
        mhState.hybrids.push({
          rowId: newRowId,
          productId: '',
          name: '',
          brand: '',
          variety: '',
          maturity: null
        });
        renderStage();

        // After re-render, scroll new row into view and auto-open its dropdown
        requestAnimationFrame(() => {
          const row = stageShell.querySelector(`.setup-hybrid-row[data-row-id="${newRowId}"]`);
          if(row){
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          const btn = document.getElementById(`mh-hybrid-btn-${newRowId}`);
          if(btn){
            btn.click();
          }
        });
      });
    }

    const comboItems = getHybridItemsForCombo();

    mhState.hybrids.forEach(hyb => {
      const btn   = document.getElementById(`mh-hybrid-btn-${hyb.rowId}`);
      const panel = document.getElementById(`mh-hybrid-panel-${hyb.rowId}`);
      const list  = document.getElementById(`mh-hybrid-list-${hyb.rowId}`);

      if(btn && panel && list){
        makeCombo({
          btn,
          panel,
          list,
          items: comboItems,
          formatter: x => x.label,
          onPick: it => {
            const found = comboItems.find(m => m.id === it.id) || null;

            hyb.productId = found ? found.productId : it.id;
            hyb.name      = found ? found.label : it.label;
            hyb.brand     = found ? found.brand : '';
            hyb.variety   = found ? found.variety : '';
            hyb.maturity  = found ? found.maturity : null;

            // If no check picked yet, default first chosen hybrid as check
            if(!mhState.checkProductId){
              mhState.checkProductId = hyb.productId;
            }

            renderStage();
          }
        });
      }

      const checkEl = stageShell.querySelector(`.check-indicator[data-row-id="${hyb.rowId}"]`);
      if(checkEl){
        checkEl.addEventListener('click', () => {
          if(!hyb.productId) return;
          mhState.checkProductId = hyb.productId;
          renderStage();
        });
      }

      const removeBtn = stageShell.querySelector(`.row-remove[data-row-id="${hyb.rowId}"]`);
      if(removeBtn){
        removeBtn.addEventListener('click', () => {
          const idx = mhState.hybrids.findIndex(h => h.rowId === hyb.rowId);
          if(idx !== -1) mhState.hybrids.splice(idx,1);
          if(mhState.hybrids.every(h => h.productId !== mhState.checkProductId)){
            mhState.checkProductId = null;
          }
          renderStage();
        });
      }
    });
  }

  function renderBlocks(){
    if(!stageShell) return;
    const blocks = mhState.blocks;
    const lengthFt = mhState.passLengthFt;
    const widthFt  = mhState.passWidthFt;
    let html = '';

    html += `
      <div class="blocks-panel">
        <div class="blocks-panel-header">
          Plot length: <strong>${lengthFt} ft</strong> • Pass width: <strong>${widthFt} ft</strong> • Area per strip:
          <strong>${formatNumber((lengthFt*widthFt)/43560,3)} ac</strong>
        </div>
    `;

    if(!blocks.length){
      html += `<p class="muted">No blocks generated. Hit Set Up Plot and try again.</p>`;
    }else{
      blocks.forEach((blk, idx) => {
        const isCheck = mhState.checkProductId && blk.productId === mhState.checkProductId;
        const badYield = blk.yieldBuPerAc != null && (blk.yieldBuPerAc < 50 || blk.yieldBuPerAc > 400);
        const notesVal = blk.notes || '';
        const files = blk.files || [];

        html += `
          <div class="yield-block-card" data-row-id="${blk.rowId}">
            <div class="yield-block-head">
              <div>
                <div class="yield-block-title">
                  Entry ${idx+1} · ${blk.name || 'Variety'}
                  ${isCheck ? '<span class="badge-check">Check</span>' : ''}
                  ${blk.voided ? '<span class="badge-void">Voided</span>' : ''}
                </div>
                <div class="yield-block-sub">
                  ${blk.maturity ? `${blk.maturity} RM` : ''}
                </div>
              </div>
            </div>
            <div class="yield-block-grid">
              <label class="field-mini">
                <span>Moisture %</span>
                <input type="text" inputmode="decimal"
                       class="input" id="mh-moist-${blk.rowId}"
                       value="${blk.moisturePct != null ? formatNumber(blk.moisturePct,2) : ''}">
              </label>
              <label class="field-mini">
                <span>Weight (Lbs)</span>
                <input type="text" inputmode="numeric"
                       class="input" id="mh-weight-${blk.rowId}"
                       value="${blk.weightLbs != null ? formatWithCommas(blk.weightLbs) : ''}">
              </label>
              <div class="field-mini">
                <span>Yield (bu/ac)</span>
                <div id="mh-yield-${blk.rowId}" class="yield-value ${badYield ? 'bad' : ''}">
                  ${blk.yieldBuPerAc != null ? formatNumber(blk.yieldBuPerAc,2) : '—'}
                </div>
              </div>
            </div>
            <div class="void-row">
              <input type="checkbox" id="mh-void-${blk.rowId}" ${blk.voided ? 'checked' : ''}>
              <label for="mh-void-${blk.rowId}">Void this hybrid</label>
            </div>

            <div class="yield-extra">
              <div class="field-mini">
                <span>Notes</span>
                <div class="notes-shell">
                  <textarea class="input notes-input"
                            id="mh-notes-${blk.rowId}`
                            rows="2"
                            placeholder="Notes about this hybrid…">${notesVal}</textarea>
                  <button type="button"
                          class="mic-btn"
                          data-dict-target="mh-notes-${blk.rowId}"
                          data-dictation-target="#mh-notes-${blk.rowId}"
                          aria-label="Dictate notes">
                    <svg class="mic-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A7 7 0 0 0 19 11a1 1 0 0 0-2 0z"></path>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="field-mini">
                <span>Attachments (max 5)</span>
                <div class="files-shell">
                  <input type="file"
                         id="mh-files-input-${blk.rowId}"
                         class="hidden-file"
                         multiple>
                  <button type="button"
                          class="btn btn-small"
                          id="mh-files-btn-${blk.rowId}">
                    Add files (${files.length}/5)
                  </button>
                  <ul class="file-list" id="mh-files-list-${blk.rowId}">
                    ${files.map((f, i) => `
                      <li data-idx="${i}">
                        <span class="file-name">${f.name}</span>
                        <button type="button" class="file-remove" aria-label="Remove file">&times;</button>
                      </li>
                    `).join('')}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;
    stageShell.innerHTML = html;

    mhState.blocks.forEach(blk => {
      const moistEl = document.getElementById(`mh-moist-${blk.rowId}`);
      const weightEl = document.getElementById(`mh-weight-${blk.rowId}`);
      const yieldEl  = document.getElementById(`mh-yield-${blk.rowId}`);
      const voidEl   = document.getElementById(`mh-void-${blk.rowId}`);
      const notesEl  = document.getElementById(`mh-notes-${blk.rowId}`);
      const filesInput = document.getElementById(`mh-files-input-${blk.rowId}`);
      const filesBtn   = document.getElementById(`mh-files-btn-${blk.rowId}`);
      const filesList  = document.getElementById(`mh-files-list-${blk.rowId}`);

      function updateYieldDisplay(){
        if(!yieldEl) return;
        if(blk.yieldBuPerAc != null){
          yieldEl.textContent = formatNumber(blk.yieldBuPerAc,2);
          const bad = blk.yieldBuPerAc < 50 || blk.yieldBuPerAc > 400;
          yieldEl.classList.toggle('bad', bad);
        }else{
          yieldEl.textContent = '—';
          yieldEl.classList.remove('bad');
        }
      }

      function recalcYield(){
        blk.yieldBuPerAc = calcDevYield({
          cropKind: mhState.cropKind,
          moisturePct: blk.moisturePct,
          wetWeightLbs: blk.weightLbs,
          lengthFt: mhState.passLengthFt,
          widthFt: mhState.passWidthFt
        });
        updateYieldDisplay();
        renderDevSummary();
      }

      if(moistEl){
        moistEl.dataset.prev = moistEl.value;

        moistEl.addEventListener('input', e => {
          const oldVal = e.target.dataset.prev || '';
          let v = e.target.value;

          v = v.replace(/[^0-9.]/g,'');
          const parts = v.split('.');
          if(parts.length > 2){
            v = oldVal;
          }else if(parts.length === 2 && parts[1].length > 2){
            v = oldVal;
          }

          e.target.value = v;
          e.target.dataset.prev = v;
          blk.moisturePct = v === '' ? null : Number(v);
          recalcYield();
        });

        moistEl.addEventListener('blur', e => {
          let v = e.target.value;
          if(v === ''){
            blk.moisturePct = null;
            recalcYield();
            return;
          }
          v = v.replace(/[^0-9.]/g,'');
          const parts = v.split('.');
          if(parts.length > 2){
            v = parts[0] + '.' + parts.slice(1).join('');
          }
          const num = Number(v);
          blk.moisturePct = isFinite(num) ? num : null;
          e.target.value = blk.moisturePct != null ? blk.moisturePct.toFixed(2) : '';
          recalcYield();
        });
      }

      if(weightEl){
        weightEl.addEventListener('input', e => {
          let v = e.target.value.replace(/\D/g,'');
          e.target.value = v;
          blk.weightLbs = v === '' ? null : Number(v);
          recalcYield();
        });
        weightEl.addEventListener('blur', e => {
          if(blk.weightLbs != null){
            e.target.value = formatWithCommas(blk.weightLbs);
          }
        });
      }

      if(voidEl){
        voidEl.addEventListener('change', e => {
          blk.voided = e.target.checked;
          renderBlocks();
        });
      }

      if(notesEl){
        notesEl.addEventListener('input', e => {
          blk.notes = e.target.value;
        });
      }

      if(filesBtn && filesInput && filesList){
        if(!Array.isArray(blk.files)) blk.files = [];

        function renderFileList(){
          const files = blk.files || [];
          filesList.innerHTML = files.map((f, i) => `
            <li data-idx="${i}">
              <span class="file-name">${f.name}</span>
              <button type="button" class="file-remove" aria-label="Remove file">&times;</button>
            </li>
          `).join('');
          filesBtn.textContent = `Add files (${files.length}/5)`;
        }

        renderFileList();

        filesBtn.addEventListener('click', () => {
          filesInput.click();
        });

        filesInput.addEventListener('change', e => {
          const selected = Array.from(e.target.files || []);
          if(!selected.length) return;
          if(!Array.isArray(blk.files)) blk.files = [];
          const spaceLeft = Math.max(0, 5 - blk.files.length);
          const toAdd = selected.slice(0, spaceLeft);
          toAdd.forEach(f => {
            blk.files.push({
              name: f.name,
              size: f.size,
              type: f.type
            });
          });
          filesInput.value = '';
          renderFileList();
        });

        filesList.addEventListener('click', e => {
          const li = e.target.closest('li');
          if(!li) return;
          if(e.target.classList.contains('file-remove')){
            const idx = Number(li.dataset.idx);
            if(!isNaN(idx)){
              blk.files.splice(idx,1);
              renderFileList();
            }
          }
        });
      }
    });
  }

  function renderStage(){
    if(btnSetUpPlot){
      btnSetUpPlot.textContent = mhState.blocks.length ? 'Edit Plot Setup' : 'Set Up Plot';
    }
    if(mhState.stage === 'setup'){
      renderSetup();
    }else{
      renderBlocks();
    }
    renderDevSummary();
  }

  function initSwipeForCard(){
    if(!devFieldCard) return;
    const isMobile =
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      window.innerWidth <= 768;

    if(!isMobile) return;

    if (window.FVSwipeList && typeof window.FVSwipeList.attach === 'function') {
      try {
        window.FVSwipeList.attach(devFieldCard, {
          onSwipeRight: () => openModal()
        });
        return;
      } catch (err) {
        console.warn('FVSwipeList.attach failed, falling back to manual swipe.', err);
      }
    }

    let startX = 0;
    let startY = 0;
    let tracking = false;

    devFieldCard.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }, { passive: true });

    devFieldCard.addEventListener('touchend', e => {
      if(!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if(dx > 40 && Math.abs(dy) < 30){
        openModal();
      }
    }, { passive: true });
  }

  // ---------- Firestore load/save ----------

  async function loadSeedProducts(){
    try{
      const db = getDb();
      const baseRef = collection(db, 'productsSeed');

      // Use cropCorn / cropSoy flags based on mhState.cropKind
      const cropField = mhState.cropKind === 'soy' ? 'cropSoy' : 'cropCorn';

      const qRef = query(
        baseRef,
        where(cropField, '==', true),
        where('status', '==', 'active')
      );

      const snap = await getDocs(qRef);
      const rows = [];
      snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        rows.push({
          id: docSnap.id,   // doc id – unique per variety
          ...data
        });
      });

      // Sort client-side: brand, variety
      rows.sort((a,b) => {
        const aBrand = (a.brand || '').toLowerCase();
        const bBrand = (b.brand || '').toLowerCase();
        if(aBrand < bBrand) return -1;
        if(aBrand > bBrand) return 1;
        const aVar = (a.variety || '').toLowerCase();
        const bVar = (b.variety || '').toLowerCase();
        if(aVar < bVar) return -1;
        if(aVar > bVar) return 1;
        return 0;
      });

      seedOptions = rows;
      // Re-render setup so combo pulls from real products
      if(mhState.stage === 'setup'){
        renderStage();
      }
    }catch(err){
      console.error('Error loading productsSeed for MH helper:', err);
      seedOptions = [];
    }
  }

  async function loadFromFirestore(){
    const ref = getMhDocRef();
    if(!ref) {
      // Still want seed products (by trial crop) even if no state doc exists
      await loadSeedProducts();
      return;
    }

    try{
      const snap = await getDoc(ref);
      if(snap.exists()){
        const data = snap.data() || {};

        mhState.cropKind       = data.cropKind      || mhState.cropKind;
        mhState.passLengthFt   = data.passLengthFt  ?? mhState.passLengthFt;
        mhState.passWidthFt    = data.passWidthFt   ?? mhState.passWidthFt;
        mhState.plantDate      = data.plantDate     || mhState.plantDate || null;
        mhState.checkProductId = data.checkProductId|| mhState.checkProductId;
        mhState.hybrids        = Array.isArray(data.hybrids) ? data.hybrids : [];
        mhState.blocks         = Array.isArray(data.blocks)  ? data.blocks  : [];
        mhState.stage          = mhState.blocks.length ? 'blocks' : 'setup';
      }

      // After we know cropKind for sure, load seed products
      await loadSeedProducts();

      renderStage();
    }catch(err){
      console.error('Error loading MH state from Firestore:', err);
      // Still try to load seed products even if state load fails
      await loadSeedProducts();
    }
  }

  async function saveToFirestore(){
    const ref = getMhDocRef();
    if(!ref){
      // No IDs – dev mode
      console.log('Multi-Hybrid Helper Save (dev only)', JSON.parse(JSON.stringify(mhState)));
      alert('Saved locally (dev mode). Add trialId & fieldDocId to save in Firestore.');
      return;
    }

    try{
      const payload = {
        cropKind: mhState.cropKind || 'corn',
        passLengthFt: mhState.passLengthFt || 0,
        passWidthFt: mhState.passWidthFt || 0,
        plantDate: mhState.plantDate || null,
        checkProductId: mhState.checkProductId || null,
        hybrids: mhState.hybrids || [],
        blocks: mhState.blocks || [],
        updatedAt: new Date()
      };
      await setDoc(ref, payload, { merge: true });
      closeModal();
    }catch(err){
      console.error('Error saving MH state to Firestore:', err);
      alert('Unable to save multi-hybrid data to Firestore.');
    }
  }

  // ---------- Event wiring ----------

  if(btnOpenModal) btnOpenModal.addEventListener('click', openModal);
  if(devFieldCard) devFieldCard.addEventListener('click', openModal);
  if(btnClose)     btnClose.addEventListener('click', closeModal);

  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){
      if(!modalBackdrop?.classList.contains('hidden')){
        closeModal();
      }
      closeAllCombos();
    }
  });

  document.addEventListener('click', () => closeAllCombos());

  if(btnSetUpPlot){
    btnSetUpPlot.addEventListener('click', () => {
      if(mhState.stage === 'setup'){
        const lenInput = document.getElementById('mh-length-input');
        if(lenInput) lenInput.focus();
      }else{
        mhState.stage = 'setup';
        renderStage();
      }
    });
  }

  if(btnOk){
    btnOk.addEventListener('click', () => {
      if(mhState.stage === 'setup'){
        if(!validateSetup()) return;
        mhState.blocks = mhState.hybrids.map(h => ({
          rowId: h.rowId,
          productId: h.productId,
          name: h.name,
          brand: h.brand,
          variety: h.variety,
          maturity: h.maturity,
          moisturePct: null,
          weightLbs: null,
          yieldBuPerAc: null,
          voided: false,
          notes: '',
          files: []
        }));
        mhState.stage = 'blocks';
        renderStage();
        return;
      }

      // Stage === 'blocks' -> save real data
      saveToFirestore();
    });
  }

  renderStage();
  initSwipeForCard();
  // Kick off Firestore hydration + seed load (non-blocking)
  loadFromFirestore();

  return {
    open: openModal,
    close: closeModal,
    getState: () => JSON.parse(JSON.stringify(mhState)),
    setStage: (stage) => { mhState.stage = stage; renderStage(); }
  };
}
