// /Farm-vista/js/fv-perms-hero.js
// Shared Permissions Hero Card for:
//  • Account Roles
//  • Employee Overrides (later)
//
// Usage (example):
//   import '/Farm-vista/js/fv-perms-hero.js';
//
//   const hero = document.querySelector('fv-perms-hero');
//   hero.config = {
//     mode: 'role', // 'role' or 'employee'
//     name: 'Manager',
//     baseRoleName: null,    // or 'Base Role' when mode==='employee'
//     perms: rolePermsObject,
//     onDeleteRole: () => { ... },
//     onResetOverrides: () => { ... } // for employee mode only
//   };
//
// This component:
//  • Reads menu structure (NAV_MENU) so it stays in sync when you add/move items.
//  • Summarizes how many menu entries are enabled.
//  • Supports extra “capabilities” like chatbot & KPI cards.
//  • New menu items / capabilities default to OFF (we treat missing as false).
//

import NAV_MENU from '/Farm-vista/js/menu.js';

const CAPABILITIES = [
  { id: 'cap-chatbot', label: 'AI Chatbot' },
  { id: 'cap-kpi-equipment', label: 'Equipment KPI Cards' },
  { id: 'cap-kpi-grain', label: 'Grain KPI Cards' },
  { id: 'cap-kpi-field-maint', label: 'Field Maintenance KPI Cards' },
];

function normalizePerm(perms, key) {
  if (!perms) return false;
  const v = perms[key];
  if (typeof v === 'boolean') return v;
  if (v && typeof v.on === 'boolean') return !!v.on;
  return false; // default OFF for unknown items
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
      onDeleteRole: null,
      onResetOverrides: null
    };
    this._root = this; // no shadow; use shared theme CSS
  }

  set config(cfg) {
    this._config = Object.assign({}, this._config, cfg || {});
    this.render();
  }

  get config() {
    return this._config;
  }

  connectedCallback() {
    // If no config yet, render a minimal placeholder
    if (!this._hasRendered) {
      this.render();
    }
  }

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

  _renderStyles() {
    return `
      <style>
        .perm-hero {
          margin: 0 0 12px 0;
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
      </style>
    `;
  }

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

    const html = `
      ${this._renderStyles()}
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
  }
}

if (!customElements.get('fv-perms-hero')) {
  customElements.define('fv-perms-hero', FVPermsHero);
}
