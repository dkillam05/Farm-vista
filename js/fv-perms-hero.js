// /Farm-vista/js/fv-perms-hero.js
// Shared Permissions Panel (Hero + Nested Matrix) for:
//  • Account Roles
//  • Employee Overrides
//
// Usage (example):
//   import '/Farm-vista/js/fv-perms-hero.js';
//
//   const panel = document.querySelector('fv-perms-hero');
//   panel.config = {
//     mode: 'role',             // 'role' or 'employee'
//     name: 'Manager',          // title line
//     baseRoleName: null,       // or 'Manager' when mode==='employee'
//     perms: rolePermsObject,   // { [id]: {view,add,edit,delete} or legacy bool/{on} }
//     // Optional:
//     onPermsChange: (perms) => { ...save to Firestore... },
//     onDeleteRole: () => { ... },
//     onResetOverrides: () => { ... } // for employee mode only
//   };
//
// This helper is 100% self-contained: hero + nested, collapsible menu permissions.
//  • Reads NAV_MENU so sub-menus are properly nested under main menus.
//  • Each main menu (group) is collapsible (default: collapsed).
//  • Each group has an "All" pill to toggle all 4 actions on/off for itself + all children.
//  • Toggling a group's View/Add/Edit/Delete pill cascades to all children.
//  • Leaf menu items now have their own expand/collapse so their pills stay hidden until needed.
//  • Extra Features are in their own collapsible group with simple On/Off pills.
//
// Indicators:
//  • GROUP HEADER shows how many sub-items are enabled beneath it (even while collapsed).
//  • LEAF rows show a simple green dot when ANY action is enabled on that row (View/Add/Edit/Delete).
//  • LEAF rows that have children also show a small count badge if deeper descendants are enabled.
//
// Admin protection:
//  • Role named "Administrator" cannot be deleted (delete button hidden/disabled).

import NAV_MENU from '/Farm-vista/js/menu.js';

const CAPABILITIES = [
  { id: 'cap-chatbot', label: 'AI Chatbot' },
  { id: 'cap-kpi-equipment', label: 'Equipment KPI Cards' },
  { id: 'cap-kpi-grain', label: 'Grain KPI Cards' },
  { id: 'cap-kpi-field-maint', label: 'Field Maintenance KPI Cards' },
];

// For summary: treat "view" as enabled.
function normalizePermForSummary(perms, key) {
  if (!perms) return false;
  const v = perms[key];
  if (!v) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v.view === 'boolean') return !!v.view;
  if (typeof v.on === 'boolean') return !!v.on;
  return false;
}

// Normalize any perm entry into 4-flag shape.
function normalizeEntry(v) {
  if (typeof v === 'boolean') {
    return { view: v, add: false, edit: false, delete: false };
  }
  if (v && typeof v.on === 'boolean' && !('view' in v)) {
    return { view: !!v.on, add: false, edit: false, delete: false };
  }
  return {
    view: !!(v && v.view),
    add: !!(v && v.add),
    edit: !!(v && v.edit),
    delete: !!(v && v.delete)
  };
}

function buildNavIndex(menu) {
  const byParent = {};
  const byId = {};

  function walk(items, depth = 0, parent = '__ROOT__') {
    (items || []).forEach(it => {
      if (!it || !it.id) return;
      if (it.id === 'home') return; // skip home

      const node = {
        id: it.id,
        type: it.type || 'item',
        label: it.label || it.id,
        depth,
        parent
      };

      (byParent[parent] || (byParent[parent] = [])).push(node);
      byId[it.id] = node;

      if (Array.isArray(it.children) && it.children.length) {
        walk(it.children, depth + 1, it.id);
      }
    });
  }

  walk(menu?.items || []);
  return { byParent, byId };
}

class FVPermsHero extends HTMLElement {
  constructor() {
    super();
    this._config = {
      mode: 'role',
      name: '',
      baseRoleName: null,
      perms: {},
      onPermsChange: null,
      onDeleteRole: null,
      onResetOverrides: null
    };
    this._root = this; // no shadow; share theme CSS
    this._hasRendered = false;

    // Which groups (Equipment, Grain, etc.) are expanded
    this._openGroups = new Set();
    // Which leaf rows (sub menus like eq-tractors, eq-trucks) are expanded
    this._openRows = new Set();
    this._navIndex = { byParent: {}, byId: {} };
  }

