/* ====================================================================
/Farm-vista/js/trials-mh-yield-helper.js
Reusable Multi-Hybrid Yield helper engine.
Now:
 • Drives the modal UI (setup + blocks)
 • Persists mhState to Firestore at:
   fieldTrials/{trialId}/fields/{fieldDocId}/multiHybrid/state
 • Variety chooser pulls from productsSeed (by crop + active)
 • Tracks plantDate from a calendar picker under plot length
 • Marks productsSeed/{productId}.used = true for any varieties used
 • Stores entryNumber for each entry (hybrid + block), renumbered 1..N
   on hard delete so scorecard/reports stay in order.
 • Preserves moisture/weight/yield/notes/files when editing setup and
   returning to blocks – existing blocks are reused by rowId.
 • "New Entry" UX: new variety row shows at the top as "New Entry"
   until a variety is chosen, then it drops to the bottom as the
   next entry number.
==================================================================== */

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp
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
    cropKind: 'corn',      // 'corn' | 'soy' – overridden from trial context
    stage: 'setup',        // 'setup' | 'blocks'
    passLengthFt: 600,
    passWidthFt: 20,
    plantDate: null,       // 'YYYY-MM-DD' string
    checkProductId: null,
    hybrids: [],           // [{ rowId, entryNumber, productId, ..., isCheck, isNewEntry }]
    blocks: []             // [{ rowId, entryNumber, productId, moisturePct, weightLbs, ... }]
  };

  // Ensure entryNumber stays in sync with current hybrid order,
  // and mirror it onto blocks by rowId so reports/scorecard
  // can sort off entryNumber.
  function renumberEntries() {
    mhState.hybrids = (mhState.hybrids || []).map((h, idx) => ({
      ...h,
      entryNumber: idx + 1
    }));

    const byRow = new Map();
    mhState.hybrids.forEach(h => {
      if (h && h.rowId) {
        byRow.set(h.rowId, h.entryNumber);
      }
    });

    mhState.blocks = (mhState.blocks || []).map(b => {
      let entryNumber = b.entryNumber;
      if (byRow.has(b.rowId)) {
        entryNumber = byRow.get(b.rowId);
      }
      return {
        ...b,
        entryNumber
      };
    });
  }

  // Seed product options loaded from productsSeed
  let seedOptions = [];

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

  const modalBackdrop      = document.getElementById('yieldModalBackdrop');
  const btnOpenModal       = document.getElementById('btnOpenModal');
  const devFieldCard       = document.getElementById('devFieldCard');
  const btnClose           = document.getElementById('btnYieldClose');
  const btnOk              = document.getElementById('btnYieldOk');
  const btnSetUpPlot       = document.getElementById('btnSetUpPlot');
  const stageShell         = document.getElementById('mhStageShell');
  const devFieldSummaryEl  = document.getElementById('devFieldSummary');

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
      const isCheck = !!h.isCheck;
      const entryNum = h.entryNumber ?? (idx + 1);

      const parts = [];
      const displayName = h.name || [
        h.brand || '',
        h.variety || ''
      ].join(' ').trim() || 'Variety';

      parts.push(`Entry ${entryNum}: ${displayName}`);
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

  // Build display items for the variety combo based *only* on seedOptions.
  function getHybridItemsForCombo(){
    const rows = (seedOptions || []).slice();
    if(!rows.length) return [];
    return rows.map(s => {
      const brand   = s.brand   || '';
      const variety = s.variety || '';
      const mat     = s.maturity != null ? String(s.maturity) : '';
      let label = `${brand} ${variety}`.trim();
      if(mat) label += ` (${mat} RM)`;
      return {
        id: s.id,
        seedDocId: s.id,
        brand,
        variety,
        maturity: s.maturity ?? null,
        label
      };
    });
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
          const entryNum = h.entryNumber ?? (idx + 1);
          errors.push(`Entry ${entryNum}: select a variety.`);
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

    const lengthFt     = mhState.passLengthFt;
    const widthFt      = mhState.passWidthFt;
    const plantDateVal = mhState.plantDate || '';

    // Sort hybrids so any "New Entry" row appears on top visually,
    // but entryNumber still reflects final planting order.
    const hybrids = (mhState.hybrids || []).slice().sort((a, b) => {
      const aNew = !!a.isNewEntry;
      const bNew = !!b.isNewEntry;
      if (aNew && !bNew) return -1;
      if (!aNew && bNew) return 1;
      const aNum = a.entryNumber ?? 0;
      const bNum = b.entryNumber ?? 0;
      return aNum - bNum;
    });

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
        const isCheckRow   = !!hyb.isCheck;
        const displayName  = hyb.productId
          ? (hyb.name || `${hyb.brand || ''} ${hyb.variety || ''}`.trim() || 'Variety')
          : 'Select variety…';
        const label        = hyb.productId
          ? `${displayName}${hyb.maturity != null ? ' (' + hyb.maturity + ' RM)' : ''}`
          : 'Select variety…';
        const entryNum     = hyb.entryNumber ?? (idx + 1);
        const entryLabel   = hyb.isNewEntry ? 'New Entry' : `Entry ${entryNum}`;

        html += `
          <div class="setup-hybrid-row" data-row-id="${hyb.rowId}">
            <div class="entry-label">${entryLabel}</div>
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
        mhState.plantDate = v || null;
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
        const maxEntry = mhState.hybrids.reduce(
          (max, h) => Math.max(max, h.entryNumber || 0),
          0
        );
        const nextEntry = maxEntry + 1;

        // Only one "New Entry" at a time
        mhState.hybrids.forEach(h => { h.isNewEntry = false; });

        mhState.hybrids.push({
          rowId: newRowId,
          entryNumber: nextEntry,
          productId: '',
          name: '',
          brand: '',
          variety: '',
          maturity: null,
          isCheck: false,
          isNewEntry: true
        });

        // Keep entryNumber 1..N and mirror to blocks
        renumberEntries();
        renderStage();

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

    hybrids.forEach(hybView => {
      // hybView is a sorted view; find the real object in mhState.hybrids
      const hyb = mhState.hybrids.find(h => h.rowId === hybView.rowId);
      if(!hyb) return;

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

            hyb.productId = found ? found.seedDocId : it.id;
            hyb.name      = found ? found.label : it.label;
            hyb.brand     = found ? found.brand : '';
            hyb.variety   = found ? found.variety : '';
            hyb.maturity  = found ? found.maturity : null;

            // Once a variety is chosen, this is no longer the "New Entry"
            if(hyb.isNewEntry){
              hyb.isNewEntry = false;
            }

            // If no check yet, first selected variety becomes the check
            if(!mhState.checkProductId){
              mhState.checkProductId = hyb.productId;
            }

            // Keep per-entry isCheck flags in sync with the chosen checkProductId
            mhState.hybrids.forEach(h => {
              h.isCheck = !!(h.productId && h.productId === mhState.checkProductId);
            });

            renderStage();
          }
        });
      }

      const checkEl = stageShell.querySelector(`.check-indicator[data-row-id="${hyb.rowId}"]`);
      if(checkEl){
        checkEl.addEventListener('click', () => {
          if(!hyb.productId) return;

          mhState.checkProductId = hyb.productId;

          // Update per-entry flags so the check shows clearly in Firestore
          mhState.hybrids.forEach(h => {
            h.isCheck = !!(h.productId && h.productId === mhState.checkProductId);
          });

          renderStage();
        });
      }

      const removeBtn = stageShell.querySelector(`.row-remove[data-row-id="${hyb.rowId}"]`);
      if(removeBtn){
        removeBtn.addEventListener('click', () => {
          const idx = mhState.hybrids.findIndex(h => h.rowId === hyb.rowId);
          if(idx !== -1) mhState.hybrids.splice(idx,1);

          // If the check hybrid was removed, clear the check and flags
          if(mhState.hybrids.every(h => h.productId !== mhState.checkProductId)){
            mhState.checkProductId = null;
          }

          mhState.hybrids.forEach(h => {
            h.isCheck = !!(h.productId && h.productId === mhState.checkProductId);
          });

          // Also drop any blocks linked to this rowId, then renumber all entries
          mhState.blocks = (mhState.blocks || []).filter(b => b.rowId !== hyb.rowId);
          renumberEntries();

          renderStage();
        });
      }
    });
  }

  // ---------- BLOCKS (yield entry) UI ----------

  function renderBlocks(){
    if(!stageShell) return;

    const blocks = (mhState.blocks || [])
      .filter(b => !b.voided)
      .slice()
      .sort((a, b) => {
        const aNum = a.entryNumber ?? 0;
        const bNum = b.entryNumber ?? 0;
        return aNum - bNum;
      });

    if(!blocks.length){
      stageShell.innerHTML = `
        <div class="blocks-panel">
          <div class="blocks-panel-header">
            No yield blocks are defined for this plot yet.
            Use <strong>Edit Plot Setup</strong> to add varieties first.
          </div>
        </div>
      `;
      return;
    }

    const len = mhState.passLengthFt || 0;
    const wid = mhState.passWidthFt || 0;

    let html = `
      <div class="blocks-panel">
        <div class="blocks-panel-header">
          Enter moisture and weight for each entry. Yield is calculated automatically
          using the plot length (${len} ft) and pass width (${wid} ft).
        </div>
    `;

    blocks.forEach((b, idx) => {
      const isCheck   = !!b.isCheck;
      const entryNum  = b.entryNumber ?? (idx + 1);
      const entryLabel= `Entry ${entryNum}`;
      const name      = b.name || `${b.brand || ''} ${b.variety || ''}`.trim() || 'Variety';
      const mat       = b.maturity != null ? ` (${b.maturity} RM)` : '';
      const moistVal  = b.moisturePct != null ? formatNumber(b.moisturePct, 2) : '';
      const wtVal     = b.weightLbs    != null ? formatWithCommas(b.weightLbs) : '';
      const yldVal    = b.yieldBuPerAc != null ? formatNumber(b.yieldBuPerAc, 1) : '—';

      html += `
        <div class="yield-block-card" data-row-id="${b.rowId}">
          <div class="yield-block-head">
            <div>
              <div class="yield-block-title">${entryLabel}: ${name}${mat}${isCheck ? ' – CHECK' : ''}</div>
              <div class="yield-block-sub">
                Plot length ${len} ft • Pass width ${wid} ft
              </div>
            </div>
          </div>

          <div class="row" style="margin-top:6px;">
            <div class="field">
              <label for="mh-block-moist-${b.rowId}">Moisture (%)</label>
              <input id="mh-block-moist-${b.rowId}"
                     type="text"
                     inputmode="decimal"
                     class="input"
                     value="${moistVal}">
            </div>
            <div class="field">
              <label for="mh-block-wt-${b.rowId}">Weight (lbs)</label>
              <input id="mh-block-wt-${b.rowId}"
                     type="text"
                     inputmode="numeric"
                     class="input"
                     value="${wtVal}">
            </div>
          </div>

          <div class="help">
            Yield (to ${mhState.cropKind === 'soy' ? '13.0%' : '15.0%'} std moisture):
            <strong id="mh-block-yield-${b.rowId}">${yldVal}</strong> bu/ac
          </div>
          <div class="help mh-block-error" id="mh-block-error-${b.rowId}"></div>
        </div>
      `;
    });

    html += `</div>`;
    stageShell.innerHTML = html;

    blocks.forEach(b => {
      const moistInput = document.getElementById(`mh-block-moist-${b.rowId}`);
      const wtInput    = document.getElementById(`mh-block-wt-${b.rowId}`);
      const yldEl      = document.getElementById(`mh-block-yield-${b.rowId}`);
      const errEl      = document.getElementById(`mh-block-error-${b.rowId}`);

      function recalc(){
        const mRaw = moistInput ? moistInput.value.replace(/[^0-9.]/g,'') : '';
        const wRaw = wtInput    ? wtInput.value.replace(/[^0-9]/g,'')   : '';

        const m = mRaw === '' ? null : Number(mRaw);
        const w = wRaw === '' ? null : Number(wRaw);

        b.moisturePct = m;
        b.weightLbs   = w;

        const y = calcDevYield({
          cropKind: mhState.cropKind,
          moisturePct: m,
          wetWeightLbs: w,
          lengthFt: mhState.passLengthFt,
          widthFt: mhState.passWidthFt
        });

        b.yieldBuPerAc = y != null ? y : null;

        if(yldEl){
          yldEl.textContent = y != null ? formatNumber(y,1) : '—';
        }

        // ---- Range validation for moisture and yield ----
        let errMsg = '';

        // Moisture range
        if (m != null && isFinite(m)) {
          if (mhState.cropKind === 'corn') {
            if (m < 10 || m > 40) {
              errMsg = 'Moisture looks off for corn (expected 10–40%).';
            }
          } else { // soy
            if (m < 5 || m > 20) {
              errMsg = 'Moisture looks off for soybeans (expected 5–20%).';
            }
          }
        }

        // Yield range
        if (!errMsg && y != null && isFinite(y)) {
          if (mhState.cropKind === 'corn') {
            if (y < 100 || y > 400) {
              errMsg = 'Yield looks off for corn (expected 100–400 bu/ac).';
            }
          } else { // soy
            if (y < 25 || y > 150) {
              errMsg = 'Yield looks off for soybeans (expected 25–150 bu/ac).';
            }
          }
        }

        if (errEl) {
          errEl.textContent = errMsg || '';
        }

        renderDevSummary();
      }

      if(moistInput){
        moistInput.addEventListener('input', () => {
          // Keep only digits and one dot, and limit to 2 decimals
          let clean = moistInput.value.replace(/[^0-9.]/g, '');
          const parts = clean.split('.');
          if (parts.length > 2) {
            clean = parts[0] + '.' + parts.slice(1).join('');
          }
          if (clean.includes('.')) {
            const [intPart, decPart = ''] = clean.split('.');
            const limitedDec = decPart.slice(0, 2);
            moistInput.value = limitedDec.length > 0 ? `${intPart}.${limitedDec}` : intPart + '.';
          } else {
            moistInput.value = clean;
          }
          recalc();
        });

        // On blur, normalize to exactly 2 decimals: 15 -> 15.00
        moistInput.addEventListener('blur', () => {
          let v = moistInput.value;
          if (v === '' || v === '.') {
            moistInput.value = '';
            recalc();
            return;
          }
          const num = Number(v);
          if (!isFinite(num)) {
            moistInput.value = '';
            recalc();
            return;
          }
          moistInput.value = num.toFixed(2);
          recalc();
        });
      }

      if(wtInput){
        wtInput.addEventListener('input', () => {
          const clean = wtInput.value.replace(/[^0-9]/g,'');
          wtInput.value = clean ? formatWithCommas(clean) : '';
          recalc();
        });
      }

      // Initial draw if we already had values
      recalc();
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

      const snap = await getDocs(baseRef);
      const rows = [];
      snap.forEach(docSnap => {
        const data = docSnap.data() || {};
        rows.push({
          id: docSnap.id,
          ...data
        });
      });

      const cropField = mhState.cropKind === 'soy' ? 'cropSoy' : 'cropCorn';

      seedOptions = rows
        .filter(r => r[cropField] === true)
        .filter(r => (r.status || '').toLowerCase() === 'active')
        .sort((a,b) => {
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

        let hybrids = Array.isArray(data.hybrids) ? data.hybrids : [];
        let blocks  = Array.isArray(data.blocks)  ? data.blocks  : [];

        // Ensure each hybrid has a rowId and default isNewEntry=false.
        hybrids = hybrids.map(h => ({
          ...h,
          rowId: h.rowId || nextRowId(),
          isNewEntry: !!h.isNewEntry && !h.productId ? true : false
        }));
        const hasEntryNumbers = hybrids.some(h => typeof h.entryNumber === 'number');
        if (hasEntryNumbers) {
          hybrids.sort((a, b) => {
            const aNum = a.entryNumber ?? 0;
            const bNum = b.entryNumber ?? 0;
            return aNum - bNum;
          });
        }
        mhState.hybrids = hybrids;

        // Ensure each block has a rowId that lines up with hybrids if possible.
        blocks = blocks.map(b => {
          let rowId = b.rowId;
          if (!rowId && b.productId) {
            const match = hybrids.find(h => h.productId && h.productId === b.productId);
            if (match) rowId = match.rowId;
          }
          if (!rowId) rowId = nextRowId();
          return { ...b, rowId };
        });
        mhState.blocks = blocks;

        mhState.stage = mhState.blocks.length ? 'blocks' : 'setup';

        // Sync check flags both ways:
        // 1) If we have checkProductId, mark hybrids/blocks with isCheck.
        // 2) If we only have isCheck flags, infer checkProductId.
        if(mhState.checkProductId){
          mhState.hybrids = mhState.hybrids.map(h => ({
            ...h,
            isCheck: !!(h.productId && h.productId === mhState.checkProductId)
          }));
          mhState.blocks = mhState.blocks.map(b => ({
            ...b,
            isCheck: !!(b.productId && b.productId === mhState.checkProductId)
          }));
        }else{
          const checkHybrid = mhState.hybrids.find(h => h.isCheck && h.productId);
          if(checkHybrid){
            mhState.checkProductId = checkHybrid.productId;
            mhState.hybrids = mhState.hybrids.map(h => ({
              ...h,
              isCheck: !!(h.productId && h.productId === mhState.checkProductId)
            }));
            mhState.blocks = mhState.blocks.map(b => ({
              ...b,
              isCheck: !!(b.productId && b.productId === mhState.checkProductId)
            }));
          }
        }

        // Normalize entryNumber 1..N and mirror onto blocks so reports
        // and the scoreboard can sort by entryNumber.
        renumberEntries();
      }

      await loadSeedProducts();
      renderStage();
    }catch(err){
      console.error('Error loading MH state from Firestore:', err);
      await loadSeedProducts();
    }
  }

  async function saveToFirestore(){
    const ref = getMhDocRef();
    if(!ref){
      console.log('Multi-Hybrid Helper Save (dev only)', JSON.parse(JSON.stringify(mhState)));
      alert('Saved locally (dev mode). Add trialId & fieldDocId to save in Firestore.');
      return;
    }

    try{
      // Make sure entryNumber is clean before saving
      renumberEntries();

      const payload = {
        cropKind: mhState.cropKind || 'corn',
        passLengthFt: mhState.passLengthFt || 0,
        passWidthFt: mhState.passWidthFt || 0,
        plantDate: mhState.plantDate || null,
        checkProductId: mhState.checkProductId || null,
        hybrids: mhState.hybrids || [],
        blocks: mhState.blocks || [],
        updatedAt: serverTimestamp()
      };

      await setDoc(ref, payload, { merge: true });

      // Mark any seed products used in this MH trial as used=true
      try{
        const db = getDb();
        const uniqueIds = new Set();

        (mhState.hybrids || []).forEach(h => {
          if(h && h.productId) uniqueIds.add(h.productId);
        });
        (mhState.blocks || []).forEach(b => {
          if(b && b.productId) uniqueIds.add(b.productId);
        });
        if(mhState.checkProductId){
          uniqueIds.add(mhState.checkProductId);
        }

        const writes = [];
        uniqueIds.forEach(id => {
          const seedRef = doc(db, 'productsSeed', id);
          writes.push(
            setDoc(seedRef, { used: true, updatedAt: serverTimestamp() }, { merge: true })
          );
        });

        if(writes.length){
          await Promise.all(writes);
        }
      }catch(markErr){
        console.warn('Failed to mark seed products as used for MH trial:', markErr);
      }

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

        // Before building blocks, normalize entry numbers 1..N
        renumberEntries();

        // Preserve existing block data by rowId (moisture, weight, yield, notes, files)
        const existingByRowId = new Map();
        (mhState.blocks || []).forEach(b => {
          if(b && b.rowId){
            existingByRowId.set(b.rowId, b);
          }
        });

        mhState.blocks = mhState.hybrids.map(h => {
          const existing = existingByRowId.get(h.rowId) || {};

          return {
            // preserve previous values where they exist
            ...existing,
            rowId: h.rowId,
            entryNumber: h.entryNumber ?? existing.entryNumber ?? null,
            productId: h.productId,
            name: h.name,
            brand: h.brand,
            variety: h.variety,
            maturity: h.maturity,
            isCheck: !!(h.productId && h.productId === mhState.checkProductId),
            // keep stored yield data if we had it
            moisturePct: existing.moisturePct ?? null,
            weightLbs: existing.weightLbs ?? null,
            yieldBuPerAc: existing.yieldBuPerAc ?? null,
            voided: existing.voided ?? false,
            notes: existing.notes ?? '',
            files: existing.files ?? []
          };
        });

        mhState.stage = 'blocks';
        renderStage();
        return;
      }

      // In blocks mode we actually save to Firestore
      saveToFirestore();
    });
  }

  // Initial empty render (then Firestore load will replace)
  renderStage();
  initSwipeForCard();
  loadFromFirestore();

  return {
    open: openModal,
    close: closeModal,
    getState: () => JSON.parse(JSON.stringify(mhState)),
    setStage: (stage) => { mhState.stage = stage; renderStage(); }
  };
}
