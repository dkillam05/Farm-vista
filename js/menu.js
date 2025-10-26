/* /js/menu.js — FarmVista navigation config (BASE-RELATIVE)
   Works with <base href="/Farm-vista/"> so everything resolves under the project site.
*/

export const NAV_MENU = {
  org: {
    name: 'Dowson Farms',
    location: 'Divernon, Illinois',
    logo: 'assets/icons/icon-192.png'
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
      href: 'dashboard/index.html',
      activeMatch: 'exact'
    },

    /* ===== Crop Production ===== */
    {
      type: 'group',
      id: 'crop',
      icon: '🌱',
      label: 'Crop Production',
      href: 'pages/crop-production/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'crop-planting',   icon: '🌱', label: 'Planting',            href: 'pages/crop-production/planting.html',    activeMatch: 'exact' },
        { type: 'link', id: 'crop-spraying',   icon: '💦', label: 'Spraying',            href: 'pages/crop-production/spraying.html',    activeMatch: 'exact' },
        { type: 'link', id: 'crop-fertilizer', icon: '🧂', label: 'Fertilizer',          href: 'pages/crop-production/fertilizer.html',  activeMatch: 'exact' },
        { type: 'link', id: 'crop-harvest',    icon: '🌾', label: 'Harvest',             href: 'pages/crop-production/harvest.html',     activeMatch: 'exact' },
        { type: 'link', id: 'crop-aerial',     icon: '🚁', label: 'Aerial Applications', href: 'pages/crop-production/aerial.html',      activeMatch: 'exact' },
        { type: 'link', id: 'crop-trials',     icon: '🧬', label: 'Trials',              href: 'pages/crop-production/trials.html',      activeMatch: 'exact' },
        { type: 'link', id: 'crop-maint',      icon: '🛠️', label: 'Field Maintenance',  href: 'pages/crop-production/maintenance.html', activeMatch: 'exact' }
      ]
    },

    /* ===== Grain ===== */
    {
      type: 'group',
      id: 'grain',
      icon: '🌾',
      label: 'Grain',
      href: 'pages/grain/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'grain-bins',  icon: '🛢️', label: 'Grain Bin Inventory',  href: 'pages/grain/grain-bins.html' },
        { type: 'link', id: 'grain-bags',  icon: '👝',  label: 'Grain Bag Inventory',  href: 'pages/grain/grain-bags.html' },
        { type: 'link', id: 'grain-ctr',   icon: '📄',  label: 'Grain Contracts',      href: 'pages/grain/grain-contracts.html' },
        { type: 'link', id: 'grain-tix',   icon: '🎟️', label: 'Grain Tickets (OCR)',  href: 'pages/grain/grain-ticket-ocr.html' }
      ]
    },

    /* ===== Equipment ===== */
    {
      type: 'group',
      id: 'equipment',
      icon: '🚜',
      label: 'Equipment',
      href: 'pages/equipment/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'eq-tractors',     icon: '🚜', label: 'Tractors',               href: 'pages/equipment/equipment-tractors.html' },
        { type: 'link', id: 'eq-sprayers',     icon: '💦', label: 'Sprayers',               href: 'pages/equipment/equipment-sprayers.html' },
        { type: 'link', id: 'eq-fertilizer',   icon: '🧂', label: 'Fertilizer Equipment',   href: 'pages/equipment/equipment-fertilizer.html' },
        { type: 'link', id: 'eq-combines',     icon: '🌾', label: 'Combines',               href: 'pages/equipment/equipment-combines.html' },
        { type: 'link', id: 'eq-implements',   icon: '⚙️', label: 'Implements',             href: 'pages/equipment/equipment-implements.html' },
        { type: 'link', id: 'eq-construction', icon: '🏗️', label: 'Construction',          href: 'pages/equipment/equipment-construction.html' },
        { type: 'link', id: 'eq-starfire',     icon: '🛰️', label: 'StarFire / Technology',  href: 'pages/equipment/equipment-starfire.html' },
        { type: 'link', id: 'eq-trucks',       icon: '🚚', label: 'Trucks',                  href: 'pages/equipment/equipment-trucks.html' },
        { type: 'link', id: 'eq-trailers',     icon: '🚛', label: 'Trailers',                href: 'pages/equipment/equipment-trailers.html' }
      ]
    },

    /* ===== Office ===== */
    {
      type: 'group',
      id: 'office',
      icon: '🏢',
      label: 'Office',
      href: 'pages/office/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'office-teams',
          icon: '👥',
          label: 'Teams & Partners',
          href: 'pages/office/teams-and-partners/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'teams-employees',       icon: '👤',     label: 'Employees',        href: 'pages/office/teams-and-partners/employees.html' },
            { type: 'link', id: 'teams-sub-contractors', icon: '🧰',     label: 'Sub-Contractors',  href: 'pages/office/teams-and-partners/sub-contractors.html' },
            { type: 'link', id: 'teams-vendors',         icon: '🏪',     label: 'Vendors',          href: 'pages/office/teams-and-partners/vendors.html' },
            { type: 'link', id: 'teams-dictionary',      icon: '📖',     label: 'Dictionary',       href: 'pages/office/teams-and-partners/dictionary.html' }
          ]
        },

        { type: 'link', id: 'office-vehicle-registration', icon: '🚗', label: 'Vehicle Registration', href: 'pages/office/vehicle-registration.html', activeMatch: 'exact' },
        { type: 'link', id: 'office-field-boundaries',     icon: '🗺️', label: 'Field Boundaries',      href: 'pages/office/field-boundaries.html',     activeMatch: 'starts-with' }
      ]
    },

    /* ===== Inventory ===== */
    {
      type: 'group',
      id: 'inventory',
      icon: '📦',
      label: 'Inventory',
      href: 'pages/inventory/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'inv-grain-bags', icon: '👝', label: 'Grain Bag Inventory', href: 'pages/inventory/grain-bags.html', activeMatch: 'starts-with' }
      ]
    },

    /* ===== Expenses ===== */
    {
      type: 'group',
      id: 'expenses',
      icon: '💵',
      label: 'Expenses',
      href: 'pages/expenses/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'exp-expenditures', icon: '🧾', label: 'Expenditures', href: 'pages/expenses/expenditures.html', activeMatch: 'starts-with' },
        {
          type: 'group',
          id: 'exp-reports',
          icon: '📑',
          label: 'Reports',
          href: 'pages/expenses/reports/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'exp-reports-custom',  icon: '🛠️', label: 'Customized Reports', href: 'pages/expenses/reports/custom.html',     activeMatch: 'starts-with' },
            { type: 'link', id: 'exp-reports-predef',  icon: '📚', label: 'Predefined Reports', href: 'pages/expenses/reports/predefined.html', activeMatch: 'starts-with' }
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
      href: 'pages/calculators/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'calc-area',         icon: '📐', label: 'Area',                         href: 'pages/calculators/calc-area.html' },
        { type: 'link', id: 'calc-bin',          icon: '🛢️', label: 'Grain Bin',                    href: 'pages/calculators/calc-grain-bin.html' },
        { type: 'link', id: 'calc-shrink',       icon: '📉', label: 'Grain Shrink',                 href: 'pages/calculators/calc-grain-shrink.html' },
        { type: 'link', id: 'calc-combine-loss', icon: '🌾', label: 'Combine Grain Loss',           href: 'pages/calculators/calc-combine-grain-loss.html' },
        { type: 'link', id: 'calc-combine-yld',  icon: '✅', label: 'Combine Yield Check',           href: 'pages/calculators/calc-combine-yield.html' },
        { type: 'link', id: 'calc-combine-calibration', icon: '⚖️', label: 'Combine Yield Calibration', href: 'pages/calculators/calc-combine-yield-calibration.html', activeMatch: 'exact' },
        { type: 'link', id: 'calc-chem-mix',     icon: '🧪', label: 'Chemical Mix',                 href: 'pages/calculators/calc-chemical-mix.html' },
        { type: 'link', id: 'calc-trial-ylds',   icon: '🧬', label: 'Trial Yields',                 href: 'pages/calculators/calc-trial-yields.html' }
      ]
    },

    /* ===== Reports ===== */
    {
      type: 'group',
      id: 'reports',
      icon: '📑',
      label: 'Reports',
      href: 'pages/reports/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        { type: 'link', id: 'reports-custom',  icon: '🛠️', label: 'AI Reports (Custom)', href: 'pages/reports/reports-ai.html' },
        { type: 'link', id: 'reports-predef',  icon: '📚', label: 'Predefined Reports',  href: 'pages/reports/reports-predefined.html' },
        { type: 'link', id: 'reports-history', icon: '🗂️', label: 'AI Report History',   href: 'pages/reports/reports-ai-history.html' }
      ]
    },

    /* ===== Setup ===== */
    {
      type: 'group',
      id: 'setup',
      icon: '⚙️',
      label: 'Setup',
      href: 'pages/setup/index.html',
      collapsible: true,
      initialOpen: false,
      children: [
        {
          type: 'group',
          id: 'setup-products',
          icon: '🗂️',
          label: 'Products',
          href: 'pages/setup/products/index.html',
          collapsible: true,
          initialOpen: false,
          children: [
            { type: 'link', id: 'setup-prod-seed',       icon: '🌱', label: 'Seed',        href: 'pages/setup/products/seed.html',        activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-chemical',   icon: '🧪', label: 'Chemical',    href: 'pages/setup/products/chemical.html',    activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-fertilizer', icon: '🧂', label: 'Fertilizer',  href: 'pages/setup/products/fertilizer.html',  activeMatch: 'starts-with' },
            { type: 'link', id: 'setup-prod-grainbags',  icon: '👝', label: 'Grain Bags',  href: 'pages/setup/products/grain-bags.html',  activeMatch: 'starts-with' }
          ]
        },

        { type: 'link', id: 'setup-message-board', icon: '📢', label: 'Message Board', href: 'pages/setup/message-board.html', activeMatch: 'exact' },

        { type: 'link', id: 'setup-farms',   icon: '🏷️', label: 'Farms',  href: 'pages/setup/farms.html',  activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-fields',  icon: '🗺️', label: 'Fields', href: 'pages/setup/fields.html', activeMatch: 'starts-with' },

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
          href: 'pages/setup/grain-bin-sites.html',
          activeMatch: 'starts-with'
        },

        { type: 'link', id: 'setup-rtk-towers', icon: '🛰️', label: 'RTK Tower Information', href: 'pages/setup/rtk-tower-information.html', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-company', label: 'Company Details', icon: '🏢', href: 'pages/setup/company-details.html', activeMatch: 'starts-with' },
        { type: 'link', id: 'setup-roles',   label: 'Account Roles',   icon: '👥', href: 'pages/setup/account-roles.html',   activeMatch: 'starts-with' }
      ]
    }
  ],

  options: { stateKey: 'fv:nav:groups' }
};

export default NAV_MENU;