  set config(cfg) {
    const merged = Object.assign({}, this._config, cfg || {});
    const srcPerms = merged.perms || {};
    const normalizedPerms = {};
    Object.keys(srcPerms).forEach(k => {
      if (k === 'home') return;
      normalizedPerms[k] = normalizeEntry(srcPerms[k]);
    });
    merged.perms = normalizedPerms;
    this._config = merged;
    this.render();
  }

  get config() {
    return this._config;
  }

  connectedCallback() {
    if (!this._hasRendered) {
      this.render();
    }
  }

  /* ---------- Summary helpers ---------- */

  _computeSummary() {
    const cfg = this._config;
    const menu = NAV_MENU || { items: [] };
    const perms = cfg.perms || {};

    const { byParent, byId } = buildNavIndex(menu);
    this._navIndex = { byParent, byId };

    const allNodes = Object.values(byId);

    const totalNav = allNodes.length;
    let enabledNav = 0;
    allNodes.forEach(n => {
      if (normalizePermForSummary(perms, n.id)) enabledNav++;
    });

    const totalCaps = CAPABILITIES.length;
    let enabledCaps = 0;
    let chatbotEnabled = false;
    const enabledCapLabels = [];

    CAPABILITIES.forEach(cap => {
      const on = normalizePermForSummary(perms, cap.id);
      if (on) {
        enabledCaps++;
        enabledCapLabels.push(cap.label);
        if (cap.id === 'cap-chatbot') chatbotEnabled = true;
      }
    });

    return {
      totalNav,
      enabledNav,
      totalCaps,
      enabledCaps,
      chatbotEnabled,
      enabledCapLabels
    };
  }

  /* ---------- Internal perm helpers ---------- */

  _getPerm(id) {
    const perms = this._config.perms || {};
    perms[id] = normalizeEntry(perms[id]);
    this._config.perms = perms;
    return perms[id];
  }

  _setPerm(id, entry) {
    const perms = this._config.perms || {};
    perms[id] = normalizeEntry(entry);
    this._config.perms = perms;
  }

  _emitPermsChange() {
    if (typeof this._config.onPermsChange === 'function') {
      const clone = Object.assign({}, this._config.perms || {});
      this._config.onPermsChange(clone);
    }
  }

  _walkGroupAndDescendants(groupId, fn) {
    const { byParent } = this._navIndex || {};
    if (!byParent) return;
    const stack = [groupId];
    while (stack.length) {
      const id = stack.pop();
      fn(id);
      const children = byParent[id] || [];
      children.forEach(child => {
        stack.push(child.id);
      });
    }
  }

  _isGroupFullyAllOn(groupId) {
    let allOn = true;
    this._walkGroupAndDescendants(groupId, (id) => {
      const p = this._getPerm(id);
      if (!(p.view && p.add && p.edit && p.delete)) {
        allOn = false;
      }
    });
    return allOn;
  }

  _toggleGroupAll(groupId) {
    const currentlyAll = this._isGroupFullyAllOn(groupId);
    const next = !currentlyAll;

    this._walkGroupAndDescendants(groupId, (id) => {
      const p = this._getPerm(id);
      p.view = next;
      p.add = next;
      p.edit = next;
      p.delete = next;
      this._setPerm(id, p);
    });

    this._emitPermsChange();
    this.render();
  }

  _isGroupActionAllOn(groupId, action) {
    let allOn = true;
    this._walkGroupAndDescendants(groupId, (id) => {
      const p = this._getPerm(id);
      if (!p[action]) allOn = false;
    });
    return allOn;
  }

  _toggleGroupAction(groupId, action) {
    const allOn = this._isGroupActionAllOn(groupId, action);
    const next = !allOn;
    this._walkGroupAndDescendants(groupId, (id) => {
      const p = this._getPerm(id);
      p[action] = next;
      this._setPerm(id, p);
    });
    this._emitPermsChange();
    this.render();
  }

  _toggleLeafAction(id, action) {
    const p = this._getPerm(id);
    p[action] = !p[action];
    this._setPerm(id, p);
    this._emitPermsChange();
    this.render();
  }

  _toggleCapability(id) {
    const p = this._getPerm(id);
    p.view = !p.view; // simple On/Off via view flag
    this._setPerm(id, p);
    this._emitPermsChange();
    this.render();
  }

