// /Farm-vista/js/theme-boot.js
(function(){
  try{
    var t = localStorage.getItem('fv-theme');        // 'light' | 'dark' | 'system'
    if(!t) return;                                   // no preference → keep light defaults
    document.documentElement.setAttribute('data-theme', t === 'system' ? 'auto' : t);
    document.documentElement.classList.toggle('dark',
      t === 'dark' ||
      (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  }catch(e){}
})();