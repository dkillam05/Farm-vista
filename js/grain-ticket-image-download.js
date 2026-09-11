/* FarmVista — saved grain ticket image download/share
   Rev 2026-09-11i
   Uniform support for Ticket Detail, Grain Inventory drill-down,
   and Grain Contract Report ticket popup.

   Sept 11, 2026:
   Ticket Detail must never use a document-wide MutationObserver for this
   helper. The old observer called enhance() for every subtree mutation while
   enhance() itself added/removed DOM, which could keep the main thread busy
   during Ticket Detail startup. Ticket Detail now watches only ticketImage src.

   Rev i also adds the compact Active Hauling Jobs overview to Grain Inventory.
*/
(() => {
  'use strict';
  if (window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260911I) return;
  window.__FV_GRAIN_TICKET_IMAGE_DOWNLOAD_20260911I = true;

  const style = document.createElement('style');
  style.id = 'fv-ticket-image-download-style';
  style.textContent = `
    .fv-ticket-download-btn{min-height:42px;padding:9px 15px;border:1px solid #3B7E46!important;border-radius:10px;background:#3B7E46!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font:inherit;font-weight:850;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;text-decoration:none}
    .fv-ticket-download-btn:hover,.fv-ticket-download-btn:focus{background:#326d3c!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-btn:disabled{opacity:.65;cursor:wait;color:#fff!important;-webkit-text-fill-color:#fff!important}
    .fv-ticket-download-row{display:flex;justify-content:flex-start;gap:8px;padding:10px 0 12px;width:100%}
    @media(max-width:560px){.fv-ticket-download-row .fv-ticket-download-btn{width:100%}}
  `;
  if (!document.getElementById(style.id)) document.head.appendChild(style);

  const clean = value => String(value || '').trim();
  const prepared = new WeakMap();
  const isAppleMobile = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isMobileShareDevice = () => isAppleMobile() || /Android/i.test(navigator.userAgent) || matchMedia('(pointer:coarse)').matches;
  const readyLabel = () => isAppleMobile() ? 'Save Image' : 'Download Image';

  function extensionFrom(blob,url){
    const type=clean(blob?.type).toLowerCase();
    if(type.includes('png')) return 'png';
    if(type.includes('webp')) return 'webp';
    if(type.includes('heic')||type.includes('heif')) return 'heic';
    if(type.includes('jpeg')||type.includes('jpg')) return 'jpg';
    const match=clean(url).match(/\.(jpe?g|png|webp|heic|heif)(?:[?#]|$)/i);
    return match?match[1].toLowerCase().replace('jpeg','jpg'):'jpg';
  }

  function mimeFor(ext,blob){
    const type=clean(blob?.type).toLowerCase();
    if(type.startsWith('image/')) return type;
    if(ext==='png') return 'image/png';
    if(ext==='webp') return 'image/webp';
    if(ext==='heic'||ext==='heif') return 'image/heic';
    return 'image/jpeg';
  }

  function ticketName(){
    const detailTicket=clean(document.querySelector('#ticketNumber')?.value||document.querySelector('[data-ticket-number]')?.dataset?.ticketNumber);
    const popupTitle=clean(document.querySelector('#ticketPopupTitle')?.textContent||document.querySelector('#ticket-image-modal-title')?.textContent||document.querySelector('#fv-ticket-image-title')?.textContent);
    const source=detailTicket||popupTitle.match(/(?:ticket\s*)?#?([A-Za-z0-9-]{3,})/i)?.[1]||new URLSearchParams(location.search).get('id')||'image';
    return `grain-ticket-${String(source).replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'image'}`;
  }

  async function buildFile(image){
    const url=clean(image?.currentSrc||image?.src);
    if(!url) throw new Error('No ticket image URL available.');
    const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache'});
    if(!response.ok) throw new Error(`Image request failed (${response.status})`);
    const blob=await response.blob();
    if(!blob.size) throw new Error('Ticket image was empty.');
    const ext=extensionFrom(blob,url);
    const type=mimeFor(ext,blob);
    return new File([blob],`${ticketName()}.${ext}`,{type});
  }

  function setButton(button,{ready=false,error=false}={}){
    if(!button?.isConnected) return;
    if(error){
      button.disabled=false;
      button.textContent=isAppleMobile()?'Retry Save Image':'Retry Download';
      button.title='FarmVista could not prepare the actual image file. Tap to try again.';
      return;
    }
    if(ready){
      button.disabled=false;
      button.textContent=readyLabel();
      button.title=isAppleMobile()?'Save the actual grain ticket image to your iPhone Photos.':'';
      return;
    }
    button.disabled=true;
    button.textContent=isAppleMobile()?'Preparing Image…':'Preparing…';
    button.title='Preparing the saved grain ticket image.';
  }

  function prepareForShare(image,button,{force=false}={}){
    if(!isMobileShareDevice()||!navigator.share){
      setButton(button,{ready:true});
      return;
    }
    const url=clean(image?.currentSrc||image?.src);
    if(!url){
      button.disabled=true;
      return;
    }
    const existing=prepared.get(image);
    if(!force&&existing?.url===url){
      if(existing.file){setButton(button,{ready:true});return;}
      if(existing.error){setButton(button,{error:true});return;}
      if(existing.promise){setButton(button);return;}
    }
    const state={url,file:null,promise:null,error:null};
    prepared.set(image,state);
    setButton(button);
    state.promise=buildFile(image).then(file=>{
      state.file=file;
      state.error=null;
      setButton(button,{ready:true});
      return file;
    }).catch(error=>{
      state.error=error;
      console.warn('[FarmVista] Ticket image file preparation failed:',error);
      setButton(button,{error:true});
      return null;
    });
  }

  function sharePreparedFile(image,button){
    const state=prepared.get(image);
    const file=state?.file;
    if(!file){
      if(state?.error){prepareForShare(image,button,{force:true});return;}
      prepareForShare(image,button);return;
    }
    if(navigator.canShare && !navigator.canShare({files:[file]})){
      alert('This device cannot save this ticket image as a file from the share sheet.');
      return;
    }
    navigator.share({files:[file],title:'Grain Ticket Image'}).catch(error=>{
      if(error?.name==='AbortError') return;
      console.warn('[FarmVista] Native ticket-image file share failed:',error);
      alert('FarmVista could not open this grain ticket as an image file. Please try again.');
    });
  }

  async function downloadDesktop(image,button){
    const old=button.textContent;
    button.disabled=true;
    button.textContent='Preparing…';
    try{
      const file=await buildFile(image);
      const blobUrl=URL.createObjectURL(file);
      const a=document.createElement('a');
      a.href=blobUrl;
      a.download=file.name;
      a.style.display='none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(blobUrl),30000);
    }catch(error){
      console.warn('[FarmVista] Ticket image download failed:',error);
      alert('FarmVista could not prepare this ticket image for download. Please try again.');
    }finally{
      button.disabled=false;
      button.textContent=old;
    }
  }

  function activateImage(image,button){
    if(isMobileShareDevice()&&navigator.share){sharePreparedFile(image,button);return;}
    downloadDesktop(image,button);
  }

  function makeButton(image,key){
    const button=document.createElement('button');
    button.type='button';
    button.className='fv-ticket-download-btn';
    button.textContent=readyLabel();
    button.dataset.fvTicketDownload=key;
    button.setAttribute('aria-label',isAppleMobile()?'Save grain ticket image to Photos':'Download saved grain ticket image');
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      activateImage(image,button);
    });
    prepareForShare(image,button);
    return button;
  }

  function makeRow(image,key){
    const row=document.createElement('div');
    row.className='fv-ticket-download-row';
    row.dataset.fvTicketDownloadRow=key;
    row.hidden=!clean(image?.currentSrc||image?.getAttribute('src')||image?.src);
    row.appendChild(makeButton(image,key));
    return row;
  }

  function refreshPreparation(image,button){
    if(!image||!button)return;
    const url=clean(image.currentSrc||image.getAttribute('src')||image.src);
    const row=button.closest('.fv-ticket-download-row');
    if(row)row.hidden=!url;
    if(!url)return;
    const state=prepared.get(image);
    if(state?.url!==url)prepareForShare(image,button);
  }

  function enhanceDetail(){
    const image=document.getElementById('ticketImage');
    if(!image)return;
    const card=image.closest('.image-card')||image.closest('.card');
    const wrap=document.getElementById('ticketImageWrap')||image.parentElement;
    if(!card||!wrap)return;

    // Remove only an old legacy button once. Never repeatedly mutate the page.
    const legacy=card.querySelector('.image-actions [data-fv-ticket-download]');
    if(legacy) legacy.remove();

    let row=card.querySelector('[data-fv-ticket-download-row="detail"]');
    if(!row){
      row=makeRow(image,'detail');
      const helper=card.querySelector('.card-sub');
      if(helper)helper.insertAdjacentElement('afterend',row);else wrap.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  function enhanceInventory(){
    const image=document.querySelector('.fv-ticket-image-body img')||document.getElementById('ticket-image-modal-img');
    if(!image)return;
    const body=image.closest('.fv-ticket-image-body')||image.parentElement;
    if(!body)return;
    const dialog=image.closest('.fv-ticket-image-dialog')||image.closest('.modal-card')||body.parentElement;
    let row=dialog?.querySelector('[data-fv-ticket-download-row="inventory"]');
    if(!row){
      row=makeRow(image,'inventory');
      body.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  function enhanceContractReport(){
    const image=document.getElementById('ticketPopupImage');
    const wrap=image?.closest('.ticket-image-wrap');
    if(!image||!wrap)return;
    const parent=wrap.parentElement;
    let row=parent?.querySelector(':scope > [data-fv-ticket-download-row="contract"]');
    if(!row){
      row=makeRow(image,'contract');
      wrap.insertAdjacentElement('beforebegin',row);
    }
    refreshPreparation(image,row.querySelector('.fv-ticket-download-btn'));
  }

  /* ============================================================
     Grain Inventory — Active Hauling Jobs overview
  ============================================================ */
  async function installActiveHaulingJobs(){
    if(!String(location.pathname||'').toLowerCase().endsWith('/pages/grain/index.html')) return;
    if(document.getElementById('fv-active-hauling-jobs-section')) return;

    const harvest=document.getElementById('active-harvest-section')?.closest('.workspace-section');
    if(!harvest) return;

    const extraStyle=document.createElement('style');
    extraStyle.id='fv-active-hauling-jobs-style';
    extraStyle.textContent=`
      #fv-active-hauling-jobs-section .fv-ahj-table{width:100%;border-collapse:collapse;min-width:980px}
      #fv-active-hauling-jobs-section .fv-ahj-table th{padding:10px 12px;background:var(--surface-2,#f3f3f3);border-bottom:1px solid var(--border,#d4d4d4);font-size:.78rem;font-weight:800;text-align:center;white-space:nowrap}
      #fv-active-hauling-jobs-section .fv-ahj-table td{padding:11px 12px;border-bottom:1px solid var(--border,#e1e1e1);font-size:.88rem;text-align:center;vertical-align:middle}
      #fv-active-hauling-jobs-section .fv-ahj-table td:first-child,#fv-active-hauling-jobs-section .fv-ahj-table th:first-child{text-align:left}
      #fv-active-hauling-jobs-section .fv-ahj-row{cursor:pointer}
      #fv-active-hauling-jobs-section .fv-ahj-row:hover{background:var(--surface-2,rgba(0,0,0,.04))}
      .fv-ahj-jobname{font-weight:850}
      .fv-ahj-status{display:inline-flex;align-items:center;justify-content:center;padding:4px 9px;border-radius:999px;background:rgba(59,126,70,.14);color:#2d6937;font-size:.75rem;font-weight:850;white-space:nowrap}
      .fv-ahj-status.past-due{background:rgba(179,38,30,.12);color:#a6201a}
      [data-theme="dark"] .fv-ahj-status{color:#b9e4bf}
      [data-theme="dark"] .fv-ahj-status.past-due{color:#ffb4ab}
      .fv-ahj-empty{padding:28px 18px;text-align:center;opacity:.68}
      #fv-ahj-modal-backdrop{z-index:12500}
      .fv-ahj-ticket-link{color:#3B7E46;font-weight:850;text-decoration:none}
      .fv-ahj-ticket-link:hover{text-decoration:underline}
      @media(max-width:560px){#fv-active-hauling-jobs-section .inventory-head{padding-bottom:13px}}
    `;
    document.head.appendChild(extraStyle);

    const section=document.createElement('section');
    section.className='workspace-section';
    section.id='fv-active-hauling-jobs-section';
    section.innerHTML=`
      <div class="inventory-card">
        <div class="inventory-head">
          <div>
            <h2 class="inventory-title">Active Hauling Jobs</h2>
            <div class="inventory-sub">Open hauling jobs at a glance. Click a job to see its tickets and weighted grain-quality averages.</div>
          </div>
        </div>
        <div class="inventory-body">
          <div class="table-wrap">
            <table class="fv-ahj-table">
              <thead><tr>
                <th>Hauling Job</th><th>Status</th><th>Crop</th><th>Starting Bu.</th><th>Ticketed Bu.</th><th>Remaining</th><th>Loads</th><th>Avg MO</th><th>Avg FM</th><th>Avg Damage</th>
              </tr></thead>
              <tbody id="fv-ahj-tbody"><tr><td colspan="10" class="fv-ahj-empty">Loading active hauling jobs…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>`;
    harvest.insertAdjacentElement('beforebegin',section);

    const modal=document.createElement('div');
    modal.className='modal-backdrop';
    modal.id='fv-ahj-modal-backdrop';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fv-ahj-modal-title">
        <div class="modal-head">
          <div><div class="modal-title" id="fv-ahj-modal-title">Hauling Job</div><div class="inventory-sub" id="fv-ahj-modal-sub"></div></div>
          <button type="button" class="modal-close" id="fv-ahj-modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid" id="fv-ahj-summary"></div>
          <div id="fv-ahj-ticket-list"></div>
          <div class="modal-actions"><button type="button" class="btn" id="fv-ahj-modal-done">Close</button></div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const n=v=>{const x=Number(String(v??'').replace(/,/g,''));return Number.isFinite(x)?x:0};
    const norm=v=>clean(v).toLowerCase();
    const esc=v=>clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    const fmtBu=v=>`${Math.round(n(v)).toLocaleString('en-US')} bu`;
    const fmtGrade=v=>{const x=Number(v);return Number.isFinite(x)?`${x.toFixed(2)}%`:'N/A'};
    const cropLabel=v=>{const x=norm(v);if(['soy','soybean','soybeans','beans','sb'].includes(x))return 'Soybeans';if(['corn','maize'].includes(x))return 'Corn';if(x==='wheat')return 'Wheat';return clean(v)||'—'};
    const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
    const starting=j=>Math.max(0,n(j?.startingBushels??j?.jobBushels??j?.bushels));
    const isVoided=t=>t?.voided===true||norm(t?.status).includes('void');
    const ticketBushels=t=>Math.max(0,n(t?.netBushels??t?.netBu??t?.bushels));
    const ticketsFor=(tickets,id)=>tickets.filter(t=>!isVoided(t)&&clean(t?.haulingJobId)===clean(id));
    const ticketed=(tickets,j)=>ticketsFor(tickets,j.id).reduce((s,t)=>s+ticketBushels(t),0);
    const remaining=(tickets,j)=>Math.max(0,starting(j)-ticketed(tickets,j));
    const status=(tickets,j)=>{
      if(j?.manualClosed===true)return 'closed';
      const raw=norm(j?.status);
      if(j?.active===false||raw.includes('void'))return 'voided';
      if(raw.includes('closed')||raw.includes('cancel'))return 'closed';
      if(raw.includes('complete')||(starting(j)>0&&remaining(tickets,j)<=.005))return 'complete';
      const start=clean(j?.deliveryStartDate||j?.startDate);
      if(start&&start>today())return 'upcoming';
      const end=clean(j?.deliveryEndDate||j?.endDate);
      if(end&&end<today()&&remaining(tickets,j)>.005)return 'past_due';
      return 'active';
    };
    const jobName=j=>{
      const saved=clean(j?.displayName||j?.jobName||j?.haulingJobName);if(saved)return saved;
      const buyer=clean(j?.buyerName||j?.buyer);
      const location=clean(j?.deliveryLocationName||j?.locationName||j?.destinationName||j?.destination);
      const place=buyer&&location&&!norm(location).startsWith(norm(buyer))?`${buyer} ${location}`:(location||buyer||'Hauling Job');
      return `${place} — ${Math.round(starting(j)).toLocaleString('en-US')} bu`;
    };
    const dateValue=t=>clean(t?.ticketDate||t?.date||t?.deliveryDate||'');
    const ticketNumber=t=>clean(t?.ticketNumber||t?.ticketNo||t?.number||t?.scaleTicketNumber)||clean(t?.id).slice(0,8);
    const driver=t=>clean(t?.driverName||t?.driver||t?.submittedByName||t?.submittedBy)||'—';
    const weighted=tickets=>{
      let total=0,mo=0,moW=0,fm=0,fmW=0,da=0,daW=0;
      tickets.forEach(t=>{const w=ticketBushels(t);total+=w;if(!(w>0))return;
        const m=Number(t?.moisture??t?.mo),f=Number(t?.foreignMaterial??t?.fm),d=Number(t?.damage??t?.dm);
        if(Number.isFinite(m)){mo+=m*w;moW+=w}if(Number.isFinite(f)){fm+=f*w;fmW+=w}if(Number.isFinite(d)){da+=d*w;daW+=w}
      });
      return{bushels:total,loads:tickets.length,moisture:moW?mo/moW:null,fm:fmW?fm/fmW:null,damage:daW?da/daW:null};
    };

    const closeModal=()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow=''};
    modal.querySelector('#fv-ahj-modal-close').addEventListener('click',closeModal);
    modal.querySelector('#fv-ahj-modal-done').addEventListener('click',closeModal);
    modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});

    try{
      const firebase=await import('/js/firebase-init.js');
      await firebase.ready;
      const db=firebase.getFirestore();
      const [jobSnap,ticketSnap]=await Promise.all([
        firebase.getDocs(firebase.collection(db,'grain_hauling_jobs')),
        firebase.getDocs(firebase.collection(db,'grain_tickets'))
      ]);
      const jobs=jobSnap.docs.map(ds=>({id:ds.id,...(ds.data()||{})}));
      const tickets=ticketSnap.docs.map(ds=>({id:ds.id,...(ds.data()||{})}));
      const active=jobs.filter(j=>['active','past_due'].includes(status(tickets,j))).sort((a,b)=>{
        const as=status(tickets,a)==='past_due'?0:1,bs=status(tickets,b)==='past_due'?0:1;
        return as-bs||jobName(a).localeCompare(jobName(b),undefined,{numeric:true,sensitivity:'base'});
      });
      const tbody=section.querySelector('#fv-ahj-tbody');
      if(!active.length){tbody.innerHTML='<tr><td colspan="10" class="fv-ahj-empty">No active hauling jobs.</td></tr>';return;}
      tbody.innerHTML=active.map(j=>{
        const jt=ticketsFor(tickets,j.id),g=weighted(jt),st=status(tickets,j);
        return `<tr class="fv-ahj-row" data-job-id="${esc(j.id)}">
          <td><span class="fv-ahj-jobname">${esc(jobName(j))}</span></td>
          <td><span class="fv-ahj-status ${st==='past_due'?'past-due':''}">${st==='past_due'?'Past Due':'Active'}</span></td>
          <td>${esc(cropLabel(j?.crop||j?.commodity))}</td>
          <td>${fmtBu(starting(j))}</td><td>${fmtBu(g.bushels)}</td><td>${fmtBu(remaining(tickets,j))}</td>
          <td>${g.loads.toLocaleString('en-US')}</td><td>${fmtGrade(g.moisture)}</td><td>${fmtGrade(g.fm)}</td><td>${fmtGrade(g.damage)}</td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('[data-job-id]').forEach(row=>row.addEventListener('click',()=>{
        const job=active.find(j=>j.id===row.dataset.jobId);if(!job)return;
        const jt=ticketsFor(tickets,job.id).sort((a,b)=>dateValue(b).localeCompare(dateValue(a))||ticketNumber(a).localeCompare(ticketNumber(b),undefined,{numeric:true,sensitivity:'base'}));
        const g=weighted(jt);
        modal.querySelector('#fv-ahj-modal-title').textContent=jobName(job);
        const sold=clean(job?.customerName||job?.soldUnderName||job?.soldUnder);
        modal.querySelector('#fv-ahj-modal-sub').textContent=[cropLabel(job?.crop||job?.commodity),sold?`Sold Under: ${sold}`:''].filter(Boolean).join(' • ');
        modal.querySelector('#fv-ahj-summary').innerHTML=`
          <div class="detail-box"><div class="detail-label">Starting Bushels</div><div class="detail-value">${fmtBu(starting(job))}</div></div>
          <div class="detail-box"><div class="detail-label">Ticketed Bushels</div><div class="detail-value">${fmtBu(g.bushels)}</div></div>
          <div class="detail-box"><div class="detail-label">Remaining</div><div class="detail-value">${fmtBu(remaining(tickets,job))}</div></div>
          <div class="detail-box"><div class="detail-label">Loads</div><div class="detail-value">${g.loads}</div></div>
          <div class="detail-box"><div class="detail-label">Avg Moisture</div><div class="detail-value">${fmtGrade(g.moisture)}</div></div>
          <div class="detail-box"><div class="detail-label">Avg FM / Damage</div><div class="detail-value">${fmtGrade(g.fm)} / ${fmtGrade(g.damage)}</div></div>`;
        modal.querySelector('#fv-ahj-ticket-list').innerHTML=jt.length?`
          <div class="table-wrap"><table class="harvest-drill-table"><thead><tr><th>Ticket #</th><th>Date</th><th>Driver</th><th>Bushels</th><th>MO</th><th>FM</th><th>Damage</th></tr></thead><tbody>
          ${jt.map(t=>`<tr><td><a class="fv-ahj-ticket-link" href="/pages/grain/grain-ticket-detail.html?id=${encodeURIComponent(t.id)}">${esc(ticketNumber(t))}</a></td><td>${esc(dateValue(t)||'—')}</td><td>${esc(driver(t))}</td><td>${fmtBu(ticketBushels(t))}</td><td>${fmtGrade(t?.moisture??t?.mo)}</td><td>${fmtGrade(t?.foreignMaterial??t?.fm)}</td><td>${fmtGrade(t?.damage??t?.dm)}</td></tr>`).join('')}
          </tbody></table></div>`:'<div class="fv-ahj-empty">No tickets are linked to this hauling job yet.</div>';
        modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
      }));
    }catch(error){
      console.error('[FarmVista] Active hauling jobs overview failed:',error);
      const tbody=section.querySelector('#fv-ahj-tbody');
      if(tbody)tbody.innerHTML='<tr><td colspan="10" class="fv-ahj-empty">Active hauling jobs could not be loaded.</td></tr>';
    }
  }

  const path=String(location.pathname||'').toLowerCase();
  const isDetail=path.endsWith('/pages/grain/grain-ticket-detail.html');

  if(path.endsWith('/pages/grain/index.html')) installActiveHaulingJobs();

  if(isDetail){
    enhanceDetail();

    const image=document.getElementById('ticketImage');
    if(image){
      const observer=new MutationObserver(()=>enhanceDetail());
      observer.observe(image,{attributes:true,attributeFilter:['src']});
      image.addEventListener('load',enhanceDetail,{passive:true});
      window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }
    return;
  }

  // Inventory/report dialogs are created dynamically. Keep a bounded,
  // throttled child-list observer there, but never observe attributes or run
  // synchronously for every mutation.
  let timer=0;
  const runDynamicEnhance=()=>{
    timer=0;
    enhanceInventory();
    enhanceContractReport();
  };
  const scheduleDynamicEnhance=()=>{
    if(timer)return;
    timer=window.setTimeout(runDynamicEnhance,100);
  };

  runDynamicEnhance();
  const observer=new MutationObserver(scheduleDynamicEnhance);
  observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
})();
