/**
 * FarmVista Sidebar Enhancer (works on every page that has #sidebar)
 * - Wraps existing sidebar markup in a scrollable container
 * - Builds collapsible groups from raw text + links
 * - Removes trailing "v" from group titles (e.g., "Equipmentv" -> "Equipment")
 * - Persists open/closed state in localStorage
 * - Leaves header/footer and main content untouched
 */

(function(){
  const SIDEBAR_ID = 'sidebar';
  const STORAGE_KEY = 'fv.sidebar.openGroups.v1';

  document.addEventListener('DOMContentLoaded', init, {once:true});

  function init(){
    const sb = document.getElementById(SIDEBAR_ID);
    if(!sb){ return; }

    // Ensure base classes for styling
    sb.classList.add('fv-sidebar');

    // Ensure a single inner scroller
    let scroller = sb.querySelector('.fv-sidebar__scroll');
    if(!scroller){
      scroller = document.createElement('div');
      scroller.className = 'fv-sidebar__scroll';
      while(sb.firstChild){ scroller.appendChild(sb.firstChild); }
      sb.appendChild(scroller);
    }

    // If already enhanced, just attach handlers
    if(scroller.querySelector('.fv-group')){ attachPersistence(scroller); return; }

    // Parse raw nodes into header/link "lines"
    const rawNodes = Array.from(scroller.childNodes);
    const lines = toLines(rawNodes);

    const groups = [];
    let current = null;

    lines.forEach(line=>{
      if(line.isHeader){
        current = { title: cleanupTitle(line.text), items: [] };
        groups.push(current);
      }else if(line.isLink){
        if(!current){
          current = { title: 'Menu', items: [] };
          groups.push(current);
        }
        current.items.push(line.el);
      }
    });

    if(groups.length === 0){ return; }

    const openState = loadOpenState();
    const frag = document.createDocumentFragment();

    groups.forEach((g, idx)=>{
      const groupEl = document.createElement('section');
      groupEl.className = 'fv-group';
      const isOpen = openState.has(g.title) || idx === 0;

      const titleBtn = document.createElement('button');
      titleBtn.className = 'fv-group__title';
      titleBtn.type = 'button';
      titleBtn.setAttribute('aria-expanded', String(isOpen));
      titleBtn.innerHTML = `
        <span>${escapeHtml(g.title)}</span>
        <svg class="fv-group__chev" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7 5l6 5-6 5V5z"></path>
        </svg>
      `;

      const linksWrap = document.createElement('div');
      linksWrap.className = 'fv-links';
      if(!isOpen){ linksWrap.style.display = 'none'; }
      if(isOpen){ groupEl.classList.add('is-open'); }

      g.items.forEach(a=>{
        const link = normalizeLink(a);
        linksWrap.appendChild(link);
      });

      titleBtn.addEventListener('click', ()=>{
        const nowOpen = linksWrap.style.display === 'none';
        linksWrap.style.display = nowOpen ? '' : 'none';
        titleBtn.setAttribute('aria-expanded', String(nowOpen));
        groupEl.classList.toggle('is-open', nowOpen);
        persistOpenState(scroller);
      });

      groupEl.appendChild(titleBtn);
      groupEl.appendChild(linksWrap);
      frag.appendChild(groupEl);
    });

    scroller.innerHTML = '';
    scroller.appendChild(frag);

    // Save state on unload/navigation
    attachPersistence(scroller);
  }

  function attachPersistence(scroller){
    window.addEventListener('beforeunload', ()=>persistOpenState(scroller));
  }

  function persistOpenState(scroller){
    const openTitles = Array
      .from(scroller.querySelectorAll('.fv-group.is-open .fv-group__title span'))
      .map(s=>s.textContent.trim());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(openTitles));
  }

  function loadOpenState(){
    try{ return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); }
    catch{ return new Set(); }
  }

  // Turn messy nodes into lines we can process
  function toLines(nodes){
    const lines = [];
    nodes.forEach(n=>{
      if(n.nodeType === 1){ // element
        const el = n;
        const isLink = el.tagName === 'A' || el.querySelector('a');
        const text = (el.textContent || '').trim();
        const isHeader = isLikelyHeader(el, text);
        if(isHeader){
          lines.push({isHeader:true, text});
        }else if(isLink){
          const a = el.tagName === 'A' ? el : el.querySelector('a');
          if(a) lines.push({isLink:true, el:a});
        }
      }else if(n.nodeType === 3){ // text
        const text = n.textContent.replace(/\s+/g,' ').trim();
        if(text){
          const isHeader = /v$/.test(text) || /^[A-Z][\w &/-]+$/.test(text);
          if(isHeader) lines.push({isHeader:true, text});
        }
      }
    });
    return lines;
  }

  function isLikelyHeader(el, text){
    if(el.matches('h1,h2,h3,h4,strong,[data-nav-header]')) return true;
    if(el.tagName === 'A') return false;
    if(!text) return false;
    return /v$/.test(text) || /^[A-Z][\w &/-]+$/.test(text);
  }

  function cleanupTitle(text){
    return text.replace(/\s*v$/, '').trim();
  }

  function normalizeLink(a){
    const link = document.createElement('a');
    link.className = 'fv-link';
    link.href = a.getAttribute('href') || '#';
    const raw = (a.textContent || '').trim().replace(/^•\s*/,'');
    link.textContent = raw;
    // Preserve target if present
    const t = a.getAttribute('target'); if(t) link.setAttribute('target', t);
    return link;
  }

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }
})();
