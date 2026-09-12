/* FarmVista — hauling-job ticket sequence review — Sept. 12, 2026 */
(() => {
  'use strict';
  if (window.__FV_HAULING_TICKET_SEQUENCE_20260912) return;
  window.__FV_HAULING_TICKET_SEQUENCE_20260912 = true;
  if (!location.pathname.toLowerCase().endsWith('/pages/grain/grain-contracts.html')) return;

  const clean=v=>String(v??'').trim();
  const num=v=>{const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
  const fmt=v=>num(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  const expanded=new Set();
  let firebase=null,db=null,jobs=new Map(),tickets=new Map(),loading=null,queued=false;

  function styles(){
    if(document.getElementById('fv-hauling-ticket-sequence-style'))return;
    const s=document.createElement('style');s.id='fv-hauling-ticket-sequence-style';s.textContent=`
      #fv-ticket-status-job-list .fv-seq-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:8px 10px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--surface-2,#f5f5f5);color:inherit;font:inherit;font-size:.78rem;font-weight:900;cursor:pointer}
      #fv-ticket-status-job-list .fv-seq-body[hidden]{display:none!important}
      #fv-ticket-status-job-list .fv-seq-body{display:grid!important;gap:8px!important;margin-top:8px!important}
      #fv-ticket-status-job-list .fv-seq-badge{display:inline-flex;margin-left:7px;padding:2px 7px;border-radius:999px;font-size:.67rem;font-weight:900}
      #fv-ticket-status-job-list .fv-seq-badge.job{background:rgba(59,126,70,.12);color:#2d6937}
      #fv-ticket-status-job-list .fv-seq-badge.split{background:rgba(230,126,34,.14);color:#a65300}
      #fv-ticket-status-job-list .fv-seq-badge.spot{background:rgba(179,38,30,.11);color:#9d241e}
      #fv-ticket-status-job-list .fv-seq-line{margin-top:4px;font-size:.72rem;font-weight:850}
      #fv-ticket-status-job-list .fv-seq-line .spot{color:#9d241e}
    `;document.head.appendChild(s);
  }

  async function load(force=false){
    if(loading&&!force)return loading;
    loading=(async()=>{const f=firebase||await import('/js/firebase-init.js');await f.ready;firebase=f;db=f.getFirestore();const [j,t]=await Promise.all([f.getDocs(f.collection(db,'grain_hauling_jobs')),f.getDocs(f.collection(db,'grain_tickets'))]);jobs=new Map(j.docs.map(x=>[x.id,{id:x.id,...x.data()}]));tickets=new Map(t.docs.map(x=>[x.id,{id:x.id,...x.data()}]));})().finally(()=>loading=null);return loading;
  }

  const ticketNo=t=>clean(t?.ticketNumber||t?.ticketNo||t?.ticket||t?.number||t?.scaleTicketNumber||t?.id);
  const ticketBu=t=>Math.max(0,num(t?.netBushels??t?.netBu??t?.bushels));
  const target=j=>Math.max(0,num(j?.startingBushels??j?.jobBushels??j?.bushels));

  function ordered(jobId){return [...tickets.values()].filter(t=>clean(t?.haulingJobId)===jobId&&!clean(t?.status).toLowerCase().includes('void')).sort((a,b)=>collator.compare(ticketNo(a),ticketNo(b))||clean(a?.ticketDate||a?.date).localeCompare(clean(b?.ticketDate||b?.date)))}

  function allocation(job,list){let used=0;const max=target(job);return list.map((t,i)=>{const bu=ticketBu(t),fill=Math.min(bu,Math.max(0,max-used)),spot=Math.max(0,bu-fill);used+=bu;return{t,rank:i+1,fill,spot,type:spot>.005?(fill>.005?'split':'spot'):'job'}})}

  function makeBody(linked,jobId,count){
    let toggle=linked.querySelector(':scope>.fv-seq-toggle'),body=linked.querySelector(':scope>.fv-seq-body');
    if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='fv-seq-toggle';toggle.innerHTML='<span></span><b>›</b>';linked.querySelector(':scope>.fv-ticket-job-linked-label')?.insertAdjacentElement('afterend',toggle);toggle.onclick=e=>{e.preventDefault();e.stopPropagation();const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',open?'true':'false');body.hidden=!open;open?expanded.add(jobId):expanded.delete(jobId);text(toggle,count,open)}}
    if(!body){body=document.createElement('div');body.className='fv-seq-body';linked.appendChild(body)}
    linked.querySelectorAll(':scope>[data-fv-status-ticket]').forEach(n=>body.appendChild(n));
    const open=expanded.has(jobId);toggle.setAttribute('aria-expanded',open?'true':'false');body.hidden=!open;text(toggle,count,open);return body;
  }
  function text(t,c,o){const s=t.querySelector('span');if(s)s.textContent=`${c} assigned ticket${c===1?'':'s'} — ${o?'Hide':'View'}`}

  function decorateCard(card,a){
    const title=card.querySelector('.fv-hauling-ticket-title span:first-child');
    if(title){title.querySelector('.fv-seq-badge')?.remove();title.insertAdjacentHTML('beforeend',`<span class="fv-seq-badge ${a.type}">${a.type==='spot'?'SPOT':a.type==='split'?'FILLS JOB + SPOT':'JOB'}</span>`)}
    let line=card.querySelector('.fv-seq-line');if(!line){line=document.createElement('div');line.className='fv-seq-line';const note=card.querySelector('.fv-status-ticket-note');(note||card.lastElementChild||card).insertAdjacentElement(note?'beforebegin':'beforeend',line)}
    line.innerHTML=a.type==='split'?`Job: ${fmt(a.fill)} bu • <span class="spot">Spot: ${fmt(a.spot)} bu</span>`:a.type==='spot'?`<span class="spot">Spot: ${fmt(a.spot)} bu</span>`:`Job: ${fmt(a.fill)} bu`;
  }

  async function run(){
    const root=document.getElementById('fv-ticket-status-job-list');if(!root||root.hidden)return;await load(true);
    root.querySelectorAll('[data-fv-status-job][data-fv-ticket-job-id]').forEach(jobCard=>{const id=clean(jobCard.dataset.fvTicketJobId),job=jobs.get(id),linked=jobCard.querySelector('.fv-ticket-job-linked');if(!job||!linked)return;const list=allocation(job,ordered(id)),body=makeBody(linked,id,list.length),cards=new Map([...body.querySelectorAll('[data-fv-status-ticket][data-ticket-id]')].map(c=>[clean(c.dataset.ticketId),c]));list.forEach(a=>{const c=cards.get(a.t.id);if(c){body.appendChild(c);decorateCard(c,a)}})});
  }
  function queue(ms=30){if(queued)return;queued=true;setTimeout(()=>requestAnimationFrame(async()=>{queued=false;styles();await run()}),ms)}
  new MutationObserver(()=>queue()).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('change',e=>{if(e.target?.id==='fv-ticket-job-status-filter')queue(120)},true);
  document.addEventListener('drop',()=>queue(500),true);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>queue(50),{once:true});else queue(50);
})();
