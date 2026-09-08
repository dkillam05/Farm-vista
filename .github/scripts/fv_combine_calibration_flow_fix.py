from pathlib import Path

path = Path('pages/calculators/calc-combine-yield-calibration.html')
text = path.read_text()


def replace_once(old, new, label):
    global text
    if old not in text:
        raise SystemExit(f'Anchor not found: {label}')
    text = text.replace(old, new, 1)


replace_once(
'''    .hist{padding:14px 16px; display:grid; gap:12px;}
    .hist-item{border:1px solid var(--border); border-radius:12px; padding:12px; background:var(--card-surface,var(--surface));
      display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;}
    .hist-item .view{border:1px solid var(--border); background:var(--surface); border-radius:10px; padding:8px 12px; font-weight:700; cursor:pointer; color:var(--text) !important;}
''',
'''    .hist{padding:14px 16px; display:grid; gap:12px;}
    .hist-swipe{position:relative; overflow:hidden; border-radius:12px; background:#b42318; touch-action:pan-y;}
    .hist-delete{position:absolute; inset:0 0 0 auto; width:92px; border:0; background:#b42318; color:#fff; font-weight:800; cursor:pointer;}
    .hist-item{position:relative; z-index:1; border:1px solid var(--border); border-radius:12px; padding:12px; background:var(--card-surface,var(--surface));
      display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; transition:transform .18s ease; will-change:transform;}
    .hist-item .view{border:1px solid var(--border); background:var(--surface); border-radius:10px; padding:8px 12px; font-weight:700; cursor:pointer; color:var(--text) !important;}
    .hist-swipe.open .hist-item{transform:translateX(-92px);}
''',
'history css')

replace_once(
'''    .dialog-head{ padding:12px 14px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
    .dialog-body{ padding:14px; overflow:auto; flex:1 1 auto; min-height:0; -webkit-overflow-scrolling:touch; }
    .closex{border:1px solid var(--border); background:var(--surface); border-radius:10px; padding:8px 12px; cursor:pointer; font-weight:700; color:var(--text) !important;}
''',
'''    .dialog-head{ padding:12px 14px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .dialog-actions{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
    .dialog-body{ padding:14px; overflow:auto; flex:1 1 auto; min-height:0; -webkit-overflow-scrolling:touch; }
    .closex,.sharex{border:1px solid var(--border); background:var(--surface); border-radius:10px; padding:8px 12px; cursor:pointer; font-weight:700; color:var(--text) !important;}
''',
'modal css')

replace_once(
'''      <div class="dialog-head">
        <h3 id="mdTitle">Details</h3>
        <button class="closex" id="mdClose" type="button">Back</button>
      </div>
''',
'''      <div class="dialog-head">
        <h3 id="mdTitle">Details</h3>
        <div class="dialog-actions">
          <button class="sharex" id="mdShare" type="button">Share</button>
          <button class="closex" id="mdClose" type="button">Back</button>
        </div>
      </div>
''',
'modal header')

replace_once(
'''      const modal = $("modal");
      const mdBody = $("mdBody");
      const mdClose = $("mdClose");
''',
'''      const modal = $("modal");
      const mdBody = $("mdBody");
      const mdClose = $("mdClose");
      const mdShare = $("mdShare");
''',
'modal refs')

replace_once(
'''      let __db = null;
''',
'''      let __db = null;
      let activeModalRecord = null;
      let isSavingCalibration = false;
''',
'state vars')