  _toggleGroupOpen(groupId) {
    if (this._openGroups.has(groupId)) {
      this._openGroups.delete(groupId);
    } else {
      this._openGroups.add(groupId);
    }
    this.render();
  }

  _toggleRowOpen(rowId) {
    if (this._openRows.has(rowId)) {
      this._openRows.delete(rowId);
    } else {
      this._openRows.add(rowId);
    }
    this.render();
  }

  /* ---------- Indicator helpers ---------- */

  _isAnyActionOn(id) {
    const p = this._getPerm(id);
    return !!(p.view || p.add || p.edit || p.delete);
  }

  // Returns counts for descendants ONLY (excludes the id itself)
  _descendantActionStats(id) {
    const { byParent } = this._navIndex || {};
    if (!byParent) return { total: 0, enabled: 0 };

    let total = 0;
    let enabled = 0;

    const stack = [...(byParent[id] || []).map(n => n.id)];
    while (stack.length) {
      const cur = stack.pop();
      total++;
      if (this._isAnyActionOn(cur)) enabled++;
      const kids = byParent[cur] || [];
      kids.forEach(k => stack.push(k.id));
    }

    return { total, enabled };
  }

  _hasChildren(id) {
    const { byParent } = this._navIndex || {};
    const kids = (byParent && byParent[id]) ? byParent[id] : [];
    return Array.isArray(kids) && kids.length > 0;
  }

  /* ---------- Nested matrix helpers ---------- */

  _buildMenuTreeHtml() {
    const menu = NAV_MENU || { items: [] };
    const { byParent, byId } = buildNavIndex(menu);
    this._navIndex = { byParent, byId };

    const roots = byParent['__ROOT__'] || [];
    if (!roots.length && !CAPABILITIES.length) {
      return `
        <div class="perm-matrix-empty">
          No navigation menus configured. Once menus are added to NAV_MENU, they will appear here.
        </div>
      `;
    }

    const renderGroupBlock = (node) => {
      const isOpen = this._openGroups.has(node.id);
      const openClass = isOpen ? 'perm-group-open' : 'perm-group-closed';

      const groupRow = this._buildRowHtml(node, true);

      const children = byParent[node.id] || [];
      let childrenHtml = '';
      children.forEach(child => {
        if (child.type === 'group') {
          childrenHtml += renderGroupBlock(child);
        } else {
          childrenHtml += this._buildRowHtml(child, false);
        }
      });

      const hasChildren = children.length > 0;
      const allOn = this._isGroupFullyAllOn(node.id);

      // Group header indicator (descendants enabled)
      const ds = this._descendantActionStats(node.id);
      const showSubBadge = ds.total > 0 && ds.enabled > 0;
      const subBadge = showSubBadge
        ? `
          <span class="perm-sub-indicator" title="${ds.enabled} sub-items enabled">
            <span class="perm-sub-dot" aria-hidden="true"></span>
            <span class="perm-sub-count">${ds.enabled}</span>
          </span>
        `
        : '';

      return `
        <div class="perm-group ${openClass}" data-group-id="${node.id}">
          <div class="perm-group-header" data-group-toggle="${node.id}">
            <button type="button" class="perm-group-chevron" aria-label="Toggle ${node.label}">
              <span class="chevron">${isOpen ? '▾' : '▸'}</span>
            </button>
            <div class="perm-group-title">
              ${node.label}
              ${subBadge}
            </div>
            <div class="perm-group-header-actions">
              <button type="button"
                      class="perm-pill perm-pill-all ${allOn ? 'perm-pill-on' : 'perm-pill-off'}"
                      data-group-all="${node.id}">
                All
              </button>
            </div>
          </div>
          <div class="perm-group-body">
            ${groupRow}
            ${hasChildren ? `<div class="perm-group-children">${childrenHtml}</div>` : ''}
          </div>
        </div>
      `;
    };

    let html = '';

    roots.forEach(node => {
      if (node.type === 'group') {
        html += renderGroupBlock(node);
      } else {
        html += this._buildRowHtml(node, false);
      }
    });

    // Extra capabilities as their own collapsible group with simple On/Off
    if (CAPABILITIES.length) {
      const capsGroupId = '__CAPS__';
      const isOpen = this._openGroups.has(capsGroupId);
      const openClass = isOpen ? 'perm-group-open' : 'perm-group-closed';

      let capsRows = '';
      CAPABILITIES.forEach(cap => {
        capsRows += this._buildCapabilityRowHtml(cap);
      });

      html += `
        <div class="perm-group ${openClass}" data-group-id="${capsGroupId}">
          <div class="perm-group-header" data-group-toggle="${capsGroupId}">
            <button type="button" class="perm-group-chevron" aria-label="Toggle Extra Features">
              <span class="chevron">${isOpen ? '▾' : '▸'}</span>
            </button>
            <div class="perm-group-title">Extra Features</div>
          </div>
          <div class="perm-group-body">
            <div class="perm-group-children">
              ${capsRows}
            </div>
          </div>
        </div>
      `;
    }

    return html;
  }

