/* /Farm-vista/js/menu-acl.js
   FarmVista — NAV ACL filter (role/override aware)

   Inputs:
     - NAV_MENU: { items: NavItem[], options?: {...} }
     - allowedIds: string[]  (from FVUserContext.allowedIds)

   Behavior:
     - Keeps only links whose `id` is in allowedIds.
     - Keeps groups that have at least one allowed descendant.
     - Preserves item order and group properties.
     - Supports wildcard allow: '*' or 'ALL' in allowedIds.
*/

(function () {
  'use strict';

  /**
   * @typedef {'link'|'group'} NavItemType
   * @typedef {'starts-with'|'exact'|'regex'} ActiveMatch
   *
   * @typedef NavItem
   * @property {NavItemType} type
   * @property {string} id
   * @property {string} label
   * @property {string} [icon]
   * @property {string} [href]
   * @property {boolean} [external=false]
   * @property {ActiveMatch} [activeMatch='starts-with']
   * @property {boolean} [collapsible=false]
   * @property {boolean} [initialOpen=false]
   * @property {NavItem[]} [children]
   * @property {string[]} [roles]  // optional, unused here (roles already resolved into allowedIds)
   */

  function toSet(arr){
    const s = new Set();
    (arr||[]).forEach(v => { if (v != null) s.add(String(v)); });
    return s;
  }

  function cloneShallow(item){
    const out = {};
    for (const k in item) {
      if (k === 'children') continue;
      out[k] = item[k];
    }
    return out;
  }

  /**
   * Recursively prunes the tree to allowed link ids.
   * @param {NavItem} node
   * @param {Set<string>} allow
   * @returns {NavItem|null}
   */
  function prune(node, allow){
    if (!node || !node.type || !node.id) return null;

    if (node.type === 'link') {
      return allow.has(node.id) ? { ...node } : null;
    }

    if (node.type === 'group') {
      const kids = [];
      (node.children || []).forEach(ch => {
        const pr = prune(ch, allow);
        if (pr) kids.push(pr);
      });
      if (!kids.length) return null;
      const g = cloneShallow(node);
      g.children = kids;
      return g;
    }

    return null;
  }

  /**
   * Top-level filter.
   * @param {{items:NavItem[], options?:object}} NAV_MENU
   * @param {string[]|Set<string>} allowedIds
   * @returns {{items:NavItem[], options?:object}}
   */
  function filter(NAV_MENU, allowedIds){
    const allow = allowedIds instanceof Set ? allowedIds : toSet(allowedIds);
    const wildcard = allow.has('*') || allow.has('ALL');

    // If wildcard, pass-through.
    if (wildcard) return { items: (NAV_MENU.items || []).slice(), options: NAV_MENU.options || {} };

    const out = [];
    (NAV_MENU.items || []).forEach(item => {
      const pr = prune(item, allow);
      if (pr) out.push(pr);
    });

    // Preserve options (e.g., stateKey for group open state)
    return { items: out, options: NAV_MENU.options || {} };
  }

  // UMD-style exports: global + ESM compatibility
  const API = { filter };
  if (typeof window !== 'undefined') window.FVMenuACL = API;
  if (typeof export !== 'undefined') { /* no-op */ }
  try { if (typeof module !== 'undefined' && module.exports) module.exports = API; } catch {}
  try { if (typeof define === 'function' && define.amd) define(function(){ return API; }); } catch {}
  try { if (typeof self !== 'undefined') self.FVMenuACL = API; } catch {}

  // ESM export (ignored by classic browsers; fine when imported as module)
  try { Object.defineProperty(API, '__esModule', { value: true }); API.default = API; } catch {}
})();