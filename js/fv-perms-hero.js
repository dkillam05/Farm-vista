// /Farm-vista/js/fv-perms-hero.js
// Shared Permissions Panel (Hero + Matrix) for:
//  • Account Roles
//  • Employee Overrides
//
// Usage (example):
//   import '/Farm-vista/js/fv-perms-hero.js';
//
//   const panel = document.querySelector('fv-perms-hero');
//   panel.config = {
//     mode: 'role', // 'role' or 'employee'
//     name: 'Manager',             // title line
//     baseRoleName: null,          // or 'Manager' when mode==='employee'
//     perms: rolePermsObject,      // { [id]: {view,add,edit,delete} or legacy bool/{on} }
//     navMenu: NAV_MENU_OPTIONAL,  // usually omit; falls back to menu.js
//
//     // Callbacks:
//     onPermsChange: (perms) => { ...save to Firestore... },
//     onDeleteRole: () => { ... },
//     onResetOverrides: () => { ... } // for employee mode only
//   };
//
// Notes:
//  • This helper is 100% self-contained: it renders the hero + the permissions matrix.
//  • It reads NAV_MENU so it stays in sync when you add/move items.
//  • New menu items default to all false (view/add/edit/delete = false).
//  • Legacy perms (bool / {on:true}) are treated as: {view:true, add:false, edit:false, delete:false}.
//

import NAV_MENU from '/Farm-vista/js/menu.js';

const CAPABILITIES = [
  { id: 'cap-chatbot', label: 'AI Chatbot' },
  { id: 'cap-kpi-equipment', label: 'Equipment KPI Cards' },
  { id: 'cap-kpi-grain', label: 'Grain KPI Cards' },
  { id: 'cap-kpi-field-maint', label: 'Field Maintenance KPI Cards' },
];

// Normalize a permission entry for summary counts.
// For menus we treat "view" as "enabled".
function normalizePerm(perms, key) {
  if (!perms) return false;
  const v = perms[key];
  if (!v) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v.view === 'boolean') return !!v.view;
  if (typeof v.on === 'boolean') return !!v.on;
  return false; // default OFF
}

function buildNavIndex(menu) {
  const byParent = {};
  const allNodes = [];

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
      allNodes.push(node);

      if (Array.isArray(it.children) && it.children.length) {
        walk(it.children, depth + 1, it.id);
      }
    });
  }

  walk(menu?.items || []);
  return { byParent, allNodes };
}

class FVPermsHero extends HTMLElement {
  constructor() {
    super();
    this._config = {
      mode: 'role',         // 'role' | 'employee'
      name: '',
      baseRoleName: null,
      perms: {},
      navMenu: null,
      onPermsChange: null,
      onDeleteRole: null,
      onResetOverrides: null
    };
    this._root = this; // no shadow; share theme CSS
  }