  _buildRowHtml(node, isGroupRow) {
    const id = node.id;
    const depth = node.depth || 0;
    const p = this._getPerm(id);

    const rowType = isGroupRow ? 'group' : 'leaf';

    // Groups: always show pills.
    // Leaves: collapsed by default; open only if _openRows has id.
    const isLeaf = !isGroupRow;
    const isOpenRow = !isLeaf || this._openRows.has(id);
    const rowStateClass = isOpenRow ? 'perm-row-open' : 'perm-row-closed';

    // mark group row inside body so we can style it (darker + underline, NOT larger)
    const groupRowClass = isGroupRow ? 'perm-row-groupbase' : '';

    const indentClass = `perm-row-label-depth-${Math.min(depth, 3)}`;

    // Leaf: simple green dot if ANY action enabled on that leaf (Weather, etc.)
    const leafOnDot = (!isGroupRow && this._isAnyActionOn(id))
      ? `<span class="perm-on-dot" aria-hidden="true"></span>`
      : '';

    // Leaf indicator (only if this leaf has children and something beneath it is enabled)
    let deepBadge = '';
    if (!isGroupRow && this._hasChildren(id)) {
      const ds = this._descendantActionStats(id);
      if (ds.total > 0 && ds.enabled > 0) {
        deepBadge = `
          <span class="perm-sub-indicator perm-sub-indicator-sm" title="${ds.enabled} deeper sub-items enabled">
            <span class="perm-sub-dot" aria-hidden="true"></span>
            <span class="perm-sub-count">${ds.enabled}</span>
          </span>
        `;
      }
    }

    let labelInner;
    if (isGroupRow) {
      labelInner = `<span class="perm-row-label-text">${node.label}</span>`;
    } else {
      labelInner = `
        <button type="button"
                class="perm-row-toggle"
                data-row-toggle="${id}">
          <span class="row-chevron">${isOpenRow ? '▾' : '▸'}</span>
          <span class="perm-row-label-text">${node.label}</span>
          ${leafOnDot}
          ${deepBadge}
        </button>
      `;
    }

    const makePill = (action, isOn, text) => {
      const activeClass = isOn ? 'perm-pill-on' : 'perm-pill-off';
      return `
        <button type="button"
                class="perm-pill ${activeClass}"
                data-perm-id="${id}"
                data-perm-type="${rowType}"
                data-perm-action="${action}">
          ${text}
        </button>
      `;
    };

    return `
      <div class="perm-row ${rowStateClass} ${groupRowClass}" data-perm-row="${id}">
        <div class="perm-row-label ${indentClass}">
          ${labelInner}
        </div>
        <div class="perm-row-pills">
          ${makePill('view',   p.view,   'View')}
          ${makePill('add',    p.add,    'Add')}
          ${makePill('edit',   p.edit,   'Edit')}
          ${makePill('delete', p.delete, 'Delete')}
        </div>
      </div>
    `;
  }

  _buildCapabilityRowHtml(cap) {
    const id = cap.id;
    const label = cap.label;
    const p = this._getPerm(id);
    const isOn = !!p.view;
    const activeClass = isOn ? 'perm-pill-on' : 'perm-pill-off';
    const text = isOn ? 'On' : 'Off';

    return `
      <div class="perm-row" data-cap-row="${id}">
        <div class="perm-row-label perm-row-label-depth-0">
          <span class="perm-row-label-text">${label}</span>
        </div>
        <div class="perm-row-pills">
          <button type="button"
                  class="perm-pill ${activeClass}"
                  data-cap-id="${id}">
            ${text}
          </button>
        </div>
      </div>
    `;
  }

