/* /Farm-vista/js/menu.js
   FarmVista navigation config (DATA ONLY).
   The shell will import this and render the drawer.
   No fallbacks — if import fails, shell should show a toast (not a fake menu).
*/

/**
 * @typedef {'link'|'group'} NavItemType
 * @typedef {'starts-with'|'exact'|'regex'} ActiveMatch
 *
 * @typedef NavItem
 * @property {NavItemType} type
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {string} [href]
 * @property {boolean} [external=false]
 * @property {ActiveMatch} [activeMatch='starts-with']
 * @property {boolean} [collapsible=false]
 * @property {boolean} [initialOpen=false]
 * @property {NavItem[]} [children]
 * @property {string[]} [roles]
 */

/**
 * @typedef NavConfig
 * @property {{name:string, location?:string, logo?:string}} org
 * @property {{brand:string, slogan?:string}} footer
 * @property {NavItem[]} items
 * @property {{stateKey?: string}} [options]   // localStorage key for group open/close state
 */

/** @type {NavConfig} */
export const NAV_MENU = {
  org: {
    name: 'Dowson Farms',
    location: 'Divernon, Illinois',
    logo: '/Farm-vista/assets/icons/icon-192.png'
  },

  footer: {
    brand: 'FarmVista',
    slogan: 'Farm data, simplified'
  },

  items: [
    /* ===== Top-level ===== */
    {
      type: 'link',
      id: 'home',
      icon: '🏠',
      label: 'Home',
      href: '/Farm-vista/dashboard/',
      activeMatch: 'starts-with'
    },

    /* ===== Crop Production (with submenus) ===== */
    {
      type: 'group',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '#',                   // landing (placeholder)
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',             href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',             href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',           href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',              href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications', href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',               href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',   href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Equipment (with submenus) ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '#',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',    icon: '🚜', label: 'Tractors',               href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-sprayers',    icon: '💦', label: 'Sprayers',               href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-fertspread',  icon: '👨🏼‍🔬', label: 'Fertilizer Spreader',    href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-combines',    icon: '🌾', label: 'Combines',               href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-implements',  icon: '⚙️', label: 'Implements',             href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-construction',icon: '🏗️', label: 'Construction',          href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-starfire',    icon: '🛰️', label: 'StarFire / Technology',  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-trucks',      icon: '🚚', label: 'Trucks',                  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'eq-trailers',    icon: '🚛', label: 'Trailers',                href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Grain (with submenus) ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '#',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bin',   icon: '🛢️', label: 'Grain Bin Inventory',  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'grain-bag',   icon: '👝', label: 'Grain Bag Inventory',  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets',        href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Calculators (with submenus) ===== */
    {
      type: 'group',
      id: 'calculators',
      icon: '🔢',
      label: 'Calculators',
      href: '/Farm-vista/calculators/',   // landing (placeholder route you created)
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area',       icon: '📐', label: 'Area Calculator',             href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'calc-bin',        icon: '🛢️', label: 'Bin Size Calculator',         href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'calc-shrink',     icon: '📉', label: 'Yield Shrink Calculator',      href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'calc-combinecal', icon: '⚙️', label: 'Combine Yield Calibration',    href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Expenses (now with submenus) ===== */
    {
      type: 'group',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: '/Farm-vista/pages/expenses/index.html',   // landing page to add/view expenses
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'exp-expenditures', icon: '🧾', label: 'Expenditures', href: '#', activeMatch: 'starts-with' },
        {
          type: 'group',
          id: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: '#',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'exp-reports-custom',   icon: '🛠️', label: 'Customized Reports', href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'exp-reports-predef',   icon: '📚', label: 'Predefined Reports', href: '#', activeMatch: 'starts-with' }
          ]
        }
      ]
    },

    /* ===== Reports (emoji changed to 📑; with submenus) ===== */
    {
      type: 'group',
      id: 'reports',
      icon: '📑',                      // changed from 📊 to 📑
      label: 'Reports',
      href: '#',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'reports-custom', icon: '🛠️', label: 'Customized Reports', href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'reports-predef', icon: '📚', label: 'Predefined Reports', href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Setup (existing, expanded; Products subgroup) ===== */
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: '/Farm-vista/pages/setup/index.html', // Setup dashboard path
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'link',
          id: 'setup-message-board',
          icon: '📢',
          label: 'Message Board',
          href: '/Farm-vista/pages/setup/message-board.html',
          activeMatch: 'exact'
        },
        { type: 'link', id: 'setup-farms',  icon: '🏷️', label: 'Farms',  href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields', icon: '🗺️', label: 'Fields', href: '#', activeMatch: 'starts-with' },

        {
          type: 'group',
          id: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          href: '#',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed',       icon: '🌱', label: 'Seed',        href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical',   icon: '🧪', label: 'Chemical',    href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer',  href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags', href: '#', activeMatch: 'starts-with' }
          ]
        },

        { type: 'link', id: 'setup-company', icon: '🏢', label: 'Company Details', href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   icon: '👥', label: 'Account Roles',   href: '#', activeMatch: 'starts-with' }
      ]
      // roles: ['admin'], // (optional) enable later for role-based visibility
    }
  ],

  options: {
    // Where the shell should store open/closed state for groups
    stateKey: 'fv:nav:groups'
  }
};

export default NAV_MENU;