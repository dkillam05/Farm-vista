/* /Farm-vista/js/menu-acl.js
   FVMenuACL.filter(NAV_MENU, allowedIds) → filtered menu object
   - Keeps "Home" regardless of allowedIds.
*/
(function(){
  function clone(obj){ return JSON.parse(JSON.stringify(obj||{})); }

  function collectAllLinks(nodes, found){
    (nodes||[]).forEach(n=>{
      if (n.type==='group') collectAllLinks(n.children, found);
      else if (n.type==='link' && n.id) found.push(n);
    });
  }

  function findHomeId(menu){
    const links=[]; collectAllLinks(menu.items, links);
    let homeId=null;
    for(const l of links){
      const href = l.href ? new URL(l.href, location.origin).pathname : '';
      if (l.id==='home' || /home/i.test(l.id) ||
          /\/Farm-vista\/index\.html$/.test(href) ||
          /\/Farm-vista\/dashboard\/?$/.test(href) ||
          /\/Farm-vista\/dashboard\/index\.html$/.test(href)) {
        homeId = l.id; break;
      }
    }
    return homeId;
  }

  function filterGroup(group, allowSet){
    const kids = [];
    (group.children||[]).forEach(ch=>{
      if (ch.type==='group'){
        const g = filterGroup(ch, allowSet);
        if (g) kids.push(g);
      } else if (ch.type==='link'){
        if (allowSet.has(ch.id)) kids.push(ch);
      }
    });
    if (!group.collapsible) {
      // non-collapsible groups are headers that also act as links; keep if its own link is allowed OR it has children
      const asLinkAllowed = group.id && allowSet.has(group.id);
      if (kids.length || asLinkAllowed) {
        const copy = {...group, children:kids};
        return copy;
      }
      return null;
    }
    return kids.length ? {...group, children:kids} : null;
  }

  function filter(menu, allowedIds){
    const m = clone(menu);
    const homeId = findHomeId(m);
    const allowSet = new Set(allowedIds||[]);
    if (homeId) allowSet.add(homeId);        // always allow Home

    const out = [];
    (m.items||[]).forEach(item=>{
      if (item.type==='link'){
        if (allowSet.has(item.id)) out.push(item);
      } else if (item.type==='group'){
        const g = filterGroup(item, allowSet);
        if (g) out.push(g);
      }
    });

    return {...m, items: out};
  }

  window.FVMenuACL = { filter };
})();