  /* ---------- Styles ---------- */

  _renderStyles() {
    return `
      <style>
        .perm-hero-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0 0 12px 0;
        }
        .perm-hero {
          border-radius: 16px;
          border: 1px solid var(--border, #d0d4d0);
          background: linear-gradient(135deg, rgba(59,126,70,0.12), rgba(203,205,203,0.32));
          padding: 12px 14px;
          display: grid;
          grid-template-columns: minmax(0,1.4fr) minmax(0,1.2fr);
          gap: 10px;
          align-items: center;
        }
        @media (max-width: 900px){
          .perm-hero {
            grid-template-columns: 1fr;
            align-items: flex-start;
          }
        }
        .perm-main {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .perm-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .perm-icon {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: #2F6C3C;
          color: #fff;
          font-size: 16px;
        }
        .perm-title-text {
          font-weight: 800;
          font-size: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .perm-subtitle {
          font-size: 13px;
          color: var(--muted, #67706B);
        }
        .perm-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
        }
        .perm-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 700;
          background: rgba(255,255,255,0.9);
          color: var(--text, #243024);
          border: 1px solid rgba(0,0,0,0.06);
        }
        .perm-badge-strong {
          background: #2F6C3C;
          color: #fff;
          border-color: #2F6C3C;
        }
        .perm-badge-warn {
          background: #b3261e;
          color: #fff;
          border-color: #b3261e;
        }
        .perm-right {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .perm-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid var(--border, #d0d4d0);
          background: var(--surface, #f7f7f7);
          padding: 6px 10px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          min-height: 32px;
          gap: 6px;
        }
        .perm-btn-quiet {
          background: rgba(255,255,255,0.9);
        }
        .perm-btn-danger-icon {
          border-color: #b3261e;
          color: #b3261e;
          background: rgba(255,255,255,0.96);
          padding: 5px 8px;
          min-width: auto;
        }
        .perm-btn-danger-icon svg {
          width: 18px;
          height: 18px;
          display: block;
        }

        /* ----- Matrix layout (nested) ----- */
        .perm-matrix-card {
          border-radius: 14px;
          border: 1px solid var(--border, #d0d4d0);
          background: var(--surface, #fdfdfd);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .perm-matrix-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .perm-matrix-title {
          font-weight: 800;
          font-size: 14px;
        }
        .perm-matrix-sub {
          font-size: 12px;
          color: var(--muted, #67706B);
        }
        .perm-matrix-body {
          margin-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .perm-matrix-empty {
          padding: 10px 8px;
          font-size: 12px;
          color: var(--muted, #67706B);
        }

        .perm-group {
          border-radius: 10px;
          border: 1px solid rgba(0,0,0,0.06);
          background: #fff;
          overflow: hidden;
        }
        .perm-group-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          background: rgba(0,0,0,0.02);
        }
        .perm-group-chevron {
          border-radius: 999px;
          border: 1px solid rgba(0,0,0,0.12);
          background: #fff;
          width: 26px;
          height: 26px;
          display: grid;
          place-items: center;
          padding: 0;
          cursor: pointer;
          font-size: 12px;
        }
        .perm-group-title {
          font-weight: 800;
          font-size: 13px;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        /* Subtle “has enabled sub-items” indicator (group header + deep badge) */
        .perm-sub-indicator{
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          padding: 2px 7px;
          border: 1px solid rgba(0,0,0,0.10);
          background: rgba(255,255,255,0.92);
          color: var(--muted, #67706B);
          font-weight: 800;
          font-size: 11px;
          line-height: 1;
          flex: 0 0 auto;
        }
        .perm-sub-indicator-sm{
          padding: 2px 6px;
          font-size: 10.5px;
          opacity: 0.95;
        }
        .perm-sub-dot{
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #2F6C3C;
          opacity: 0.85;
          display: inline-block;
        }
        .perm-sub-count{
          letter-spacing: 0.2px;
        }

        /* NEW: simple “something on here” dot for leaf rows (Weather etc.) */
        .perm-on-dot{
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #2F6C3C;
          opacity: 0.9;
          display: inline-block;
          flex: 0 0 auto;
          margin-left: 6px;
        }

        .perm-group-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .perm-group-body {
          padding: 4px 6px 6px;
        }
        .perm-group-children {
          border-top: 1px solid rgba(0,0,0,0.04);
          margin-top: 4px;
          padding-top: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .perm-row {
          display: grid;
          grid-template-columns: minmax(0, 1.5fr) minmax(0, 2.3fr);
          align-items: center;
          padding: 3px 4px;
        }
        @media (max-width: 720px){
          .perm-row {
            grid-template-columns: 1.3fr 2.7fr;
          }
        }
        .perm-row-label {
          font-size: 13px; /* keep same size */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          align-items: center;
        }
        .perm-row-label-depth-0 { padding-left: 0; }
        .perm-row-label-depth-1 { padding-left: 10px; }
        .perm-row-label-depth-2 { padding-left: 20px; }
        .perm-row-label-depth-3 { padding-left: 30px; }

        /* Group row inside body: NOT larger, just darker + underlined */
        .perm-row-groupbase .perm-row-label-text{
          font-weight: 900;
          color: var(--text, #243024);
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-thickness: 1px;
        }

        .perm-row-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
          background: transparent;
          padding: 0;
          margin: 0;
          font: inherit;
          color: inherit;
          cursor: pointer;
          min-width: 0;
        }
        .row-chevron {
          font-size: 11px;
          opacity: 0.8;
          flex: 0 0 auto;
        }
        .perm-row-label-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .perm-row-pills {
          display: flex;
          justify-content: flex-start;
          gap: 4px;
          flex-wrap: wrap;
          align-items: center;
        }
        .perm-pill {
          border-radius: 999px;
          border: 1px solid rgba(0,0,0,0.14);
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          min-width: 48px;
          text-align: center;
          background: #fafafa;
        }
        .perm-pill-on {
          background: #2F6C3C;
          color: #fff;
          border-color: #2F6C3C;
        }
        .perm-pill-off {
          background: rgba(255,255,255,0.95);
          color: var(--muted, #67706B);
        }
        .perm-pill-all {
          min-width: 52px;
        }

        .perm-row-closed .perm-row-pills {
          display: none;
        }

        .perm-group-closed .perm-group-body {
          display: none;
        }
        .perm-group-open .perm-group-body {
          display: block;
        }
      </style>
    `;
  }

