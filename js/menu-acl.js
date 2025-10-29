/* /Farm-vista/js/menu-acl.js
   Filters a NAV_MENU object by an allowedIds list (strings).
   Exposes a GLOBAL helper: window.FVMenuACL.filter(NAV_MENU, allowedIds)

   Rule:
     - Keep a link only if its `id` is present in allowedIds.
     - Keep groups only if they contain at least one kept child.
*/

(function(){
  'use strict';

  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

  function filterItems(items, allowSet){
    const out = [];
    (items || []).forEach(item => {
      if (item.type === 'link') {
        const id = String(item.id || '');
        if (id && allowSet.has(id)) out.push(item);
        return;
      }
      if (item.type === 'group') {
        const copy = { ...item, children: [] };
        (item.children || []).forEach(ch => {
          if (ch.type === 'group') {
            const sub = filterItems(ch.children || [], allowSet);
            if (sub.length) copy.children.push({ ...ch, children: sub });
          } else if (ch.type === 'link') {
            const id = String(ch.id || '');
            if (id && allowSet.has(id)) copy.children.push(ch);
          }
        });
        if (copy.children.length) out.push(copy);
      }
    });
    return out;
  }

  function filter(NAV_MENU, allowedIds){
    const cfg = NAV_MENU && Array.isArray(NAV_MENU.items) ? clone(NAV_MENU) : { items: [], options: {} };
    const allowSet = new Set((allowedIds || []).map(String));
    cfg.items = filterItems(cfg.items, allowSet);
    return cfg;
  }

  window.FVMenuACL = { filter };
})();