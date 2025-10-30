/* /Farm-vista/js/menu-acl.js
   FarmVista — NAV ACL filter (role/override aware)
   - Keeps only links whose `id` is allowed.
   - Keeps groups with at least one allowed descendant.
   - Wildcard allow: '*' or 'ALL'.
   - Always-allowed IDs: ['home']  ← ensures Home is visible for all users.
*/
(function () {
  'use strict';

  /** Always-visible link IDs (do NOT add groups here). */
  const ALWAYS_ALLOWED = new Set(['home']);

  /**
   * @typedef {'link'|'group'} NavItemType
   * @typedef {'starts-with'|'exact'|'regex'} ActiveMatch
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
   */

  function toSet(arr){
    const s = new Set();
    (arr || []).forEach(v => {
      if (v == null) return;
      s.add(String(v));
    });
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
   * Recursively prune the tree to allowed link ids.
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
    const base = allowedIds instanceof Set ? new Set(allowedIds) : toSet(allowedIds);
    // Merge in always-allowed
    ALWAYS_ALLOWED.forEach(id => base.add(id));

    const wildcard = base.has('*') || base.has('ALL');
    if (wildcard) {
      // Pass-through, but still ensure 'home' exists in case caller inspects ids later
      return { items: (NAV_MENU.items || []).slice(), options: NAV_MENU.options || {} };
    }

    const out = [];
    (NAV_MENU.items || []).forEach(item => {
      const pr = prune(item, base);
      if (pr) out.push(pr);
    });

    return { items: out, options: NAV_MENU.options || {} };
  }

  // UMD-style exports
  const API = { filter };
  if (typeof window !== 'undefined') window.FVMenuACL = API;
  try { if (typeof module !== 'undefined' && module.exports) module.exports = API; } catch {}
  try { if (typeof define === 'function' && define.amd) define(function(){ return API; }); } catch {}
  try { if (typeof self !== 'undefined') self.FVMenuACL = API; } catch {}

  try { Object.defineProperty(API, '__esModule', { value: true }); API.default = API; } catch {}
})();