replace_once(
'''      function openModal(it){
        $("mdTitle").textContent = "Calibration Details";
''',
'''      function recordKey(it){
        return String(it?.localId || it?.t || "");
      }

      function removeLocalCalibration(key){
        const next = loadH().filter(it => recordKey(it) !== String(key));
        saveH(next);
        renderHist();
      }

      function resetForNextCalibration(){
        state.farm = null;
        state.field = null;

        farmIdEl.value = "";
        fieldIdEl.value = "";
        farmBtn.textContent = "Select farm…";
        fieldBtn.textContent = "Select field…";

        farmSearch.value = "";
        fieldSearch.value = "";

        cropSel.value = "corn";
        cw.value = "";
        gw.value = "";
        grainCartStart.value = "";
        grainCartEnd.value = "";

        refreshFieldComboForFarm(null);
        closeAllCombos();
        showErr("");

        requestAnimationFrame(()=> farmBtn.focus());
      }

      function shareTextForCalibration(it){
        const cropLabel = it.crop === "corn" ? "Corn" : "Soybeans";
        const lines = [
          "FarmVista Combine Yield Calibration",
          it.combineLabel ? `Combine: ${it.combineLabel}` : null,
          `Farm: ${it.farmName || it.farmId || "—"}`,
          `Field: ${it.fieldName || it.fieldId || "—"}`,
          `Crop: ${cropLabel}`,
          `Date: ${it.submittedDate || "—"}`,
          `Submitted by: ${it.submittedBy || "—"}`,
          `Combine Weight: ${fmt(it.cw,0)} lb`,
          `Grain Cart Weight: ${fmt(it.gw,0)} lb`,
          `Result: ${it.status} • ${fmt(it.pct,2)}% off`
        ].filter(Boolean);

        return lines.join("\\n");
      }

      async function shareActiveCalibration(){
        if(!activeModalRecord) return;

        const shareData = {
          title: "Combine Yield Calibration",
          text: shareTextForCalibration(activeModalRecord)
        };

        try{
          if(navigator.share){
            await navigator.share(shareData);
            return;
          }

          await navigator.clipboard.writeText(shareData.text);
          const old = mdShare.textContent;
          mdShare.textContent = "Copied";
          setTimeout(()=>{ mdShare.textContent = old; }, 1400);
        }catch(e){
          if(e?.name !== "AbortError"){
            console.error("Share failed:", e);
          }
        }
      }

      function openModal(it){
        activeModalRecord = it || null;
        $("mdTitle").textContent = "Calibration Details";
''',
'open modal helpers')

replace_once(
'''      function closeModal(){
        modal.removeAttribute("open");
        modal.setAttribute("aria-hidden", "true");
      }

      mdClose.addEventListener("click", closeModal);
''',
'''      function closeModal(){
        modal.removeAttribute("open");
        modal.setAttribute("aria-hidden", "true");
        activeModalRecord = null;
      }

      mdClose.addEventListener("click", closeModal);
      mdShare.addEventListener("click", shareActiveCalibration);
''',
'modal share listener')

replace_once(
'''      function renderHist(){
        const h = loadH();

        if(!h.length){
          historyBox.innerHTML =
            '<div class="muted">No previous calibrations.</div>';

          return;
        }

        historyBox.innerHTML = "";

        h.forEach((it, idx)=>{
          const div = document.createElement("div");

          div.className = "hist-item";

          const c = it.combineLabel
            ? (it.combineLabel + " • ")
            : "";

          const line =
            `${c}${it.crop === "corn" ? "Corn" : "Soy"} • ` +
            `${it.status} • ${fmt(it.pct,2)}%`;

          div.innerHTML =
            `<div class="hline">${esc(line)}</div>` +
            `<button class="view" type="button">View</button>`;

          div.querySelector(".view").addEventListener(
            "click",
            ()=>{
              openModal(loadH()[idx]);
            }
          );

          historyBox.appendChild(div);
        });
      }
''',
'''      function renderHist(){
        const h = loadH();

        if(!h.length){
          historyBox.innerHTML =
            '<div class="muted">No previous calibrations.</div>';

          return;
        }

        historyBox.innerHTML = "";

        h.forEach(it=>{
          const key = recordKey(it);
          const wrap = document.createElement("div");
          wrap.className = "hist-swipe";

          const del = document.createElement("button");
          del.className = "hist-delete";
          del.type = "button";
          del.textContent = "Delete";
          del.setAttribute("aria-label", "Delete calibration from recent history");

          const div = document.createElement("div");
          div.className = "hist-item";

          const c = it.combineLabel
            ? (it.combineLabel + " • ")
            : "";

          const line =
            `${c}${it.crop === "corn" ? "Corn" : "Soy"} • ` +
            `${it.status} • ${fmt(it.pct,2)}%`;

          div.innerHTML =
            `<div class="hline">${esc(line)}</div>` +
            `<button class="view" type="button">View</button>`;

          div.querySelector(".view").addEventListener("click", ()=>{
            const current = loadH().find(x => recordKey(x) === key) || it;
            openModal(current);
          });

          del.addEventListener("click", ()=> removeLocalCalibration(key));

          let startX = 0;
          let startY = 0;
          let tracking = false;
          let horizontal = false;

          div.addEventListener("touchstart", e=>{
            const t = e.touches[0];
            startX = t.clientX;
            startY = t.clientY;
            tracking = true;
            horizontal = false;
            div.style.transition = "none";
          }, {passive:true});

          div.addEventListener("touchmove", e=>{
            if(!tracking) return;
            const t = e.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;

            if(!horizontal && Math.abs(dx) > 8){
              horizontal = Math.abs(dx) > Math.abs(dy);
            }
            if(!horizontal) return;

            e.preventDefault();
            const base = wrap.classList.contains("open") ? -92 : 0;
            const x = Math.max(-92, Math.min(0, base + dx));
            div.style.transform = `translateX(${x}px)`;
          }, {passive:false});

          div.addEventListener("touchend", e=>{
            if(!tracking) return;
            tracking = false;
            div.style.transition = "";

            const t = e.changedTouches[0];
            const dx = t.clientX - startX;
            const shouldOpen = horizontal && (wrap.classList.contains("open") ? dx < 35 : dx < -48);

            wrap.classList.toggle("open", shouldOpen);
            div.style.transform = "";
          }, {passive:true});

          wrap.appendChild(del);
          wrap.appendChild(div);
          historyBox.appendChild(wrap);
        });
      }
''',
'history render')

