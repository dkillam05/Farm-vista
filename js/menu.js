/* /Farm-vista/js/menu.js
   FarmVista navigation config (DATA ONLY).
   The shell will import this and render the drawer.
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
 * @property {{stateKey?: string}} [options]
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
    /* ===== Home ===== */
    {
      type: 'link',
      id: 'home',
      icon: '🏠',
      label: 'Home',
      href: '/Farm-vista/dashboard/index.html',   // <-- UPDATED (lowercase "dashboard")
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: '/Farm-vista/pages/crop-production/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',              href: '/Farm-vista/pages/crop-production/crop-planting.html' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',              href: '/Farm-vista/pages/crop-production/crop-spraying.html' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',            href: '/Farm-vista/pages/crop-production/crop-fertilizer.html' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',               href: '/Farm-vista/pages/crop-production/crop-harvest.html' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications',   href: '/Farm-vista/pages/crop-production/crop-aerial.html' },
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',                href: '/Farm-vista/pages/crop-production/crop-trials.html' },
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',    href: '/Farm-vista/pages/crop-production/crop-maintenance.html' }
      ]
    },

    /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: '/Farm-vista/pages/grain/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bins',  icon: '🛢️', label: 'Grain Bin Inventory',  href: '/Farm-vista/grain-tracking/grain-bins.html' },
        { type: 'link', id: 'grain-bags',  icon: '👝',  label: 'Grain Bag Inventory',  href: '/Farm-vista/grain-tracking/grain-bags.html' },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: '/Farm-vista/grain-tracking/grain-contracts.html' },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets (OCR)',  href: '/Farm-vista/grain-tracking/grain-ticket-ocr.html' }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: '/Farm-vista/pages/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',     icon: '🚜', label: 'Tractors',               href: '/Farm-vista/equipment/equipment-tractors.html' },
        { type: 'link', id: 'eq-sprayers',     icon: '💦', label: 'Sprayers',               href: '/Farm-vista/equipment/equipment-sprayers.html' },
        { type: 'link', id: 'eq-fertilizer',   icon: '🧂', label: 'Fertilizer Equipment',   href: '/Farm-vista/equipment/equipment-fertilizer.html' },
        { type: 'link', id: 'eq-combines',     icon: '🌾', label: 'Combines',               href: '/Farm-vista/equipment/equipment-combines.html' },
        { type: 'link', id: 'eq-implements',   icon: '⚙️', label: 'Implements',             href: '/Farm-vista/equipment/equipment-implements.html' },
        { type: 'link', id: 'eq-construction', icon: '🏗️', label: 'Construction',          href: '/Farm-vista/equipment/equipment-construction.html' },
        { type: 'link', id: 'eq-starfire',     icon: '🛰️', label: 'StarFire / Technology',  href: '/Farm-vista/equipment/equipment-starfire.html' },
        { type: 'link', id: 'eq-trucks',       icon: '🚚', label: 'Trucks',                  href: '/Farm-vista/equipment/equipment-trucks.html' },
        { type: 'link', id: 'eq-trailers',     icon: '🚛', label: 'Trailers',                href: '/Farm-vista/equipment/equipment-trailers.html' }
      ]
    },

    /* ===== Expenses ===== */
    {
      type: 'group',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: '/Farm-vista/pages/expenses/index.html',
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
            { type: 'link', id: 'exp-reports-custom', icon: '🛠️', label: 'Customized Reports', href: '#', activeMatch: 'starts-with' },
            { type: 'link', id: 'exp-reports-predef', icon: '📚', label: 'Predefined Reports', href: '#', activeMatch: 'starts-with' }
          ]
        }
      ]
    },

    /* ===== Office ===== */
    {
      type: 'group',
      id: 'office',
      icon: '🏢',
      label: 'Office',
      href: '/Farm-vista/pages/office/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'office-teams',
          icon: '👥',
          label: 'Teams & Partners',
          href: '/Farm-vista/pages/office/teams-and-partners/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'teams-employees',       icon: '🧑🏼‍🌾',  label: 'Employees',        href: '/Farm-vista/teams-partners/teams-employees.html' },
            { type: 'link', id: 'teams-sub-contractors', icon: '🧰',  label: 'Sub-Contractors',  href: '/Farm-vista/teams-partners/teams-sub-contractors.html' },
            { type: 'link', id: 'teams-vendors',         icon: '🏪',  label: 'Vendors',          href: '/Farm-vista/teams-partners/teams-vendors.html' },
            { type: 'link', id: 'teams-dictionary',      icon: '📖',  label: 'Dictionary',       href: '/Farm-vista/teams-partners/teams-dictionary.html' }
          ]
        },
        { type: 'link', id: 'office-field-boundaries', icon: '🗺️', label: 'Field Boundaries', href: '#', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Calculators ===== */
    {
      type: 'group',
      id: 'calculators',
      icon: '🔢',
      label: 'Calculators',
      href: '/Farm-vista/pages/calculators/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area',        icon: '📐', label: 'Area',                    href: '/Farm-vista/calculators/calc-area.html' },
        { type: 'link', id: 'calc-bin',         icon: '🛢️', label: 'Grain Bin',               href: '/Farm-vista/calculators/calc-grain-bin.html' },
        { type: 'link', id: 'calc-shrink',      icon: '📉', label: 'Grain Shrink',            href: '/Farm-vista/calculators/calc-grain-shrink.html' },
        { type: 'link', id: 'calc-combine-yld', icon: '⚙️', label: 'Combine Yield Cal',       href: '/Farm-vista/calculators/calc-combine-yield.html' },
        { type: 'link', id: 'calc-chem-mix',    icon: '🧪', label: 'Chemical Mix',            href: '/Farm-vista/calculators/calc-chemical-mix.html' },
        { type: 'link', id: 'calc-trial-ylds',  icon: '🧬', label: 'Trial Yields',            href: '/Farm-vista/calculators/calc-trial-yields.html' }
      ]
    },

    /* ===== Reports ===== */
    {
      type: 'group',
      id: 'reports',
      icon: '📑',
      label: 'Reports',
      href: '/Farm-vista/pages/reports/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'reports-custom', icon: '🛠️', label: 'AI Reports (Custom)', href: '/Farm-vista/reports/reports-ai.html' },
        { type: 'link', id: 'reports-predef', icon: '📚', label: 'Predefined Reports',  href: '/Farm-vista/reports/reports-predefined.html' },
        { type: 'link', id: 'reports-history', icon: '🗂️', label: 'AI Report History', href: '/Farm-vista/reports/reports-ai-history.html' }
      ]
    },

    /* ===== Setup ===== */
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: '/Farm-vista/pages/setup/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'setup-message-board', icon: '📢', label: 'Message Board', href: '/Farm-vista/pages/setup/message-board.html', activeMatch: 'exact' },
        { type: 'link', id: 'setup-farms',         icon: '🏷️', label: 'Farms',        href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields',        icon: '🗺️', label: 'Fields',       href: '#', activeMatch: 'starts-with' },
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
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags',  href: '#', activeMatch: 'starts-with' }
          ]
        },
        { type: 'link', id: 'setup-company', icon: '🏢', label: 'Company Details', href: '#', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   icon: '👥', label: 'Account Roles',   href: '#', activeMatch: 'starts-with' }
      ]
    }
  ],

  options: {
    stateKey: 'fv:nav:groups'
  }
};

export default NAV_MENU;