  /* ---------- Render ---------- */

  render() {
    this._hasRendered = true;
    const cfg = this._config;
    const {
      totalNav,
      enabledNav,
      totalCaps,
      enabledCaps,
      chatbotEnabled,
      enabledCapLabels
    } = this._computeSummary();

    const mode = cfg.mode === 'employee' ? 'employee' : 'role';
    const nameLabel = cfg.name || (mode === 'employee' ? 'Employee' : 'Role');

    // Protect built-in Administrator role from deletion
    const isProtectedRole = (
      mode === 'role' &&
      (cfg.name || '').toString().trim().toLowerCase() === 'administrator'
    );

    const baseRoleLine = (mode === 'employee' && cfg.baseRoleName)
      ? `<div class="perm-subtitle">Base role: <strong>${cfg.baseRoleName}</strong></div>`
      : '';

    const navBadgeText = totalNav > 0
      ? `${enabledNav}/${totalNav} menus enabled`
      : 'No menus configured';

    let capBadge = '';
    if (totalCaps > 0) {
      capBadge = `
        <span class="perm-badge">
          <span>Features: ${enabledCaps}/${totalCaps}</span>
        </span>
      `;
    }

    let chatbotBadge = '';
    if (chatbotEnabled) {
      chatbotBadge = `
        <span class="perm-badge perm-badge-strong">
          <span>AI Chatbot</span>
        </span>
      `;
    } else {
      chatbotBadge = `
        <span class="perm-badge perm-badge-warn">
          <span>AI Chatbot: Off</span>
        </span>
      `;
    }

    let extraCapsBadge = '';
    if (enabledCapLabels.length > 0) {
      const others = enabledCapLabels.filter(l => l !== 'AI Chatbot');
      if (others.length > 0) {
        extraCapsBadge = `
          <span class="perm-badge">
            <span>KPI / Extra: ${others.length}</span>
          </span>
        `;
      }
    }

    const subtitle = (mode === 'employee')
      ? 'Employee-specific overrides on top of a base role.'
      : 'Base permissions for a group of employees. New menus and features start locked until enabled here.';

    const deleteBtn = (!isProtectedRole && cfg.onDeleteRole)
      ? `
        <button type="button" class="perm-btn perm-btn-danger-icon" data-role="delete-role" title="Delete role">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M9 3a1 1 0 0 0-.94.66L7.38 5H5a1 1 0 1 0 0 2h1v11a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7h1a1 1 0 1 0 0-2h-2.38l-.68-1.34A1 1 0 0 0 15 3H9zm1 4a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zm4 0a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0V8a1 1 0 0 1 1-1zM9 5h6l.34.68L15.62 6H8.38l.28-.32L9 5z"/>
          </svg>
        </button>
      `
      : '';

    const resetBtn = (mode === 'employee' && cfg.onResetOverrides)
      ? `
        <button type="button" class="perm-btn perm-btn-quiet" data-role="reset-overrides">
          Reset Overrides
        </button>
      `
      : '';

    const matrixHtml = this._buildMenuTreeHtml();

    const html = `
      ${this._renderStyles()}
      <div class="perm-hero-panel">
        <div class="perm-hero">
          <div class="perm-main">
            <div class="perm-title-row">
              <div class="perm-icon" aria-hidden="true">🔒</div>
              <div class="perm-title-text">
                ${mode === 'employee' ? 'Employee Permissions' : 'Role Permissions'} • ${nameLabel}
              </div>
            </div>
            <div class="perm-subtitle">
              ${subtitle}
            </div>
            ${baseRoleLine}
            <div class="perm-badges">
              <span class="perm-badge perm-badge-strong">${navBadgeText}</span>
              ${capBadge}
              ${chatbotBadge}
              ${extraCapsBadge}
            </div>
          </div>
          <div class="perm-right">
            ${resetBtn}
            ${deleteBtn}
          </div>
        </div>

        <div class="perm-matrix-card">
          <div class="perm-matrix-header">
            <div class="perm-matrix-title">
              Menu Permissions
            </div>
            <div class="perm-matrix-sub">
              Expand a menu, then expand a sub-menu if you need to change its actions.
              Group controls and “All” cascade to sub-menus. Extra Features use simple On/Off.
            </div>
          </div>
          <div class="perm-matrix-body">
            ${matrixHtml}
          </div>
        </div>
      </div>
    `;

    this._root.innerHTML = html;

    // Wire up delete/reset
    const del = this._root.querySelector('[data-role="delete-role"]');
    if (!isProtectedRole && del && typeof this._config.onDeleteRole === 'function') {
      del.addEventListener('click', () => this._config.onDeleteRole());
    }
    const reset = this._root.querySelector('[data-role="reset-overrides"]');
    if (reset && typeof this._config.onResetOverrides === 'function') {
      reset.addEventListener('click', () => this._config.onResetOverrides());
    }

    // Wire up group expand/collapse
    this._root.querySelectorAll('[data-group-toggle]').forEach(btn => {
      const id = btn.getAttribute('data-group-toggle');
      if (!id) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleGroupOpen(id);
      });
    });

    // Wire up group "All" pills (menus only)
    this._root.querySelectorAll('[data-group-all]').forEach(btn => {
      const id = btn.getAttribute('data-group-all');
      if (!id) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleGroupAll(id);
      });
    });

    // Wire up per-row pills for menus
    this._root.querySelectorAll('.perm-pill[data-perm-id]').forEach(btn => {
      const id = btn.getAttribute('data-perm-id');
      const action = btn.getAttribute('data-perm-action');
      const type = btn.getAttribute('data-perm-type');
      if (!id || !action || !type) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === 'group') {
          this._toggleGroupAction(id, action);
        } else {
          this._toggleLeafAction(id, action);
        }
      });
    });

    // Wire up capability On/Off pills
    this._root.querySelectorAll('[data-cap-id]').forEach(btn => {
      const id = btn.getAttribute('data-cap-id');
      if (!id) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleCapability(id);
      });
    });

    // Wire up row expand/collapse for leaf rows (sub menus)
    this._root.querySelectorAll('[data-row-toggle]').forEach(btn => {
      const id = btn.getAttribute('data-row-toggle');
      if (!id) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._toggleRowOpen(id);
      });
    });
  }
}

if (!customElements.get('fv-perms-hero')) {
  customElements.define('fv-perms-hero', FVPermsHero);
}
