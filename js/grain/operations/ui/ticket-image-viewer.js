// FarmVista Grain Operations — read-only ticket image viewer shared by ticket quick detail.
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export function ticketImageViewer(url){
  if(!url)return '<section class="fv-go-ticket-image"><h3>Original Grain Ticket</h3><div class="fv-go-ticket-image-empty">No ticket image available.</div></section>';
  return `<section class="fv-go-ticket-image"><h3>Original Grain Ticket</h3><div class="fv-go-ticket-viewer" data-ticket-viewer><div class="fv-go-ticket-stage"><img src="${String(url).replaceAll('"','&quot;')}" alt="Scanned grain ticket" draggable="false"></div></div><div class="fv-go-ticket-image-actions"><button type="button" class="fv-go-btn secondary" data-ticket-rotate="-90">↶ Rotate Left</button><button type="button" class="fv-go-btn secondary" data-ticket-rotate="90">↷ Rotate Right</button></div></section>`;
}
export function wireTicketImageViewer(scope){
  const wrap=scope?.querySelector('[data-ticket-viewer]'),img=wrap?.querySelector('img'),stage=wrap?.querySelector('.fv-go-ticket-stage');if(!wrap||!img||!stage)return;
  let zoom=1,rotation=0,panning=false,startX=0,startY=0,startLeft=0,startTop=0,pinchDistance=0,pinchZoom=1,touchPanX=0,touchPanY=0,touchPanLeft=0,touchPanTop=0;
  const fit=()=>{if(!img.naturalWidth||!img.naturalHeight)return 1;const side=Math.abs(rotation%180)===90,w=side?img.naturalHeight:img.naturalWidth,h=side?img.naturalWidth:img.naturalHeight;return Math.min((wrap.clientWidth-36)/w,(wrap.clientHeight-36)/h)};
  const draw=(center=false)=>{if(!img.naturalWidth)return;const scale=fit()*zoom,side=Math.abs(rotation%180)===90,w=(side?img.naturalHeight:img.naturalWidth)*scale,h=(side?img.naturalWidth:img.naturalHeight)*scale;stage.style.width=Math.max(wrap.clientWidth,w+40)+'px';stage.style.height=Math.max(wrap.clientHeight,h+40)+'px';img.style.width=img.naturalWidth+'px';img.style.height=img.naturalHeight+'px';img.style.transform=`translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;if(center)requestAnimationFrame(()=>{wrap.scrollLeft=Math.max(0,(stage.scrollWidth-wrap.clientWidth)/2);wrap.scrollTop=Math.max(0,(stage.scrollHeight-wrap.clientHeight)/2)})};
  img.onload=()=>draw(true);if(img.complete)draw(true);
  wrap.addEventListener('wheel',e=>{e.preventDefault();zoom=clamp(zoom+(e.deltaY<0?.12:-.12),1,5);draw(true)},{passive:false});
  wrap.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||(e.pointerType==='mouse'&&e.button!==0))return;panning=true;startX=e.clientX;startY=e.clientY;startLeft=wrap.scrollLeft;startTop=wrap.scrollTop;wrap.classList.add('is-panning');wrap.setPointerCapture?.(e.pointerId)});
  wrap.addEventListener('pointermove',e=>{if(!panning)return;e.preventDefault();wrap.scrollLeft=startLeft-(e.clientX-startX);wrap.scrollTop=startTop-(e.clientY-startY)});
  const stop=()=>{panning=false;wrap.classList.remove('is-panning')};wrap.addEventListener('pointerup',stop);wrap.addEventListener('pointercancel',stop);
  const distance=t=>Math.hypot(t[1].clientX-t[0].clientX,t[1].clientY-t[0].clientY);
  wrap.addEventListener('touchstart',e=>{if(e.touches.length===2){e.preventDefault();pinchDistance=distance(e.touches);pinchZoom=zoom}else if(e.touches.length===1&&zoom>1){e.preventDefault();touchPanX=e.touches[0].clientX;touchPanY=e.touches[0].clientY;touchPanLeft=wrap.scrollLeft;touchPanTop=wrap.scrollTop}},{passive:false});
  wrap.addEventListener('touchmove',e=>{if(e.touches.length===2&&pinchDistance){e.preventDefault();zoom=clamp(pinchZoom*distance(e.touches)/pinchDistance,1,5);draw(false)}else if(e.touches.length===1&&zoom>1){e.preventDefault();wrap.scrollLeft=touchPanLeft-(e.touches[0].clientX-touchPanX);wrap.scrollTop=touchPanTop-(e.touches[0].clientY-touchPanY)}},{passive:false});
  wrap.addEventListener('touchend',e=>{if(e.touches.length<2)pinchDistance=0});
  scope.querySelectorAll('[data-ticket-rotate]').forEach(b=>b.onclick=()=>{rotation+=Number(b.dataset.ticketRotate)||0;zoom=1;draw(true)});
}
