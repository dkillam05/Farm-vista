// FarmVista Grain Operations — mandatory phone landscape gate.
// Portrait uses a page-level notice outside the Grain Operations workspace so the shell stays usable.
const STYLE_ID='fv-grain-operations-landscape-lock-style';
const GATE_ID='fv-grain-operations-landscape-gate';

export function installLandscapeLock(){
  if(!document.getElementById(STYLE_ID)){
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      #${GATE_ID}{display:none}
      #${GATE_ID} .fv-rotate-icon-wrap{
        width:70px;height:70px;border-radius:18px;
        display:flex;align-items:center;justify-content:center;
        margin-bottom:22px;background:rgba(59,126,70,.10);
      }
      #${GATE_ID} .fv-rotate-icon{font-size:45px;line-height:1;color:#3B7E46;font-weight:800}
      #${GATE_ID} .fv-rotate-title{font-size:1.5rem;font-weight:900;line-height:1.15;margin-bottom:16px}
      #${GATE_ID} .fv-rotate-copy{font-size:.98rem;line-height:1.45;opacity:.72;max-width:380px}
      @media (max-width:700px) and (orientation:portrait){
        html:has(body.fv-grain-operations-locked),body.fv-grain-operations-locked{height:100%;overflow:hidden!important;overscroll-behavior:none;background:var(--bg,#fff)!important}
        body.fv-grain-operations-locked fv-shell{height:100dvh;overflow:hidden;background:var(--bg,#fff)!important}
        body.fv-grain-operations-locked .contracts-page{display:none!important}
        body.fv-grain-operations-locked #${GATE_ID}{
          display:flex!important;
          position:fixed;
          left:0;right:0;
          top:calc(env(safe-area-inset-top,0px) + 56px);
          bottom:calc(var(--fv-shell-footer-height,64px) + 3px);
          z-index:900;
          align-items:center;justify-content:center;flex-direction:column;
          padding:24px;text-align:center;
          background:var(--bg,#fff)!important;
          color:var(--text,#142016);border:0;box-shadow:none;overflow:hidden;
        }
        body.fv-grain-operations-locked #${GATE_ID}::before{
          content:'';position:fixed;left:0;right:0;
          top:calc(env(safe-area-inset-top,0px) + 56px);
          height:3px;background:#d7bd38;pointer-events:none;
        }
        body.fv-grain-operations-locked #${GATE_ID}::after{
          content:'';position:fixed;left:0;right:0;
          bottom:var(--fv-shell-footer-height,64px);height:3px;
          background:#d7bd38;pointer-events:none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  let gate=document.getElementById(GATE_ID);
  if(!gate){
    gate=document.createElement('div');
    gate.id=GATE_ID;
    gate.setAttribute('role','region');
    gate.setAttribute('aria-label','Rotate phone to use Grain Operations');
    gate.innerHTML='<div class="fv-rotate-icon-wrap"><div class="fv-rotate-icon">↻</div></div><div class="fv-rotate-title">Rotate Your Phone</div><div class="fv-rotate-copy">Grain Operations needs a wider screen. Turn your phone sideways to continue.</div>';
    document.body.appendChild(gate);
  }

  const sync=()=>document.body.classList.toggle('fv-grain-operations-locked',matchMedia('(max-width:700px) and (orientation:portrait)').matches);
  sync();
  addEventListener('orientationchange',sync,{passive:true});
  addEventListener('resize',sync,{passive:true});
  return sync;
}
