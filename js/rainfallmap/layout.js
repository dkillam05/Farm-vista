export function detectLayoutMode(){
  const ua = navigator.userAgent || '';
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isMobile = /iPhone|Android|Mobile|iPad|iPod/i.test(ua);

  document.body.classList.remove('desktop-view', 'mobile-browser', 'pwa-standalone');

  if (isStandalone){
    document.body.classList.add('pwa-standalone');
  } else if (isMobile){
    document.body.classList.add('mobile-browser');
  } else {
    document.body.classList.add('desktop-view');
  }
}
