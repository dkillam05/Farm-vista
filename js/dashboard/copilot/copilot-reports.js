import {ready,getFirestore,doc,getDoc} from '/js/firebase/firebase-init.js';
import {buildReportPdf,reportFilename,validateReport} from './copilot-report-pdf.js';

let pdfTools;
async function withTimeout(promise,ms,message){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
function loadScript(src){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=src;
    const timer=setTimeout(()=>{script.remove();reject(new Error('PDF tools took too long to load. Please try again.'));},15000);
    script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('PDF tools could not load. Please try again.'));};document.head.appendChild(script);
  });
}
async function loadTools(){
  if(!pdfTools)pdfTools=(async()=>{
    if(!window.jspdf?.jsPDF)await loadScript('/js/vendor/jspdf.umd.min.js');
    if(!window.jspdf.jsPDF.API.autoTable)await loadScript('/js/vendor/jspdf.plugin.autotable.min.js');
    return window.jspdf.jsPDF;
  })().catch(error=>{pdfTools=null;throw error;});
  return pdfTools;
}
async function logoImage(url){
  const parsed=new URL(url,location.origin);
  if(parsed.protocol!=='https:' || parsed.username || parsed.password)throw new Error('Invalid logo URL');
  const res=await fetch(parsed.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw new Error('Logo unavailable');
  const blob=await res.blob();if(blob.size>4*1024*1024)throw new Error('Logo too large');
  const objectUrl=URL.createObjectURL(blob);
  try {
    const img=new Image();img.src=objectUrl;
    await withTimeout(img.decode(),10000,'Logo decode timed out');
    if(!img.naturalWidth || !img.naturalHeight)throw new Error('Invalid logo');
    const scale=Math.min(1,512/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
    return {logoData:canvas.toDataURL('image/png'),logoWidth:canvas.width,logoHeight:canvas.height};
  }finally{URL.revokeObjectURL(objectUrl);}
}
async function companyBranding(isCurrent){
  await ready;if(!isCurrent())throw new Error('Your sign-in changed. Reload FarmVista.');
  let company={},notice='';
  try{
    const snapshot=await withTimeout(getDoc(doc(getFirestore(),'company','main')),12000,'Company lookup timed out');
    company=snapshot?.exists()?snapshot.data():{};
  }catch{notice='Company details could not be loaded; FarmVista branding is used.';}
  if(!isCurrent())throw new Error('Your sign-in changed. Reload FarmVista.');
  let logo;
  if(company.logo?.url){try{logo=await logoImage(company.logo.url);}catch{notice='The company logo could not be loaded; the FarmVista logo is used.';}}
  if(!logo)logo=await logoImage('/assets/icons/logo.png');
  return {name:String(company.name || 'FarmVista').slice(0,240),...logo,notice};
}

export function createReportManager({endpoint,getToken,projectId,isCurrent}){
  const cache=new Map();let activeUrl=null,activeFile=null,activePdf=null,sequence=0;
  const modal=document.createElement('dialog');modal.className='fv-report-dialog';
  modal.setAttribute('aria-label','Copilot report');
  modal.innerHTML='<div class="fv-report-head"><strong>Report PDF</strong><button type="button" data-close>Close</button></div><div class="fv-report-actions"><button type="button" data-share disabled>Share PDF</button><button type="button" data-save disabled>Save PDF</button><button type="button" data-print disabled>Print</button><a data-open hidden target="_blank" rel="noopener">Open PDF</a></div><p class="fv-report-status" role="status" aria-live="polite"></p><iframe title="Report PDF preview"></iframe>';
  const style=document.createElement('style');style.textContent=`
    .fv-report-dialog{box-sizing:border-box;width:min(1000px,calc(100vw - 24px));height:min(88dvh,940px);max-height:calc(100dvh - 24px);max-width:calc(100vw - 24px);padding:0;border:1px solid var(--border,#ccd3cd);border-radius:14px;background:var(--surface,#fff);color:var(--text,#18251c)}
    .fv-report-dialog[open]{display:flex;flex-direction:column}.fv-report-dialog::backdrop{background:rgba(0,0,0,.6)}
    .fv-report-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-bottom:2px solid #c7bb3e}
    .fv-report-actions{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px 0}
    .fv-report-dialog button,.fv-report-dialog a{font:600 13px system-ui;min-height:42px;padding:9px 13px;border:0;border-radius:9px;background:#2f6c3c;color:#fff;text-decoration:none;cursor:pointer;box-sizing:border-box}
    .fv-report-dialog button:disabled{opacity:.45;cursor:default}.fv-report-dialog [data-close]{background:var(--border,#e2e7e2);color:var(--text,#18251c)}
    .fv-report-status{font:13px/1.4 system-ui;margin:8px 14px;min-height:18px}.fv-report-dialog iframe{border:0;flex:1;width:100%;min-height:0;background:#fff}
    html.fv-report-open,html.fv-report-open body{overflow:hidden!important}html.fv-report-open fv-shell::part(main){overflow:hidden!important}
    #ai-section .fv-report-create{width:44px;height:44px;border:0;background:transparent;color:var(--text,#18251c);cursor:pointer;border-radius:9px;display:inline-flex;align-items:center;justify-content:center}
    #ai-section .fv-report-create svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    #ai-section .fv-report-link{display:block;margin-top:10px;padding:9px 13px;border:0;border-radius:9px;background:#2f6c3c;color:#fff;font:600 13px system-ui;cursor:pointer}
  `;
  document.head.appendChild(style);document.body.appendChild(modal);
  const frame=modal.querySelector('iframe'),status=modal.querySelector('[role="status"]'),openLink=modal.querySelector('[data-open]');
  const buttons=[...modal.querySelectorAll('[data-share],[data-save],[data-print]')];
  function clearActive(){frame.removeAttribute('src');if(activeUrl)URL.revokeObjectURL(activeUrl);activeUrl=null;activeFile=null;activePdf=null;openLink.hidden=true;buttons.forEach(button=>button.disabled=true);}
  function close(){sequence++;if(modal.open)modal.close();document.documentElement.classList.remove('fv-report-open');clearActive();}
  modal.querySelector('[data-close]').addEventListener('click',close);
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  modal.addEventListener('close',()=>{document.documentElement.classList.remove('fv-report-open');});
  function assertCurrent(){if(!isCurrent())throw new Error('Your farm or sign-in changed. Reload FarmVista before opening a report.');}
  function remember(report){
    validateReport(report);cache.set(report.id,report);
    while(cache.size>3)cache.delete(cache.keys().next().value);
    return {id:report.id,title:report.title,query:report.query};
  }
  async function open(ref){
    const request=++sequence;clearActive();
    modal.querySelector('strong').textContent=ref.title || 'Report PDF';status.textContent='Preparing PDF…';
    if(!modal.open)modal.showModal();document.documentElement.classList.add('fv-report-open');
    try{
      assertCurrent();let report=cache.get(ref.id),refreshed=false;
      if(!report){
        const token=await getToken();assertCurrent();if(!token)throw new Error('Please sign in again.');
        const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({projectId,query:ref.query}),signal:AbortSignal.timeout(240000)});
        const result=await res.json();assertCurrent();
        if(!res.ok || !result.ok)throw new Error(result.error || 'The report could not be loaded.');
        report=result.report;validateReport(report);cache.set(ref.id,report);refreshed=true;
        while(cache.size>3)cache.delete(cache.keys().next().value);
      }
      const [jsPDF,branding]=await Promise.all([loadTools(),companyBranding(isCurrent)]);assertCurrent();
      if(request!==sequence)return;
      activePdf=buildReportPdf({report,branding,jsPDF});const blob=activePdf.output('blob');
      activeFile=new File([blob],reportFilename(report),{type:'application/pdf'});activeUrl=URL.createObjectURL(blob);
      frame.src=activeUrl;openLink.href=activeUrl;openLink.hidden=false;buttons.forEach(button=>button.disabled=false);
      status.textContent=branding.notice || (refreshed?'Report refreshed from current records.':'Ready to share, save or print.');
    }catch(error){if(request!==sequence)return;if(isCurrent())status.textContent=error.message || 'The PDF could not be created.';else close();}
  }
  modal.querySelector('[data-save]').addEventListener('click',()=>{
    if(!activeFile || !isCurrent())return;
    const link=document.createElement('a');link.href=activeUrl;link.download=activeFile.name;document.body.appendChild(link);link.click();link.remove();status.textContent='PDF download started. You can also use Open PDF to save it.';
  });
  modal.querySelector('[data-share]').addEventListener('click',async()=>{
    if(!activeFile || !isCurrent())return;
    if(!navigator.share || !navigator.canShare?.({files:[activeFile]})){status.textContent='Use Save PDF, then attach the file to your message or email.';return;}
    try{await navigator.share({files:[activeFile],title:activeFile.name});close();}
    catch(error){if(error.name!=='AbortError')status.textContent='Sharing could not open. Use Save PDF or Open PDF instead.';}
  });
  modal.querySelector('[data-print]').addEventListener('click',()=>{
    if(!activeFile || !isCurrent())return;
    try{frame.contentWindow.focus();frame.contentWindow.print();status.textContent='If no print menu appears, use Open PDF and choose Print from its menu.';}
    catch{status.textContent='Use Open PDF, then choose Print from its menu.';}
  });
  return {remember,open,destroy(){close();cache.clear();modal.remove();style.remove();}};
}