  set config(cfg) {
    // Shallow clone config and perms so we keep an internal object we can edit
    this._config = Object.assign({}, this._config, cfg || {});
    this._config.perms = Object.assign({}, this._config.perms || {});
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
    const menu = cfg.navMenu || NAV_MENU || { items: [] };
    const perms = cfg.perms || {};

    const { allNodes } = buildNavIndex(menu);

    const totalNav = allNodes.length;
    let enabledNav = 0;
    allNodes.forEach(n => {
      if (normalizePerm(perms, n.id)) enabledNav++;
    });

    const totalCaps = CAPABILITIES.length;
    let enabledCaps = 0;
    let chatbotEnabled = false;
    const enabledCapLabels = [];

    CAPABILITIES.forEach(cap => {
      const on = normalizePerm(perms, cap.id);
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

  /* ---------- Matrix helpers ---------- */

  _ensure4PermShape(perms, id) {
    // Accept legacy shapes and normalize to {view,add,edit,delete}
    const v = perms[id];
    if (!v) {
      return { view: false, add: false, edit: false, delete: false };
    }
    if (typeof v === 'boolean') {
      return { view: v, add: false, edit: false, delete: false };
    }
    if (typeof v.on === 'boolean' && !('view' in v)) {
      return { view: !!v.on, add: false, edit: false, delete: false };
    }
    return {
      view: !!v.view,
      add: !!v.add,
      edit: !!v.edit,
      delete: !!v.delete
    };
  }

  _buildMatrixRowsHtml() {
    const cfg = this._config;
    const menu = cfg.navMenu || NAV_MENU || { items: [] };
    const perms = cfg.perms || {};
    const { allNodes } = buildNavIndex(menu);

    if (!allNodes.length) {
      return `
        <div class="perm-matrix-empty">
          No navigation menus configured. Once menus are added to NAV_MENU, they will appear here.
        </div>
      `;
    }

    // Simple sort: by depth, then label
    const sorted = allNodes.slice().sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (a.label || '').localeCompare(b.label || '');
    });

    let rowsHtml = '';
    sorted.forEach(node => {
      const id = node.id;
      const label = node.label;
      const depth = node.depth || 0;
      const p = this._ensure4PermShape(perms, id);

      const makePill = (action, isOn, text) => {
        const activeClass = isOn ? 'perm-pill-on' : 'perm-pill-off';
        return `
          <button type="button"
                  class="perm-pill ${activeClass}"
                  data-perm-id="${id}"
                  data-perm-action="${action}">
            ${text}
          </button>
        `;
      };

      rowsHtml += `
        <div class="perm-row" data-perm-row="${id}">
          <div class="perm-row-label" data-depth="${depth}">
            ${label}
          </div>
          <div class="perm-row-pills">
            ${makePill('view',   p.view,   'View')}
            ${makePill('add',    p.add,    'Add')}
            ${makePill('edit',   p.edit,   'Edit')}
            ${makePill('delete', p.delete, 'Delete')}
          </div>
        </div>
      `;
    });

    return rowsHtml;
  }

  _togglePerm(id, action) {
    const cfg = this._config;
    if (!cfg.perms) cfg.perms = {};
    const current = this._ensure4PermShape(cfg.perms, id);
    const newValue = !current[action];
    current[action] = newValue;
    cfg.perms[id] = current;

    if (typeof cfg.onPermsChange === 'function') {
      // Pass a shallow clone so callers don't accidentally mutate internals
      cfg.onPermsChange(Object.assign({}, cfg.perms));
    }

    // Re-render to reflect the new state
    this.render();
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
        .perm-btn-primary {
          background: #2F6C3C;
          border-color: #2F6C3C;
          color: #fff;
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

        /* ----- Matrix layout ----- */
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
        .perm-matrix {
          margin-top: 6px;
          border-radius: 10px;
          border: 1px solid rgba(0,0,0,0.06);
          overflow: hidden;
        }
        .perm-matrix-head,
        .perm-row {
          display: grid;
          grid-template-columns: minmax(0, 1.8fr) minmax(0, 2.2fr);
          align-items: stretch;
        }
        @media (max-width: 720px){
          .perm-matrix-head,
          .perm-row {
            grid-template-columns: 1.3fr 2.7fr;
          }
        }
        .perm-matrix-head {
          background: rgba(0,0,0,0.03);
          border-bottom: 1px solid rgba(0,0,0,0.06);
        }
        .perm-col-label {
          padding: 6px 8px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 700;
          color: var(--muted, #67706B);
        }
        .perm-col-label-main {
          border-right: 1px solid rgba(0,0,0,0.06);
        }
        .perm-col-label-actions {
          display: flex;
          justify-content: flex-start;
          gap: 4px;
          padding-right: 8px;
        }
        .perm-col-label-actions span {
          flex: 1;
          text-align: center;
        }
        .perm-row {
          border-bottom: 1px solid rgba(0,0,0,0.04);
          background: #fff;
        }
        .perm-row:last-child {
          border-bottom: none;
        }
        .perm-row-label {
          padding: 6px 8px;
          font-size: 13px;
          border-right: 1px solid rgba(0,0,0,0.06);
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .perm-row-label[data-depth="1"] {
          padding-left: 16px;
        }
        .perm-row-label[data-depth="2"] {
          padding-left: 24px;
        }
        .perm-row-label[data-depth="3"] {
          padding-left: 32px;
        }
        .perm-row-pills {
          padding: 4px 6px;
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
        .perm-matrix-empty {
          padding: 10px 8px;
          font-size: 12px;
          color: var(--muted, #67706B);
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

    const deleteBtn = cfg.onDeleteRole
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

    const matrixRows = this._buildMatrixRowsHtml();

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
              Toggle what this role/employee can <strong>View, Add, Edit, Delete</strong> for each menu.
            </div>
          </div>
          <div class="perm-matrix">
            <div class="perm-matrix-head">
              <div class="perm-col-label perm-col-label-main">Menu</div>
              <div class="perm-col-label">
                <div class="perm-col-label-actions">
                  <span>View</span>
                  <span>Add</span>
                  <span>Edit</span>
                  <span>Delete</span>
                </div>
              </div>
            </div>
            ${matrixRows}
          </div>
        </div>
      </div>
    `;

    this._root.innerHTML = html;

    // Wire up actions
    const del = this._root.querySelector('[data-role="delete-role"]');
    if (del && typeof this._config.onDeleteRole === 'function') {
      del.addEventListener('click', () => {
        this._config.onDeleteRole();
      });
    }
    const reset = this._root.querySelector('[data-role="reset-overrides"]');
    if (reset && typeof this._config.onResetOverrides === 'function') {
      reset.addEventListener('click', () => {
        this._config.onResetOverrides();
      });
    }

    const pills = this._root.querySelectorAll('.perm-pill');
    pills.forEach(btn => {
      const id = btn.getAttribute('data-perm-id');
      const action = btn.getAttribute('data-perm-action');
      if (!id || !action) return;
      btn.addEventListener('click', () => this._togglePerm(id, action));
    });
  }
}

if (!customElements.get('fv-perms-hero')) {
  customElements.define('fv-perms-hero', FVPermsHero);
}