replace_once(
'''        summary.innerHTML =
          `<strong>Result:</strong> ` +
          `${c}${cropLabel} → ` +
          `<strong>${out.status}</strong> • ` +
          `<strong>${fmt(out.pct,2)}%</strong> ` +
          `( ${fmt(out.cw,0)} lb vs ${fmt(out.gw,0)} lb )`;
''',
'''        summary.innerHTML =
          `<strong>✓ Calibration saved.</strong><br>` +
          `<strong>Result:</strong> ` +
          `${c}${cropLabel} → ` +
          `<strong>${out.status}</strong> • ` +
          `<strong>${fmt(out.pct,2)}%</strong> ` +
          `( ${fmt(out.cw,0)} lb vs ${fmt(out.gw,0)} lb )`;
''',
'saved result text')

replace_once(
'''      $("calcBtn").addEventListener(
        "click",
        async ()=>{
          const out = calc();

          if(!out){
            return;
          }

          out.crop = cropSel.value;

          out.combineId =
            String(
              window.__fv_hub_combine_id ||
              ""
            );

          out.combineLabel =
            String(
              window.__fv_hub_combine_label ||
              ""
            );

          const rec = {
            t: Date.now(),

            farmId: out.farmId,
            fieldId: out.fieldId,

            farmName:
              out.farmName || "",

            fieldName:
              out.fieldName || "",

            combineId:
              out.combineId,

            combineLabel:
              out.combineLabel,

            crop:
              out.crop,

            cw:
              out.cw,

            gw:
              out.gw,

            pct:
              out.pct,

            status:
              out.status,

            submittedBy:
              out.submittedBy,

            submittedDate:
              out.submittedDate
          };

          const h = loadH();

          h.unshift(rec);

          saveH(h);
          renderHist();
          showResult(rec);

          try{
            await saveToFirestore(rec);
          }catch(e){
            console.error(e);

            /*
             * Keep UX simple:
             * local history still saves even if Firestore fails.
             */
          }
        }
      );
''',
'''      $("calcBtn").addEventListener(
        "click",
        async ()=>{
          if(isSavingCalibration){
            return;
          }

          const out = calc();

          if(!out){
            return;
          }

          out.crop = cropSel.value;

          out.combineId =
            String(
              window.__fv_hub_combine_id ||
              ""
            );

          out.combineLabel =
            String(
              window.__fv_hub_combine_label ||
              ""
            );

          const rec = {
            localId:
              (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,

            t: Date.now(),

            farmId: out.farmId,
            fieldId: out.fieldId,

            farmName:
              out.farmName || "",

            fieldName:
              out.fieldName || "",

            combineId:
              out.combineId,

            combineLabel:
              out.combineLabel,

            crop:
              out.crop,

            cw:
              out.cw,

            gw:
              out.gw,

            pct:
              out.pct,

            status:
              out.status,

            submittedBy:
              out.submittedBy,

            submittedDate:
              out.submittedDate
          };

          const calcBtn = $("calcBtn");
          const oldLabel = calcBtn.textContent;
          isSavingCalibration = true;
          calcBtn.disabled = true;
          calcBtn.textContent = "Saving…";
          showErr("");

          try{
            await saveToFirestore(rec);

            const h = loadH();
            h.unshift(rec);
            saveH(h);
            renderHist();
            showResult(rec);
            resetForNextCalibration();
          }catch(e){
            console.error(e);
            showErr("Calibration could not be saved. Your entries are still here — please try Calculate again.");
          }finally{
            isSavingCalibration = false;
            calcBtn.disabled = false;
            calcBtn.textContent = oldLabel;
          }
        }
      );
''',
'calculate flow')

path.write_text(text)
print('Patched combine yield calibration flow.')
