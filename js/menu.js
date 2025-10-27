/* /js/menu.js — FarmVista navigation config (ABSOLUTE PATHS)
   All hrefs are prefixed with /Farm-vista/ so they work on every page,
   regardless of whether the page includes <base href="/Farm-vista/">.
*/

const ROOT = '/Farm-vista/';
const P = (rel) => ROOT + rel.replace(/^\/+/, '');

export const NAV_MENU = {
  org: {
    name: 'Dowson Farms',
    location: 'Divernon, Illinois',
    logo: P('assets/icons/icon-192.png')
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
      href: P('dashboard/index.html'),
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: P('pages/crop-production/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',            href: P('pages/crop-production/planting.html'),    activeMatch: 'exact' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',            href: P('pages/crop-production/spraying.html'),    activeMatch: 'exact' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',          href: P('pages/crop-production/fertilizer.html'),  activeMatch: 'exact' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',             href: P('pages/crop-production/harvest.html'),     activeMatch: 'exact' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications', href: P('pages/crop-production/aerial.html'),      activeMatch: 'exact' },
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',              href: P('pages/crop-production/trials.html'),      activeMatch: 'exact' },
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',  href: P('pages/crop-production/maintenance.html'), activeMatch: 'exact' }
      ]
    },

    /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: P('pages/grain/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bins',  icon: '🛢️', label: 'Grain Bin Inventory',  href: P('pages/grain/grain-bins.html') },
        { type: 'link', id: 'grain-bags',  icon: '👝',  label: 'Grain Bag Inventory',  href: P('pages/grain/grain-bags.html') },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: P('pages/grain/grain-contracts.html') },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets (OCR)',  href: P('pages/grain/grain-ticket-ocr.html') }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: P('pages/equipment/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',     icon: '🚜', label: 'Tractors',               href: P('pages/equipment/equipment-tractors.html') },
        { type: 'link', id: 'eq-sprayers',     icon: '💦', label: 'Sprayers',               href: P('pages/equipment/equipment-sprayers.html') },
        { type: 'link', id: 'eq-fertilizer',   icon: '🧂', label: 'Fertilizer Equipment',   href: P('pages/equipment/equipment-fertilizer.html') },
        { type: 'link', id: 'eq-combines',     icon: '🌾', label: 'Combines',               href: P('pages/equipment/equipment-combines.html') },
        { type: 'link', id: 'eq-implements',   icon: '⚙️', label: 'Implements',             href: P('pages/equipment/equipment-implements.html') },
        { type: 'link', id: 'eq-construction', icon: '🏗️', label: 'Construction',          href: P('pages/equipment/equipment-construction.html') },
        { type: 'link', id: 'eq-starfire',     icon: '🛰️', label: 'StarFire / Technology',  href: P('pages/equipment/equipment-starfire.html') },
        { type: 'link', id: 'eq-trucks',       icon: '🚚', label: 'Trucks',                  href: P('pages/equipment/equipment-trucks.html') },
        { type: 'link', id: 'eq-trailers',     icon: '🚛', label: 'Trailers',                href: P('pages/equipment/equipment-trailers.html') }
      ]
    },

    /* ===== Office ===== */
    {
      type: 'group',
      id: 'office',
      icon: '🏢',
      label: 'Office',
      href: P('pages/office/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'office-teams',
          icon: '👥',
          label: 'Teams & Partners',
          href: P('pages/office/teams-and-partners/index.html'),
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'teams-employees',       icon: '👤', label: 'Employees',       href: P('pages/office/teams-and-partners/employees.html') },
            { type: 'link', id: 'teams-sub-contractors', icon: '🧰', label: 'Sub-Contractors', href: P('pages/office/teams-and-partners/sub-contractors.html') },
            { type: 'link', id: 'teams-vendors',         icon: '🏪', label: 'Vendors',         href: P('pages/office/teams-and-partners/vendors.html') },
            { type: 'link', id: 'teams-dictionary',      icon: '📖', label: 'Dictionary',      href: P('pages/office/teams-and-partners/dictionary.html') }
          ]
        },

        { type: 'link', id: 'office-vehicle-registration', icon: '🚗', label: 'Vehicle Registration', href: P('pages/office/vehicle-registration.html'), activeMatch: 'exact' },
        { type: 'link', id: 'office-field-boundaries',     icon: '🗺️', label: 'Field Boundaries',    href: P('pages/office/field-boundaries.html'),     activeMatch: 'starts-with' }
      ]
    },

    /* ===== Inventory ===== */
    {
      type: 'group',
      id: 'inventory',
      icon: '📦',
      label: 'Inventory',
      href: P('pages/inventory/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'inv-grain-bags', icon: '👝', label: 'Grain Bag Inventory', href: P('pages/inventory/grain-bags.html'), activeMatch: 'starts-with' }
      ]
    },

    /* ===== Expenses ===== */
    {
      type: 'group',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: P('pages/expenses/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'exp-expenditures', icon: '🧾', label: 'Expenditures', href: P('pages/expenses/expenditures.html'), activeMatch: 'starts-with' },
        {
          type: 'group',
          id: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: P('pages/expenses/reports/index.html'),
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'exp-reports-custom',  icon: '🛠️', label: 'Customized Reports', href: P('pages/expenses/reports/custom.html'),     activeMatch: 'starts-with' },
            { type: 'link', id: 'exp-reports-predef',  icon: '📚', label: 'Predefined Reports', href: P('pages/expenses/reports/predefined.html'), activeMatch: 'starts-with' }
          ]
        }
      ]
    },

    /* ===== Calculators ===== */
    {
      type: 'group',
      id: 'calculators',
      icon: '🔢',
      label: 'Calculators',
      href: P('pages/calculators/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area',         icon: '📐', label: 'Area',                          href: P('pages/calculators/calc-area.html') },
        { type: 'link', id: 'calc-bin',          icon: '🛢️', label: 'Grain Bin',                     href: P('pages/calculators/calc-grain-bin.html') },
        { type: 'link', id: 'calc-shrink',       icon: '📉', label: 'Grain Shrink',                  href: P('pages/calculators/calc-grain-shrink.html') },
        { type: 'link', id: 'calc-combine-loss', icon: '🌾', label: 'Combine Grain Loss',            href: P('pages/calculators/calc-combine-grain-loss.html') },
        { type: 'link', id: 'calc-combine-yld',  icon: '✅', label: 'Combine Yield Check',           href: P('pages/calculators/calc-combine-yield.html') },
        { type: 'link', id: 'calc-combine-calibration', icon: '⚖️', label: 'Combine Yield Calibration', href: P('pages/calculators/calc-combine-yield-calibration.html'), activeMatch: 'exact' },
        { type: 'link', id: 'calc-chem-mix',     icon: '🧪', label: 'Chemical Mix',                  href: P('pages/calculators/calc-chemical-mix.html') },
        { type: 'link', id: 'calc-trial-ylds',   icon: '🧬', label: 'Trial Yields',                  href: P('pages/calculators/calc-trial-yields.html') }
      ]
    },

    /* ===== Reports ===== */
    {
      type: 'group',
      id: 'reports',
      icon: '📑',
      label: 'Reports',
      href: P('pages/reports/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'reports-custom',  icon: '🛠️', label: 'AI Reports (Custom)', href: P('pages/reports/reports-ai.html') },
        { type: 'link', id: 'reports-predef',  icon: '📚', label: 'Predefined Reports',  href: P('pages/reports/reports-predefined.html') },
        { type: 'link', id: 'reports-history', icon: '🗂️', label: 'AI Report History',   href: P('pages/reports/reports-ai-history.html') }
      ]
    },

    /* ===== Setup ===== */
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: P('pages/setup/index.html'),
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          href: P('pages/setup/products/index.html'),
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed',       icon: '🌱', label: 'Seed',        href: P('pages/setup/products/seed.html'),        activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical',   icon: '🧪', label: 'Chemical',    href: P('pages/setup/products/chemical.html'),    activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer',  href: P('pages/setup/products/fertilizer.html'),  activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags',  href: P('pages/setup/products/grain-bags.html'),  activeMatch: 'starts-with' }
          ]
        },

        { type: 'link', id: 'setup-message-board', icon: '📢', label: 'Message Board', href: P('pages/setup/message-board.html'), activeMatch: 'exact' },

        { type: 'link', id: 'setup-farms',   icon: '🏷️', label: 'Farms',  href: P('pages/setup/farms.html'),  activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields',  icon: '🗺️', label: 'Fields', href: P('pages/setup/fields.html'), activeMatch: 'starts-with' },

        { 
          type: 'link',
          id: 'setup-grain-sites',
          label: 'Grain Bin Sites',
          icon: `
            <svg viewBox="0 0 24 24" aria-hidden="true"
                 style="width:28px;height:28px;display:block;margin:0 auto;">
              <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
                <path d="M6.5 7 L12 3.8 L17.5 7"/>
                <rect x="7" y="7" width="10" height="13" rx="1.6"/>
                <path d="M10 7v13M14 7v13" stroke-linecap="round"/>
              </g>
            </svg>
          `,
          href: P('pages/setup/grain-bin-sites.html'),
          activeMatch: 'starts-with'
        },

        { type: 'link', id: 'setup-rtk-towers', icon: '🛰️', label: 'RTK Tower Information', href: P('pages/setup/rtk-tower-information.html'), activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-company', label: 'Company Details', icon: '🏢', href: P('pages/setup/company-details.html'), activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   label: 'Account Roles',   icon: '👥', href: P('pages/setup/account-roles.html'),   activeMatch: 'starts-with' }
      ]
    }
  ],

  options: { stateKey: 'fv:nav:groups' }
};

export default NAV_MENU;